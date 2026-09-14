package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"gorm.io/gorm"

	"football-backend/internal/ai"
	"football-backend/internal/crypto"
	"football-backend/internal/model"
	"football-backend/internal/video"
)

const aiCallTimeout = 150 * time.Second

// Analysis 负责 视频→抽帧→AI 分析→加密入库 这条完整流水线。
type Analysis struct {
	db          *gorm.DB
	analyzer    ai.Analyzer
	cipher      *crypto.Cipher
	store       *video.Store
	framesDir   string
	concurrency chan struct{}
}

func NewAnalysis(
	db *gorm.DB,
	analyzer ai.Analyzer,
	cipher *crypto.Cipher,
	store *video.Store,
	framesDir string,
	maxConcurrent int,
) *Analysis {
	return &Analysis{
		db:          db,
		analyzer:    analyzer,
		cipher:      cipher,
		store:       store,
		framesDir:   framesDir,
		concurrency: make(chan struct{}, maxConcurrent),
	}
}

// Run 异步执行分析，并随着进度更新对应的视频记录。position 是学生的场上位置，可为空。
func (s *Analysis) Run(videoID uint, videoPath string, durationSec float64, position string) {
	// 上传的视频会被保留供回放；这里只清理采样帧，它们纯粹是为了喂给模型而存在。
	framesDir := filepath.Join(s.framesDir, fmt.Sprintf("v%d", videoID))
	defer func() {
		if err := os.RemoveAll(framesDir); err != nil {
			log.Printf("video %d: delete temp frames failed: %v", videoID, err)
		}
		s.evictExpired()
	}()

	select {
	case s.concurrency <- struct{}{}:
		defer func() { <-s.concurrency }()
	case <-time.After(60 * time.Second):
		s.fail(videoID, "系统繁忙，请稍后重试")
		return
	}

	s.setStatus(videoID, model.StatusProcessing)

	framePaths, err := video.ExtractFrames(videoPath, framesDir, durationSec)
	if err != nil {
		log.Printf("video %d: extract frames failed: %v", videoID, err)
		s.fail(videoID, "视频处理失败，请确认视频文件未损坏")
		return
	}

	s.saveThumbnail(videoID, framePaths[len(framePaths)/2])

	ctx, cancel := context.WithTimeout(context.Background(), aiCallTimeout)
	defer cancel()

	report, err := s.analyzer.Analyze(ctx, framePaths, durationSec, position)
	if err != nil {
		log.Printf("video %d: analyze failed: %v", videoID, err)
		s.fail(videoID, "AI分析失败，请检查设置页的模型配置后重试")
		return
	}

	plaintext, err := json.Marshal(report)
	if err != nil {
		s.fail(videoID, "分析结果序列化失败")
		return
	}
	sealed, err := s.cipher.Encrypt(plaintext)
	if err != nil {
		s.fail(videoID, "分析结果加密失败")
		return
	}

	now := time.Now()
	if err := s.db.Model(&model.Video{}).Where("id = ?", videoID).Updates(map[string]interface{}{
		"status":        model.StatusDone,
		"training_type": report.TrainingType,
		"result_cipher": sealed,
		"completed_at":  &now,
		"error_msg":     "",
	}).Error; err != nil {
		log.Printf("video %d: persist result failed: %v", videoID, err)
	}
}

// evictExpired 把视频存储清理回容量上限以内，并把文件已被删除的记录标记为
// 已清理，这样界面就不会再为磁盘上已不存在的视频提供回放入口。
func (s *Analysis) evictExpired() {
	evicted := s.store.Enforce()
	for _, path := range evicted {
		if err := s.db.Model(&model.Video{}).Where("stored_path = ?", path).
			Updates(map[string]interface{}{"video_stored": false, "stored_path": ""}).Error; err != nil {
			log.Printf("video store: mark evicted %s failed: %v", path, err)
		}
	}
}

// saveThumbnail 保留片段中间的一帧作为报告封面。这里失败最多只是让界面
// 失去封面图，因此绝不会导致整次分析失败。
func (s *Analysis) saveThumbnail(videoID uint, framePath string) {
	raw, err := os.ReadFile(framePath)
	if err != nil {
		log.Printf("video %d: read thumbnail frame failed: %v", videoID, err)
		return
	}
	sealed, err := s.cipher.Encrypt(raw)
	if err != nil {
		log.Printf("video %d: encrypt thumbnail failed: %v", videoID, err)
		return
	}
	if err := s.db.Model(&model.Video{}).Where("id = ?", videoID).
		Update("thumb_cipher", sealed).Error; err != nil {
		log.Printf("video %d: persist thumbnail failed: %v", videoID, err)
	}
}

// DecryptThumbnail 解密已保存的封面图。
func (s *Analysis) DecryptThumbnail(v *model.Video) ([]byte, error) {
	if len(v.ThumbCipher) == 0 {
		return nil, nil
	}
	return s.cipher.Decrypt(v.ThumbCipher)
}

// DecryptReport 解密已保存的报告，用于返回给已认证用户。
func (s *Analysis) DecryptReport(v *model.Video) (*model.AnalysisReport, error) {
	if len(v.ResultCipher) == 0 {
		return nil, nil
	}
	plaintext, err := s.cipher.Decrypt(v.ResultCipher)
	if err != nil {
		return nil, err
	}
	var report model.AnalysisReport
	if err := json.Unmarshal(plaintext, &report); err != nil {
		return nil, err
	}
	return &report, nil
}

func (s *Analysis) setStatus(videoID uint, status model.VideoStatus) {
	if err := s.db.Model(&model.Video{}).Where("id = ?", videoID).
		Update("status", status).Error; err != nil {
		log.Printf("video %d: update status failed: %v", videoID, err)
	}
}

func (s *Analysis) fail(videoID uint, message string) {
	now := time.Now()
	if err := s.db.Model(&model.Video{}).Where("id = ?", videoID).Updates(map[string]interface{}{
		"status":       model.StatusFailed,
		"error_msg":    message,
		"completed_at": &now,
	}).Error; err != nil {
		log.Printf("video %d: update failure state failed: %v", videoID, err)
	}
}
