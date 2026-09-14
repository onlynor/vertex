package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
)

// textMessage 的 content 是普通字符串：纯文本模型只接受这种写法，视觉模型两种写法都接受，
// 因此评语这类纯文字任务用它兼容性最好。
type textMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type textRequest struct {
	Model    string        `json:"model"`
	Messages []textMessage `json:"messages"`
}

// 部分推理模型会把思考过程用 <think> 标签混在正文里返回，这部分不能展示给老师。
var thinkBlock = regexp.MustCompile(`(?s)<think>.*?</think>`)

// Complete 发送一轮纯文本对话并返回模型回复，供评语、课堂总评等文字生成使用。
// 与视频分析共用同一份模型配置，设置页改了模型后这里同样立即生效。
func (a *OpenAICompatAnalyzer) Complete(ctx context.Context, system, user string) (string, error) {
	cfg, err := a.configProvider()
	if err != nil {
		return "", fmt.Errorf("读取AI配置失败: %w", err)
	}
	if cfg.APIKey == "" || cfg.BaseURL == "" || cfg.Model == "" {
		return "", fmt.Errorf("AI 配置不完整，请先在设置页填写 API Key / Base URL / 模型名")
	}

	payload, err := json.Marshal(textRequest{
		Model: cfg.Model,
		Messages: []textMessage{
			{Role: "system", Content: system},
			{Role: "user", Content: user},
		},
	})
	if err != nil {
		return "", fmt.Errorf("构建请求失败: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, normalizeBaseURL(cfg.BaseURL), bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("创建请求失败: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("调用AI接口失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("读取响应失败: %w", err)
	}

	var parsed chatResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("解析响应失败: %w (status %d)", err, resp.StatusCode)
	}
	if parsed.Error != nil {
		return "", fmt.Errorf("AI接口返回错误: %s", parsed.Error.Message)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("AI接口返回非200状态码: %d", resp.StatusCode)
	}
	if len(parsed.Choices) == 0 {
		return "", fmt.Errorf("AI接口返回内容为空")
	}

	text := strings.TrimSpace(thinkBlock.ReplaceAllString(parsed.Choices[0].Message.Content, ""))
	if text == "" {
		return "", fmt.Errorf("AI接口返回内容为空")
	}
	return text, nil
}
