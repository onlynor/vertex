package evaluation

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// CommentSystemPrompt 约束评语写法：只依据老师的记录，先肯定、再指出一个改进点。
const CommentSystemPrompt = `你是一名经验丰富的中小学体育教师，正在根据评价记录给学生写足球课评语。

要求：
1. 只依据给出的评价记录和视频分析结论来写，不要编造记录里没有的事实、数字或比赛情节。
2. 先具体肯定做得好的地方，再指出一个最需要改进的方面，并给出一条课后能照着做的练习建议。
3. 读者是学生和家长：语气温和、真诚、具体，少用套话；不要出现星级、分数或“AI”等字样。
4. 以学生姓名加“同学”开头（例如“张三同学，……”），写成一段话，字数按要求，使用简体中文。
5. 只输出评语正文，不要标题、引号或任何说明。`

// SummarySystemPrompt 约束班级总评：只依据统计数据，给出下节课能直接用的建议。
const SummarySystemPrompt = `你是一名中小学体育教研员，正在根据全班的评价统计撰写足球课教学总评。

要求：
1. 只依据给出的统计数据和老师记录来写，不要编造数据。
2. 按以下顺序分段：整体情况（一两句）；表现较好的方面；需要加强的方面；接下来的教学建议（2~3 条，具体可执行）。
3. 可以点名表扬个别学生，但不要点名批评学生。
4. 使用简体中文，250 字以内；不要使用 Markdown 符号（如 #、*）。`

// SheetInfo 是评价表的表头信息。
type SheetInfo struct {
	ClassName string
	Title     string
	Date      string
	Options   Options
}

// VideoNote 是某段训练视频的 AI 分析结论，作为写评语的参考。
type VideoNote struct {
	ID           uint
	Date         string
	TrainingType string
	Level        string
	Highlights   []string
	Issues       []string
}

// VideoContext 是写评语时可参考的视频：期末评价同时给出期初和期末两段。
type VideoContext struct {
	First  *VideoNote
	Latest *VideoNote
	// Label 是 Latest 的称呼，如「比赛录像」「最近一次训练视频」。
	Label string
}

// Row 是参与统计的一名学生。
type Row struct {
	Name     string
	Position string
	Values   map[string]any
}

// CommentPrompt 为一名学生拼装评语提示词。
func CommentPrompt(k *Kind, sheet SheetInfo, name, position string, values map[string]any, videos VideoContext) string {
	var b strings.Builder
	fmt.Fprintf(&b, "评价表：%s（%s：%s，%s，%s）\n", k.Label, k.TitleLabel, sheet.Title, sheet.Date, ClassLabel(sheet.ClassName))
	writeOptions(&b, sheet.Options, sheet.Date)
	fmt.Fprintf(&b, "学生：%s", name)
	if position != "" {
		fmt.Fprintf(&b, "（场上位置：%s）", position)
	}
	b.WriteString("\n\n老师的评价记录：\n")
	for _, f := range k.Fields {
		switch {
		case f.Context:
			continue
		case f.Type == Position:
			for _, item := range PositionItemsFor(position) {
				if n, ok := asInt(values[PositionPrefix+item.Key]); ok {
					fmt.Fprintf(&b, "- %s·%s：%d 星（%s）\n", f.Label, item.Label, n, StarLevel(n))
				}
			}
		default:
			v, ok := values[f.Key]
			if !ok {
				continue
			}
			text := f.Describe(v)
			if f.Key == "score" && sheet.Options.Drill != nil {
				n, _ := asInt(v)
				text = fmt.Sprintf("%d %s", n, sheet.Options.Drill.Unit)
			}
			fmt.Fprintf(&b, "- %s：%s\n", f.Label, text)
		}
	}
	writeVideos(&b, videos)
	fmt.Fprintf(&b, "\n写作侧重：%s\n请为这名学生写一段评语，%s 字，以“%s同学”开头。", k.Guidance, k.CommentLength, name)
	return b.String()
}

func writeOptions(b *strings.Builder, o Options, date string) {
	if d := o.Drill; d != nil {
		fmt.Fprintf(b, "练习项目：%s（%s）；达标线：基础层 %s、提高层 %s、挑战层 %s\n",
			d.Label, d.Measure, thresholdText(d, 0), thresholdText(d, 1), thresholdText(d, 2))
	}
	if o.PeriodStart != "" {
		fmt.Fprintf(b, "统计区间：%s 至 %s\n", o.PeriodStart, date)
	}
	if o.RecordMethod != "" {
		fmt.Fprintf(b, "记录方式：%s\n", o.RecordMethod)
	}
}

