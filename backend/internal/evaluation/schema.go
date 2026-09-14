// Package evaluation 定义「智能评价」模块的五种评价表：常规评价、分层评价、期中评价、
// 期末评价、赛事评价。前四种之外的「位置专项」按学生的场上位置嵌入常规、期中、期末、赛事四种表。
//
// 字段定义只写在这里一处：前端通过 GET /api/evaluations/schema 取得后渲染表格，
// 后端用同一份定义校验老师提交的数据、拼装给大模型的评语提示词。
package evaluation

import (
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"
)

// FieldType 决定一个评价项用什么控件录入、以什么方式统计。
type FieldType string

const (
	Stars  FieldType = "stars"  // 1~5 星，每档有自己的含义
	Number FieldType = "number" // 非负整数，如进球数、测评成绩
	Text   FieldType = "text"   // 简短文字，如本次亮点
	Choice FieldType = "choice" // 固定选项，如出勤情况、学期等级
	// Position 是位置专项：按这一行的场上位置显示对应的几项星级，值存为 pos_<能力键>。
	Position FieldType = "position"
)

// Field 是评价表中的一列。
type Field struct {
	Key   string    `json:"key"`
	Label string    `json:"label"`
	Type  FieldType `json:"type"`
	// Levels 是星级 1~5 各档的含义，下标 0 对应 1 星。
	Levels []string `json:"levels,omitempty"`
	// AllowZero 表示星级可以记为 0，含义是「未参与」（旧版分层任务表用）。
	AllowZero bool     `json:"allow_zero,omitempty"`
	Options   []string `json:"options,omitempty"`
	Max       int      `json:"max,omitempty"`
	Unit      string   `json:"unit,omitempty"`
	// Context 表示这一列只是背景信息（如场上位置），填了也不算作「已评价」。
	Context bool `json:"context,omitempty"`
	// Manual 表示这一列只能由老师录入：出勤、成绩、进球这类客观事实，AI 一键评价不会去填。
	Manual      bool   `json:"manual,omitempty"`
	Placeholder string `json:"placeholder,omitempty"`
}

// PositionItem 是位置专项中的一项。键名与「球员能力」的能力键一致，
// 老师的打分可以直接对应到学生的能力维度。
type PositionItem struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	// Look 是观察要点：提示老师看什么，也告诉视频分析重点看哪些动作。
	Look string `json:"look"`
}

// Positions 是四个场上位置。
var Positions = []string{"前锋", "中场", "后卫", "门将"}

// PositionPrefix 是位置专项评分在评价值里的键名前缀。
const PositionPrefix = "pos_"

// PositionItems 是各位置的专项观察项，适合小学生训练。
var PositionItems = map[string][]PositionItem{
	"前锋": {
		{Key: "shooting", Label: "射门", Look: "支撑脚站位、脚背触球部位、射门力量和方向"},
		{Key: "dribbling", Label: "运球突破", Look: "变向时机、护球动作、突破后的加速"},
		{Key: "attack", Label: "进攻跑位", Look: "无球跑动、接应和前插的时机"},
	},
	"中场": {
		{Key: "passing", Label: "传球", Look: "脚内侧触球、传球力量和准确度"},
		{Key: "control", Label: "控球", Look: "停球是否稳、转身和护球"},
		{Key: "teamwork", Label: "配合意识", Look: "抬头观察、呼应队友、传跑配合"},
	},
	"后卫": {
		{Key: "defense", Label: "防守抢断", Look: "防守站位、上抢时机、脚下动作"},
		{Key: "speed", Label: "回追速度", Look: "丢球后的反应和回追积极性"},
		{Key: "teamwork", Label: "补位配合", Look: "补位意识、与队友保持合适距离"},
	},
	"门将": {
		{Key: "saving", Label: "扑救", Look: "准备姿势、移动步伐、倒地扑救"},
		{Key: "handling", Label: "手控球", Look: "接球手型、抱球是否稳"},
		{Key: "rushing", Label: "出击", Look: "出击时机和判断"},
	},
}

// PositionItemsFor 返回某个位置的专项项目；位置为空或不认识时返回空。
func PositionItemsFor(position string) []PositionItem {
	return PositionItems[position]
}

// PositionFocus 把某个位置的观察要点写成一句话，供视频分析和评语提示词使用。
func PositionFocus(position string) string {
	items := PositionItemsFor(position)
	parts := make([]string, 0, len(items))
	for _, item := range items {
		parts = append(parts, fmt.Sprintf("%s（%s）", item.Label, item.Look))
	}
	return strings.Join(parts, "、")
}

