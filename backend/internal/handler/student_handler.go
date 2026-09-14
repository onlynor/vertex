package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"football-backend/internal/auth"
	"football-backend/internal/classes"
	"football-backend/internal/model"
)

type StudentHandler struct {
	db *gorm.DB
}

func NewStudentHandler(db *gorm.DB) *StudentHandler {
	return &StudentHandler{db: db}
}

// List 处理 GET /api/students 接口，可按关键字过滤。
func (h *StudentHandler) List(c *gin.Context) {
	query := h.db.Model(&model.Student{}).Order("created_at DESC")

	if keyword := c.Query("keyword"); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("name LIKE ? OR student_no LIKE ? OR class_name LIKE ?", like, like, like)
	}
	if className, ok := c.GetQuery("class_name"); ok {
		query = query.Where("class_name = ?", className)
	}

	var students []model.Student
	if err := query.Find(&students).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询学生列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": students})
}

type studentRequest struct {
	Name      string `json:"name" binding:"required"`
	StudentNo string `json:"student_no"`
	ClassName string `json:"class_name"`
	Gender    string `json:"gender"`
	Age       int    `json:"age"`
	Position  string `json:"position"`
}

// Create 处理 POST /api/students 接口。
func (h *StudentHandler) Create(c *gin.Context) {
	var req studentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请填写学生姓名"})
		return
	}
	position, err := normalizePosition(req.Position)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	claims := auth.CurrentTeacher(c)
	student := model.Student{
		Name:      req.Name,
		StudentNo: req.StudentNo,
		ClassName: classes.Normalize(req.ClassName),
		Gender:    req.Gender,
		Age:       req.Age,
		Position:  position,
		TeacherID: claims.TeacherID,
	}
	if err := h.db.Create(&student).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建学生失败"})
		return
	}
	c.JSON(http.StatusCreated, student)
}

// Update 处理 PUT /api/students/:id 接口。
func (h *StudentHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "学生ID非法"})
		return
	}

	var req studentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请填写学生姓名"})
		return
	}
	position, err := normalizePosition(req.Position)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var student model.Student
	if err := h.db.First(&student, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "学生不存在"})
		return
	}

	if err := h.db.Model(&student).Updates(map[string]interface{}{
		"name":       req.Name,
		"student_no": req.StudentNo,
		"class_name": classes.Normalize(req.ClassName),
		"gender":     req.Gender,
		"age":        req.Age,
		"position":   position,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新学生失败"})
		return
	}
	c.JSON(http.StatusOK, student)
}

// Delete 处理 DELETE /api/students/:id 接口。
func (h *StudentHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "学生ID非法"})
		return
	}
	if err := h.db.Delete(&model.Student{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除学生失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}
