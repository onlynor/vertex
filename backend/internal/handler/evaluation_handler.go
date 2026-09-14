package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"football-backend/internal/auth"
	"football-backend/internal/classes"
	"football-backend/internal/crypto"
	"football-backend/internal/evaluation"
	"football-backend/internal/model"
	"football-backend/internal/service"
)

// textCompleter 是生成评语所需的模型能力，由 ai.OpenAICompatAnalyzer 实现。
type textCompleter interface {
	Complete(ctx context.Context, system, user string) (string, error)
}

const (
	maxSheetEntries    = 300
	maxCommentRunes    = 1000
	maxSummaryRunes    = 2000
	maxTitleRunes      = 64
	maxTeacherRunes    = 32
	maxSaveBody        = 2 << 20
	maxCommentsPerCall = 10
	maxFillPerCall     = 8
	commentConcurrency = 4
	commentTimeout     = 90 * time.Second
	fillTimeout        = 120 * time.Second
	summaryTimeout     = 120 * time.Second
	// 一键评价参考同班最近几张评价表里这名学生的记录。
	historySheets     = 20
	historyPerStudent = 3
	historyLines      = 4
	// 日常评价只把 30 天内的视频分析写进评语提示词，太久以前的表现参考意义不大。
	videoRelevance       = 30 * 24 * time.Hour
	unrecognisedTraining = "无法识别"
)

// EvaluationHandler 负责「智能评价」模块：评价表的增删改查、AI 评语与课堂总评。
type EvaluationHandler struct {
	db       *gorm.DB
	cipher   *crypto.Cipher
	analysis *service.Analysis
	llm      textCompleter
}

func NewEvaluationHandler(db *gorm.DB, cipher *crypto.Cipher, analysis *service.Analysis, llm textCompleter) *EvaluationHandler {
	return &EvaluationHandler{db: db, cipher: cipher, analysis: analysis, llm: llm}
}

// videoRef 是一段视频分析的摘要：在评价表里提示老师、用来预填，也作为 AI 写评语的参考。
type videoRef struct {
	ID           uint      `json:"id"`
	Date         time.Time `json:"date"`
	TrainingType string    `json:"training_type"`
	Level        string    `json:"level"`
	Rating       int       `json:"rating"`
	Highlight    string    `json:"highlight"`
	Issue        string    `json:"issue"`

	highlights []string
	issues     []string
}

// videoSpan 是某名学生在这张表关心的时间范围内的视频：第一段、最后一段和总数。
type videoSpan struct {
	first, latest *videoRef
	count         int
}

type entryResponse struct {
	StudentID     uint           `json:"student_id"`
	StudentName   string         `json:"student_name"`
	StudentNo     string         `json:"student_no"`
	Position      string         `json:"position"`
	Values        map[string]any `json:"values"`
	Comment       string         `json:"comment"`
	CommentSource string         `json:"comment_source"`
	// AIFields 是这一行里由「AI 一键评价」填出、老师还没改过的评价项。
	AIFields []string `json:"ai_fields"`
	// Video 是时间范围内最近一段视频；VideoFirst 只在期末评价、且范围内有两段以上视频时给出。
	Video      *videoRef `json:"video"`
	VideoFirst *videoRef `json:"video_first,omitempty"`
	VideoCount int       `json:"video_count"`
}

// sheetView 是评价表的表头，附带解析后的附加信息。
type sheetView struct {
	model.EvaluationSheet
	Options evaluation.Options `json:"options"`
}

type sheetResponse struct {
	sheetView
	Summary string          `json:"summary"`
	Entries []entryResponse `json:"entries"`
}

// openEntry 是解密后的一行评价。
type openEntry struct {
	model.EvaluationEntry
	Values  map[string]any
	Comment string
}

// Schema 处理 GET /api/evaluations/schema：评价表类型、字段、位置专项和练习项目。
func (h *EvaluationHandler) Schema(c *gin.Context) {
	c.JSON(http.StatusOK, evaluation.Schema())
}

