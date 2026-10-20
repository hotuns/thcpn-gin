package export

import (
	"encoding/json"
	"testing"

	"thcpn-gin/internal/apperr"
)

func TestBatchExportContentSelection(t *testing.T) {
	for _, test := range []struct {
		name, flags         string
		data, images, valid bool
	}{
		{"images only", `,"include_data":false,"include_images":true`, false, true, true},
		{"data only", `,"include_data":true,"include_images":false`, true, false, true},
		{"both", `,"include_data":true,"include_images":true`, true, true, true},
		{"neither", `,"include_data":false,"include_images":false`, false, false, false},
		{"partial empty", `,"include_data":false`, false, false, false},
		{"legacy unspecified", "", true, true, true},
		{"bad type", `,"include_data":"yes"`, false, false, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw := json.RawMessage(`{"device_ids":["test"],"start_time":"2026-10-19T00:00:00Z","end_time":"2026-10-20T00:00:00Z"` + test.flags + `}`)
			cfg, err := parseBatchExportConfig(raw)
			if test.valid {
				if err != nil || cfg.IncludeData != test.data || cfg.IncludeImages != test.images {
					t.Fatalf("cfg=%+v err=%v", cfg, err)
				}
			} else if apperr.KindOf(err) != apperr.KindInvalidArgument {
				t.Fatalf("expected invalid selection, got %v", err)
			}
		})
	}
}