func thresholdText(d *Drill, i int) string {
	if d.LowerIsBetter {
		return fmt.Sprintf("≤%d %s", d.Thresholds[i], d.Unit)
	}
	return fmt.Sprintf("≥%d %s", d.Thresholds[i], d.Unit)
}

func writeVideos(b *strings.Builder, v VideoContext) {
	if v.First != nil && v.Latest != nil && v.First.ID != v.Latest.ID {
		writeVideo(b, "期初视频", v.First)
		writeVideo(b, "期末视频", v.Latest)
		b.WriteString("（请对比期初和期末两段视频，说明动作上的变化）\n")
		return
	}
	if v.Latest != nil {
		writeVideo(b, v.Label, v.Latest)
	}
}

func writeVideo(b *strings.Builder, label string, n *VideoNote) {
	fmt.Fprintf(b, "\n%s的 AI 分析（%s，%s；仅作参考，以老师的记录为主）：\n", label, n.Date, n.TrainingType)
	fmt.Fprintf(b, "- 综合表现：%s\n", n.Level)
	if len(n.Highlights) > 0 {
		fmt.Fprintf(b, "- 做得好的地方：%s\n", strings.Join(n.Highlights, "；"))
	}
	if len(n.Issues) > 0 {
		fmt.Fprintf(b, "- 发现的问题：%s\n", strings.Join(n.Issues, "；"))
	}
}

// 每个文字类评价项最多摘几条给模型参考，全班几十条原文既费调用额度也会淹没统计信息。
const summaryTextSamples = 6

// SummaryPrompt 汇总全班数据，拼装课堂总评提示词。total 是表中学生总数，rows 只含已有评价的学生。
func SummaryPrompt(k *Kind, sheet SheetInfo, total int, rows []Row) string {
	var b strings.Builder
	fmt.Fprintf(&b, "评价表：%s\n班级：%s\n%s：%s\n日期：%s\n", k.Label, ClassLabel(sheet.ClassName), k.TitleLabel, sheet.Title, sheet.Date)
	writeOptions(&b, sheet.Options, sheet.Date)
	fmt.Fprintf(&b, "全班 %d 人，其中 %d 人有评价记录。\n\n各项统计：\n", total, len(rows))

	var samples []string
	for _, f := range k.Fields {
		switch f.Type {
		case Stars:
			b.WriteString(starStat(f, rows))
		case Number:
			if f.Key == "score" && sheet.Options.Drill != nil {
				b.WriteString(scoreStat(f, *sheet.Options.Drill, rows))
			} else {
				b.WriteString(numberStat(f, rows))
			}
		case Choice:
			b.WriteString(choiceStat(f, rows))
		case Position:
			b.WriteString(positionStat(f, rows))
		case Text:
			taken := 0
			for _, r := range rows {
				s, _ := r.Values[f.Key].(string)
				if s == "" || taken >= summaryTextSamples {
					continue
				}
				samples = append(samples, fmt.Sprintf("- %s｜%s：%s", f.Label, r.Name, clipRunes(s, 60)))
				taken++
			}
		}
	}
	if len(samples) > 0 {
		b.WriteString("\n老师记录的文字（节选）：\n")
		b.WriteString(strings.Join(samples, "\n"))
		b.WriteString("\n")
	}
	b.WriteString("\n请据此撰写这次的教学总评。")
	return b.String()
}

func starStat(f Field, rows []Row) string {
	counts := make([]int, 6)
	sum, rated := 0, 0
	for _, r := range rows {
		n, ok := asInt(r.Values[f.Key])
		if !ok || n < 1 || n > 5 {
			continue
		}
		counts[n]++
		sum += n
		rated++
	}
	if rated == 0 {
		return fmt.Sprintf("- %s：暂无记录\n", f.Label)
	}
	var parts []string
	for level := 5; level >= 1; level-- {
		if counts[level] > 0 {
			parts = append(parts, fmt.Sprintf("%s %d 人", f.LevelLabel(level), counts[level]))
		}
	}
	return fmt.Sprintf("- %s：平均 %.1f 星（%s）\n", f.Label, float64(sum)/float64(rated), strings.Join(parts, "、"))
}

func numberStat(f Field, rows []Row) string {
	sum, count := 0, 0
	for _, r := range rows {
		if n, ok := asInt(r.Values[f.Key]); ok {
			sum += n
			count++
		}
	}
	if count == 0 {
		return fmt.Sprintf("- %s：暂无记录\n", f.Label)
	}
	avg := float64(sum) / float64(count)
	return fmt.Sprintf("- %s：合计 %d %s，人均 %.1f %s（%d 人有记录）\n", f.Label, sum, f.Unit, avg, f.Unit, count)
}