// List 处理 GET /api/evaluations 接口，支持 kind / class_name 过滤。
func (h *EvaluationHandler) List(c *gin.Context) {
	query := h.db.Model(&model.EvaluationSheet{}).Omit("summary_cipher").Order("lesson_date DESC, id DESC")
	if kind := c.Query("kind"); kind != "" {
		query = query.Where("kind = ?", kind)
	}
	if className, ok := c.GetQuery("class_name"); ok {
		query = query.Where("class_name = ?", className)
	}

	var sheets []model.EvaluationSheet
	if err := query.Limit(300).Find(&sheets).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询评价表失败"})
		return
	}
	items := make([]sheetView, 0, len(sheets))
	for _, s := range sheets {
		items = append(items, viewOf(s))
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

type sheetHeaderRequest struct {
	Kind        string             `json:"kind"`
	ClassName   string             `json:"class_name"`
	Title       string             `json:"title"`
	LessonDate  string             `json:"lesson_date"`
	TeacherName string             `json:"teacher_name"`
	Options     evaluation.Options `json:"options"`
}

// Create 处理 POST /api/evaluations 接口：按班级新建评价表，自动带入该班全部学生，
// 需要场上位置的评价表同时带入学生档案里的位置。
func (h *EvaluationHandler) Create(c *gin.Context) {
	var req sheetHeaderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}
	kind, ok := evaluation.KindByKey(req.Kind)
	if !ok || kind.Legacy {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择评价表类型"})
		return
	}
	claims := auth.CurrentTeacher(c)
	title, date, teacher, err := normalizeSheetHeader(kind, req.Title, req.LessonDate, req.TeacherName, claims.Name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	options, err := kind.NormalizeOptions(req.Options, date)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// 班级名称沿用学生档案里的写法；还没有统一写法的老数据（如「三年级二班」）也要能找到学生。
	className := strings.TrimSpace(req.ClassName)
	names := []string{className}
	if normalized := classes.Normalize(className); normalized != className {
		names = append(names, normalized)
	}

	var students []model.Student
	if err := h.db.Where("class_name IN ?", names).
		Order("CASE WHEN student_no = '' THEN 1 ELSE 0 END, student_no, id").
		Find(&students).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询班级学生失败"})
		return
	}
	if len(students) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该班级还没有学生，请先在「学生管理」中添加"})
		return
	}
	if len(students) > maxSheetEntries {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("一张评价表最多 %d 名学生", maxSheetEntries)})
		return
	}

	sheet := model.EvaluationSheet{
		TeacherID:    claims.TeacherID,
		Kind:         kind.Key,
		ClassName:    className,
		Title:        title,
		LessonDate:   date,
		TeacherName:  teacher,
		Options:      encodeOptions(options),
		StudentCount: len(students),
	}
	err = h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&sheet).Error; err != nil {
			return err
		}
		entries := make([]model.EvaluationEntry, 0, len(students))
		for i, s := range students {
			values := map[string]any{}
			// 场上位置默认取学生档案，老师可以在表里改成这次的实际位置。
			if kind.UsesPosition && s.Position != "" {
				values["position"] = s.Position
			}
			entry, err := h.sealEntry(sheet.ID, s.ID, s.Name, i, values, "", "")
			if err != nil {
				return err
			}
			entries = append(entries, entry)
		}
		return tx.Create(&entries).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建评价表失败"})
		return
	}
	h.respondSheet(c, http.StatusCreated, &sheet, kind)
}

// Get 处理 GET /api/evaluations/:id 接口，返回解密后的全部评价、评语和相关视频分析。
func (h *EvaluationHandler) Get(c *gin.Context) {
	sheet, kind, ok := h.findSheet(c)
	if !ok {
		return
	}
	h.respondSheet(c, http.StatusOK, sheet, kind)
}

type saveEntryRequest struct {
	StudentID     uint           `json:"student_id"`
	Values        map[string]any `json:"values"`
	Comment       string         `json:"comment"`
	CommentSource string         `json:"comment_source"`
	AIFields      []string       `json:"ai_fields"`
}

type saveSheetRequest struct {
	Title       string              `json:"title"`
	LessonDate  string              `json:"lesson_date"`
	TeacherName string              `json:"teacher_name"`
	Summary     string              `json:"summary"`
	Options     *evaluation.Options `json:"options"`
	Entries     []saveEntryRequest  `json:"entries"`
}

