package nodeprofile

import (
	"strings"
	"testing"
)

func TestNormalize(t *testing.T) {
	for _, tc := range []struct {
		raw, want string
		valid     bool
	}{
		{"  林下观测  ", "林下观测", true}, {"  ", "", true}, {strings.Repeat("树", 50), strings.Repeat("树", 50), true},
		{strings.Repeat("树", 51), "", false}, {"a\nb", "", false}, {"a\tb", "", false}, {"\x00", "", false}, {"a\u2028b", "", false},
	} {
		got, err := Normalize(tc.raw)
		if (err == nil) != tc.valid || (err == nil && got != tc.want) {
			t.Errorf("Normalize(%q)=%q,%v", tc.raw, got, err)
		}
	}
	if Label("", 3) != "节点 3" || Label("林下", 3) != "林下 · 节点 3" {
		t.Fatal("incorrect node display")
	}
}