// Drill 是分层评价的练习项目：怎么测、单位、三个层级的达标线。
type Drill struct {
	Key     string `json:"key"`
	Label   string `json:"label"`
	Measure string `json:"measure"`
	Unit    string `json:"unit"`
	// LowerIsBetter 为 true 时成绩越少越好（如运球绕桩用时）。
	LowerIsBetter bool `json:"lower_is_better"`
	// Thresholds 依次是基础层、提高层、挑战层的达标线。
	Thresholds [3]int `json:"thresholds"`
	Method     string `json:"method,omitempty"`
}

// CustomDrillKey 表示老师自己定义的练习项目。
const CustomDrillKey = "custom"

// Drills 是适合小学生的专项练习，达标线是默认值，老师建表时可以按本班情况修改。
var Drills = []Drill{
	{Key: "juggling", Label: "颠球", Measure: "连续颠球次数", Unit: "次", Thresholds: [3]int{5, 10, 20},
		Method: "脚背颠球，球落地为止，测两次取较好的一次"},
	{Key: "inside_pass", Label: "脚内侧传球", Measure: "10 次传球中传进目标区的次数", Unit: "次", Thresholds: [3]int{4, 6, 8},
		Method: "距离 8~10 米，两个标志桶之间为目标区"},
	{Key: "inside_trap", Label: "脚内侧停球", Measure: "10 次接球中停稳的次数", Unit: "次", Thresholds: [3]int{4, 6, 8},
		Method: "同伴从 6~8 米外传地滚球，停球后球在一步以内算停稳"},
	{Key: "cone_dribble", Label: "运球绕桩", Measure: "绕完全程的用时", Unit: "秒", LowerIsBetter: true, Thresholds: [3]int{20, 16, 12},
		Method: "6 根标志桶间距 1.5 米，往返一次，漏桩一次加 1 秒"},
	{Key: "instep_shot", Label: "脚背正面射门", Measure: "10 次射门中射进球门的次数", Unit: "次", Thresholds: [3]int{3, 5, 7},
		Method: "罚球点附近射门，不设守门员"},
	{Key: "sole_roll", Label: "脚底拉球", Measure: "30 秒内左右脚交替拉球次数", Unit: "次", Thresholds: [3]int{15, 25, 35},
		Method: "原地左右脚交替踩拉，球不离脚"},
}

// Tiers 是分层评价的四个结果，下标即达到的层数。
var Tiers = []string{"未达标", "基础层", "提高层", "挑战层"}

// DrillByKey 按键名查找内置练习项目。
func DrillByKey(key string) (Drill, bool) {
	for _, d := range Drills {
		if d.Key == key {
			return d, true
		}
	}
	return Drill{}, false
}

// TierFor 按达标线判断成绩达到的层级。
func TierFor(d Drill, score int) string {
	reached := 0
	for i, line := range d.Thresholds {
		ok := score >= line
		if d.LowerIsBetter {
			ok = score <= line
		}
		if ok {
			reached = i + 1
		}
	}
	return Tiers[reached]
}

// Kind 是一种评价表。
type Kind struct {
	Key              string  `json:"key"`
	Label            string  `json:"label"`
	Description      string  `json:"description"`
	TitleLabel       string  `json:"title_label"`
	TitlePlaceholder string  `json:"title_placeholder"`
	DateLabel        string  `json:"date_label"`
	Fields           []Field `json:"fields"`
	// UsesPosition：每行带场上位置和位置专项。
	UsesPosition bool `json:"uses_position"`
	// UsesDrill：分层评价，表头选练习项目和达标线。
	UsesDrill bool `json:"uses_drill"`
	// UsesPeriod：期中、期末，表头填统计区间的开始日期。
	UsesPeriod bool `json:"uses_period"`
	// CompareVideos：期末，对比统计区间内第一段和最后一段视频。
	CompareVideos bool `json:"compare_videos"`
	// SameDayVideo：赛事，只看比赛当天的视频（比赛录像）。
	SameDayVideo bool `json:"same_day_video"`
	// RecordMethods：表头可选的记录方式。
	RecordMethods []string `json:"record_methods,omitempty"`
	// Legacy：升级前的旧版评价表类型，只用来打开已有的表，不能再新建。
	Legacy bool `json:"legacy,omitempty"`
	// Guidance、CommentLength 只用于评语提示词。
	Guidance      string `json:"-"`
	CommentLength string `json:"-"`
}