// Save 处理 PUT /api/evaluations/:id 接口：整表保存（前端自动保存调用）。
// 提交的学生列表即表中的全部学生，不在列表中的行会被移除。
func (h *EvaluationHandler) Save(c *gin.Context) {
	sheet, kind, ok := h.findSheet(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSaveBody)
	var req saveSheetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误或内容过长"})
		return
	}
	claims := auth.CurrentTeacher(c)
	title, date, teacher, err := normalizeSheetHeader(kind, req.Title, req.LessonDate, req.TeacherName, claims.Name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	options := decodeOptions(sheet.Options)
	if req.Options != nil {
		options = *req.Options
	}
	if options, err = kind.NormalizeOptions(options, date); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	summary := strings.TrimSpace(req.Summary)
	if utf8.RuneCountInString(summary) > maxSummaryRunes {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("课堂总评最多 %d 字", maxSummaryRunes)})
		return
	}
	if len(req.Entries) > maxSheetEntries {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("一张评价表最多 %d 名学生", maxSheetEntries)})
		return
	}

	// 学生姓名快照：优先用学生档案里的最新姓名；学生已被删除时沿用表里原来的名字。
	var previous []model.EvaluationEntry
	if err := h.db.Select("student_id", "student_name").Where("sheet_id = ?", sheet.ID).Find(&previous).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取评价表失败"})
		return
	}
	known := make(map[uint]string, len(previous))
	for _, p := range previous {
		known[p.StudentID] = p.StudentName
	}

	ids := make([]uint, 0, len(req.Entries))
	seen := make(map[uint]bool, len(req.Entries))
	for _, e := range req.Entries {
		if seen[e.StudentID] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "同一名学生在表中出现了两次"})
			return
		}
		seen[e.StudentID] = true
		ids = append(ids, e.StudentID)
	}
	students, err := h.studentsByID(ids)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询学生失败"})
		return
	}

	entries := make([]model.EvaluationEntry, 0, len(req.Entries))
	recorded, commented := 0, 0
	for i, e := range req.Entries {
		name, wasInSheet := known[e.StudentID]
		if s, ok := students[e.StudentID]; ok {
			name = s.Name
		} else if !wasInSheet {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("学生不存在（ID %d）", e.StudentID)})
			return
		}
		values, err := kind.Normalize(e.Values)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("%s：%s", name, err.Error())})
			return
		}
		comment := strings.TrimSpace(e.Comment)
		if utf8.RuneCountInString(comment) > maxCommentRunes {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("%s：评语最多 %d 字", name, maxCommentRunes)})
			return
		}
		source := ""
		if comment != "" {
			commented++
			source = "manual"
			if e.CommentSource == "ai" {
				source = "ai"
			}
		}
		if kind.Recorded(values) {
			recorded++
		}
		entry, err := h.sealEntry(sheet.ID, e.StudentID, name, i, values, comment, source)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "评价数据加密失败"})
			return
		}
		entry.AIFields = joinAIFields(values, e.AIFields)
		entries = append(entries, entry)
	}

	var summaryCipher []byte
	if summary != "" {
		if summaryCipher, err = h.cipher.Encrypt([]byte(summary)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "评价数据加密失败"})
			return
		}
	}

	now := time.Now()
	err = h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("sheet_id = ?", sheet.ID).Delete(&model.EvaluationEntry{}).Error; err != nil {
			return err
		}
		if len(entries) > 0 {
			if err := tx.Create(&entries).Error; err != nil {
				return err
			}
		}
		return tx.Model(&model.EvaluationSheet{}).Where("id = ?", sheet.ID).Updates(map[string]any{
			"title":           title,
			"lesson_date":     date,
			"teacher_name":    teacher,
			"options":         encodeOptions(options),
			"summary_cipher":  summaryCipher,
			"student_count":   len(entries),
			"recorded_count":  recorded,
			"commented_count": commented,
			"updated_at":      now,
		}).Error
	})
	if err != nil {
		log.Printf("evaluation %d: save failed: %v", sheet.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存评价表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"updated_at":      now,
		"options":         options,
		"student_count":   len(entries),
		"recorded_count":  recorded,
		"commented_count": commented,
	})
}

// Delete 处理 DELETE /api/evaluations/:id 接口。
func (h *EvaluationHandler) Delete(c *gin.Context) {
	sheet, _, ok := h.findSheet(c)
	if !ok {
		return
	}
	err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("sheet_id = ?", sheet.ID).Delete(&model.EvaluationEntry{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.EvaluationSheet{}, sheet.ID).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除评价表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

type generateCommentsRequest struct {
	StudentIDs []uint `json:"student_ids"`
}

type generatedComment struct {
	StudentID uint   `json:"student_id"`
	Comment   string `json:"comment,omitempty"`
	Error     string `json:"error,omitempty"`
}

// GenerateComments 处理 POST /api/evaluations/:id/comments 接口：按已保存的评价为指定学生
// 生成评语。这里只返回结果、不写库，由前端放进表格后随自动保存一起落库——
// 评价表只有前端一个写入方，就不会出现生成结果与老师同时编辑互相覆盖的问题。
func (h *EvaluationHandler) GenerateComments(c *gin.Context) {
	sheet, kind, ok := h.findSheet(c)
	if !ok {
		return
	}
	var req generateCommentsRequest
	if err := c.ShouldBindJSON(&req); err != nil || len(req.StudentIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择要生成评语的学生"})
		return
	}
	if len(req.StudentIDs) > maxCommentsPerCall {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("一次最多为 %d 名学生生成评语", maxCommentsPerCall)})
		return
	}

	entries, err := h.loadEntries(sheet.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "评价数据解密失败"})
		return
	}
	byStudent := make(map[uint]openEntry, len(entries))
	for _, e := range entries {
		byStudent[e.StudentID] = e
	}
	students, err := h.studentsByID(req.StudentIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询学生失败"})
		return
	}
	options := decodeOptions(sheet.Options)
	from, to := videoWindow(kind, sheet, options)
	spans := h.videoSpans(req.StudentIDs, from, to)
	info := sheetInfo(sheet, options)
	sheetDay, _ := time.ParseInLocation("2006-01-02", sheet.LessonDate, time.Local)

	results := make([]generatedComment, len(req.StudentIDs))
	var wg sync.WaitGroup
	sem := make(chan struct{}, commentConcurrency)
	for i, id := range req.StudentIDs {
		results[i].StudentID = id
		entry, found := byStudent[id]
		if !found {
			results[i].Error = "该学生不在这张评价表中"
			continue
		}
		if !kind.Recorded(entry.Values) {
			results[i].Error = "还没有评价记录，先打分再生成评语"
			continue
		}

		name, position := entry.StudentName, ""
		if s, ok := students[id]; ok {
			name, position = s.Name, s.Position
		}
		if p, ok := entry.Values["position"].(string); ok && p != "" {
			position = p
		}
		prompt := evaluation.CommentPrompt(kind, info, name, position, entry.Values, videoContext(kind, spans[id], sheetDay))

		wg.Add(1)
		go func(i int, name, prompt string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			ctx, cancel := context.WithTimeout(c.Request.Context(), commentTimeout)
			defer cancel()
			text, err := h.llm.Complete(ctx, evaluation.CommentSystemPrompt, prompt)
			if err != nil {
				log.Printf("evaluation %d: comment for student %d failed: %v", sheet.ID, results[i].StudentID, err)
				results[i].Error = friendlyAIError(err)
				return
			}
			if comment := evaluation.CleanComment(text, name); comment != "" {
				results[i].Comment = comment
			} else {
				results[i].Error = "AI 没有返回有效的评语，请重试"
			}
		}(i, name, prompt)
	}
	wg.Wait()

	c.JSON(http.StatusOK, gin.H{"items": results})
}

