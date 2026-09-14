package handler

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/xuri/excelize/v2"
	"gorm.io/gorm"

	"football-backend/internal/model"
	"football-backend/internal/service"
)

type ExportHandler struct {
	db       *gorm.DB
	analysis *service.Analysis
}

func NewExportHandler(db *gorm.DB, analysis *service.Analysis) *ExportHandler {
	return &ExportHandler{db: db, analysis: analysis}
}

type exportRow struct {
	ID           uint   `json:"id"`
	StudentName  string `json:"student_name"`
	StudentNo    string `json:"student_no"`
	ClassName    string `json:"class_name"`
	TrainingType string `json:"training_type"`
	CreatedAt    string `json:"created_at"`
	Status       string `json:"status"`
	Level        string `json:"level"`
	Rating       int    `json:"rating"`
	Summary      string `json:"summary"`
	Performance  string `json:"performance"`
	Highlights   string `json:"highlights"`
	Issues       string `json:"issues"`
	Suggestions  string `json:"suggestions"`
}

// exportHeaders 由 CSV 与 XLSX 两个导出器共用，保证两种格式的表头永远一致。
var exportHeaders = []string{
	"记录ID", "学生姓名", "学号", "班级", "训练项目", "分析时间",
	"综合评级", "星级", "整体总结", "动作表现", "做得好的地方", "发现的问题", "改进建议",
}

// Export 处理 GET /api/reports/export?format=csv|xlsx 接口，即报告页触发的
// 手动导出。体育老师日常使用 Excel，因此只提供这两种格式。
func (h *ExportHandler) Export(c *gin.Context) {
	query := h.db.Model(&model.Video{}).Preload("Student").
		Where("status = ?", model.StatusDone).Order("created_at DESC")

	if studentID := c.Query("student_id"); studentID != "" {
		query = query.Where("student_id = ?", studentID)
	}
	if className, ok := c.GetQuery("class_name"); ok {
		query = query.Where("student_id IN (?)", h.db.Model(&model.Student{}).Select("id").Where("class_name = ?", className))
	}

	var records []model.Video
	if err := query.Find(&records).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "导出失败：查询记录出错"})
		return
	}

	rows := make([]exportRow, 0, len(records))
	for i := range records {
		report, err := h.analysis.DecryptReport(&records[i])
		if err != nil || report == nil {
			continue
		}
		row := exportRow{
			ID:           records[i].ID,
			TrainingType: records[i].TrainingType,
			CreatedAt:    records[i].CreatedAt.Format("2006-01-02 15:04:05"),
			Status:       string(records[i].Status),
			Level:        report.Level,
			Rating:       report.Rating,
			Summary:      report.Summary,
			Performance:  report.Performance,
			Highlights:   strings.Join(report.Highlights, "；"),
			Issues:       strings.Join(report.Issues, "；"),
			Suggestions:  strings.Join(report.Suggestions, "；"),
		}
		if records[i].Student != nil {
			row.StudentName = records[i].Student.Name
			row.StudentNo = records[i].Student.StudentNo
			row.ClassName = records[i].Student.ClassName
		}
		rows = append(rows, row)
	}

	filename := fmt.Sprintf("训练报告_%s", time.Now().Format("20060102_150405"))

	if c.DefaultQuery("format", "csv") == "xlsx" {
		body, err := buildExportXLSX(rows)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "导出失败"})
			return
		}
		c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.xlsx"`, filename))
		c.Data(http.StatusOK, xlsxContentType, body)
		return
	}

	var buf bytes.Buffer
	// 写入 UTF-8 BOM，确保 Excel 能正确打开中文列头。
	buf.WriteString(utf8BOM)
	writer := csv.NewWriter(&buf)
	_ = writer.Write(exportHeaders)
	for _, row := range rows {
		_ = writer.Write(exportRowCells(row))
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "导出失败"})
		return
	}

	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.csv"`, filename))
	c.Data(http.StatusOK, "text/csv; charset=utf-8", buf.Bytes())
}

func exportRowCells(row exportRow) []string {
	return []string{
		fmt.Sprint(row.ID), row.StudentName, row.StudentNo, row.ClassName,
		row.TrainingType, row.CreatedAt, row.Level, fmt.Sprint(row.Rating),
		row.Summary, row.Performance, row.Highlights, row.Issues, row.Suggestions,
	}
}

// exportColumnWidths 为较长的自由文本报告列预设列宽，避免教师手动逐列调整。
var exportColumnWidths = []float64{10, 12, 14, 14, 12, 20, 10, 8, 40, 40, 30, 30, 30}

func buildExportXLSX(rows []exportRow) ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close()

	const sheet = "训练报告"
	index, err := f.NewSheet(sheet)
	if err != nil {
		return nil, err
	}
	f.SetActiveSheet(index)
	// NewFile() 总会创建一个 Sheet1，这里删掉它，让导出文件只有一个工作表。
	_ = f.DeleteSheet("Sheet1")

	headerStyle, err := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true},
		Fill:      excelize.Fill{Type: "pattern", Color: []string{"#E8F0FE"}, Pattern: 1},
		Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center"},
	})
	if err != nil {
		return nil, err
	}
	bodyStyle, err := f.NewStyle(&excelize.Style{
		Alignment: &excelize.Alignment{Vertical: "top", WrapText: true},
	})
	if err != nil {
		return nil, err
	}

	for i, header := range exportHeaders {
		col, _ := excelize.ColumnNumberToName(i + 1)
		_ = f.SetColWidth(sheet, col, col, exportColumnWidths[i])
		cell := fmt.Sprintf("%s1", col)
		_ = f.SetCellValue(sheet, cell, header)
		_ = f.SetCellStyle(sheet, cell, cell, headerStyle)
	}

	for i, row := range rows {
		line := i + 2
		for j, value := range exportRowCells(row) {
			col, _ := excelize.ColumnNumberToName(j + 1)
			cell := fmt.Sprintf("%s%d", col, line)
			// 故意以字符串写入：像“2023001”这样的学号不能被 Excel 转成数字。
			_ = f.SetCellStr(sheet, cell, value)
			_ = f.SetCellStyle(sheet, cell, cell, bodyStyle)
		}
	}

	// 冻结表头行，滚动时表头保持可见。
	lastCol, _ := excelize.ColumnNumberToName(len(exportHeaders))
	if err := f.SetPanes(sheet, &excelize.Panes{
		Freeze:      true,
		YSplit:      1,
		TopLeftCell: "A2",
		ActivePane:  "bottomLeft",
		Selection: []excelize.Selection{
			{SQRef: "A2:" + lastCol + "2", Pane: "bottomLeft"},
		},
	}); err != nil {
		return nil, err
	}

	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