// 通用星级含义。
var starLevels = []string{"需加强", "较弱", "中等", "良好", "优秀"}

// StarLevel 返回通用星级 n 的含义。
func StarLevel(n int) string {
	if n >= 1 && n <= len(starLevels) {
		return starLevels[n-1]
	}
	return ""
}

// TextMaxRunes 是文字类评价项的长度上限，表格里的一句话足够用。
const TextMaxRunes = 200

func positionField(label string) Field {
	return Field{Key: "position", Label: label, Type: Choice, Options: Positions, Context: true}
}

func positionGroup(label string) Field {
	return Field{Key: "pos", Label: label, Type: Position, Levels: starLevels}
}

var Kinds = []Kind{
	{
		Key:              "routine",
		Label:            "常规评价",
		Description:      "日常训练用：出勤、训练态度、团队纪律全队通用，再结合位置看专项动作",
		TitleLabel:       "训练内容",
		TitlePlaceholder: "如：脚内侧传接球",
		DateLabel:        "训练日期",
		UsesPosition:     true,
		Guidance:         "这是一次日常训练的评价，以鼓励为主，重点说训练态度、团队纪律和位置专项动作。",
		CommentLength:    "60~100",
		Fields: []Field{
			positionField("场上位置"),
			{Key: "attendance", Label: "出勤情况", Type: Choice, Options: []string{"出勤", "迟到", "早退", "请假", "缺勤"}, Manual: true},
			{Key: "attitude", Label: "训练态度", Type: Stars, Levels: []string{"不够投入", "偶尔走神", "认真", "积极", "非常积极"}},
			{Key: "discipline", Label: "团队纪律", Type: Stars, Levels: []string{"多次提醒", "偶有违纪", "基本遵守", "遵守纪律", "带头遵守"}},
			positionGroup("位置专项"),
			{Key: "highlight", Label: "本次亮点", Type: Text, Placeholder: "如：传球落点准确"},
			{Key: "improve", Label: "需改进", Type: Text, Placeholder: "如：接球时身体僵硬"},
		},
	},
	{
		Key:              "layered",
		Label:            "分层评价",
		Description:      "颠球、脚内侧传球等专项练习，按基础层、提高层、挑战层看每个学生达到哪一层",
		TitleLabel:       "名称",
		TitlePlaceholder: "如：颠球分层测评（第 3 周）",
		DateLabel:        "测评日期",
		UsesDrill:        true,
		Guidance:         "这是专项练习的分层评价，请说明学生达到的层级，并给出冲击下一层级的具体练法。",
		CommentLength:    "60~100",
		Fields: []Field{
			{Key: "score", Label: "成绩", Type: Number, Max: 9999},
			{Key: "tier", Label: "达到层级", Type: Choice, Options: Tiers, Manual: true},
			{Key: "technique", Label: "动作规范", Type: Stars, Levels: []string{"错误较多", "不太规范", "基本规范", "比较规范", "规范标准"}},
			{Key: "advice", Label: "下一步练法", Type: Text, Placeholder: "如：多用左脚颠球"},
		},
	},
	{
		Key:              "midterm",
		Label:            "期中评价",
		Description:      "学期中段：基础专项技术、体能水平、位置配合意识，可以看视频回放，也可以现场记录",
		TitleLabel:       "名称",
		TitlePlaceholder: "如：秋季学期期中评价",
		DateLabel:        "评价日期",
		UsesPosition:     true,
		UsesPeriod:       true,
		RecordMethods:    []string{"视频回看", "现场记录"},
		Guidance:         "这是期中评价，请概括前半学期的表现，并指出后半学期的努力方向。",
		CommentLength:    "80~120",
		Fields: []Field{
			positionField("场上位置"),
			{Key: "basic_skill", Label: "基础专项技术", Type: Stars, Levels: starLevels},
			{Key: "fitness", Label: "体能水平", Type: Stars, Levels: starLevels},
			{Key: "awareness", Label: "位置配合意识", Type: Stars, Levels: starLevels},
			positionGroup("位置专项"),
			{Key: "highlight", Label: "阶段亮点", Type: Text},
			{Key: "improve", Label: "待提高", Type: Text},
		},
	},
	{
		Key:              "final",
		Label:            "期末评价",
		Description:      "学期总评：位置专项技术、战术理解、个人成长进步，可以对比期初和期末的训练视频",
		TitleLabel:       "学期",
		TitlePlaceholder: "如：2026-2027 学年第一学期",
		DateLabel:        "评价日期",
		UsesPosition:     true,
		UsesPeriod:       true,
		CompareVideos:    true,
		Guidance:         "这是期末评价（学期总评），请写出这学期的成长变化；如果给了期初和期末视频的分析，请对比说明动作上的进步。",
		CommentLength:    "100~150",
		Fields: []Field{
			positionField("场上位置"),
			positionGroup("位置专项技术"),
			{Key: "tactics", Label: "战术理解", Type: Stars, Levels: starLevels},
			{Key: "growth", Label: "成长进步", Type: Stars, Levels: []string{"明显退步", "略有退步", "保持稳定", "有所进步", "显著进步"}},
			{Key: "grade", Label: "学期等级", Type: Choice, Options: []string{"优秀", "良好", "合格", "待提高"}},
			{Key: "message", Label: "教师寄语", Type: Text},
		},
	},
	{
		Key:              "match",
		Label:            "赛事评价",
		Description:      "比赛专用：赛场作风、临场发挥、赛场贡献，优先看比赛录像，也可以赛后录入",
		TitleLabel:       "比赛",
		TitlePlaceholder: "如：校园足球联赛 第 2 轮",
		DateLabel:        "比赛日期",
		UsesPosition:     true,
		SameDayVideo:     true,
		RecordMethods:    []string{"比赛录像", "赛后录入"},
		Guidance:         "这是比赛评价，请围绕赛场作风、临场发挥和赛场贡献来写；有比赛录像的分析时优先参考。",
		CommentLength:    "80~120",
		Fields: []Field{
			positionField("本场位置"),
			{Key: "conduct", Label: "赛场作风", Type: Stars, Levels: []string{"消极", "不够积极", "正常", "积极拼抢", "顽强拼搏"}},
			{Key: "performance", Label: "临场发挥", Type: Stars, Levels: starLevels},
			{Key: "contribution", Label: "赛场贡献", Type: Stars, Levels: []string{"较少", "一般", "有贡献", "贡献较大", "起关键作用"}},
			{Key: "goals", Label: "进球", Type: Number, Max: 99, Unit: "个"},
			{Key: "assists", Label: "助攻", Type: Number, Max: 99, Unit: "次"},
			positionGroup("位置专项"),
			{Key: "note", Label: "赛后记录", Type: Text, Placeholder: "如：补位及时，拼抢积极"},
		},
	},
}

