package handler

import (
	"net/http"
	"os"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"football-backend/internal/auth"
	"football-backend/internal/model"
	"football-backend/internal/service"
	"football-backend/internal/video"
)

type VideoHandler struct {
	db       *gorm.DB
	analysis *service.Analysis
	store    *video.Store
}

func NewVideoHandler(db *gorm.DB, analysis *service.Analysis, store *video.Store) *VideoHandler {
	return &VideoHandler{db: db, analysis: analysis, store: store}
}

// videoResponse 是前端消费的数据结构：记录本身、解密后的报告和学生姓名。
type videoResponse struct {
	model.Video
	StudentName string                `json:"student_name"`
	Report      *model.AnalysisReport `json:"report"`
}

// Analyze 处理 POST /api/videos/analyze 接口：校验、保存、创建数据库记录、
// 启动异步分析后立即返回。
func (h *VideoHandler) Analyze(c *gin.Context) {
	fileHeader, err := c.FormFile("video")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未找到上传的视频文件"})
		return
	}
	if err := video.ValidateUpload(fileHeader); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	studentID, err := strconv.ParseUint(c.PostForm("student_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择本次训练的学生"})
		return
	}
	var student model.Student
	if err := h.db.First(&student, studentID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "所选学生不存在"})
		return
	}

	taskID := uuid.NewString()
	rawPath, err := h.store.Save(taskID, fileHeader)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存视频失败，请重试"})
		return
	}

	// 手机拍摄、微信转发的视频常见 HEVC 编码或 .mov/.avi 封装，桌面浏览器普遍放不了；
	// 这里探测并按需转码成 H.264/AAC 的 MP4，之后的时长校验、入库、回放都基于这份
	// 保证能播放的文件。已经是浏览器兼容格式的视频不受影响，直接跳过转码。
	savedPath, err := video.NormalizeForPlayback(rawPath, h.store.Dir(), taskID)
	if err != nil {
		_ = video.Delete(rawPath)
		c.JSON(http.StatusBadRequest, gin.H{"error": "视频文件无法解析，请确认文件未损坏或更换格式后重试"})
		return
	}

	// 权威的时长校验在这里：浏览器无法读取所有已接受封装格式的元数据
	// （尤其是 AVI），因此前端的校验仅供参考。
	duration, _ := video.ProbeDuration(savedPath)
	if duration > 0 {
		if err := video.ValidateDuration(duration); err != nil {
			_ = video.Delete(savedPath)
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	claims := auth.CurrentTeacher(c)
	record := model.Video{
		TaskID:       taskID,
		StudentID:    student.ID,
		TeacherID:    claims.TeacherID,
		Filename:     fileHeader.Filename,
		SizeBytes:    fileHeader.Size,
		DurationSec:  duration,
		TrainingType: "识别中",
		Status:       model.StatusPending,
		StoredPath:   savedPath,
		VideoStored:  true,
	}
	if err := h.db.Create(&record).Error; err != nil {
		_ = video.Delete(savedPath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建分析任务失败"})
		return
	}

	// 学生设置了场上位置时，分析会重点看该位置的专项动作。
	go h.analysis.Run(record.ID, savedPath, duration, student.Position)

	c.JSON(http.StatusAccepted, gin.H{"id": record.ID, "task_id": record.TaskID, "status": record.Status})
}

// Get 处理 GET /api/videos/:id 接口。
func (h *VideoHandler) Get(c *gin.Context) {
	record, ok := h.findVideo(c)
	if !ok {
		return
	}

	report, err := h.analysis.DecryptReport(record)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "分析结果解密失败"})
		return
	}

	resp := videoResponse{Video: *record, Report: report}
	if record.Student != nil {
		resp.StudentName = record.Student.Name
	}
	c.JSON(http.StatusOK, resp)
}

// List 处理 GET /api/videos 接口，支持 status / student_id 过滤。
func (h *VideoHandler) List(c *gin.Context) {
	query := h.db.Model(&model.Video{}).Preload("Student").Order("created_at DESC")

	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}
	if studentID := c.Query("student_id"); studentID != "" {
		query = query.Where("student_id = ?", studentID)
	}
	if className, ok := c.GetQuery("class_name"); ok {
		query = query.Where("student_id IN (?)", h.db.Model(&model.Student{}).Select("id").Where("class_name = ?", className))
	}
	limit := 100
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 500 {
		limit = v
	}

	var records []model.Video
	if err := query.Limit(limit).Find(&records).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询分析记录失败"})
		return
	}

	items := make([]videoResponse, 0, len(records))
	for i := range records {
		report, err := h.analysis.DecryptReport(&records[i])
		if err != nil {
			// 单条记录解密失败不应让整个列表变空白。
			report = nil
		}
		item := videoResponse{Video: records[i], Report: report}
		if records[i].Student != nil {
			item.StudentName = records[i].Student.Name
		}
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// Thumbnail 处理 GET /api/videos/:id/thumb 接口，返回解密后的封面图。
func (h *VideoHandler) Thumbnail(c *gin.Context) {
	record, ok := h.findVideo(c)
	if !ok {
		return
	}
	raw, err := h.analysis.DecryptThumbnail(record)
	if err != nil || raw == nil {
		c.Status(http.StatusNotFound)
		return
	}
	c.Data(http.StatusOK, "image/jpeg", raw)
}

// File 处理 GET /api/videos/:id/file 接口，以流式方式返回保留的视频。
// http.ServeFile 支持 Range 请求，因此播放器可以拖动进度条。
func (h *VideoHandler) File(c *gin.Context) {
	record, ok := h.findVideo(c)
	if !ok {
		return
	}
	if !record.VideoStored || record.StoredPath == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "该视频已不在服务器上"})
		return
	}
	if _, err := os.Stat(record.StoredPath); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "该视频已不在服务器上"})
		return
	}
	http.ServeFile(c.Writer, c.Request, record.StoredPath)
}

// Delete 处理 DELETE /api/videos/:id 接口，删除记录及其视频文件。
func (h *VideoHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "记录ID非法"})
		return
	}

	var record model.Video
	if err := h.db.First(&record, id).Error; err == nil {
		_ = video.Delete(record.StoredPath)
	}
	if err := h.db.Delete(&model.Video{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除记录失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

// findVideo 把 :id 解析为数字主键或任务 UUID 两种形式之一。
func (h *VideoHandler) findVideo(c *gin.Context) (*model.Video, bool) {
	idParam := c.Param("id")
	query := h.db.Preload("Student")

	var record model.Video
	var err error
	if numericID, convErr := strconv.ParseUint(idParam, 10, 64); convErr == nil {
		err = query.First(&record, numericID).Error
	} else {
		err = query.Where("task_id = ?", idParam).First(&record).Error
	}
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "分析记录不存在"})
		return nil, false
	}
	return &record, true
}
