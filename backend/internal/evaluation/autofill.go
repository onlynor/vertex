package evaluation

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"
)

// FillSystemPrompt 约束「AI 一键评价」：按老师的口径把一张表填完，并且只依据给出的材料。
const FillSystemPrompt = `你是一名经验丰富的中小学体育教师，正在根据训练视频的分析结论和已有记录，替老师把一名学生的评价填好。

要求：
1. 只依据给出的材料（视频分析、老师已填内容、以往评价记录）判断，不要编造比赛情节、数字或事实。
2. 视频分析看的是技术动作：技术类项目按视频结论打分，做得好的给 4~5 星，被指出问题的给 2~3 星，不要所有项目都给同一个星级。
3. 训练态度、团队纪律、配合意识这类视频看不出来的项目，材料里没有依据就给 3 星（中等），不要凭印象打高分或低分。
4. 文字项写具体的观察，一句话 20 字左右，不要套话。
5. 评语写给学生和家长看：先具体肯定，再指出一个最需要改进的地方，给一条课后能照着做的练习建议；以学生姓名加“同学”开头，不要出现星级、分数或“AI”等字样。
6. 只输出一个 JSON 对象，不要代码围栏、不要任何解释：
{"values": {"字段键": 值}, "comment": "评语正文"}
7. values 里只能出现下面列出的字段键，星级填 1~5 的整数，选项类只能填给出的选项之一；没有把握的字段可以不填。`

// HistoryNote 是同一名学生在其它评价表上的记录，作为 AI 填表的参考。
type HistoryNote struct {
	Date  string
	Label string
	Title string
	// Lines 是各评价项的中文描述，如「训练态度：4 星（积极）」。
	Lines []string
}

// FillPrompt 为一名学生拼装「一键评价」的提示词：先给已有材料，再列出需要填的字段。
func FillPrompt(k *Kind, sheet SheetInfo, name, position string, values map[string]any, videos VideoContext, history []HistoryNote) string {
	var b strings.Builder
	fmt.Fprintf(&b, "评价表：%s（%s：%s，%s，%s）\n", k.Label, k.TitleLabel, sheet.Title, sheet.Date, ClassLabel(sheet.ClassName))
	writeOptions(&b, sheet.Options, sheet.Date)
	fmt.Fprintf(&b, "学生：%s", name)
	if position != "" {
		fmt.Fprintf(&b, "（场上位置：%s）", position)
	}
	b.WriteString("\n")

	if lines := recordedLines(k, sheet, position, values); len(lines) > 0 {
		b.WriteString("\n老师已经填写的内容（作为判断依据，不要改动）：\n")
		b.WriteString(strings.Join(lines, "\n") + "\n")
	}
	writeVideos(&b, videos)
	writeHistory(&b, history)

	b.WriteString("\n需要你填写的字段：\n")
	for _, line := range FillTargets(k, position, values, true) {
		b.WriteString("- " + line.Prompt + "\n")
	}
	fmt.Fprintf(&b, "\n写作侧重：%s\n请输出 JSON：values 填上面列出的字段，comment 为 %s 字的评语，以“%s同学”开头。",
		k.Guidance, k.CommentLength, name)
	return b.String()
}

// FillTarget 是一个待填字段：Key 是写进 values 的键，Prompt 是给模型看的说明。
type FillTarget struct {
	Key    string
	Prompt string
}

// FillTargets 列出这一行可以交给 AI 填的字段。skipFilled 为 true 时跳过老师已经填过的，
// 用于「只填空白」；为 false 时列出全部，用于「全部重填」。
func FillTargets(k *Kind, position string, values map[string]any, skipFilled bool) []FillTarget {
	var out []FillTarget
	for _, f := range k.Fields {
		if f.Type == Position {
			for _, item := range PositionItemsFor(position) {
				key := PositionPrefix + item.Key
				if skipFilled && has(values, key) {
					continue
				}
				out = append(out, FillTarget{Key: key, Prompt: fmt.Sprintf("%s｜%s·%s，1~5 星：%s；观察要点：%s",
					key, f.Label, item.Label, starScale(starLevels), item.Look)})
			}
			continue
		}
		if !f.AIFillable() || (skipFilled && has(values, f.Key)) {
			continue
		}
		out = append(out, FillTarget{Key: f.Key, Prompt: fmt.Sprintf("%s｜%s", f.Key, f.fillHint())})
	}
	return out
}

// AIFillable 判断一个评价项能否由 AI 依据材料判断：背景信息、老师录入的客观事实
// （出勤、成绩、进球数这类数字）都只能由老师填。
func (f Field) AIFillable() bool {
	return !f.Context && !f.Manual && f.Type != Number && f.Type != Position
}

func (f Field) fillHint() string {
	switch f.Type {
	case Stars:
		levels := f.Levels
		if len(levels) == 0 {
			levels = starLevels
		}
		return fmt.Sprintf("%s，1~5 星：%s", f.Label, starScale(levels))
	case Choice:
		return fmt.Sprintf("%s，从这些里选一个：%s", f.Label, strings.Join(f.Options, " / "))
	default:
		hint := fmt.Sprintf("%s，一句话（%d 字以内）", f.Label, FillTextMaxRunes)
		if f.Placeholder != "" {
			hint += "，如：" + f.Placeholder
		}
		return hint
	}
}

