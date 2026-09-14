package video

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// transcodeTimeout 给转码留足够余量：受 MaxFileSizeBytes 和 MaxDurationSec 限制，
// 一段训练视频最长 60 秒、最大 100MB，veryfast 预设下正常应在数秒到数十秒内完成。
const transcodeTimeout = 180 * time.Second

type codecInfo struct {
	videoCodec string // 空字符串表示没有视频流
	audioCodec string // 空字符串表示没有音频流（或没有探测到）
}

// NormalizeForPlayback 确保保存在磁盘上的视频能被主流桌面浏览器直接播放。
//
// 手机拍摄、经微信转发的视频经常是 HEVC(H.265) 编码，或者用 .mov/.avi 封装——
// 这些组合服务端的 ffmpeg 都能正常解码（抽帧、AI 分析不受影响），但 Chrome/Firefox
// 在 Windows/Linux 上普遍没有对应的解码器，导致回放黑屏。这里探测编码，命中已知
// 能被浏览器播放的组合就直接保留原文件，否则转码成 H.264/AAC 的 MP4 再落盘，
// 避免给每个视频都白白付一次转码的 CPU 成本。
//
// 传入 srcPath 已经保存在 dir 目录下、文件名为 taskID+原始扩展名。转码发生时，
// 原始文件会被删除，只保留转码后的 taskID+".mp4"，避免同一份视频存两份占用存储。
func NormalizeForPlayback(srcPath, dir, taskID string) (string, error) {
	info, err := probeCodecs(srcPath)
	if err != nil {
		return "", fmt.Errorf("探测视频编码失败: %w", err)
	}
	if isBrowserSafe(srcPath, info) {
		return srcPath, nil
	}

	tmpPath := filepath.Join(dir, taskID+".transcoding.mp4")
	if err := transcodeToH264(srcPath, tmpPath); err != nil {
		os.Remove(tmpPath)
		return "", err
	}

	finalPath := filepath.Join(dir, taskID+".mp4")
	if err := os.Remove(srcPath); err != nil && !os.IsNotExist(err) {
		os.Remove(tmpPath)
		return "", fmt.Errorf("清理原始视频失败: %w", err)
	}
	if finalPath != tmpPath {
		if err := os.Rename(tmpPath, finalPath); err != nil {
			return "", fmt.Errorf("重命名转码结果失败: %w", err)
		}
	}
	return finalPath, nil
}

// isBrowserSafe 判断“容器 + 编码”这个组合是否能被 Chrome/Firefox/Edge 直接播放。
// 即便编码本身兼容，.mov/.avi 容器在这些浏览器里也不保证能播，所以按扩展名分别判断。
func isBrowserSafe(path string, info codecInfo) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".mp4":
		return info.videoCodec == "h264" && (info.audioCodec == "" || info.audioCodec == "aac")
	case ".webm":
		return (info.videoCodec == "vp8" || info.videoCodec == "vp9") &&
			(info.audioCodec == "" || info.audioCodec == "opus" || info.audioCodec == "vorbis")
	default:
		return false
	}
}

type ffprobeStreams struct {
	Streams []struct {
		CodecType string `json:"codec_type"`
		CodecName string `json:"codec_name"`
	} `json:"streams"`
}

// probeCodecs 读取视频流和音频流各自的编码名称。
func probeCodecs(path string) (codecInfo, error) {
	cmd := exec.Command("ffprobe",
		"-v", "error",
		"-show_entries", "stream=codec_type,codec_name",
		"-of", "json",
		path,
	)
	out, err := cmd.Output()
	if err != nil {
		return codecInfo{}, err
	}

	var parsed ffprobeStreams
	if err := json.Unmarshal(out, &parsed); err != nil {
		return codecInfo{}, fmt.Errorf("解析ffprobe输出失败: %w", err)
	}

	var info codecInfo
	for _, s := range parsed.Streams {
		switch s.CodecType {
		case "video":
			if info.videoCodec == "" {
				info.videoCodec = s.CodecName
			}
		case "audio":
			if info.audioCodec == "" {
				info.audioCodec = s.CodecName
			}
		}
	}
	return info, nil
}

// transcodeToH264 把任意 ffmpeg 能解码的视频转成 H.264/AAC 的 MP4。
// +faststart 把 moov 元数据移到文件头部，这样浏览器边下边播、拖动进度条时不用先拉完整个文件。
func transcodeToH264(srcPath, dstPath string) error {
	ctx, cancel := context.WithTimeout(context.Background(), transcodeTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-y",
		"-i", srcPath,
		"-c:v", "libx264",
		"-profile:v", "main",
		"-pix_fmt", "yuv420p",
		"-preset", "veryfast",
		"-crf", "23",
		"-c:a", "aac",
		"-b:a", "128k",
		"-movflags", "+faststart",
		dstPath,
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("视频转码失败: %w, output: %s", err, string(output))
	}
	return nil
}
