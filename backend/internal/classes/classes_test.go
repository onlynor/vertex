package classes

import (
	"sort"
	"testing"
)

func TestNormalize(t *testing.T) {
	cases := map[string]string{
		"二年级一班":    "2年级1班",
		"2年级一班":    "2年级1班",
		"二年级1班":    "2年级1班",
		"2年级1班":    "2年级1班",
		"三年级（2）班":  "3年级2班",
		"3年级(02)班": "3年级2班",
		" 三年级 二班 ": "3年级2班",
		"六年级十班":    "6年级10班",
		"六年级十二班":   "6年级12班",
		"五年级二十一班":  "5年级21班",
		"２年级３班":    "2年级3班",
		"大班":       "大班",
		"小班":       "小班",
		"中(2)班":    "中(2)班",
		"初一3班":     "初一3班",
		"十三年级一班":   "十三年级一班",
		"":         "",
		"足球  校队":   "足球 校队",
	}
	for in, want := range cases {
		if got := Normalize(in); got != want {
			t.Errorf("Normalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLess(t *testing.T) {
	names := []string{"", "3年级2班", "足球校队", "大班", "10年级1班", "3年级10班", "小班", "3年级1班", "1年级2班"}
	sort.Slice(names, func(i, j int) bool { return Less(names[i], names[j]) })
	want := []string{"小班", "大班", "1年级2班", "3年级1班", "3年级2班", "3年级10班", "10年级1班", "足球校队", ""}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("sorted = %q, want %q", names, want)
		}
	}
}
