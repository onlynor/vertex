package ai

import (
	"context"

	"football-backend/internal/model"
)

// Config 是访问 OpenAI 兼容模型接口所需的全部配置。
// 它在每次调用时解析，因此在设置页修改配置后无需重启服务器即可生效。
type Config struct {
	APIKey  string
	BaseURL string
	Model   string
}

// ConfigProvider 在每次分析请求时返回当前有效的模型配置。
type ConfigProvider func() (Config, error)

// Analyzer 把业务代码与任何具体厂商的模型解耦。
// framePaths 是从训练视频中采样出的、保存在本地的 JPEG 帧（参见 internal/video.ExtractFrames）。
// 发送图片而非原始视频，是所有 OpenAI 兼容视觉 API 都支持的输入形式，
// 因此只需修改 API Key / Base URL / 模型名，同一个实现即可对接 DeepSeek、豆包、Kimi、Qwen-VL 等。
// position 是学生的场上位置（可为空），分析时会重点看该位置的专项动作。
type Analyzer interface {
	Analyze(ctx context.Context, framePaths []string, durationSec float64, position string) (*model.AnalysisReport, error)
}
