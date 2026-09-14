package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"football-backend/internal/ai"
	"football-backend/internal/settings"
)

type SettingHandler struct {
	settings *settings.Service
	analyzer *ai.OpenAICompatAnalyzer
}

func NewSettingHandler(settingsSvc *settings.Service, analyzer *ai.OpenAICompatAnalyzer) *SettingHandler {
	return &SettingHandler{settings: settingsSvc, analyzer: analyzer}
}

// GetLLM 处理 GET /api/settings/llm 接口。API Key 从不以明文返回，
// 只返回是否已配置以及脱敏后的提示。
func (h *SettingHandler) GetLLM(c *gin.Context) {
	cfg, err := h.settings.GetLLMConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取配置失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"base_url":       cfg.BaseURL,
		"model":          cfg.Model,
		"api_key_masked": maskKey(cfg.APIKey),
		"has_api_key":    cfg.APIKey != "",
	})
}

type llmSettingRequest struct {
	APIKey  string `json:"api_key"`
	BaseURL string `json:"base_url" binding:"required"`
	Model   string `json:"model" binding:"required"`
}

// SaveLLM 处理 PUT /api/settings/llm 接口。api_key 为空表示保留已保存的 Key。
func (h *SettingHandler) SaveLLM(c *gin.Context) {
	var req llmSettingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "接口地址和模型名不能为空"})
		return
	}
	if err := h.settings.SaveLLMConfig(settings.LLMConfig{
		APIKey:  req.APIKey,
		BaseURL: req.BaseURL,
		Model:   req.Model,
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存配置失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "配置已保存"})
}

// TestLLM 处理 POST /api/settings/llm/test 接口，在用户用某组配置上传视频之前，
// 先验证这组配置确实能连通厂商接口。
func (h *SettingHandler) TestLLM(c *gin.Context) {
	var req llmSettingRequest
	_ = c.ShouldBindJSON(&req)

	cfg, err := h.settings.GetLLMConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取配置失败"})
		return
	}
	// 测试用户在表单中当前看到的内容，对未修改的字段回退到已保存的值。
	if req.APIKey != "" {
		cfg.APIKey = req.APIKey
	}
	if req.BaseURL != "" {
		cfg.BaseURL = req.BaseURL
	}
	if req.Model != "" {
		cfg.Model = req.Model
	}
	if cfg.APIKey == "" || cfg.BaseURL == "" || cfg.Model == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请先填写完整的 API Key / 接口地址 / 模型名"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	if err := h.analyzer.Ping(ctx, ai.Config{APIKey: cfg.APIKey, BaseURL: cfg.BaseURL, Model: cfg.Model}); err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": "连接成功，模型可正常调用"})
}

func maskKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 8 {
		return "****"
	}
	return key[:4] + "••••••••" + key[len(key)-4:]
}
