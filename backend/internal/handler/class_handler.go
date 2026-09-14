package handler

import (
	"net/http"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"football-backend/internal/classes"
	"football-backend/internal/model"
)

// ClassHandler 负责分班管理。班级不单独建表，由学生档案里的班级汇总而来：
// 老师只要给学生填上班级，班级就出现了；改名、统一写法都是批量改学生档案。
type ClassHandler struct {
	db *gorm.DB
}

func NewClassHandler(db *gorm.DB) *ClassHandler {
	return &ClassHandler{db: db}
}

type classInfo struct {
	Name  string `json:"name"`
	Count int64  `json:"count"`
	Boys  int64  `json:"boys"`
	Girls int64  `json:"girls"`
	// Normalized 是统一写法后的名称，与 Name 相同表示不需要调整。
	Normalized string `json:"normalized"`
}

// List 处理 GET /api/classes 接口：班级列表，按幼儿园、年级、班号排序。
func (h *ClassHandler) List(c *gin.Context) {
	var rows []struct {
		ClassName string
		Gender    string
		N         int64
	}
	if err := h.db.Model(&model.Student{}).
		Select("class_name, gender, COUNT(*) AS n").
		Group("class_name, gender").
		Scan(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询班级失败"})
		return
	}

	byName := map[string]*classInfo{}
	for _, r := range rows {
		info := byName[r.ClassName]
		if info == nil {
			info = &classInfo{Name: r.ClassName, Normalized: classes.Normalize(r.ClassName)}
			byName[r.ClassName] = info
		}
		info.Count += r.N
		switch r.Gender {
		case "男":
			info.Boys += r.N
		case "女":
			info.Girls += r.N
		}
	}
	items := make([]classInfo, 0, len(byName))
	for _, info := range byName {
		items = append(items, *info)
	}
	sort.Slice(items, func(i, j int) bool { return classes.Less(items[i].Name, items[j].Name) })
	c.JSON(http.StatusOK, gin.H{"items": items})
}

type renameClassRequest struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// Rename 处理 PUT /api/classes/rename 接口：班级改名，该班学生和评价表一起改。
func (h *ClassHandler) Rename(c *gin.Context) {
	var req renameClassRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}
	to := classes.Normalize(req.To)
	if to == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请填写新的班级名称"})
		return
	}
	if utf8.RuneCountInString(to) > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "班级名称最多 64 个字"})
		return
	}

	var moved int64
	err := h.db.Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&model.Student{}).Where("class_name = ?", req.From).Update("class_name", to)
		if res.Error != nil {
			return res.Error
		}
		moved = res.RowsAffected
		return tx.Model(&model.EvaluationSheet{}).Where("class_name = ?", req.From).Update("class_name", to).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "班级改名失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"name": to, "students": moved})
}

type classChange struct {
	From     string `json:"from"`
	To       string `json:"to"`
	Students int64  `json:"students"`
}

// Normalize 处理 POST /api/classes/normalize 接口：把已有班级统一成标准写法，
// 例如「三年级二班」「3年级(2)班」都改成「3年级2班」，这样同一个班的学生会归到一起。
func (h *ClassHandler) Normalize(c *gin.Context) {
	var studentClasses, sheetClasses []string
	if err := h.db.Model(&model.Student{}).Distinct("class_name").Pluck("class_name", &studentClasses).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询班级失败"})
		return
	}
	if err := h.db.Model(&model.EvaluationSheet{}).Distinct("class_name").Pluck("class_name", &sheetClasses).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询班级失败"})
		return
	}

	seen := map[string]bool{}
	changes := []classChange{}
	err := h.db.Transaction(func(tx *gorm.DB) error {
		for _, name := range append(studentClasses, sheetClasses...) {
			to := classes.Normalize(name)
			if seen[name] || to == name || strings.TrimSpace(to) == "" {
				continue
			}
			seen[name] = true
			res := tx.Model(&model.Student{}).Where("class_name = ?", name).Update("class_name", to)
			if res.Error != nil {
				return res.Error
			}
			if err := tx.Model(&model.EvaluationSheet{}).Where("class_name = ?", name).Update("class_name", to).Error; err != nil {
				return err
			}
			changes = append(changes, classChange{From: name, To: to, Students: res.RowsAffected})
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "统一班级名称失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"changes": changes})
}