type fillRequest struct {
	StudentIDs []uint `json:"student_ids"`
	// Overwrite 为 true 时连老师已填的格子一起重填，默认只填空白。
	Overwrite bool `json:"overwrite"`
}

// filledEntry 只回传 AI 这次填出来的格子，由前端并进表格后随自动保存落库。
type filledEntry struct {
	StudentID uint           `json:"student_id"`
	Values    map[string]any `json:"values,omitempty"`
	Fields    []string       `json:"fields,omitempty"`
	Comment   string         `json:"comment,omitempty"`
	Error     string         `json:"error,omitempty"`
}

// Fill 处理 POST /api/evaluations/:id/fill 接口：「AI 一键评价」。
// 依据这名学生的视频分析、老师已填的内容和同班最近几张评价表里的记录，
// 一次把整行的星级、选项、文字和评语都填出来。客观事实（出勤、成绩、进球数）仍然由老师录入。
func (h *EvaluationHandler) Fill(c *gin.Context) {
	sheet, kind, ok := h.findSheet(c)
	if !ok {
		return
	}
	var req fillRequest
	if err := c.ShouldBindJSON(&req); err != nil || len(req.StudentIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择要评价的学生"})
		return
	}
	if len(req.StudentIDs) > maxFillPerCall {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("一次最多为 %d 名学生生成评价", maxFillPerCall)})
		return
	}

	entries, err := h.loadEntries(sheet.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "评价数据解密失败"})
		return
	}
	byStudent := make(map[uint]openEntry, len(entries))
	for _, e := range entries {
		byStudent[e.StudentID] = e
	}
	students, err := h.studentsByID(req.StudentIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询学生失败"})
		return
	}

	options := decodeOptions(sheet.Options)
	from, to := videoWindow(kind, sheet, options)
	spans := h.videoSpans(req.StudentIDs, from, to)
	history := h.historyNotes(sheet, req.StudentIDs, options)
	info := sheetInfo(sheet, options)
	sheetDay, _ := time.ParseInLocation("2006-01-02", sheet.LessonDate, time.Local)

	results := make([]filledEntry, len(req.StudentIDs))
	var wg sync.WaitGroup
	sem := make(chan struct{}, commentConcurrency)
	for i, id := range req.StudentIDs {
		results[i].StudentID = id
		entry, found := byStudent[id]
		if !found {
			results[i].Error = "该学生不在这张评价表中"
			continue
		}
		name, position := entry.StudentName, ""
		if s, ok := students[id]; ok {
			name, position = s.Name, s.Position
		}
		if p, ok := entry.Values["position"].(string); ok && p != "" {
			position = p
		}

		targets := evaluation.FillTargets(kind, position, entry.Values, !req.Overwrite)
		needComment := req.Overwrite || entry.Comment == ""
		if len(targets) == 0 && !needComment {
			results[i].Error = "已经填好了，如需重写请选「全部重填」"
			continue
		}
		videos := videoContext(kind, spans[id], sheetDay)
		notes := history[id]
		if videos.Latest == nil && len(notes) == 0 && !kind.Recorded(entry.Values) {
			results[i].Error = "没有可参考的材料：先上传这名学生的训练视频，或先手动打几项分"
			continue
		}

		prompt := evaluation.FillPrompt(kind, info, name, position, entry.Values, videos, notes)
		wg.Add(1)
		go func(i int, name, position, prompt string, values map[string]any, needComment bool) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			ctx, cancel := context.WithTimeout(c.Request.Context(), fillTimeout)
			defer cancel()
			text, err := h.llm.Complete(ctx, evaluation.FillSystemPrompt, prompt)
			if err != nil {
				log.Printf("evaluation %d: fill for student %d failed: %v", sheet.ID, results[i].StudentID, err)
				results[i].Error = friendlyAIError(err)
				return
			}
			out, err := evaluation.ParseFill(text)
			if err != nil {
				log.Printf("evaluation %d: fill for student %d unparsable: %v", sheet.ID, results[i].StudentID, err)
				results[i].Error = err.Error()
				return
			}
			filled := kind.CoerceFill(position, values, out.Values, !req.Overwrite)
			if needComment {
				results[i].Comment = evaluation.CleanComment(out.Comment, name)
			}
			if len(filled) == 0 && results[i].Comment == "" {
				results[i].Error = "AI 没有返回有效的评价，请重试"
				return
			}
			results[i].Values = filled
			results[i].Fields = sortedKeys(filled)
		}(i, name, position, prompt, entry.Values, needComment)
	}
	wg.Wait()

	c.JSON(http.StatusOK, gin.H{"items": results})
}

