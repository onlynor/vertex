package ai

import (
	"strings"
	"testing"
)

func TestUserPromptPositionFocus(t *testing.T) {
	withPosition := UserPrompt(20, 12, "门将")
	for _, want := range []string{"场上位置是门将", "扑救", "手控球", "出击"} {
		if !strings.Contains(withPosition, want) {
			t.Errorf("prompt with position missing %q", want)
		}
	}
	if strings.Contains(UserPrompt(20, 12, ""), "场上位置") {
		t.Error("prompt without position should not mention a position")
	}
}
