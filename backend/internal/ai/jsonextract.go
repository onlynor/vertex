package ai

import (
	"encoding/json"
	"fmt"
	"strings"

	"football-backend/internal/model"
)

var levelToRating = map[string]int{
	"优秀":  5,
	"良好":  4,
	"一般":  3,
	"待提升": 2,
}

// extractReport 从模型返回的原始文本中提取报告。模型被要求只返回纯 JSON，
// 但实际返回时仍可能用 markdown 代码围栏包裹，或在前后夹带多余文字
func extractReport(raw string) (*model.AnalysisReport, error) {
	text := strings.TrimSpace(raw)
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(text, "```")
	text = strings.TrimSpace(text)

	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start == -1 || end == -1 || end < start {
		return nil, fmt.Errorf("模型返回内容中未找到JSON对象")
	}

	var report model.AnalysisReport
	if err := json.Unmarshal([]byte(text[start:end+1]), &report); err != nil {
		return nil, fmt.Errorf("解析模型返回JSON失败: %w", err)
	}

	if report.TrainingType == "" {
		report.TrainingType = "综合训练"
	}
	if report.Highlights == nil {
		report.Highlights = []string{}
	}
	if report.Issues == nil {
		report.Issues = []string{}
	}
	if report.Suggestions == nil {
		report.Suggestions = []string{}
	}
	// 即使模型只填写了 level 与 rating 中的一项，也把两者保持为一致的对应关系，
	// 这样界面上的星级显示永远不会与文字档位相矛盾。
	if r, ok := levelToRating[report.Level]; ok {
		report.Rating = r
	} else if report.Rating >= 2 && report.Rating <= 5 {
		for level, rating := range levelToRating {
			if rating == report.Rating {
				report.Level = level
			}
		}
	} else {
		report.Level = "一般"
		report.Rating = 3
	}

	return &report, nil
}
