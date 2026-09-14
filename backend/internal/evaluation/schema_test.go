package evaluation

import (
	"strings"
	"testing"
)

func mustKind(t *testing.T, key string) *Kind {
	t.Helper()
	k, ok := KindByKey(key)
	if !ok {
		t.Fatalf("kind %q not found", key)
	}
	return k
}

func TestNormalizeKeepsOnlyCurrentPositionItems(t *testing.T) {
	k := mustKind(t, "routine")
	got, err := k.Normalize(map[string]any{
		"position":     "前锋",
		"pos_shooting": 4.0,
		"pos_passing":  5.0, // 中场的项目，前锋不该有
		"attendance":   "出勤",
		"attitude":     5.0,
		"unknown":      1.0,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got["pos_shooting"] != 4 || got["pos_passing"] != nil || got["unknown"] != nil {
		t.Fatalf("unexpected values: %v", got)
	}
	if !k.Recorded(got) {
		t.Fatal("should be recorded")
	}
	if k.Recorded(map[string]any{"position": "前锋"}) {
		t.Fatal("position alone is only context")
	}
}

func TestNormalizeRejectsBadValues(t *testing.T) {
	k := mustKind(t, "routine")
	for _, raw := range []map[string]any{
		{"attendance": "旷课"},
		{"attitude": 6.0},
		{"position": "前锋", "pos_shooting": 4.5},
	} {
		if _, err := k.Normalize(raw); err == nil {
			t.Errorf("expected error for %v", raw)
		}
	}
}

func TestTierFor(t *testing.T) {
	juggling, _ := DrillByKey("juggling")
	dribble, _ := DrillByKey("cone_dribble")
	cases := []struct {
		drill Drill
		score int
		want  string
	}{
		{juggling, 3, "未达标"}, {juggling, 5, "基础层"}, {juggling, 12, "提高层"}, {juggling, 25, "挑战层"},
		{dribble, 25, "未达标"}, {dribble, 18, "基础层"}, {dribble, 15, "提高层"}, {dribble, 11, "挑战层"},
	}
	for _, c := range cases {
		if got := TierFor(c.drill, c.score); got != c.want {
			t.Errorf("TierFor(%s, %d) = %s, want %s", c.drill.Key, c.score, got, c.want)
		}
	}
}

func TestNormalizeOptions(t *testing.T) {
	layered := mustKind(t, "layered")
	o, err := layered.NormalizeOptions(Options{}, "2026-09-13")
	if err != nil || o.Drill == nil || o.Drill.Key != "juggling" {
		t.Fatalf("default drill: %+v, %v", o, err)
	}
	if _, err := layered.NormalizeOptions(Options{Drill: &Drill{Key: "juggling", Thresholds: [3]int{10, 5, 20}}}, "2026-09-13"); err == nil {
		t.Fatal("thresholds out of order should fail")
	}
	if _, err := layered.NormalizeOptions(Options{Drill: &Drill{Key: CustomDrillKey, Unit: "次"}}, "2026-09-13"); err == nil {
		t.Fatal("custom drill without a name should fail")
	}
	custom, err := layered.NormalizeOptions(Options{Drill: &Drill{Key: CustomDrillKey, Label: "头顶球", Unit: "次", Thresholds: [3]int{3, 6, 10}}}, "2026-09-13")
	if err != nil || custom.Drill.Measure == "" {
		t.Fatalf("custom drill: %+v, %v", custom, err)
	}

	final := mustKind(t, "final")
	o, err = final.NormalizeOptions(Options{}, "2026-12-20")
	if err != nil || o.PeriodStart != "2026-09-01" || o.Drill != nil {
		t.Fatalf("final defaults: %+v, %v", o, err)
	}
	if _, err := final.NormalizeOptions(Options{PeriodStart: "2027-01-01"}, "2026-12-20"); err == nil {
		t.Fatal("start after lesson date should fail")
	}

	match := mustKind(t, "match")
	o, _ = match.NormalizeOptions(Options{}, "2026-09-13")
	if o.RecordMethod != "比赛录像" {
		t.Fatalf("match record method default: %q", o.RecordMethod)
	}
}

func TestTermStart(t *testing.T) {
	for date, want := range map[string]string{
		"2026-09-13": "2026-09-01",
		"2026-12-31": "2026-09-01",
		"2027-01-10": "2026-09-01",
		"2027-03-01": "2027-02-01",
		"2027-07-05": "2027-02-01",
	} {
		if got := TermStart(date); got != want {
			t.Errorf("TermStart(%s) = %s, want %s", date, got, want)
		}
	}
}

func TestCommentPromptUsesPositionLabelsAndVideoComparison(t *testing.T) {
	k := mustKind(t, "final")
	prompt := CommentPrompt(k, SheetInfo{ClassName: "3年级2班", Title: "学期总评", Date: "2027-01-10", Options: Options{PeriodStart: "2026-09-01"}},
		"张三", "后卫", map[string]any{"position": "后卫", "pos_defense": 4, "growth": 4},
		VideoContext{
			First:  &VideoNote{ID: 1, Date: "2026-09-10", TrainingType: "运球", Level: "一般"},
			Latest: &VideoNote{ID: 2, Date: "2027-01-05", TrainingType: "运球", Level: "良好"},
		})
	for _, want := range []string{"位置专项技术·防守抢断：4 星", "期初视频", "期末视频", "以“张三同学”开头", "统计区间：2026-09-01 至 2027-01-10"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt missing %q:\n%s", want, prompt)
		}
	}
}
