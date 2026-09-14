package video

import (
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
)

const (
	maxFrames  = 12 // 限制帧数，以控制请求体大小与 token 开销
	frameWidth = 640
)

// ExtractFrames 使用 ffmpeg 从视频中等间隔采样 JPEG 帧。
// 大多数 OpenAI 兼容视觉模型都普遍支持图片输入，而对原生视频输入的支持
// 各厂商参差不齐，抽帧是唯一在所有厂商中都通用的输入形式。
//
// 采样间隔由 durationSec 推导而来，这样一段 5 秒的视频和一段 60 秒的视频
// 都能从头到尾被覆盖到，长视频不会只取开头几秒就被截断。
func ExtractFrames(videoPath, outDir string, durationSec float64) ([]string, error) {
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return nil, fmt.Errorf("创建抽帧目录失败: %w", err)
	}

	interval := 2.5
	if durationSec > 0 {
		interval = math.Max(1, durationSec/float64(maxFrames))
	}

	pattern := filepath.Join(outDir, "frame_%03d.jpg")
	cmd := exec.Command("ffmpeg",
		"-y",
		"-i", videoPath,
		"-vf", fmt.Sprintf("fps=1/%.3f,scale=%d:-1", interval, frameWidth),
		"-frames:v", fmt.Sprintf("%d", maxFrames),
		"-q:v", "4",
		pattern,
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg抽帧失败: %w, output: %s", err, string(output))
	}

	matches, err := filepath.Glob(filepath.Join(outDir, "frame_*.jpg"))
	if err != nil {
		return nil, fmt.Errorf("列出抽帧结果失败: %w", err)
	}
	if len(matches) == 0 {
		return nil, fmt.Errorf("未能从视频中抽取到任何帧")
	}
	sort.Strings(matches)
	return matches, nil
}
