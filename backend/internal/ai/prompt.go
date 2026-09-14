package ai

import (
	"fmt"

	"football-backend/internal/evaluation"
)

const systemPrompt = `你是一名青少年足球训练助理教练，负责观看学生的足球训练视频并给出定性反馈。

训练内容由你自己从画面判断，可能是颠球、传接球、运球绕桩、射门、变向、体能训练等任何足球训练项目，也可能是几种混合。请先判断画面里在练什么，再针对该项目给出反馈，不要假设一定是某一种训练。

严格遵守：
1. 只输出一个 JSON 对象，不要输出任何 JSON 之外的文字、Markdown 代码块标记或解释。
2. JSON 必须且只能包含以下字段：
   - training_type(string)：你判断出的训练项目名称，用简短中文词组，例如「颠球训练」「运球绕桩」「传接球」「射门练习」；判断不出来时填「综合训练」
   - summary(string)：一到两句话概括本次训练整体观感
   - performance(string)：描述观察到的动作特点（触球部位、身体协调性、重心稳定性、节奏感等，按该项目的关注点来写）
   - level(string)：整体水平的定性档位，只能是「优秀」「良好」「一般」「待提升」四者之一
   - rating(int)：与 level 对应的星级，优秀=5，良好=4，一般=3，待提升=2
   - highlights(array of string)：本次训练中做得好的地方，每项一句话
   - issues(array of string)：观察到的具体问题，每项一句话，没有明显问题可以是空数组
   - suggestions(array of string)：可执行的改进建议，每项一句话
3. 不要编造精确的次数、百分制评分或专业运动学角度数据——你无法通过采样画面精确测量这些指标。level 与 rating 只是四档定性判断，不是精确评分。涉及数量或节奏时只能用模糊定性方式描述。
4. 如果画面中根本没有出现足球训练内容，请在 training_type 填「无法识别」并在 summary 中如实说明，不要编造分析结果。
5. 全部使用简体中文输出。`

func SystemPrompt() string {
	return systemPrompt
}

// UserPrompt 告诉模型视频的真实时长和一共采样了多少帧。
// 如果不提供这些事实，模型会自行猜测时长（测试中一段 18 秒的视频曾被描述成
// “约半分钟”），并把采样帧之间的时间间隔误当成学生表现中的停顿。
// position 是学生的场上位置，设置了就请模型重点看该位置的专项动作。
func UserPrompt(durationSec float64, frameCount int, position string) string {
	interval := 0.0
	if frameCount > 1 && durationSec > 0 {
		interval = durationSec / float64(frameCount-1)
	}
	prompt := basePrompt(durationSec, frameCount, interval)
	if focus := evaluation.PositionFocus(position); focus != "" {
		prompt += fmt.Sprintf("\n\n这名学生的场上位置是%s。判断出训练项目后，请特别留意与%s相关的专项动作：%s。画面里能看到的，优先写进 performance、highlights 和 issues；看不到的不要编造。",
			position, position, focus)
	}
	return prompt
}

func basePrompt(durationSec float64, frameCount int, interval float64) string {
	return fmt.Sprintf(`以下是一段学生足球训练视频的采样画面。

事实信息（请以此为准，不要自行推测）：
- 视频总时长：%.0f 秒
- 采样帧数：%d 帧，按时间先后顺序排列，相邻两帧间隔约 %.1f 秒

注意：这些是间隔采样的静态画面，不是连续视频。相邻两帧之间球或人的位置变化属于正常采样间隔，不能据此判断学生失误或中断；某一帧里没拍到球也可能只是采样时机问题。请先判断画面里在进行什么训练，再基于确实能看到的身体姿态、触球部位和动作细节来分析，并按上述要求输出 JSON。`,
		durationSec, frameCount, interval)
}
