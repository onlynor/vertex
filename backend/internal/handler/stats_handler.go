package handler

import (
	"math"
	"net/http"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"football-backend/internal/classes"
	"football-backend/internal/model"
	"football-backend/internal/service"
)

type StatsHandler struct {
	db       *gorm.DB
	analysis *service.Analysis
}

func NewStatsHandler(db *gorm.DB, analysis *service.Analysis) *StatsHandler {
	return &StatsHandler{db: db, analysis: analysis}
}

type trendPoint struct {
	Date    string `json:"date"`
	Videos  int64  `json:"videos"`
	Reports int64  `json:"reports"`
}

// Overview 处理 GET /api/stats/overview 接口，为首页的统计卡片和 7 天趋势图提供数据。
func (h *StatsHandler) Overview(c *gin.Context) {
	weekAgo := time.Now().AddDate(0, 0, -7)
	twoWeeksAgo := time.Now().AddDate(0, 0, -14)

	var weekVideos, weekReports, totalStudents int64
	h.db.Model(&model.Video{}).Where("created_at >= ?", weekAgo).Count(&weekVideos)
	h.db.Model(&model.Video{}).Where("created_at >= ? AND status = ?", weekAgo, model.StatusDone).Count(&weekReports)
	h.db.Model(&model.Student{}).Count(&totalStudents)

	// 统计上一个 7 天区间，让首页能够展示周环比变化。
	var prevWeekVideos, prevWeekReports int64
	h.db.Model(&model.Video{}).Where("created_at >= ? AND created_at < ?", twoWeeksAgo, weekAgo).Count(&prevWeekVideos)
	h.db.Model(&model.Video{}).Where("created_at >= ? AND created_at < ? AND status = ?", twoWeeksAgo, weekAgo, model.StatusDone).Count(&prevWeekReports)

	var avgDuration float64
	h.db.Model(&model.Video{}).Where("duration_sec > 0").
		Select("COALESCE(AVG(duration_sec), 0)").Scan(&avgDuration)

	c.JSON(http.StatusOK, gin.H{
		"week_videos":       weekVideos,
		"week_reports":      weekReports,
		"prev_week_videos":  prevWeekVideos,
		"prev_week_reports": prevWeekReports,
		"total_students":    totalStudents,
		"avg_duration_sec":  avgDuration,
		"trend":             h.trend(7),
	})
}

// trend 返回最近 days 天每天的视频数与完成的报告数。
func (h *StatsHandler) trend(days int) []trendPoint {
	points := make([]trendPoint, 0, days)
	for i := days - 1; i >= 0; i-- {
		day := time.Now().AddDate(0, 0, -i)
		start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, day.Location())
		end := start.AddDate(0, 0, 1)

		var videos, reports int64
		h.db.Model(&model.Video{}).Where("created_at >= ? AND created_at < ?", start, end).Count(&videos)
		h.db.Model(&model.Video{}).Where("created_at >= ? AND created_at < ? AND status = ?", start, end, model.StatusDone).Count(&reports)
		points = append(points, trendPoint{Date: start.Format("01/02"), Videos: videos, Reports: reports})
	}
	return points
}

// 数据大屏只解密最近这么多份报告来统计等级和取精彩瞬间，全量解密没有必要。
const (
	screenReportLimit = 500
	screenMoments     = 12
	screenStars       = 5
)

type nameCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type screenStudent struct {
	ID       uint   `json:"id"`
	Name     string `json:"name"`
	Position string `json:"position"`
	// Level 是这名学生最近 500 份报告里最好的一次表现，没有报告时为空。
	Level string `json:"level"`
}

type screenClass struct {
	Name      string          `json:"name"`
	Students  []screenStudent `json:"students"`
	Videos    int             `json:"videos"`
	Excellent int             `json:"excellent"`
	AvgRating float64         `json:"avg_rating"`
}

type screenMoment struct {
	VideoID      uint      `json:"video_id"`
	StudentID    uint      `json:"student_id"`
	Student      string    `json:"student"`
	ClassName    string    `json:"class_name"`
	TrainingType string    `json:"training_type"`
	Level        string    `json:"level"`
	Text         string    `json:"text"`
	Date         time.Time `json:"date"`
}

