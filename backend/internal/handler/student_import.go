package handler

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/xuri/excelize/v2"
	"gorm.io/gorm"

	"football-backend/internal/auth"
	"football-backend/internal/classes"
	"football-backend/internal/model"
)

const (
	// 写入 UTF-8 BOM，确保 Excel 能正确打开中文列头。
	utf8BOM         = "\xEF\xBB\xBF"
	xlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	// 一份班级名单通常只有几百行，更大的文件多半是误传。
	maxImportBytes = 5 * 1024 * 1024
	// 老师们经常在真正的表头行上方留一行标题，这里在前若干行中寻找表头。
	headerSearchRows = 10
)

var importTemplateHeaders = []string{"姓名", "学号", "性别", "年龄", "班级", "位置"}

// 模板示例中的学号故意设成不像是真实学号：导入按学号去重，
// 如果示例学号太像真的，教师不改示例行直接上传模板，就可能悄悄覆盖掉已有的学生。
var importTemplateExample = []string{"示例-张小明（请替换本行）", "示例001", "男", "12", "六年级一班", "中场"}

// importAliases 把规范化后的表头单元格映射到对应的学生字段。
// 这些文件由教师手工编辑，因此这里兼容常见的写法变体，而不是因为
// 列名不合规范就拒绝整份名单。
var importAliases = map[string]string{
	"姓名": "name", "学生姓名": "name", "名字": "name", "学生": "name", "name": "name",
	"学号": "student_no", "学生学号": "student_no", "学籍号": "student_no", "编号": "student_no",
	"studentno": "student_no", "student_no": "student_no", "studentnumber": "student_no",
	"性别": "gender", "sex": "gender", "gender": "gender",
	"年龄": "age", "age": "age",
	"班级": "class_name", "班级名称": "class_name", "所在班级": "class_name",
	"class": "class_name", "classname": "class_name", "class_name": "class_name",
	"位置": "position", "场上位置": "position", "司职": "position", "position": "position",
}

type importRowError struct {
	Row     int    `json:"row"`
	Message string `json:"message"`
}

type importResult struct {
	Created int              `json:"created"`
	Updated int              `json:"updated"`
	Skipped int              `json:"skipped"`
	Errors  []importRowError `json:"errors"`
}

// Import 处理 POST /api/students/import 接口，导入 CSV 或 XLSX 班级名单。
// 部分成功是这里的常态：一行数据出错不应让教师丢掉另外几十行。
func (h *StudentHandler) Import(c *gin.Context) {
	header, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未找到上传的文件"})
		return
	}
	if header.Size <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文件为空"})
		return
	}
	if header.Size > maxImportBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("文件过大，最大支持 %dMB", maxImportBytes/1024/1024)})
		return
	}
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext != ".csv" && ext != ".xlsx" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的文件格式，仅支持 CSV / XLSX"})
		return
	}

	rows, err := readImportRows(header, ext)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	headerIdx, columns := locateImportHeader(rows)
	if headerIdx < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未找到表头行，请确认文件包含“姓名”列"})
		return
	}

	claims := auth.CurrentTeacher(c)
	result := importResult{Errors: []importRowError{}}

	for i := headerIdx + 1; i < len(rows); i++ {
		if isBlankRow(rows[i]) {
			continue
		}
		// 报错时使用教师在表格里看到的行号，而不是切片索引。
		rowNo := i + 1
		student, err := parseImportRow(rows[i], columns)
		if err != nil {
			result.Skipped++
			result.Errors = append(result.Errors, importRowError{Row: rowNo, Message: err.Error()})
			continue
		}
		student.TeacherID = claims.TeacherID

		// 班级名称已统一成「2年级1班」这种写法；老数据可能还是「二年级一班」，查重时两种都认。
		existing, err := h.findExistingStudent(student, cellAt(rows[i], columns, "class_name"))
		if err != nil {
			result.Skipped++
			result.Errors = append(result.Errors, importRowError{Row: rowNo, Message: "查询已有学生失败"})
			continue
		}
		if existing != nil {
			if err := h.db.Model(existing).Updates(importUpdates(student)).Error; err != nil {
				result.Skipped++
				result.Errors = append(result.Errors, importRowError{Row: rowNo, Message: "更新学生失败"})
				continue
			}
			result.Updated++
			continue
		}
		if err := h.db.Create(student).Error; err != nil {
			result.Skipped++
			result.Errors = append(result.Errors, importRowError{Row: rowNo, Message: "创建学生失败"})
			continue
		}
		result.Created++
	}

	c.JSON(http.StatusOK, result)
}

