package handler

import (
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/xuri/excelize/v2"
)

const (
	maxExportSheets  = 10
	maxExportColumns = 60
	maxExportRows    = 5000
	maxExportBody    = 5 << 20
	// Excel 单个单元格最多容纳 32767 个字符。
	maxCellRunes = 32767
)

type tableColumn struct {
	Header string  `json:"header"`
	Width  float64 `json:"width"`
}

// tableSheet 描述一个工作表：可选的标题和表头信息（键值对）、表格本体，以及表格下方的说明。
type tableSheet struct {
	Name    string        `json:"name"`
	Title   string        `json:"title"`
	Meta    [][2]string   `json:"meta"`
	Columns []tableColumn `json:"columns"`
	Rows    [][]any       `json:"rows"`
	Notes   []string      `json:"notes"`
}

type tableExportRequest struct {
	Filename string       `json:"filename"`
	Sheets   []tableSheet `json:"sheets"`
}

// ExportTable 处理 POST /api/export/xlsx 接口：把前端整理好的表格生成 Excel 文件。
// 球员能力、智能评价的数据在前端汇总计算，导出时把结果交给这里统一排版，
// 表头样式与训练报告导出保持一致，前端也不必再引入体积很大的 Excel 库。
func (h *ExportHandler) ExportTable(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxExportBody)
	var req tableExportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "导出数据格式错误或超出大小限制"})
		return
	}
	if len(req.Sheets) == 0 || len(req.Sheets) > maxExportSheets {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("工作表数量应在 1~%d 个之间", maxExportSheets)})
		return
	}
	for _, s := range req.Sheets {
		if len(s.Columns) == 0 || len(s.Columns) > maxExportColumns || len(s.Rows) > maxExportRows {
			c.JSON(http.StatusBadRequest, gin.H{"error": "导出的表格过大"})
			return
		}
	}

	body, err := buildTableXLSX(req.Sheets)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成 Excel 失败"})
		return
	}
	filename := sanitizeFilename(req.Filename) + ".xlsx"
	c.Header("Content-Disposition",
		fmt.Sprintf(`attachment; filename="export.xlsx"; filename*=UTF-8''%s`, url.PathEscape(filename)))
	c.Data(http.StatusOK, xlsxContentType, body)
}

type tableStyles struct {
	title, metaLabel, metaValue, header, text, number, note int
}

func newTableStyles(f *excelize.File) (tableStyles, error) {
	specs := []*excelize.Style{
		{Font: &excelize.Font{Bold: true, Size: 14, Color: "#101828"}, Alignment: &excelize.Alignment{Vertical: "center"}},
		{Font: &excelize.Font{Bold: true, Color: "#667085"}, Alignment: &excelize.Alignment{Vertical: "top"}},
		{Font: &excelize.Font{Color: "#344054"}, Alignment: &excelize.Alignment{Vertical: "top", WrapText: true}},
		{
			Font:      &excelize.Font{Bold: true, Color: "#1D2939"},
			Fill:      excelize.Fill{Type: "pattern", Color: []string{"#E8F0FE"}, Pattern: 1},
			Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center", WrapText: true},
			Border:    []excelize.Border{{Type: "bottom", Color: "#C7D7FE", Style: 1}},
		},
		{Alignment: &excelize.Alignment{Vertical: "top", WrapText: true}},
		{Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "top"}},
		{Font: &excelize.Font{Color: "#667085", Size: 10}, Alignment: &excelize.Alignment{Vertical: "top", WrapText: true}},
	}
	ids := make([]int, len(specs))
	for i, spec := range specs {
		id, err := f.NewStyle(spec)
		if err != nil {
			return tableStyles{}, err
		}
		ids[i] = id
	}
	return tableStyles{
		title: ids[0], metaLabel: ids[1], metaValue: ids[2], header: ids[3],
		text: ids[4], number: ids[5], note: ids[6],
	}, nil
}