// historyNotes 取这些学生在同班最近几张评价表上的记录，作为一键评价的参考。
// 期中、期末只看统计区间内的表，其余类型看评价日期以前的最近几张。
func (h *EvaluationHandler) historyNotes(sheet *model.EvaluationSheet, studentIDs []uint, options evaluation.Options) map[uint][]evaluation.HistoryNote {
	out := make(map[uint][]evaluation.HistoryNote)
	if len(studentIDs) == 0 {
		return out
	}
	names := []string{sheet.ClassName}
	if normalized := classes.Normalize(sheet.ClassName); normalized != sheet.ClassName {
		names = append(names, normalized)
	}
	query := h.db.Select("id", "kind", "title", "lesson_date").
		Where("id <> ? AND class_name IN ? AND lesson_date <= ?", sheet.ID, names, sheet.LessonDate)
	if options.PeriodStart != "" {
		query = query.Where("lesson_date >= ?", options.PeriodStart)
	}
	var sheets []model.EvaluationSheet
	if err := query.Order("lesson_date DESC, id DESC").Limit(historySheets).Find(&sheets).Error; err != nil {
		log.Printf("evaluation: load history failed: %v", err)
		return out
	}
	if len(sheets) == 0 {
		return out
	}
	order := make(map[uint]int, len(sheets))
	byID := make(map[uint]model.EvaluationSheet, len(sheets))
	ids := make([]uint, 0, len(sheets))
	for i, s := range sheets {
		order[s.ID] = i
		byID[s.ID] = s
		ids = append(ids, s.ID)
	}

	var rows []model.EvaluationEntry
	if err := h.db.Where("sheet_id IN ? AND student_id IN ?", ids, studentIDs).Find(&rows).Error; err != nil {
		log.Printf("evaluation: load history entries failed: %v", err)
		return out
	}
	sort.Slice(rows, func(a, b int) bool { return order[rows[a].SheetID] < order[rows[b].SheetID] })
	for _, row := range rows {
		if len(out[row.StudentID]) >= historyPerStudent {
			continue
		}
		past, ok := byID[row.SheetID]
		if !ok {
			continue
		}
		kind, ok := evaluation.KindByKey(past.Kind)
		if !ok {
			continue
		}
		e, err := h.openEntry(row)
		if err != nil || !kind.Recorded(e.Values) {
			continue
		}
		position, _ := e.Values["position"].(string)
		lines := evaluation.HistoryLines(kind, position, e.Values, historyLines)
		if len(lines) == 0 {
			continue
		}
		out[row.StudentID] = append(out[row.StudentID], evaluation.HistoryNote{
			Date:  past.LessonDate,
			Label: kind.Label,
			Title: past.Title,
			Lines: lines,
		})
	}
	return out
}

func sortedKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// GenerateSummary 处理 POST /api/evaluations/:id/summary 接口：根据全班统计生成课堂总评。
// 与评语一样只返回结果，由前端随自动保存落库。
func (h *EvaluationHandler) GenerateSummary(c *gin.Context) {
	sheet, kind, ok := h.findSheet(c)
	if !ok {
		return
	}
	entries, err := h.loadEntries(sheet.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "评价数据解密失败"})
		return
	}
	rows := make([]evaluation.Row, 0, len(entries))
	for _, e := range entries {
		if kind.Recorded(e.Values) {
			position, _ := e.Values["position"].(string)
			rows = append(rows, evaluation.Row{Name: e.StudentName, Position: position, Values: e.Values})
		}
	}
	if len(rows) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "还没有学生的评价记录，先打分再生成总评"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), summaryTimeout)
	defer cancel()
	prompt := evaluation.SummaryPrompt(kind, sheetInfo(sheet, decodeOptions(sheet.Options)), len(entries), rows)
	text, err := h.llm.Complete(ctx, evaluation.SummarySystemPrompt, prompt)
	if err != nil {
		log.Printf("evaluation %d: summary failed: %v", sheet.ID, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": friendlyAIError(err)})
		return
	}
	summary := evaluation.CleanSummary(text)
	if summary == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "AI 没有返回有效的总评，请重试"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"summary": summary})
}