// 旧版（升级前）评价表的星级和完成度含义。
var legacyCompletion = []string{"未完成", "较少完成", "部分完成", "大部分完成", "全部完成"}

// LegacyKinds 是升级前的五种评价表。已经建好的表迁移成这些类型后保持原来的字段，
// 老师仍可查看、修改和导出，数据不会丢；新建评价表只能用上面的五种新类型。
var LegacyKinds = []Kind{
	{
		Key: "legacy_skill", Label: "技能评价（旧版）", Legacy: true,
		Description: "升级前建的技能评价表", TitleLabel: "课题", DateLabel: "上课日期",
		Guidance: "这是一节课的技能评价。", CommentLength: "80~120",
		Fields: []Field{
			{Key: "dribbling", Label: "运球", Type: Stars, Levels: starLevels},
			{Key: "passing", Label: "传球", Type: Stars, Levels: starLevels},
			{Key: "shooting", Label: "射门", Type: Stars, Levels: starLevels},
			{Key: "tactics", Label: "战术理解", Type: Stars, Levels: starLevels},
			{Key: "attitude", Label: "课堂态度", Type: Stars, Levels: starLevels},
			{Key: "highlight", Label: "本课亮点", Type: Text},
			{Key: "improve", Label: "需改进", Type: Text},
		},
	},
	{
		Key: "legacy_match", Label: "比赛记录（旧版）", Legacy: true,
		Description: "升级前建的比赛记录表", TitleLabel: "比赛", DateLabel: "比赛日期",
		Guidance: "这是一场教学比赛的记录。", CommentLength: "80~120",
		Fields: []Field{
			{Key: "position", Label: "场上位置", Type: Choice, Options: Positions, Context: true},
			{Key: "touches", Label: "触球次数", Type: Number, Max: 999, Unit: "次"},
			{Key: "passes", Label: "传球成功", Type: Number, Max: 999, Unit: "次"},
			{Key: "turnovers", Label: "失误丢球", Type: Number, Max: 999, Unit: "次"},
			{Key: "shots", Label: "射门次数", Type: Number, Max: 999, Unit: "次"},
			{Key: "goals", Label: "进球", Type: Number, Max: 99, Unit: "个"},
			{Key: "assists", Label: "助攻", Type: Number, Max: 99, Unit: "次"},
			{Key: "running", Label: "跑动情况", Type: Choice, Options: []string{"积极", "较好", "一般", "偏少"}},
			{Key: "note", Label: "备注", Type: Text},
		},
	},
	{
		Key: "legacy_monthly", Label: "月度汇总（旧版）", Legacy: true,
		Description: "升级前建的月度汇总表", TitleLabel: "月份", DateLabel: "汇总日期",
		Guidance: "这是一个月的汇总评价。", CommentLength: "80~120",
		Fields: []Field{
			{Key: "attendance", Label: "出勤天数", Type: Number, Max: 31, Unit: "天"},
			{Key: "progress", Label: "技能进步", Type: Stars, Levels: starLevels},
			{Key: "participation", Label: "课堂参与", Type: Stars, Levels: starLevels},
			{Key: "teamwork", Label: "团队合作", Type: Stars, Levels: starLevels},
			{Key: "match", Label: "比赛表现", Type: Stars, Levels: starLevels},
			{Key: "highlight", Label: "月度亮点", Type: Text},
			{Key: "goal", Label: "下月目标", Type: Text},
		},
	},
	{
		Key: "legacy_layered", Label: "分层任务（旧版）", Legacy: true,
		Description: "升级前建的分层任务表", TitleLabel: "任务", DateLabel: "日期",
		Guidance: "这是分层任务的完成情况。", CommentLength: "80~120",
		Fields: []Field{
			{Key: "basic", Label: "基础层", Type: Stars, Levels: legacyCompletion, AllowZero: true},
			{Key: "advanced", Label: "提高层", Type: Stars, Levels: legacyCompletion, AllowZero: true},
			{Key: "challenge", Label: "挑战层", Type: Stars, Levels: legacyCompletion, AllowZero: true},
			{Key: "rate", Label: "完成率", Type: Number, Max: 100, Unit: "%"},
			{Key: "tier", Label: "所在层级", Type: Choice, Options: []string{"基础层", "提高层", "挑战层"}, Manual: true},
			{Key: "advice", Label: "教师建议", Type: Text},
		},
	},
	{
		Key: "legacy_semester", Label: "学期总评（旧版）", Legacy: true,
		Description: "升级前建的学期总评表", TitleLabel: "学期", DateLabel: "日期",
		Guidance: "这是学期总评。", CommentLength: "100~150",
		Fields: []Field{
			{Key: "attendance", Label: "出勤情况", Type: Stars, Levels: []string{"严重问题", "严重缺勤", "缺勤较多", "偶有缺勤", "全勤"}},
			{Key: "standard", Label: "技能达标", Type: Stars, Levels: []string{"未达标", "部分达标", "基本达标", "大部分达标", "全部达标"}},
			{Key: "participation", Label: "比赛参与", Type: Stars, Levels: []string{"不参与", "很少参与", "偶尔参与", "经常参与", "积极参与"}},
			{Key: "progress", Label: "学期进步", Type: Stars, Levels: []string{"明显退步", "略有退步", "保持稳定", "有所进步", "显著进步"}},
			{Key: "grade", Label: "学期等级", Type: Choice, Options: []string{"优秀", "良好", "合格", "待提高"}},
			{Key: "message", Label: "教师寄语", Type: Text},
			{Key: "homework", Label: "假期作业", Type: Text},
		},
	},
}

