package auth

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	tokenTTL       = 12 * time.Hour
	contextUserKey = "current_teacher"
)

type Claims struct {
	TeacherID uint   `json:"tid"`
	Username  string `json:"username"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	jwt.RegisteredClaims
}

type Service struct {
	secret []byte
}

func NewService(secret string) *Service {
	return &Service{secret: []byte(secret)}
}

func (s *Service) IssueToken(teacherID uint, username, name, role string) (string, time.Time, error) {
	expiresAt := time.Now().Add(tokenTTL)
	claims := Claims{
		TeacherID: teacherID,
		Username:  username,
		Name:      name,
		Role:      role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(s.secret)
	return signed, expiresAt, err
}

func (s *Service) Parse(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("非法的签名算法")
		}
		return s.secret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("token 无效")
	}
	return claims, nil
}

// Middleware 拒绝没有合法 bearer token 的请求，并把调用者的 claims 存入 gin context。
func (s *Service) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "未登录或登录状态已失效"})
			return
		}
		claims, err := s.Parse(strings.TrimPrefix(header, "Bearer "))
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "登录状态已失效，请重新登录"})
			return
		}
		c.Set(contextUserKey, claims)
		c.Next()
	}
}

// MediaMiddleware 额外接受以 `token` 查询参数形式传入的 token。
// <video> 标签无法设置 Authorization 请求头，而把视频整体拉下来转成 blob 又会
// 失去 Range 请求的能力、并一次性把整个文件载入内存，因此媒体路由改为从 URL
// 中取 token。不要把该中间件用在普通 JSON 路由上：查询字符串会出现在代理与
// 服务器的访问日志里。
func (s *Service) MediaMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if raw == "" {
			raw = c.Query("token")
		}
		claims, err := s.Parse(raw)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "登录状态已失效，请重新登录"})
			return
		}
		c.Set(contextUserKey, claims)
		c.Next()
	}
}

// CurrentTeacher 返回当前已认证调用者的 claims。
func CurrentTeacher(c *gin.Context) *Claims {
	v, ok := c.Get(contextUserKey)
	if !ok {
		return nil
	}
	claims, _ := v.(*Claims)
	return claims
}

func HashPassword(plain string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	return string(hash), err
}

func CheckPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}