type studentEvaluationItem struct {
	SheetID    uint           `json:"sheet_id"`
	Kind       string         `json:"kind"`
	ClassName  string         `json:"class_name"`
	Title      string         `json:"title"`
	LessonDate string         `json:"lesson_date"`
	Values     map[string]any `json:"values"`
	Comment    string         `json:"comment"`
}

// ForStudent 处理 GET /api/students/:id/evaluations 接口：该学生出现过的全部评价记录，
// 按日期先后排列，供「球员能力」页的训练表现统计使用。
func (h *EvaluationHandler) ForStudent(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "学生ID非法"})
		return
	}

	var rows []model.EvaluationEntry
	if err := h.db.Where("student_id = ?", id).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询评价记录失败"})
		return
	}
	items := make([]studentEvaluationItem, 0, len(rows))
	if len(rows) == 0 {
		c.JSON(http.StatusOK, gin.H{"items": items})
		return
	}

	sheetIDs := make([]uint, 0, len(rows))
	for _, r := range rows {
		sheetIDs = append(sheetIDs, r.SheetID)
	}
	query := h.db.Select("id", "kind", "class_name", "title", "lesson_date").Where("id IN ?", sheetIDs)
	if kind := c.Query("kind"); kind != "" {
		query = query.Where("kind = ?", kind)
	}
	var sheets []model.EvaluationSheet
	if err := query.Find(&sheets).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询评价记录失败"})
		return
	}
	byID := make(map[uint]model.EvaluationSheet, len(sheets))
	for _, s := range sheets {
		byID[s.ID] = s
	}

	for _, row := range rows {
		sheet, ok := byID[row.SheetID]
		if !ok {
			continue
		}
		e, err := h.openEntry(row)
		if err != nil {
			log.Printf("evaluation entry %d: decrypt failed: %v", row.ID, err)
			continue
		}
		items = append(items, studentEvaluationItem{
			SheetID:    sheet.ID,
			Kind:       sheet.Kind,
			ClassName:  sheet.ClassName,
			Title:      sheet.Title,
			LessonDate: sheet.LessonDate,
			Values:     e.Values,
			Comment:    e.Comment,
		})
	}
	sort.Slice(items, func(a, b int) bool {
		if items[a].LessonDate != items[b].LessonDate {
			return items[a].LessonDate < items[b].LessonDate
		}
		return items[a].SheetID < items[b].SheetID
	})
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *EvaluationHandler) findSheet(c *gin.Context) (*model.EvaluationSheet, *evaluation.Kind, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "评价表ID非法"})
		return nil, nil, false
	}
	var sheet model.EvaluationSheet
	if err := h.db.First(&sheet, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "评价表不存在"})
		return nil, nil, false
	}
	kind, ok := evaluation.KindByKey(sheet.Kind)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "评价表类型已不受支持"})
		return nil, nil, false
	}
	return &sheet, kind, true
}

func (h *EvaluationHandler) respondSheet(c *gin.Context, status int, sheet *model.EvaluationSheet, kind *evaluation.Kind) {
	entries, err := h.loadEntries(sheet.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "评价数据解密失败"})
		return
	}
	summary, err := h.openText(sheet.SummaryCipher)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "评价数据解密失败"})
		return
	}

	ids := make([]uint, len(entries))
	for i, e := range entries {
		ids[i] = e.StudentID
	}
	students, err := h.studentsByID(ids)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询学生失败"})
		return
	}
	view := viewOf(*sheet)
	from, to := videoWindow(kind, sheet, view.Options)
	spans := h.videoSpans(ids, from, to)

	resp := sheetResponse{sheetView: view, Summary: summary, Entries: make([]entryResponse, 0, len(entries))}
	for _, e := range entries {
		item := entryResponse{
			StudentID:     e.StudentID,
			StudentName:   e.StudentName,
			Values:        e.Values,
			Comment:       e.Comment,
			CommentSource: e.CommentSource,
			AIFields:      splitAIFields(e.AIFields),
		}
		if s, ok := students[e.StudentID]; ok {
			item.StudentName, item.StudentNo, item.Position = s.Name, s.StudentNo, s.Position
		}
		if span := spans[e.StudentID]; span != nil {
			item.Video = span.latest
			item.VideoCount = span.count
			if kind.CompareVideos && span.first != nil && span.first.ID != span.latest.ID {
				item.VideoFirst = span.first
			}
		}
		resp.Entries = append(resp.Entries, item)
	}
	c.JSON(status, resp)
}