// Schema 是下发给前端的完整定义。
func Schema() map[string]any {
	return map[string]any{
		"legacy_kinds":    LegacyKinds,
		"kinds":           Kinds,
		"positions":       Positions,
		"position_items":  PositionItems,
		"position_prefix": PositionPrefix,
		"drills":          Drills,
		"tiers":           Tiers,
	}
}

// KindByKey 按键名查找评价表类型，包括旧版类型。
func KindByKey(key string) (*Kind, bool) {
	for _, list := range [][]Kind{Kinds, LegacyKinds} {
		for i := range list {
			if list[i].Key == key {
				return &list[i], true
			}
		}
	}
	return nil, false
}

func (k *Kind) field(key string) (Field, bool) {
	for _, f := range k.Fields {
		if f.Key == key {
			return f, true
		}
	}
	return Field{}, false
}

// LevelLabel 返回某个星级的含义，0 星为「未参与」。
func (f Field) LevelLabel(n int) string {
	if n == 0 {
		return "未参与"
	}
	if n >= 1 && n <= len(f.Levels) {
		return f.Levels[n-1]
	}
	return ""
}

// Normalize 校验并清洗一名学生在某张表上的评价：丢弃未知字段和空值，数字统一为整数。
// 位置专项只保留当前场上位置对应的几项——换了位置，原来位置的打分就不再适用。
// 数值越界或不在选项内时返回可以直接展示给老师的错误信息。
func (k *Kind) Normalize(raw map[string]any) (map[string]any, error) {
	out := make(map[string]any, len(raw))
	for _, f := range k.Fields {
		v, ok := raw[f.Key]
		if f.Type == Position || !ok || v == nil {
			continue
		}
		switch f.Type {
		case Stars:
			n, ok := asInt(v)
			low := 1
			if f.AllowZero {
				low = 0
			}
			if !ok || n < low || n > 5 {
				return nil, fmt.Errorf("「%s」只能是 %d~5 星", f.Label, low)
			}
			out[f.Key] = n
		case Number:
			n, ok := asInt(v)
			if !ok || n < 0 || (f.Max > 0 && n > f.Max) {
				return nil, fmt.Errorf("「%s」请填写 0~%d 之间的整数", f.Label, f.Max)
			}
			out[f.Key] = n
		case Text:
			s, ok := v.(string)
			if !ok {
				return nil, fmt.Errorf("「%s」格式不正确", f.Label)
			}
			if s = strings.TrimSpace(s); s == "" {
				continue
			}
			if utf8.RuneCountInString(s) > TextMaxRunes {
				return nil, fmt.Errorf("「%s」最多 %d 个字", f.Label, TextMaxRunes)
			}
			out[f.Key] = s
		case Choice:
			s, ok := v.(string)
			if !ok {
				return nil, fmt.Errorf("「%s」格式不正确", f.Label)
			}
			if s = strings.TrimSpace(s); s == "" {
				continue
			}
			if !contains(f.Options, s) {
				return nil, fmt.Errorf("「%s」只能是 %s", f.Label, strings.Join(f.Options, " / "))
			}
			out[f.Key] = s
		}
	}
	if k.UsesPosition {
		position, _ := out["position"].(string)
		for _, item := range PositionItemsFor(position) {
			key := PositionPrefix + item.Key
			v, ok := raw[key]
			if !ok || v == nil {
				continue
			}
			n, ok := asInt(v)
			if !ok || n < 1 || n > 5 {
				return nil, fmt.Errorf("「%s」只能是 1~5 星", item.Label)
			}
			out[key] = n
		}
	}
	return out, nil
}

