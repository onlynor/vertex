package evaluation

import (
	"strings"
	"testing"
)

func kindOrFail(t *testing.T, key string) *Kind {
	t.Helper()
	k, ok := KindByKey(key)
	if !ok {
		t.Fatalf("找不到评价表类型 %s", key)
	}
	return k
}

func keysOf(targets []FillTarget) []string {
	out := make([]string, 0, len(targets))
	for _, t := range targets {
		out = append(out, t.Key)
	}
	return out
}

func TestFillTargetsSkipsManualAndFilled(t *testing.T) {
	k := kindOrFail(t, "routine")
	got := keysOf(FillTargets(k, "中场", map[string]any{"position": "中场", "attitude": 4}, true))
	want := []string{"discipline", "pos_passing", "pos_control", "pos_teamwork", "highlight", "improve"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("待填字段 = %v，期望 %v", got, want)
	}
	// 全部重填时老师已填的项目也在列表里，出勤情况这类客观事实仍然不交给 AI。
	all := keysOf(FillTargets(k, "中场", map[string]any{"attitude": 4}, false))
	for _, key := range []string{"attendance", "position"} {
		for _, got := range all {
			if got == key {
				t.Fatalf("%s 不应该交给 AI 填写", key)
			}
		}
	}
	if all[0] != "attitude" {
		t.Fatalf("全部重填应包含已填项，得到 %v", all)
	}
}

func TestFillTargetsOnlyCurrentPosition(t *testing.T) {
	k := kindOrFail(t, "final")
	got := keysOf(FillTargets(k, "门将", nil, true))
	for _, key := range got {
		if strings.HasPrefix(key, PositionPrefix) && !strings.Contains("pos_saving pos_handling pos_rushing", key) {
			t.Fatalf("门将不该出现 %s", key)
		}
	}
}

func TestCoerceFillCleansValues(t *testing.T) {
	k := kindOrFail(t, "routine")
	current := map[string]any{"position": "前锋", "attendance": "出勤"}
	raw := map[string]any{
		"attitude":     "4 星",                           // 带单位的字符串
		"discipline":   9.0,                             // 越界，夹到 5
		"pos_shooting": 3,                               //
		"pos_passing":  5,                               // 不属于前锋，丢弃
		"attendance":   "缺勤",                            // 老师填的客观事实，不允许改
		"highlight":    "“射门果断，支撑脚站位稳，力量也比上次足，整体进步很明显”", // 去引号并截断
		"unknown":      "x",
	}
	got := k.CoerceFill("前锋", current, raw, true)
	if got["attitude"] != 4 || got["discipline"] != 5 || got["pos_shooting"] != 3 {
		t.Fatalf("星级清洗结果不对：%v", got)
	}
	if _, ok := got["pos_passing"]; ok {
		t.Fatal("不属于当前位置的专项应被丢弃")
	}
	if _, ok := got["attendance"]; ok {
		t.Fatal("老师录入的客观事实不应被 AI 覆盖")
	}
	if _, ok := got["unknown"]; ok {
		t.Fatal("未知字段应被丢弃")
	}
	highlight, _ := got["highlight"].(string)
	if strings.HasPrefix(highlight, "“") || len([]rune(highlight)) > FillTextMaxRunes+1 {
		t.Fatalf("文字项未清洗：%q", highlight)
	}
	if _, err := k.Normalize(merge(current, got)); err != nil {
		t.Fatalf("清洗后的结果应能通过校验：%v", err)
	}
}

func merge(a, b map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		out[k] = v
	}
	return out
}

func TestParseFill(t *testing.T) {
	out, err := ParseFill("```json\n{\"values\":{\"attitude\":4},\"comment\":\"张三同学，很棒\"}\n```")
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if out.Comment != "张三同学，很棒" || out.Values["attitude"] != 4.0 {
		t.Fatalf("解析结果不对：%+v", out)
	}
	if _, err := ParseFill("我无法完成"); err == nil {
		t.Fatal("没有 JSON 时应当报错")
	}
}

func TestFillPromptMentionsMaterials(t *testing.T) {
	k := kindOrFail(t, "routine")
	info := SheetInfo{ClassName: "3年级1班", Title: "脚内侧传接球", Date: "2026-09-14"}
	prompt := FillPrompt(k, info, "张三", "中场", map[string]any{"position": "中场", "attendance": "出勤"},
		VideoContext{Latest: &VideoNote{Date: "2026-09-13", TrainingType: "传接球", Level: "良好",
			Highlights: []string{"传球力量合适"}, Issues: []string{"停球偏大"}}, Label: "最近一次训练视频"},
		[]HistoryNote{{Date: "2026-09-07", Label: "常规评价", Title: "带球绕桩", Lines: []string{"训练态度：4 星（积极）"}}})
	for _, want := range []string{"出勤情况：出勤", "传球力量合适", "2026-09-07", "pos_passing", "张三同学"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("提示词缺少 %q：\n%s", want, prompt)
		}
	}
	if strings.Contains(prompt, "attendance｜") {
		t.Fatal("出勤情况不应出现在待填字段里")
	}
}
