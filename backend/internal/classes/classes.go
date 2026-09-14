// Package classes 统一班级名称的写法，并给班级排序。
package classes

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var gradeClass = regexp.MustCompile(`^([0-9一二两三四五六七八九十〇零]+)年级\(?([0-9一二两三四五六七八九十〇零]+)\)?班$`)

var chineseDigits = map[rune]int{
	'零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
	'五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
}

// Normalize 把「二年级一班」「2年级(1)班」「三年级 二班」统一写成「2年级1班」「3年级2班」，
// 同一个班不会因为写法不同被分成两个班。幼儿园的小班、中班、大班以及认不出的写法
// （如「初一3班」）保持原样，只整理多余的空格。
func Normalize(raw string) string {
	s := toHalfWidth(strings.TrimSpace(raw))
	compact := strings.Join(strings.Fields(s), "")
	if m := gradeClass.FindStringSubmatch(compact); m != nil {
		grade, okGrade := parseNumber(m[1])
		class, okClass := parseNumber(m[2])
		if okGrade && okClass && grade >= 1 && grade <= 12 && class >= 1 && class <= 99 {
			return fmt.Sprintf("%d年级%d班", grade, class)
		}
	}
	return strings.Join(strings.Fields(s), " ")
}

// toHalfWidth 把全角数字、括号和空格转成半角，老师从文档里复制名单时经常带着全角字符。
func toHalfWidth(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r >= '０' && r <= '９':
			return r - '０' + '0'
		case r == '（':
			return '('
		case r == '）':
			return ')'
		case r == '　':
			return ' '
		}
		return r
	}, s)
}

// parseNumber 识别阿拉伯数字和 1~99 的中文数字（一、十、十二、二十三）。
func parseNumber(s string) (int, bool) {
	if n, err := strconv.Atoi(s); err == nil {
		return n, true
	}
	runes := []rune(s)
	if len(runes) == 0 {
		return 0, false
	}
	for i, r := range runes {
		if r != '十' {
			continue
		}
		tens, ones := 1, 0
		switch i {
		case 0:
		case 1:
			d, ok := chineseDigits[runes[0]]
			if !ok {
				return 0, false
			}
			tens = d
		default:
			return 0, false
		}
		switch len(runes) - i - 1 {
		case 0:
		case 1:
			d, ok := chineseDigits[runes[i+1]]
			if !ok {
				return 0, false
			}
			ones = d
		default:
			return 0, false
		}
		return tens*10 + ones, true
	}
	n := 0
	for _, r := range runes {
		d, ok := chineseDigits[r]
		if !ok {
			return 0, false
		}
		n = n*10 + d
	}
	return n, true
}

var normalizedName = regexp.MustCompile(`^(\d+)年级(\d+)班$`)

// kindergarten 是幼儿园班级的先后顺序：托班、小班、中班、大班。
var kindergarten = []rune{'托', '小', '中', '大'}

type sortKey struct {
	group, major, minor int
	name                string
}

func keyOf(name string) sortKey {
	if strings.TrimSpace(name) == "" {
		return sortKey{group: 3}
	}
	if m := normalizedName.FindStringSubmatch(name); m != nil {
		grade, _ := strconv.Atoi(m[1])
		class, _ := strconv.Atoi(m[2])
		return sortKey{group: 1, major: grade, minor: class, name: name}
	}
	if strings.Contains(name, "班") {
		first := []rune(name)[0]
		for i, r := range kindergarten {
			if first == r {
				return sortKey{group: 0, major: i, name: name}
			}
		}
	}
	return sortKey{group: 2, name: name}
}

// Less 给班级排序：幼儿园在前，然后按年级、班号从小到大，其余按名称，未分班放最后。
func Less(a, b string) bool {
	ka, kb := keyOf(a), keyOf(b)
	if ka.group != kb.group {
		return ka.group < kb.group
	}
	if ka.major != kb.major {
		return ka.major < kb.major
	}
	if ka.minor != kb.minor {
		return ka.minor < kb.minor
	}
	return ka.name < kb.name
}
