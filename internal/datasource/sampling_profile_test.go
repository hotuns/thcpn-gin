package datasource

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func TestSamplingProfilePresets(t *testing.T) {
	tests := []struct {
		mode      string
		dataCron  string
		imageCron string
	}{
		{SamplingProfileStandard, "0,30 *", "10 8,10,14,16"},
		{SamplingProfileLowPower, "0 *", "10 10,14"},
		{SamplingProfileHighFrequency, "0,20,40 *", "10 8,10,12,14,16,18"},
	}
	for _, tt := range tests {
		t.Run(tt.mode, func(t *testing.T) {
			schedule, err := samplingScheduleForInput(SamplingProfileUpdateInput{Mode: tt.mode})
			if err != nil {
				t.Fatalf("build preset: %v", err)
			}
			if schedule.DataCron != tt.dataCron || schedule.ImageCron != tt.imageCron {
				t.Fatalf("unexpected schedule: %#v", schedule)
			}
		})
	}
}

func TestCustomSamplingProfileNormalizesValues(t *testing.T) {
	minute := 12
	schedule, err := samplingScheduleForInput(SamplingProfileUpdateInput{
		Mode: SamplingProfileCustom, DataMinutes: []int{40, 0, 20, 20}, ImageMinute: &minute, ImageHours: []int{18, 8, 8},
	})
	if err != nil {
		t.Fatalf("build custom schedule: %v", err)
	}
	if schedule.DataCron != "0,20,40 *" || schedule.ImageCron != "12 8,18" {
		t.Fatalf("unexpected normalized schedule: %#v", schedule)
	}
	if _, err := samplingScheduleForInput(SamplingProfileUpdateInput{Mode: SamplingProfileCustom, ImageMinute: &minute}); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected empty values to fail, got %v", err)
	}
}

func TestMergeSamplingSchedulePreservesUnrelatedConfig(t *testing.T) {
	raw := json.RawMessage(`{"misc_invl":"0 18","relay":true,"data_capture_invl":"old"}`)
	merged, err := mergeSamplingSchedule(raw, samplingPresets[SamplingProfileStandard])
	if err != nil {
		t.Fatalf("merge schedule: %v", err)
	}
	var control map[string]any
	if err := json.Unmarshal(merged, &control); err != nil {
		t.Fatalf("decode merged config: %v", err)
	}
	if control["misc_invl"] != "0 18" || control["relay"] != true {
		t.Fatalf("unrelated config was not preserved: %#v", control)
	}
	for _, key := range []string{"data_capture_invl", "data_upload_invl"} {
		if control[key] != "0,30 *" {
			t.Fatalf("unexpected %s: %#v", key, control[key])
		}
	}
	for _, key := range []string{"img_capture_invl", "img_upload_invl"} {
		if control[key] != "10 8,10,14,16" {
			t.Fatalf("unexpected %s: %#v", key, control[key])
		}
	}
}

func TestSamplingProfileDetectsPresetAndAdvancedConfig(t *testing.T) {
	deviceID := uuid.New()
	standard := samplingProfileFromConfig(deviceID, THCPNDeviceConfig{ID: 9, ControlJSON: json.RawMessage(`{
		"data_capture_invl":"0,30 *","data_upload_invl":"0,30 *",
		"img_capture_invl":"10 8,10,14,16","img_upload_invl":"10 8,10,14,16"
	}`)})
	if standard.Mode != SamplingProfileStandard || standard.Advanced || standard.ExternalConfigID != 9 {
		t.Fatalf("unexpected detected profile: %#v", standard)
	}
	advanced := samplingProfileFromConfig(deviceID, THCPNDeviceConfig{ID: 10, ControlJSON: json.RawMessage(`{
		"data_capture_invl":"*/5 *","data_upload_invl":"*/5 *",
		"img_capture_invl":"10 8","img_upload_invl":"10 8"
	}`)})
	if !advanced.Advanced || advanced.Mode != SamplingProfileCustom {
		t.Fatalf("expected advanced profile, got %#v", advanced)
	}
}
