package settings

import (
	"os"

	"gorm.io/gorm"

	"football-backend/internal/crypto"
	"football-backend/internal/model"
)

const (
	KeyAPIKey  = "llm_api_key"
	KeyBaseURL = "llm_base_url"
	KeyModel   = "llm_model"
)

// LLMConfig 是分析器调用任何 OpenAI 兼容厂商所需的信息。
type LLMConfig struct {
	APIKey  string `json:"api_key"`
	BaseURL string `json:"base_url"`
	Model   string `json:"model"`
}

// Service 负责持久化从网页界面填写的 LLM 设置。API Key 在落库时用 AES-GCM
// 加密；.env 中的值作为首次启动的兜底，保证全新安装、尚未打开设置页时也能正常工作。
type Service struct {
	db     *gorm.DB
	cipher *crypto.Cipher
}

func NewService(db *gorm.DB, cipher *crypto.Cipher) *Service {
	return &Service{db: db, cipher: cipher}
}

func (s *Service) GetLLMConfig() (LLMConfig, error) {
	cfg := LLMConfig{
		APIKey:  os.Getenv("API_KEY"),
		BaseURL: os.Getenv("base_url"),
		Model:   os.Getenv("model"),
	}

	var rows []model.Setting
	if err := s.db.Find(&rows).Error; err != nil {
		return cfg, err
	}

	for _, row := range rows {
		value := row.Value
		if row.Encrypted && value != "" {
			plain, err := s.cipher.DecryptString(value)
			if err != nil {
				return cfg, err
			}
			value = plain
		}
		if value == "" {
			continue
		}
		switch row.Key {
		case KeyAPIKey:
			cfg.APIKey = value
		case KeyBaseURL:
			cfg.BaseURL = value
		case KeyModel:
			cfg.Model = value
		}
	}
	return cfg, nil
}

func (s *Service) SaveLLMConfig(cfg LLMConfig) error {
	// 界面传来的空 API Key 表示“沿用已保存的那份”。前端永远不会拿回明文 Key，
	// 因此它也无法把 Key 原样回传给我们。
	if cfg.APIKey != "" {
		sealed, err := s.cipher.EncryptString(cfg.APIKey)
		if err != nil {
			return err
		}
		if err := s.upsert(KeyAPIKey, sealed, true); err != nil {
			return err
		}
	}
	if err := s.upsert(KeyBaseURL, cfg.BaseURL, false); err != nil {
		return err
	}
	return s.upsert(KeyModel, cfg.Model, false)
}

func (s *Service) upsert(key, value string, encrypted bool) error {
	row := model.Setting{Key: key, Value: value, Encrypted: encrypted}
	return s.db.Save(&row).Error
}