func (h *EvaluationHandler) sealEntry(sheetID, studentID uint, name string, order int, values map[string]any, comment, source string) (model.EvaluationEntry, error) {
	entry := model.EvaluationEntry{
		SheetID:       sheetID,
		StudentID:     studentID,
		StudentName:   name,
		SortOrder:     order,
		CommentSource: source,
	}
	if len(values) > 0 {
		raw, err := json.Marshal(values)
		if err != nil {
			return entry, err
		}
		if entry.ValuesCipher, err = h.cipher.Encrypt(raw); err != nil {
			return entry, err
		}
	}
	if comment != "" {
		sealed, err := h.cipher.Encrypt([]byte(comment))
		if err != nil {
			return entry, err
		}
		entry.CommentCipher = sealed
	}
	return entry, nil
}

// loadEntries 解密整张表。任何一行解密失败都直接报错而不是跳过：
// 整表保存会以提交的内容为准，悄悄少一行就等于把那一行删掉了。
func (h *EvaluationHandler) loadEntries(sheetID uint) ([]openEntry, error) {
	var rows []model.EvaluationEntry
	if err := h.db.Where("sheet_id = ?", sheetID).Order("sort_order, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]openEntry, 0, len(rows))
	for _, row := range rows {
		e, err := h.openEntry(row)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, nil
}

func (h *EvaluationHandler) openEntry(row model.EvaluationEntry) (openEntry, error) {
	e := openEntry{EvaluationEntry: row, Values: map[string]any{}}
	if len(row.ValuesCipher) > 0 {
		raw, err := h.cipher.Decrypt(row.ValuesCipher)
		if err != nil {
			return e, err
		}
		if err := json.Unmarshal(raw, &e.Values); err != nil {
			return e, err
		}
	}
	comment, err := h.openText(row.CommentCipher)
	if err != nil {
		return e, err
	}
	e.Comment = comment
	return e, nil
}

func (h *EvaluationHandler) openText(sealed []byte) (string, error) {
	if len(sealed) == 0 {
		return "", nil
	}
	raw, err := h.cipher.Decrypt(sealed)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func (h *EvaluationHandler) studentsByID(ids []uint) (map[uint]model.Student, error) {
	out := make(map[uint]model.Student, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	var students []model.Student
	if err := h.db.Where("id IN ?", ids).Find(&students).Error; err != nil {
		return nil, err
	}
	for _, s := range students {
		out[s.ID] = s
	}
	return out, nil
}

// videoWindow 返回这张表关心的视频时间范围：赛事评价只看比赛当天（比赛录像），
// 期中、期末看统计区间，其余看评价日期当天及以前。
func videoWindow(kind *evaluation.Kind, sheet *model.EvaluationSheet, options evaluation.Options) (from, to time.Time) {
	day, err := time.ParseInLocation("2006-01-02", sheet.LessonDate, time.Local)
	if err != nil {
		return time.Time{}, time.Time{}
	}
	to = day.AddDate(0, 0, 1)
	switch {
	case kind.SameDayVideo:
		from = day
	case kind.UsesPeriod && options.PeriodStart != "":
		if start, err := time.ParseInLocation("2006-01-02", options.PeriodStart, time.Local); err == nil {
			from = start
		}
	}
	return from, to
}

// videoSpans 找出每名学生在时间范围内识别到训练内容的视频，只解密第一段和最后一段的报告。
func (h *EvaluationHandler) videoSpans(studentIDs []uint, from, to time.Time) map[uint]*videoSpan {
	out := make(map[uint]*videoSpan)
	if len(studentIDs) == 0 {
		return out
	}
	// 只取解密报告需要的列，不要把封面图这类大字段也读出来。
	query := h.db.Select("id", "student_id", "training_type", "result_cipher", "created_at").
		Where("student_id IN ? AND status = ? AND training_type <> ?", studentIDs, model.StatusDone, unrecognisedTraining)
	if !from.IsZero() {
		query = query.Where("created_at >= ?", from)
	}
	if !to.IsZero() {
		query = query.Where("created_at < ?", to)
	}
	var videos []model.Video
	if err := query.Order("created_at ASC").Find(&videos).Error; err != nil {
		log.Printf("evaluation: load videos failed: %v", err)
		return out
	}
	byStudent := make(map[uint][]*model.Video)
	for i := range videos {
		byStudent[videos[i].StudentID] = append(byStudent[videos[i].StudentID], &videos[i])
	}
	for id, list := range byStudent {
		span := &videoSpan{count: len(list)}
		for _, v := range list {
			if span.first = h.videoRef(v); span.first != nil {
				break
			}
		}
		for i := len(list) - 1; i >= 0; i-- {
			if span.latest = h.videoRef(list[i]); span.latest != nil {
				break
			}
		}
		if span.latest != nil {
			out[id] = span
		}
	}
	return out
}

func (h *EvaluationHandler) videoRef(v *model.Video) *videoRef {
	report, err := h.analysis.DecryptReport(v)
	if err != nil || report == nil || report.TrainingType == unrecognisedTraining {
		return nil
	}
	ref := &videoRef{
		ID:           v.ID,
		Date:         v.CreatedAt,
		TrainingType: report.TrainingType,
		Level:        report.Level,
		Rating:       report.Rating,
		highlights:   firstStrings(report.Highlights, 2),
		issues:       firstStrings(report.Issues, 2),
	}
	if len(report.Highlights) > 0 {
		ref.Highlight = report.Highlights[0]
	}
	if len(report.Issues) > 0 {
		ref.Issue = report.Issues[0]
	}
	return ref
}

// videoContext 决定写评语时参考哪几段视频：期末对比期初和期末两段，赛事看比赛录像，
// 期中看区间内最近一段，日常评价只参考 30 天内最近一段。
func videoContext(kind *evaluation.Kind, span *videoSpan, sheetDay time.Time) evaluation.VideoContext {
	if span == nil || span.latest == nil {
		return evaluation.VideoContext{}
	}
	ctx := evaluation.VideoContext{Latest: noteOf(span.latest)}
	switch {
	case kind.CompareVideos:
		ctx.First = noteOf(span.first)
		ctx.Label = "区间内最近一段视频"
	case kind.SameDayVideo:
		ctx.Label = "比赛录像"
	case kind.UsesPeriod:
		ctx.Label = "区间内最近一段训练视频"
	default:
		if !sheetDay.IsZero() && span.latest.Date.Before(sheetDay.Add(-videoRelevance)) {
			return evaluation.VideoContext{}
		}
		ctx.Label = "最近一次训练视频"
	}
	return ctx
}

func noteOf(v *videoRef) *evaluation.VideoNote {
	if v == nil {
		return nil
	}
	return &evaluation.VideoNote{
		ID:           v.ID,
		Date:         v.Date.Format("2006-01-02"),
		TrainingType: v.TrainingType,
		Level:        v.Level,
		Highlights:   v.highlights,
		Issues:       v.issues,
	}
}

func viewOf(sheet model.EvaluationSheet) sheetView {
	return sheetView{EvaluationSheet: sheet, Options: decodeOptions(sheet.Options)}
}

func encodeOptions(o evaluation.Options) string {
	raw, err := json.Marshal(o)
	if err != nil {
		return "{}"
	}
	return string(raw)
}

func decodeOptions(raw string) evaluation.Options {
	var o evaluation.Options
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &o)
	}
	return o
}

func sheetInfo(sheet *model.EvaluationSheet, options evaluation.Options) evaluation.SheetInfo {
	return evaluation.SheetInfo{ClassName: sheet.ClassName, Title: sheet.Title, Date: sheet.LessonDate, Options: options}
}

func normalizeSheetHeader(kind *evaluation.Kind, title, date, teacher, fallbackTeacher string) (string, string, string, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = kind.Label
	}
	if utf8.RuneCountInString(title) > maxTitleRunes {
		return "", "", "", fmt.Errorf("%s最多 %d 个字", kind.TitleLabel, maxTitleRunes)
	}
	date = strings.TrimSpace(date)
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	if _, err := time.ParseInLocation("2006-01-02", date, time.Local); err != nil {
		return "", "", "", errors.New("日期格式应为 YYYY-MM-DD")
	}
	teacher = strings.TrimSpace(teacher)
	if teacher == "" {
		teacher = fallbackTeacher
	}
	if utf8.RuneCountInString(teacher) > maxTeacherRunes {
		return "", "", "", fmt.Errorf("教师姓名最多 %d 个字", maxTeacherRunes)
	}
	return title, date, teacher, nil
}

// friendlyAIError 把模型调用错误转成老师能看懂的提示，同时保留厂商返回的原因（如余额不足）。
func friendlyAIError(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "AI 响应超时，请稍后重试"
	}
	if errors.Is(err, context.Canceled) {
		return "请求已取消"
	}
	msg := err.Error()
	if strings.Contains(msg, "AI 配置不完整") {
		return msg
	}
	if utf8.RuneCountInString(msg) > 120 {
		msg = string([]rune(msg)[:120]) + "…"
	}
	return "AI 调用失败：" + msg
}

func firstStrings(items []string, n int) []string {
	if len(items) > n {
		return items[:n]
	}
	return items
}

// splitAIFields 把存库时逗号分隔的键名还原成列表。
func splitAIFields(raw string) []string {
	if raw == "" {
		return []string{}
	}
	return strings.Split(raw, ",")
}

// joinAIFields 只保留仍然有值的键名，老师改成空的格子自然就不再算作 AI 填的。
func joinAIFields(values map[string]any, keys []string) string {
	kept := make([]string, 0, len(keys))
	seen := map[string]bool{}
	for _, key := range keys {
		if key == "" || seen[key] || strings.ContainsAny(key, ",") {
			continue
		}
		if _, ok := values[key]; !ok {
			continue
		}
		seen[key] = true
		kept = append(kept, key)
	}
	joined := strings.Join(kept, ",")
	for len(joined) > 255 {
		kept = kept[:len(kept)-1]
		joined = strings.Join(kept, ",")
	}
	return joined
}
