package main

import (
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/gin-gonic/gin"

	"football-backend/internal/ai"
	"football-backend/internal/auth"
	"football-backend/internal/config"
	"football-backend/internal/crypto"
	"football-backend/internal/db"
	"football-backend/internal/handler"
	"football-backend/internal/service"
	"football-backend/internal/settings"
	"football-backend/internal/video"
)

func main() {
	// 支持从 backend/ 目录（本地开发）或仓库根目录（Docker 构建上下文 / CI）运行。
	_ = config.LoadDotEnv(".env")
	_ = config.LoadDotEnv("../.env")

	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		log.Fatal("环境变量 APP_SECRET 未设置：用于 JWT 签名和数据库字段加密，请在 .env 中配置一段随机字符串")
	}

	cipher, err := crypto.New(secret)
	if err != nil {
		log.Fatalf("初始化加密模块失败: %v", err)
	}

	gormDB, err := db.Open()
	if err != nil {
		log.Fatalf("数据库初始化失败: %v", err)
	}

	tmpDir := os.Getenv("VIDEO_TMP_DIR")
	if tmpDir == "" {
		tmpDir = "./tmp"
	}
	videoDir := os.Getenv("VIDEO_STORE_DIR")
	if videoDir == "" {
		videoDir = "./data/videos"
	}
	// 尽力而为的保留策略：训练视频一直保存，直到存储空间达到此上限，
	// 此时淘汰最旧的视频，而不是让新上传直接失败。
	storeMaxGB := 20.0
	if v := os.Getenv("VIDEO_STORE_MAX_GB"); v != "" {
		if parsed, err := strconv.ParseFloat(v, 64); err == nil && parsed > 0 {
			storeMaxGB = parsed
		}
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// 教师登录/注册前需要先输入的访问口令，用来挡掉互联网上的恶意注册/刷量；
	// 不设置就不做这层校验，方便本地开发。
	appPassword := os.Getenv("APP_PASSWORD")

	authSvc := auth.NewService(secret)
	settingsSvc := settings.NewService(gormDB, cipher)
	analyzer := ai.NewOpenAICompatAnalyzer(func() (ai.Config, error) {
		cfg, err := settingsSvc.GetLLMConfig()
		return ai.Config{APIKey: cfg.APIKey, BaseURL: cfg.BaseURL, Model: cfg.Model}, err
	})
	videoStore := video.NewStore(videoDir, int64(storeMaxGB*1024*1024*1024))
	analysisSvc := service.NewAnalysis(gormDB, analyzer, cipher, videoStore, tmpDir, 3)

	authHandler := handler.NewAuthHandler(gormDB, authSvc, appPassword)
	studentHandler := handler.NewStudentHandler(gormDB)
	videoHandler := handler.NewVideoHandler(gormDB, analysisSvc, videoStore)
	statsHandler := handler.NewStatsHandler(gormDB, analysisSvc)
	classHandler := handler.NewClassHandler(gormDB)
	exportHandler := handler.NewExportHandler(gormDB, analysisSvc)
	settingHandler := handler.NewSettingHandler(settingsSvc, analyzer)
	evaluationHandler := handler.NewEvaluationHandler(gormDB, cipher, analysisSvc, analyzer)

	r := gin.Default()
	r.Use(corsMiddleware())
	r.MaxMultipartMemory = 8 << 20

	api := r.Group("/api")
	// 健康检查：容器编排据此判断后端是否就绪，所以要真的 ping 一下数据库。
	api.GET("/health", func(c *gin.Context) {
		sqlDB, err := gormDB.DB()
		if err == nil {
			err = sqlDB.PingContext(c.Request.Context())
		}
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "error", "error": "数据库连接异常"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	api.POST("/auth/login", authHandler.Login)
	api.POST("/auth/register", authHandler.Register)

	// 视频播放从查询字符串中取 token，这样 <video> 标签才能通过 Range 请求流式播放；
	// 参见 auth.MediaMiddleware。
	api.GET("/videos/:id/file", authSvc.MediaMiddleware(), videoHandler.File)

	authed := api.Group("", authSvc.Middleware())
	{
		authed.GET("/auth/me", authHandler.Me)
		authed.POST("/auth/password", authHandler.ChangePassword)

		authed.GET("/students", studentHandler.List)
		authed.POST("/students", studentHandler.Create)
		authed.POST("/students/import", studentHandler.Import)
		authed.GET("/students/import-template", studentHandler.ImportTemplate)
		authed.PUT("/students/:id", studentHandler.Update)
		authed.DELETE("/students/:id", studentHandler.Delete)

		authed.POST("/videos/analyze", videoHandler.Analyze)
		authed.GET("/videos", videoHandler.List)
		authed.GET("/videos/:id", videoHandler.Get)
		authed.GET("/videos/:id/thumb", videoHandler.Thumbnail)
		authed.DELETE("/videos/:id", videoHandler.Delete)

		authed.GET("/students/:id/evaluations", evaluationHandler.ForStudent)

		authed.GET("/classes", classHandler.List)
		authed.POST("/classes/normalize", classHandler.Normalize)
		authed.PUT("/classes/rename", classHandler.Rename)

		authed.GET("/evaluations/schema", evaluationHandler.Schema)
		authed.GET("/evaluations", evaluationHandler.List)
		authed.POST("/evaluations", evaluationHandler.Create)
		authed.GET("/evaluations/:id", evaluationHandler.Get)
		authed.PUT("/evaluations/:id", evaluationHandler.Save)
		authed.DELETE("/evaluations/:id", evaluationHandler.Delete)
		authed.POST("/evaluations/:id/fill", evaluationHandler.Fill)
		authed.POST("/evaluations/:id/comments", evaluationHandler.GenerateComments)
		authed.POST("/evaluations/:id/summary", evaluationHandler.GenerateSummary)

		authed.GET("/stats/overview", statsHandler.Overview)
		authed.GET("/stats/screen", statsHandler.Screen)
		authed.GET("/reports/export", exportHandler.Export)
		authed.POST("/export/xlsx", exportHandler.ExportTable)

		authed.GET("/settings/llm", settingHandler.GetLLM)
		authed.PUT("/settings/llm", settingHandler.SaveLLM)
		authed.POST("/settings/llm/test", settingHandler.TestLLM)
	}

	log.Printf("server listening on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}
