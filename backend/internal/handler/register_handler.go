package handler

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"

	"football-backend/internal/auth"
	"football-backend/internal/model"
)

const (
	credentialMinLen = 6
	credentialMaxLen = 12
)

var (
	alphanumeric = regexp.MustCompile(`^[A-Za-z0-9]+$`)
	hasLetter    = regexp.MustCompile(`[A-Za-z]`)
	hasDigit     = regexp.MustCompile(`[0-9]`)
)

type registerRequest struct {
	Username       string `json:"username" binding:"required"`
	Password       string `json:"password" binding:"required"`
	Name           string `json:"name"`
	AccessPassword string `json:"access_password"`
}

// Register 处理 POST /api/auth/register 接口。因为该接口是公开的，
// 规则不能只靠浏览器端校验，必须在这里强制执行。
func (h *AuthHandler) Register(c *gin.Context) {
	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请填写用户名和密码"})
		return
	}
	// 访问口令放在其他校验之前：没有口令的人不该借助用户名规则的报错
	// 探测出哪些用户名已经被占用。
	if !h.checkAccessPassword(c, req.AccessPassword) {
		return
	}

	req.Username = strings.TrimSpace(req.Username)
	if err := validateUsername(req.Username); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validatePassword(req.Password); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var existing int64
	if err := h.db.Model(&model.Teacher{}).Where("username = ?", req.Username).
		Count(&existing).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "注册失败，请重试"})
		return
	}
	if existing > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "该用户名已被注册"})
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "注册失败，请重试"})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = req.Username
	}

	teacher := model.Teacher{
		Username:     req.Username,
		PasswordHash: hash,
		Name:         name,
		Role:         "teacher",
	}
	if err := h.db.Create(&teacher).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "注册失败，请重试"})
		return
	}

	// 注册后直接为新教师签发登录态，注册完再单独登录一次只会徒增操作步骤。
	token, expiresAt, err := h.auth.IssueToken(teacher.ID, teacher.Username, teacher.Name, teacher.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "注册成功，但自动登录失败，请手动登录"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"token":      token,
		"expires_at": expiresAt,
		"teacher":    teacher,
	})
}

func validateUsername(username string) error {
	if len(username) < credentialMinLen || len(username) > credentialMaxLen {
		return fmt.Errorf("用户名需为 %d~%d 位", credentialMinLen, credentialMaxLen)
	}
	if !alphanumeric.MatchString(username) {
		return fmt.Errorf("用户名只能包含字母和数字")
	}
	return nil
}

func validatePassword(password string) error {
	if len(password) < credentialMinLen || len(password) > credentialMaxLen {
		return fmt.Errorf("密码需为 %d~%d 位", credentialMinLen, credentialMaxLen)
	}
	if !alphanumeric.MatchString(password) {
		return fmt.Errorf("密码只能包含字母和数字")
	}
	// “字母+数字”意味着两者都必须包含，而不是仅允许出现。
	if !hasLetter.MatchString(password) || !hasDigit.MatchString(password) {
		return fmt.Errorf("密码需同时包含字母和数字")
	}
	return nil
}