func buildTableXLSX(sheets []tableSheet) ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close()

	styles, err := newTableStyles(f)
	if err != nil {
		return nil, err
	}
	used := map[string]bool{}
	for i, s := range sheets {
		name := uniqueSheetName(s.Name, i, used)
		// NewFile() 自带一个 Sheet1，第一个工作表直接重命名它。
		if i == 0 {
			if err := f.SetSheetName("Sheet1", name); err != nil {
				return nil, err
			}
		} else if _, err := f.NewSheet(name); err != nil {
			return nil, err
		}
		if err := writeTableSheet(f, name, s, styles); err != nil {
			return nil, err
		}
	}
	f.SetActiveSheet(0)

	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func writeTableSheet(f *excelize.File, name string, s tableSheet, st tableStyles) error {
	cols := len(s.Columns)
	lastCol, _ := excelize.ColumnNumberToName(cols)
	widths := make([]float64, cols)
	totalWidth := 0.0
	for i, col := range s.Columns {
		w := col.Width
		if w <= 0 {
			w = 12
		}
		widths[i] = math.Min(w, 80)
		totalWidth += widths[i]
		colName, _ := excelize.ColumnNumberToName(i + 1)
		if err := f.SetColWidth(name, colName, colName, widths[i]); err != nil {
			return err
		}
	}

	row := 1
	if s.Title != "" {
		if err := f.SetCellStr(name, "A1", clipCell(s.Title)); err != nil {
			return err
		}
		_ = f.SetCellStyle(name, "A1", "A1", st.title)
		if cols > 1 {
			_ = f.MergeCell(name, "A1", lastCol+"1")
		}
		_ = f.SetRowHeight(name, 1, 26)
		row = 2
	}

	// 表头信息：第一列是名称，其余列合并起来放内容。
	valueWidth := totalWidth - widths[0]
	for _, m := range s.Meta {
		label, value := fmt.Sprintf("A%d", row), fmt.Sprintf("B%d", row)
		_ = f.SetCellStr(name, label, clipCell(m[0]))
		_ = f.SetCellStyle(name, label, label, st.metaLabel)
		if cols > 1 {
			_ = f.SetCellStr(name, value, clipCell(m[1]))
			_ = f.SetCellStyle(name, value, value, st.metaValue)
			if cols > 2 {
				_ = f.MergeCell(name, value, fmt.Sprintf("%s%d", lastCol, row))
			}
			fitMergedRow(f, name, row, m[1], valueWidth)
		}
		row++
	}
	if row > 1 {
		row++ // 标题区与表格之间空一行
	}

	headerRow := row
	for i, col := range s.Columns {
		colName, _ := excelize.ColumnNumberToName(i + 1)
		_ = f.SetCellStr(name, fmt.Sprintf("%s%d", colName, headerRow), clipCell(col.Header))
	}
	_ = f.SetCellStyle(name, fmt.Sprintf("A%d", headerRow), fmt.Sprintf("%s%d", lastCol, headerRow), st.header)

	for r, values := range s.Rows {
		line := headerRow + 1 + r
		for c := 0; c < cols && c < len(values); c++ {
			colName, _ := excelize.ColumnNumberToName(c + 1)
			cell := fmt.Sprintf("%s%d", colName, line)
			switch v := values[c].(type) {
			case float64:
				// 分数、次数以数字写入，老师可以直接在 Excel 里排序、求平均。
				_ = f.SetCellFloat(name, cell, v, -1, 64)
				_ = f.SetCellStyle(name, cell, cell, st.number)
			case string:
				// 学号这类纯数字文本也按字符串写入，避免被 Excel 转成数字丢掉前导零。
				_ = f.SetCellStr(name, cell, clipCell(v))
				_ = f.SetCellStyle(name, cell, cell, st.text)
			case bool:
				text := "否"
				if v {
					text = "是"
				}
				_ = f.SetCellStr(name, cell, text)
				_ = f.SetCellStyle(name, cell, cell, st.text)
			}
		}
	}

	line := headerRow + len(s.Rows) + 2
	for _, note := range s.Notes {
		cell := fmt.Sprintf("A%d", line)
		_ = f.SetCellStr(name, cell, clipCell(note))
		_ = f.SetCellStyle(name, cell, cell, st.note)
		if cols > 1 {
			_ = f.MergeCell(name, cell, fmt.Sprintf("%s%d", lastCol, line))
		}
		fitMergedRow(f, name, line, note, totalWidth)
		line++
	}

	// 冻结表头行，滚动时表头保持可见。
	return f.SetPanes(name, &excelize.Panes{
		Freeze:      true,
		YSplit:      headerRow,
		TopLeftCell: fmt.Sprintf("A%d", headerRow+1),
		ActivePane:  "bottomLeft",
		Selection: []excelize.Selection{
			{SQRef: fmt.Sprintf("A%d", headerRow+1), ActiveCell: fmt.Sprintf("A%d", headerRow+1), Pane: "bottomLeft"},
		},
	})
}

// fitMergedRow 为合并单元格估算行高。Excel 不会为合并单元格自动调整行高，
// 不设置的话长说明文字只显示第一行。按一个汉字约占两个列宽单位估算。
func fitMergedRow(f *excelize.File, sheet string, row int, text string, width float64) {
	if width <= 0 {
		return
	}
	units := 0.0
	for _, line := range strings.Split(text, "\n") {
		w := 0.0
		for _, r := range line {
			if r < 0x2E80 {
				w++
			} else {
				w += 2
			}
		}
		units += math.Max(1, math.Ceil(w/width))
	}
	if units > 1 {
		_ = f.SetRowHeight(sheet, row, math.Min(15*units+3, 409))
	}
}

// uniqueSheetName 去掉 Excel 不允许出现在工作表名中的字符，截断到 31 个字符并保证不重名。
func uniqueSheetName(raw string, index int, used map[string]bool) string {
	name := strings.Map(func(r rune) rune {
		if strings.ContainsRune(`[]:*?/\`, r) {
			return -1
		}
		return r
	}, strings.TrimSpace(raw))
	if name == "" {
		name = fmt.Sprintf("Sheet%d", index+1)
	}
	if utf8.RuneCountInString(name) > 28 {
		name = string([]rune(name)[:28])
	}
	candidate := name
	for n := 2; used[candidate]; n++ {
		candidate = fmt.Sprintf("%s(%d)", name, n)
	}
	used[candidate] = true
	return candidate
}

// sanitizeFilename 去掉文件名中各操作系统不允许的字符。
func sanitizeFilename(raw string) string {
	name := strings.Map(func(r rune) rune {
		if r < 0x20 || strings.ContainsRune(`\/:*?"<>|`, r) {
			return -1
		}
		return r
	}, strings.TrimSpace(raw))
	if name == "" {
		return "导出数据"
	}
	if utf8.RuneCountInString(name) > 80 {
		name = string([]rune(name)[:80])
	}
	return name
}

func clipCell(s string) string {
	if utf8.RuneCountInString(s) <= maxCellRunes {
		return s
	}
	return string([]rune(s)[:maxCellRunes])
}
