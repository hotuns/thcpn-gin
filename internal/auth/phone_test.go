package auth

import (
	"testing"

	"thcpn-gin/internal/apperr"
)

func TestNormalizePhone(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "plain", input: "13800000000", want: "13800000000"},
		{name: "with spaces and hyphens", input: " 138-0000 0000 ", want: "13800000000"},
		{name: "international", input: "+86 138-0000-0000", want: "+8613800000000"},
		{name: "empty", input: "", wantErr: true},
		{name: "invalid character", input: "1380000abc", wantErr: true},
		{name: "too short", input: "12345", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizePhone(tt.input)
			if tt.wantErr {
				if apperr.KindOf(err) != apperr.KindInvalidArgument {
					t.Fatalf("expected invalid argument, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalize phone: %v", err)
			}
			if got != tt.want {
				t.Fatalf("expected %q, got %q", tt.want, got)
			}
		})
	}
}
