package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"football-backend/internal/auth"
	"football-backend/internal/model"
)

type AuthHandler struct {
	db          *gorm.DB
	auth        *auth.Service
	appPassword string
}

func NewAuthHandler(db *gorm.DB, authSvc *auth.Service, appPassword string) *AuthHandler {
	return &AuthHandler{db: db, auth: authSvc, appPassword: appPassword}
}

// checkAccessPassword 校验登录/注册前的访问口令。APP_PASSWORD 未配置时直接放行，
// 这样本地开发和还没配置这项的部署不受影响。
func (h *AuthHandler) checkAccessPassword(c *gin.Context, provided string) bool {
	if h.appPassword == "" {
		return true
	}
	if provided != h.appPassword {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "访问密码不正确，请向管理员获取"})
		return false
	}
	return true
}

type loginRequest struct {
	Username       string `json:"username" binding:"required"`
	Password       string `json:"password" binding:"required"`
	AccessPassword string `json:"access_password"`
}

// Login 处理 POST /api/auth/login 接口。
func (h *AuthHandler) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请填写用户名和密码"})
		return
	}
	if !h.checkAccessPassword(c, req.AccessPassword) {
		return
	}

	var teacher model.Teacher
	if err := h.db.Where("username = ?", req.Username).First(&teacher).Error; err != nil {
		// 用户不存在与密码错误返回同一提示，避免泄露哪些用户名已注册。
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}
	if !auth.CheckPassword(teacher.PasswordHash, req.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	token, expiresAt, err := h.auth.IssueToken(teacher.ID, teacher.Username, teacher.Name, teacher.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "登录失败，请重试"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":      token,
		"expires_at": expiresAt,
		"teacher":    teacher,
	})
}

// Me 处理 GET /api/auth/me 接口。
func (h *AuthHandler) Me(c *gin.Context) {
	claims := auth.CurrentTeacher(c)
	var teacher model.Teacher
	if err := h.db.First(&teacher, claims.TeacherID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "账号不存在"})
		return
	}
	c.JSON(http.StatusOK, teacher)
}

type changePasswordRequest struct {
	OldPassword string `json:"old_password" binding:"required"`
	NewPassword string `json:"new_password" binding:"required"`
}

// ChangePassword 处理 POST /api/auth/password 接口。
func (h *AuthHandler) ChangePassword(c *gin.Context) {
	var req changePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请填写原密码和新密码"})
		return
	}
	// 与注册采用同样的规则，避免已有账号退化成弱密码。
	if err := validatePassword(req.NewPassword); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	claims := auth.CurrentTeacher(c)
	var teacher model.Teacher
	if err := h.db.First(&teacher, claims.TeacherID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "账号不存在"})
		return
	}
	if !auth.CheckPassword(teacher.PasswordHash, req.OldPassword) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "原密码不正确"})
		return
	}

	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码更新失败"})
		return
	}
	if err := h.db.Model(&teacher).Update("password_hash", hash).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码更新失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "密码已更新"})
}
