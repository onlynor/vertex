package video

import (
	"os/exec"
	"strconv"
	"strings"
)

// ProbeDuration 通过 ffprobe 返回视频时长（秒）。若返回 0 且无错误，
// 表示探测未能得出时长；调用方应把这种情况当作“未知”而不是硬性失败。
func ProbeDuration(path string) (float64, error) {
	cmd := exec.Command("ffprobe",
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		path,
	)
	out, err := cmd.Output()
	if err != nil {
		return 0, err
	}
	value := strings.TrimSpace(string(out))
	duration, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0, nil
	}
	return duration, nil
}