func starScale(levels []string) string {
	parts := make([]string, 0, len(levels))
	for i, level := range levels {
		parts = append(parts, fmt.Sprintf("%d=%s", i+1, level))
	}
	return strings.Join(parts, "，")
}

// recordedLines 把老师已填的内容写成提示词里的几行。
func recordedLines(k *Kind, sheet SheetInfo, position string, values map[string]any) []string {
	var lines []string
	for _, f := range k.Fields {
		if f.Type == Position {
			for _, item := range PositionItemsFor(position) {
				if n, ok := asInt(values[PositionPrefix+item.Key]); ok {
					lines = append(lines, fmt.Sprintf("- %s·%s：%d 星（%s）", f.Label, item.Label, n, StarLevel(n)))
				}
			}
			continue
		}
		v, ok := values[f.Key]
		if !ok || f.Context {
			continue
		}
		text := f.Describe(v)
		if f.Key == "score" && sheet.Options.Drill != nil {
			n, _ := asInt(v)
			text = fmt.Sprintf("%d %s（%s）", n, sheet.Options.Drill.Unit, TierFor(*sheet.Options.Drill, n))
		}
		lines = append(lines, fmt.Sprintf("- %s：%s", f.Label, text))
	}
	return lines
}

func writeHistory(b *strings.Builder, notes []HistoryNote) {
	if len(notes) == 0 {
		return
	}
	b.WriteString("\n以往的评价记录（老师填的，供参考）：\n")
	for _, n := range notes {
		fmt.Fprintf(b, "- %s %s·%s：%s\n", n.Date, n.Label, n.Title, strings.Join(n.Lines, "；"))
	}
}

// FillTextMaxRunes 是 AI 填写文字项的长度上限：表格里一句话就够，太长反而不好读。
const FillTextMaxRunes = 30

// FillResult 是模型返回的一行评价。
type FillResult struct {
	Values  map[string]any `json:"values"`
	Comment string         `json:"comment"`
}

// ParseFill 从模型回复中取出 JSON 对象。模型偶尔会加代码围栏或前后夹带说明文字。
func ParseFill(raw string) (FillResult, error) {
	var out FillResult
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start == -1 || end <= start {
		return out, fmt.Errorf("AI 没有按格式返回评价")
	}
	if err := json.Unmarshal([]byte(raw[start:end+1]), &out); err != nil {
		return out, fmt.Errorf("AI 返回的评价格式不正确")
	}
	return out, nil
}

// CoerceFill 清洗模型填的评价值：只保留允许 AI 填的字段，星级夹到 1~5，
// 文字裁到长度上限，选项类必须命中选项，其余的直接丢掉——
// 一个字段没填对不该让整行作废，老师看到空着自己补就行。
// skipFilled 为 true 时不覆盖老师已经填过的字段。
func (k *Kind) CoerceFill(position string, current, raw map[string]any, skipFilled bool) map[string]any {
	out := map[string]any{}
	allowed := make(map[string]bool)
	for _, t := range FillTargets(k, position, current, skipFilled) {
		allowed[t.Key] = true
	}
	for _, f := range k.Fields {
		if f.Type == Position {
			for _, item := range PositionItemsFor(position) {
				key := PositionPrefix + item.Key
				if !allowed[key] {
					continue
				}
				if n, ok := fillInt(raw[key]); ok {
					out[key] = clamp(n, 1, 5)
				}
			}
			continue
		}
		if !allowed[f.Key] {
			continue
		}
		v, ok := raw[f.Key]
		if !ok || v == nil {
			continue
		}
		switch f.Type {
		case Stars:
			if n, ok := fillInt(v); ok {
				low := 1
				if f.AllowZero {
					low = 0
				}
				out[f.Key] = clamp(n, low, 5)
			}
		case Choice:
			if s, ok := v.(string); ok {
				if s = strings.TrimSpace(s); contains(f.Options, s) {
					out[f.Key] = s
				}
			}
		case Text:
			if s, ok := v.(string); ok {
				if s = strings.TrimSpace(strings.Trim(strings.TrimSpace(s), "\"“”「」")); s != "" {
					out[f.Key] = clipRunes(s, FillTextMaxRunes)
				}
			}
		}
	}
	return out
}

// fillInt 接受模型可能返回的 4、4.0 或 "4 星" 这几种写法。
func fillInt(v any) (int, bool) {
	if n, ok := asInt(v); ok {
		return n, true
	}
	s, ok := v.(string)
	if !ok {
		return 0, false
	}
	digits := strings.TrimSpace(s)
	for i, r := range digits {
		if r < '0' || r > '9' {
			digits = digits[:i]
			break
		}
	}
	n, err := strconv.Atoi(digits)
	if err != nil {
		return 0, false
	}
	return n, true
}

func clamp(n, low, high int) int {
	if n < low {
		return low
	}
	if n > high {
		return high
	}
	return n
}

func has(values map[string]any, key string) bool {
	v, ok := values[key]
	if !ok || v == nil {
		return false
	}
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s) != ""
	}
	return true
}

// HistoryLines 把一行历史评价写成简短的中文描述，最多取 maxItems 项。
func HistoryLines(k *Kind, position string, values map[string]any, maxItems int) []string {
	lines := recordedLines(k, SheetInfo{}, position, values)
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		s := strings.TrimPrefix(line, "- ")
		if utf8.RuneCountInString(s) > 40 {
			s = clipRunes(s, 40)
		}
		out = append(out, s)
		if len(out) >= maxItems {
			break
		}
	}
	return out
}