// Screen 处理 GET /api/stats/screen 接口：数据大屏的全部汇总。
// 报告正文加密存放，这里解密最近 500 份来统计表现等级、找精彩瞬间和近期之星。
func (h *StatsHandler) Screen(c *gin.Context) {
	var students []model.Student
	if err := h.db.Order("id").Find(&students).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询学生失败"})
		return
	}
	var videos []model.Video
	if err := h.db.Select("id", "student_id", "training_type", "result_cipher", "created_at").
		Where("status = ?", model.StatusDone).Order("created_at DESC").Limit(screenReportLimit).
		Find(&videos).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询视频失败"})
		return
	}
	var totalVideos, totalReports, sheetCount, commentCount int64
	h.db.Model(&model.Video{}).Count(&totalVideos)
	h.db.Model(&model.Video{}).Where("status = ?", model.StatusDone).Count(&totalReports)
	h.db.Model(&model.EvaluationSheet{}).Count(&sheetCount)
	h.db.Model(&model.EvaluationSheet{}).Select("COALESCE(SUM(commented_count), 0)").Scan(&commentCount)

	byID := make(map[uint]*model.Student, len(students))
	for i := range students {
		byID[students[i].ID] = &students[i]
	}

	type best struct {
		rating int
		level  string
	}
	bestOf := map[uint]best{}
	levelCounts := map[string]int{}
	typeCounts := map[string]int{}
	classVideos := map[string]int{}
	classRatingSum := map[string]int{}
	classExcellent := map[string]int{}
	moments := []screenMoment{}
	recent := map[uint]screenMoment{}
	recentRating := map[uint]int{}
	weekAgo := time.Now().AddDate(0, 0, -7)

	for i := range videos {
		v := &videos[i]
		if v.TrainingType == unrecognisedTraining {
			continue
		}
		report, err := h.analysis.DecryptReport(v)
		if err != nil || report == nil || report.TrainingType == unrecognisedTraining {
			continue
		}
		levelCounts[report.Level]++
		typeCounts[report.TrainingType]++
		s := byID[v.StudentID]
		if s == nil {
			continue
		}
		classVideos[s.ClassName]++
		classRatingSum[s.ClassName] += report.Rating
		if report.Level == "优秀" {
			classExcellent[s.ClassName]++
		}
		if b, ok := bestOf[s.ID]; !ok || report.Rating > b.rating {
			bestOf[s.ID] = best{rating: report.Rating, level: report.Level}
		}
		highlight := ""
		if len(report.Highlights) > 0 {
			highlight = report.Highlights[0]
		}
		moment := screenMoment{
			VideoID: v.ID, StudentID: s.ID, Student: s.Name, ClassName: s.ClassName,
			TrainingType: report.TrainingType, Level: report.Level, Text: highlight, Date: v.CreatedAt,
		}
		if highlight != "" && len(moments) < screenMoments {
			moments = append(moments, moment)
		}
		if v.CreatedAt.After(weekAgo) && report.Rating > recentRating[s.ID] {
			recent[s.ID], recentRating[s.ID] = moment, report.Rating
		}
	}

	// 近期之星：最近 7 天每名学生最好的一次表现；这一周还没有训练时，取最近的记录。
	starsLabel := "本周之星"
	if len(recent) == 0 {
		starsLabel = "近期之星"
		for _, m := range moments {
			if _, ok := recent[m.StudentID]; !ok {
				recent[m.StudentID] = m
				recentRating[m.StudentID] = levelRating(m.Level)
			}
		}
	}
	stars := make([]screenMoment, 0, len(recent))
	for _, m := range recent {
		stars = append(stars, m)
	}
	sort.Slice(stars, func(i, j int) bool {
		ri, rj := recentRating[stars[i].StudentID], recentRating[stars[j].StudentID]
		if ri != rj {
			return ri > rj
		}
		return stars[i].Date.After(stars[j].Date)
	})
	if len(stars) > screenStars {
		stars = stars[:screenStars]
	}

	classMap := map[string]*screenClass{}
	positionCounts := map[string]int{}
	for i := range students {
		s := &students[i]
		cls := classMap[s.ClassName]
		if cls == nil {
			cls = &screenClass{Name: s.ClassName}
			classMap[s.ClassName] = cls
		}
		cls.Students = append(cls.Students, screenStudent{ID: s.ID, Name: s.Name, Position: s.Position, Level: bestOf[s.ID].level})
		position := s.Position
		if position == "" {
			position = "未设置"
		}
		positionCounts[position]++
	}
	classList := make([]screenClass, 0, len(classMap))
	for name, cls := range classMap {
		cls.Videos = classVideos[name]
		cls.Excellent = classExcellent[name]
		if cls.Videos > 0 {
			cls.AvgRating = math.Round(float64(classRatingSum[name])/float64(cls.Videos)*10) / 10
		}
		classList = append(classList, *cls)
	}
	sort.Slice(classList, func(i, j int) bool { return classes.Less(classList[i].Name, classList[j].Name) })

	levels := make([]nameCount, 0, 4)
	for _, level := range []string{"优秀", "良好", "一般", "待提升"} {
		levels = append(levels, nameCount{Name: level, Count: levelCounts[level]})
	}
	positions := make([]nameCount, 0, 5)
	for _, p := range []string{"前锋", "中场", "后卫", "门将", "未设置"} {
		positions = append(positions, nameCount{Name: p, Count: positionCounts[p]})
	}
	types := make([]nameCount, 0, len(typeCounts))
	for name, n := range typeCounts {
		types = append(types, nameCount{Name: name, Count: n})
	}
	sort.Slice(types, func(i, j int) bool {
		if types[i].Count != types[j].Count {
			return types[i].Count > types[j].Count
		}
		return types[i].Name < types[j].Name
	})
	if len(types) > 6 {
		types = types[:6]
	}

	c.JSON(http.StatusOK, gin.H{
		"totals": gin.H{
			"students": len(students),
			"classes":  len(classList),
			"videos":   totalVideos,
			"reports":  totalReports,
			"sheets":   sheetCount,
			"comments": commentCount,
		},
		"levels":         levels,
		"positions":      positions,
		"training_types": types,
		"classes":        classList,
		"moments":        moments,
		"stars":          stars,
		"stars_label":    starsLabel,
		"trend":          h.trend(14),
	})
}

func levelRating(level string) int {
	switch level {
	case "优秀":
		return 5
	case "良好":
		return 4
	case "一般":
		return 3
	case "待提升":
		return 2
	}
	return 0
}
