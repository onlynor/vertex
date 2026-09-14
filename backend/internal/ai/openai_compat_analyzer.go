package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"football-backend/internal/model"
)

// OpenAICompatAnalyzer 调用任何通过 OpenAI 兼容 /chat/completions 接口提供的视觉模型
// （DeepSeek、豆包/火山方舟、Kimi/Moonshot、通过 DashScope 的 OpenAI 兼容模式接入的
// Qwen-VL 等）
type OpenAICompatAnalyzer struct {
	configProvider ConfigProvider
	httpClient     *http.Client
}

func NewOpenAICompatAnalyzer(provider ConfigProvider) *OpenAICompatAnalyzer {
	return &OpenAICompatAnalyzer{
		configProvider: provider,
		httpClient:     &http.Client{Timeout: 150 * time.Second},
	}
}

// normalizeBaseURL 把裸的接口地址（如 https://api.deepseek.com/）补全成完整的
// chat completions 接口地址；如果地址本身已经完整则保持不变。
func normalizeBaseURL(raw string) string {
	url := strings.TrimRight(raw, "/")
	if strings.HasSuffix(url, "/chat/completions") {
		return url
	}
	return url + "/chat/completions"
}

type chatContentPart struct {
	Type     string    `json:"type"`
	Text     string    `json:"text,omitempty"`
	ImageURL *imageURL `json:"image_url,omitempty"`
}

type imageURL struct {
	URL string `json:"url"`
}

type chatMessage struct {
	Role    string            `json:"role"`
	Content []chatContentPart `json:"content"`
}

type chatRequest struct {
	Model    string        `json:"model"`
	Messages []chatMessage `json:"messages"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (a *OpenAICompatAnalyzer) Analyze(ctx context.Context, framePaths []string, durationSec float64, position string) (*model.AnalysisReport, error) {
	if len(framePaths) == 0 {
		return nil, fmt.Errorf("没有可分析的视频帧")
	}

	cfg, err := a.configProvider()
	if err != nil {
		return nil, fmt.Errorf("读取AI配置失败: %w", err)
	}
	if cfg.APIKey == "" || cfg.BaseURL == "" || cfg.Model == "" {
		return nil, fmt.Errorf("AI 配置不完整，请先在设置页填写 API Key / Base URL / 模型名")
	}

	content := []chatContentPart{{Type: "text", Text: UserPrompt(durationSec, len(framePaths), position)}}
	for _, p := range framePaths {
		dataURL, err := imageToDataURL(p)
		if err != nil {
			return nil, fmt.Errorf("读取抽帧图片失败: %w", err)
		}
		content = append(content, chatContentPart{Type: "image_url", ImageURL: &imageURL{URL: dataURL}})
	}

	reqBody := chatRequest{
		Model: cfg.Model,
		Messages: []chatMessage{
			{Role: "system", Content: []chatContentPart{{Type: "text", Text: SystemPrompt()}}},
			{Role: "user", Content: content},
		},
	}

	payload, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("构建请求失败: %w", err)
	}

	endpoint := normalizeBaseURL(cfg.BaseURL)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("调用AI接口失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	var parsed chatResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w (status %d, body: %s)", err, resp.StatusCode, string(body))
	}
	if parsed.Error != nil {
		return nil, fmt.Errorf("AI接口返回错误: %s", parsed.Error.Message)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("AI接口返回非200状态码: %d, body: %s", resp.StatusCode, string(body))
	}
	if len(parsed.Choices) == 0 {
		return nil, fmt.Errorf("AI接口返回内容为空")
	}

	return extractReport(parsed.Choices[0].Message.Content)
}

// Ping 用于验证一组配置是否可用，供设置页的“测试连接”按钮调用。
func (a *OpenAICompatAnalyzer) Ping(ctx context.Context, cfg Config) error {
	reqBody := chatRequest{
		Model: cfg.Model,
		Messages: []chatMessage{
			{Role: "user", Content: []chatContentPart{{Type: "text", Text: "回复 ok 两个字即可。"}}},
		},
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, normalizeBaseURL(cfg.BaseURL), bytes.NewReader(payload))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("无法连接到该接口地址: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var parsed chatResponse
	_ = json.Unmarshal(body, &parsed)
	if parsed.Error != nil {
		return fmt.Errorf("%s", parsed.Error.Message)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("接口返回状态码 %d", resp.StatusCode)
	}
	return nil
}

func imageToDataURL(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(data), nil
}
