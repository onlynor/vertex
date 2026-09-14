package video

import (
	"fmt"
	"mime/multipart"
	"path/filepath"
	"strings"
)

const (
	MaxFileSizeBytes = 100 * 1024 * 1024 // 100MB
	MinDurationSec   = 1
	MaxDurationSec   = 60
)

// ffmpeg 能解码这里列出的所有封装格式，所以校验层只管拦掉明显不支持的扩展名；
// 具体某个文件的编码是否浏览器能直接播放，由 NormalizeForPlayback 在保存后探测处理。

var allowedExtensions = map[string]bool{
	".mp4":  true,
	".mov":  true,
	".webm": true,
	".avi":  true,
}

// ValidateDuration 校验训练视频的时长范围。它由服务端在 ffprobe 探测之后执行，
// 因为浏览器无法读取我们支持的所有封装格式的元数据。
func ValidateDuration(seconds float64) error {
	if seconds < MinDurationSec || seconds > MaxDurationSec {
		return fmt.Errorf("视频时长应在 %d 秒 ~ %d 秒之间（当前约 %.0f 秒），建议上传 20~30 秒的颠球片段",
			MinDurationSec, MaxDurationSec, seconds)
	}
	return nil
}

// ValidateUpload 在文件写入磁盘之前就校验格式与大小。
func ValidateUpload(header *multipart.FileHeader) error {
	if header.Size <= 0 {
		return fmt.Errorf("视频文件为空")
	}
	if header.Size > MaxFileSizeBytes {
		return fmt.Errorf("视频文件过大，最大支持 %dMB", MaxFileSizeBytes/1024/1024)
	}
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !allowedExtensions[ext] {
		return fmt.Errorf("不支持的视频格式，仅支持 MP4 / MOV / AVI / WebM")
	}
	return nil
}