// Recorded 判断这名学生是否已经有评价内容；只有背景信息（如场上位置）不算。
func (k *Kind) Recorded(values map[string]any) bool {
	for key := range values {
		if f, ok := k.field(key); ok && f.Context {
			continue
		}
		return true
	}
	return false
}

// Describe 把一个评价值写成适合放进提示词的中文，例如「4 星（良好）」「12 次」。
func (f Field) Describe(v any) string {
	switch f.Type {
	case Stars:
		n, _ := asInt(v)
		return fmt.Sprintf("%d 星（%s）", n, f.LevelLabel(n))
	case Number:
		n, _ := asInt(v)
		if f.Unit == "" {
			return fmt.Sprint(n)
		}
		return fmt.Sprintf("%d %s", n, f.Unit)
	default:
		s, _ := v.(string)
		return s
	}
}

// Options 是表头的附加信息，按评价表类型不同而不同。
type Options struct {
	// Drill 是分层评价的练习项目和达标线。
	Drill *Drill `json:"drill,omitempty"`
	// PeriodStart 是期中、期末评价统计区间的开始日期，结束日期就是评价日期。
	PeriodStart string `json:"period_start,omitempty"`
	// RecordMethod 是期中、赛事评价的记录方式。
	RecordMethod string `json:"record_method,omitempty"`
}