// scoreStat 统计分层评价的成绩：平均值和最好成绩（按越多越好或越少越好判断）。
func scoreStat(f Field, d Drill, rows []Row) string {
	sum, count, best := 0, 0, 0
	for _, r := range rows {
		n, ok := asInt(r.Values[f.Key])
		if !ok {
			continue
		}
		if count == 0 || (d.LowerIsBetter && n < best) || (!d.LowerIsBetter && n > best) {
			best = n
		}
		sum += n
		count++
	}
	if count == 0 {
		return fmt.Sprintf("- %s：暂无记录\n", f.Label)
	}
	return fmt.Sprintf("- %s（%s）：平均 %.1f %s，最好 %d %s（%d 人有记录）\n",
		f.Label, d.Measure, float64(sum)/float64(count), d.Unit, best, d.Unit, count)
}

func choiceStat(f Field, rows []Row) string {
	counts := map[string]int{}
	for _, r := range rows {
		if s, ok := r.Values[f.Key].(string); ok && s != "" {
			counts[s]++
		}
	}
	var parts []string
	for _, option := range f.Options {
		if counts[option] > 0 {
			parts = append(parts, fmt.Sprintf("%s %d 人", option, counts[option]))
		}
	}
	if len(parts) == 0 {
		return fmt.Sprintf("- %s：暂无记录\n", f.Label)
	}
	return fmt.Sprintf("- %s：%s\n", f.Label, strings.Join(parts, "、"))
}

// positionStat 按位置分组统计位置专项的平均星级。
func positionStat(f Field, rows []Row) string {
	var b strings.Builder
	for _, position := range Positions {
		group := 0
		for _, r := range rows {
			if r.Position == position {
				group++
			}
		}
		if group == 0 {
			continue
		}
		var parts []string
		for _, item := range PositionItems[position] {
			sum, rated := 0, 0
			for _, r := range rows {
				if r.Position != position {
					continue
				}
				if n, ok := asInt(r.Values[PositionPrefix+item.Key]); ok {
					sum += n
					rated++
				}
			}
			if rated > 0 {
				parts = append(parts, fmt.Sprintf("%s 平均 %.1f 星", item.Label, float64(sum)/float64(rated)))
			}
		}
		if len(parts) > 0 {
			fmt.Fprintf(&b, "- %s（%s %d 人）：%s\n", f.Label, position, group, strings.Join(parts, "，"))
		}
	}
	if b.Len() == 0 {
		return fmt.Sprintf("- %s：暂无记录\n", f.Label)
	}
	return b.String()
}

var (
	markdownHeading = regexp.MustCompile(`(?m)^\s*#+\s*`)
	codeFence       = regexp.MustCompile("(?m)^```[a-zA-Z]*\\s*$")
)

// CleanComment 把模型回复整理成一段评语：去掉代码围栏、「评语：」前缀、首尾引号和换行。
// 模型偶尔会照抄「XX同学」这种占位写法，这里换回学生姓名。
func CleanComment(raw, name string) string {
	s := codeFence.ReplaceAllString(raw, "")
	var parts []string
	for _, line := range strings.Split(s, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			parts = append(parts, line)
		}
	}
	s = strings.Join(parts, "")
	for _, prefix := range []string{"评语：", "评语:"} {
		s = strings.TrimPrefix(s, prefix)
	}
	s = strings.Trim(s, "\"“”「」'‘’ ")
	if name != "" {
		s = strings.NewReplacer("XX同学", name+"同学", "××同学", name+"同学", "xx同学", name+"同学").Replace(s)
	}
	return clipRunes(s, 400)
}

// CleanSummary 保留分段，去掉模型偶尔仍会输出的 Markdown 标记。
func CleanSummary(raw string) string {
	s := codeFence.ReplaceAllString(raw, "")
	s = markdownHeading.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "**", "")
	var lines []string
	for _, line := range strings.Split(s, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	return clipRunes(strings.Join(lines, "\n"), 1200)
}

// ClassLabel 让没有班级的学生也有一个可读的名字。
func ClassLabel(name string) string {
	if strings.TrimSpace(name) == "" {
		return "未分班"
	}
	return name
}

func clipRunes(s string, limit int) string {
	if utf8.RuneCountInString(s) <= limit {
		return s
	}
	return string([]rune(s)[:limit]) + "…"
}