// ImportTemplate 处理 GET /api/students/import-template?format=csv|xlsx 接口。
func (h *StudentHandler) ImportTemplate(c *gin.Context) {
	filename := "学生导入模板"

	if c.DefaultQuery("format", "csv") == "xlsx" {
		body, err := buildTemplateXLSX()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "生成模板失败"})
			return
		}
		c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.xlsx"`, filename))
		c.Data(http.StatusOK, xlsxContentType, body)
		return
	}

	var buf bytes.Buffer
	buf.WriteString(utf8BOM)
	writer := csv.NewWriter(&buf)
	_ = writer.Write(importTemplateHeaders)
	_ = writer.Write(importTemplateExample)
	writer.Flush()
	if err := writer.Error(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成模板失败"})
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.csv"`, filename))
	c.Data(http.StatusOK, "text/csv; charset=utf-8", buf.Bytes())
}

func buildTemplateXLSX() ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close()

	const sheet = "学生名单"
	index, err := f.NewSheet(sheet)
	if err != nil {
		return nil, err
	}
	f.SetActiveSheet(index)
	_ = f.DeleteSheet("Sheet1")

	headerStyle, err := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true},
		Fill:      excelize.Fill{Type: "pattern", Color: []string{"#E8F0FE"}, Pattern: 1},
		Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center"},
	})
	if err != nil {
		return nil, err
	}

	for i, header := range importTemplateHeaders {
		col, _ := excelize.ColumnNumberToName(i + 1)
		_ = f.SetColWidth(sheet, col, col, 16)
		cell := fmt.Sprintf("%s1", col)
		_ = f.SetCellValue(sheet, cell, header)
		_ = f.SetCellStyle(sheet, cell, cell, headerStyle)
		// 使用文本单元格写入，保证学号中的前导零不被丢失。
		_ = f.SetCellStr(sheet, fmt.Sprintf("%s2", col), importTemplateExample[i])
	}

	lastCol, _ := excelize.ColumnNumberToName(len(importTemplateHeaders))
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

func readImportRows(header *multipart.FileHeader, ext string) ([][]string, error) {
	file, err := header.Open()
	if err != nil {
		return nil, fmt.Errorf("读取文件失败")
	}
	defer file.Close()

	raw, err := io.ReadAll(io.LimitReader(file, maxImportBytes+1))
	if err != nil {
		return nil, fmt.Errorf("读取文件失败")
	}

	if ext == ".xlsx" {
		f, err := excelize.OpenReader(bytes.NewReader(raw))
		if err != nil {
			return nil, fmt.Errorf("Excel 文件解析失败，请确认为 .xlsx 格式")
		}
		defer f.Close()
		sheets := f.GetSheetList()
		if len(sheets) == 0 {
			return nil, fmt.Errorf("Excel 文件没有工作表")
		}
		rows, err := f.GetRows(sheets[0])
		if err != nil {
			return nil, fmt.Errorf("Excel 文件解析失败")
		}
		return rows, nil
	}

	reader := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(raw, []byte(utf8BOM))))
	// 名单的末尾列常常参差不齐，这里允许每一行的长度不同。
	reader.FieldsPerRecord = -1
	rows, err := reader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("CSV 文件解析失败，请确认文件为 UTF-8 编码")
	}
	return rows, nil
}

// locateImportHeader 找到表头行，并把每个已知字段映射到其所在列下标，
// 从而允许列顺序自由排列。
func locateImportHeader(rows [][]string) (int, map[string]int) {
	limit := min(len(rows), headerSearchRows)
	for i := 0; i < limit; i++ {
		columns := map[string]int{}
		for j, cell := range rows[i] {
			if field, ok := importAliases[normalizeHeader(cell)]; ok {
				if _, seen := columns[field]; !seen {
					columns[field] = j
				}
			}
		}
		if _, ok := columns["name"]; ok {
			return i, columns
		}
	}
	return -1, nil
}

func normalizeHeader(cell string) string {
	cell = strings.TrimPrefix(cell, utf8BOM)
	cell = strings.NewReplacer(" ", "", "　", "", "\t", "", "-", "", "_", "").Replace(cell)
	return strings.ToLower(strings.TrimSpace(cell))
}

