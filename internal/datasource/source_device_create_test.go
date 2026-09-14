package datasource

import (
	"testing"

	"thcpn-gin/internal/apperr"
)

func TestCreatedSourceDeviceSN(t *testing.T) {
	tests := []struct {
		prefix string
		id     int64
		want   string
	}{
		{"thcreate.v1.", 1, "6e28225aac1dd9e273bc286cf84ef027"},
		{"thcreate.v1.", 3177, "3b173b88fedf0d057ffecd10e9faeec6"},
		{"thcreate.v3.", 1, "8a19e4a328fb93ed729f2229bd27cea4"},
		{"thcreate.v3.", 27, "59e4cd355551f173fc5fb2be5118571a"},
	}
	for _, tt := range tests {
		if got := createdSourceDeviceSN(tt.prefix, tt.id); got != tt.want {
			t.Errorf("createdSourceDeviceSN(%q, %d) = %q, want %q", tt.prefix, tt.id, got, tt.want)
		}
	}
}

func TestSourceFamilyForCreatedDeviceKind(t *testing.T) {
	tests := []struct {
		kind string
		want string
	}{
		{kind: createdSourceDeviceTHCPNStandard, want: sourceFamilyTHCPN},
		{kind: createdSourceDeviceTHCPNGateway, want: sourceFamilyTHCPN},
		{kind: createdSourceDeviceTHCPNNode, want: sourceFamilyTHCPN},
		{kind: createdSourceDeviceCarbon, want: sourceFamilyCarbon},
	}
	for _, tt := range tests {
		got, err := sourceFamilyForCreatedDeviceKind(tt.kind)
		if err != nil || got != tt.want {
			t.Fatalf("sourceFamilyForCreatedDeviceKind(%q) = %q, %v; want %q", tt.kind, got, err, tt.want)
		}
	}
	if _, err := sourceFamilyForCreatedDeviceKind("camera"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid kind error, got %v", err)
	}
}

func TestNormalizeCarbonNodesCount(t *testing.T) {
	got, err := normalizeCarbonNodesCount(nil)
	if err != nil || got != 16 {
		t.Fatalf("default nodes count = %d, %v", got, err)
	}
	valid := int64(24)
	got, err = normalizeCarbonNodesCount(&valid)
	if err != nil || got != valid {
		t.Fatalf("valid nodes count = %d, %v", got, err)
	}
	for _, value := range []int64{0, -1} {
		if _, err := normalizeCarbonNodesCount(&value); apperr.KindOf(err) != apperr.KindInvalidArgument {
			t.Fatalf("expected invalid nodes count %d, got %v", value, err)
		}
	}
}