// NormalizeOptions 校验表头附加信息并补上缺省值，只保留这种评价表用得到的部分。
func (k *Kind) NormalizeOptions(o Options, lessonDate string) (Options, error) {
	var out Options
	if k.UsesDrill {
		drill, err := normalizeDrill(o.Drill)
		if err != nil {
			return out, err
		}
		out.Drill = &drill
	}
	if k.UsesPeriod {
		start := strings.TrimSpace(o.PeriodStart)
		if start == "" {
			start = TermStart(lessonDate)
		}
		startDay, err := time.ParseInLocation("2006-01-02", start, time.Local)
		if err != nil {
			return out, fmt.Errorf("开始日期格式应为 YYYY-MM-DD")
		}
		if day, err := time.ParseInLocation("2006-01-02", lessonDate, time.Local); err == nil && startDay.After(day) {
			return out, fmt.Errorf("开始日期不能晚于评价日期")
		}
		out.PeriodStart = start
	}
	if len(k.RecordMethods) > 0 {
		method := strings.TrimSpace(o.RecordMethod)
		if method == "" {
			method = k.RecordMethods[0]
		}
		if !contains(k.RecordMethods, method) {
			return out, fmt.Errorf("记录方式只能是 %s", strings.Join(k.RecordMethods, " / "))
		}
		out.RecordMethod = method
	}
	return out, nil
}

func normalizeDrill(in *Drill) (Drill, error) {
	if in == nil {
		return Drills[0], nil
	}
	var d Drill
	if in.Key == CustomDrillKey {
		d = Drill{
			Key:           CustomDrillKey,
			Label:         strings.TrimSpace(in.Label),
			Measure:       strings.TrimSpace(in.Measure),
			Unit:          strings.TrimSpace(in.Unit),
			LowerIsBetter: in.LowerIsBetter,
		}
		if d.Label == "" || utf8.RuneCountInString(d.Label) > 20 {
			return d, fmt.Errorf("请填写练习项目名称（20 字以内）")
		}
		if d.Unit == "" || utf8.RuneCountInString(d.Unit) > 6 {
			return d, fmt.Errorf("请填写成绩单位（如 次、秒、个）")
		}
		if utf8.RuneCountInString(d.Measure) > 40 {
			return d, fmt.Errorf("测评方式最多 40 个字")
		}
		if d.Measure == "" {
			d.Measure = d.Label + "成绩"
		}
	} else {
		base, ok := DrillByKey(in.Key)
		if !ok {
			return d, fmt.Errorf("请选择练习项目")
		}
		d = base
	}
	if in.Thresholds != [3]int{} {
		d.Thresholds = in.Thresholds
	}
	for _, line := range d.Thresholds {
		if line < 0 || line > 9999 {
			return d, fmt.Errorf("达标线请填写 0~9999 之间的整数")
		}
	}
	a, b, c := d.Thresholds[0], d.Thresholds[1], d.Thresholds[2]
	if (!d.LowerIsBetter && !(a <= b && b <= c)) || (d.LowerIsBetter && !(a >= b && b >= c)) {
		if d.LowerIsBetter {
			return d, fmt.Errorf("成绩越少越好时，达标线应该从基础层到挑战层逐层变小")
		}
		return d, fmt.Errorf("达标线应该从基础层到挑战层逐层提高")
	}
	return d, nil
}

// TermStart 推算学期开始日期：8~12 月为秋季学期（9 月 1 日开始），1 月算上一年的秋季学期，
// 2~7 月为春季学期（2 月 1 日开始）。日期无法解析时按今天推算。
func TermStart(date string) string {
	day, err := time.ParseInLocation("2006-01-02", date, time.Local)
	if err != nil {
		day = time.Now()
	}
	y, m := day.Year(), day.Month()
	switch {
	case m >= 8:
		return fmt.Sprintf("%d-09-01", y)
	case m == 1:
		return fmt.Sprintf("%d-09-01", y-1)
	default:
		return fmt.Sprintf("%d-02-01", y)
	}
}

// asInt 接受 JSON 解码出的 float64 或服务端自己写入的 int，只认整数。
func asInt(v any) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case float64:
		if n != math.Trunc(n) || math.IsInf(n, 0) || math.IsNaN(n) {
			return 0, false
		}
		return int(n), true
	default:
		return 0, false
	}
}

func contains(options []string, s string) bool {
	for _, o := range options {
		if o == s {
			return true
		}
	}
	return false
}