func cellAt(row []string, columns map[string]int, field string) string {
	idx, ok := columns[field]
	if !ok || idx >= len(row) {
		return ""
	}
	return strings.TrimSpace(strings.ReplaceAll(row[idx], "　", " "))
}

func isBlankRow(row []string) bool {
	for _, cell := range row {
		if strings.TrimSpace(cell) != "" {
			return false
		}
	}
	return true
}

func parseImportRow(row []string, columns map[string]int) (*model.Student, error) {
	student := &model.Student{
		Name:      cellAt(row, columns, "name"),
		StudentNo: cellAt(row, columns, "student_no"),
		ClassName: classes.Normalize(cellAt(row, columns, "class_name")),
	}
	if student.Name == "" {
		return nil, fmt.Errorf("姓名不能为空")
	}

	gender, err := normalizeGender(cellAt(row, columns, "gender"))
	if err != nil {
		return nil, err
	}
	student.Gender = gender

	position, err := normalizePosition(cellAt(row, columns, "position"))
	if err != nil {
		return nil, err
	}
	student.Position = position

	if raw := cellAt(row, columns, "age"); raw != "" {
		age, err := strconv.Atoi(raw)
		if err != nil {
			// Excel 通常把数字单元格读成“12”，但偶尔会是“12.0”。
			if f, ferr := strconv.ParseFloat(raw, 64); ferr == nil && f == math.Trunc(f) {
				age, err = int(f), nil
			}
		}
		if err != nil || age <= 0 || age > 120 {
			return nil, fmt.Errorf("年龄必须是有效的数字")
		}
		student.Age = age
	}
	return student, nil
}

func normalizeGender(raw string) (string, error) {
	switch strings.ToLower(raw) {
	case "":
		return "", nil
	case "男", "m", "male", "男生", "boy":
		return "男", nil
	case "女", "f", "female", "女生", "girl":
		return "女", nil
	}
	return "", fmt.Errorf("性别只能填写 男 或 女")
}

// normalizePosition 把教师填写的各种位置写法统一成四个标准值，空值表示未设置。
// 位置决定能力分析使用哪一组六维指标，因此不认识的写法直接报错，而不是悄悄忽略。
func normalizePosition(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "":
		return "", nil
	case "前锋", "中锋", "边锋", "fw", "st", "cf", "forward", "striker":
		return "前锋", nil
	case "中场", "前腰", "后腰", "边前卫", "mf", "cm", "am", "dm", "midfielder":
		return "中场", nil
	case "后卫", "中卫", "边卫", "边后卫", "df", "cb", "lb", "rb", "defender":
		return "后卫", nil
	case "门将", "守门员", "gk", "goalkeeper", "keeper":
		return "门将", nil
	}
	return "", fmt.Errorf("位置只能填写 前锋 / 中场 / 后卫 / 门将")
}

// findExistingStudent 实现去重规则：有学号时按学号识别学生，
// 学号为空时按“姓名 + 班级”识别；classAliases 是同一个班的其他写法。
func (h *StudentHandler) findExistingStudent(s *model.Student, classAliases ...string) (*model.Student, error) {
	query := h.db.Model(&model.Student{})
	if s.StudentNo != "" {
		query = query.Where("student_no = ?", s.StudentNo)
	} else {
		names := append([]string{s.ClassName}, classAliases...)
		query = query.Where("name = ? AND class_name IN ? AND (student_no IS NULL OR student_no = '')", s.Name, names)
	}

	var existing model.Student
	err := query.Order("id ASC").First(&existing).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &existing, nil
}

// importUpdates 只写入文件中确实填了的列，这样一次不完整的重新导入
// 不会清掉教师手工录入的数据。
func importUpdates(s *model.Student) map[string]interface{} {
	updates := map[string]interface{}{"name": s.Name, "updated_at": time.Now()}
	if s.StudentNo != "" {
		updates["student_no"] = s.StudentNo
	}
	if s.ClassName != "" {
		updates["class_name"] = s.ClassName
	}
	if s.Gender != "" {
		updates["gender"] = s.Gender
	}
	if s.Age > 0 {
		updates["age"] = s.Age
	}
	if s.Position != "" {
		updates["position"] = s.Position
	}
	return updates
}
