package db

import (
	"fmt"
	"log"
	"os"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"football-backend/internal/model"
)

// Open 使用 DB_* 系列环境变量连接 MySQL，并执行自动迁移与首次启动时的种子数据初始化。
func Open() (*gorm.DB, error) {
	user := envOr("DB_USER", "root")
	password := os.Getenv("DB_PASSWORD")
	host := envOr("DB_HOST", "127.0.0.1")
	port := envOr("DB_PORT", "3306")
	name := envOr("DB_NAME", "football_ai")

	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
		user, password, host, port, name)

	gormDB, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return nil, fmt.Errorf("连接MySQL失败: %w", err)
	}

	if err := gormDB.AutoMigrate(
		&model.Teacher{}, &model.Student{}, &model.Video{}, &model.Setting{},
		&model.EvaluationSheet{}, &model.EvaluationEntry{},
	); err != nil {
		return nil, fmt.Errorf("数据库迁移失败: %w", err)
	}

	// 评价体系升级前建的评价表没有表头附加信息（options 为空），把它们改成对应的旧版类型，
	// 原来的字段和数据原样保留，老师仍可查看、修改和导出。可以重复执行。
	if err := gormDB.Exec(
		"UPDATE evaluation_sheets SET kind = CONCAT('legacy_', kind) " +
			"WHERE (options IS NULL OR options = '') AND kind NOT LIKE 'legacy\\_%'",
	).Error; err != nil {
		return nil, fmt.Errorf("评价表迁移失败: %w", err)
	}

	if err := seed(gormDB); err != nil {
		return nil, err
	}

	return gormDB, nil
}

// seed 在空数据库上创建默认管理员账号，保证演示环境开箱即可登录。
func seed(gormDB *gorm.DB) error {
	var count int64
	if err := gormDB.Model(&model.Teacher{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	username := envOr("ADMIN_USERNAME", "admin")
	password := envOr("ADMIN_PASSWORD", "admin123")
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	admin := model.Teacher{
		Username:     username,
		PasswordHash: string(hash),
		Name:         "张老师",
		Role:         "admin",
	}
	if err := gormDB.Create(&admin).Error; err != nil {
		return err
	}
	log.Printf("已创建默认管理员账号: %s / %s（请尽快在设置页修改密码）", username, password)
	return nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
