package datasource

import (
	"encoding/json"
	"testing"
	"thcpn-gin/internal/apperr"
	platform "thcpn-gin/internal/datasource/platform"
	carbon "thcpn-gin/internal/datasource/sources/carbon"

	"github.com/google/uuid"
)

func TestSamplingProfilePresets(t *testing.T) {
	tests := []struct {
		mode      string
		dataCron  string
		imageCron string
	}{
		{platform.SamplingProfileStandard, "0,30 *", "10 8,10,14,16"},
		{platform.SamplingProfileLowPower, "0 *", "10 10,14"},
		{platform.SamplingProfileHighFrequency, "0,20,40 *", "10 8,10,12,14,16,18"},
	}
	for _, tt := range tests {
		t.Run(tt.mode, func(t *testing.T) {
			schedule, err := platform.SamplingScheduleForInput(platform.SamplingProfileUpdateInput{Mode: tt.mode})
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
	schedule, err := platform.SamplingScheduleForInput(platform.SamplingProfileUpdateInput{
		Mode: platform.SamplingProfileCustom, DataMinutes: []int{40, 0, 20, 20}, DataHours: []int{0, 1},
		UploadMinutes: []int{30}, UploadHours: []int{0, 1}, ImageMinute: &minute, ImageHours: []int{18, 8, 8},
		ImageUploadMinute: &minute, ImageUploadHours: []int{19, 9, 9},
	})
	if err != nil {
		t.Fatalf("build custom schedule: %v", err)
	}
	if schedule.DataCron != "0,20,40 0,1" || schedule.ImageCron != "12 8,18" || schedule.ImageUploadCron != "12 9,19" {
		t.Fatalf("unexpected normalized schedule: %#v", schedule)
	}
	if _, err := platform.SamplingScheduleForInput(platform.SamplingProfileUpdateInput{Mode: platform.SamplingProfileCustom, ImageMinute: &minute}); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected empty values to fail, got %v", err)
	}
}
func TestMergeSamplingSchedulePreservesUnrelatedConfig(t *testing.T) {
	raw := json.RawMessage(`{"misc_invl":"0 18","relay":true,"data_capture_invl":"old"}`)
	merged, err := platform.MergeSamplingSchedule(raw, platform.SamplingPresets[platform.SamplingProfileStandard])
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
func TestMergeCarbonSamplingSchedulePreservesCarbonSpecificConfig(t *testing.T) {
	raw := json.RawMessage(`{"misc_invl":"55 0,1,8,12,16","image_capture_invl":"","image_upload_invl":"","data_capture_invl":"old"}`)
	merged, err := carbon.MergeCarbonSamplingSchedule(raw, platform.SamplingPresets[platform.SamplingProfileStandard])
	if err != nil {
		t.Fatalf("merge carbon schedule: %v", err)
	}
	var control map[string]any
	if err := json.Unmarshal(merged, &control); err != nil {
		t.Fatalf("decode merged config: %v", err)
	}
	if control["misc_invl"] != "55 0,1,8,12,16" || control["image_capture_invl"] != "" || control["image_upload_invl"] != "" {
		t.Fatalf("carbon-specific config was not preserved: %#v", control)
	}
	if control["data_capture_invl"] != "0,30 *" || control["data_upload_invl"] != "0,30 *" {
		t.Fatalf("unexpected carbon data schedule: %#v", control)
	}
	if _, exists := control["img_capture_invl"]; exists {
		t.Fatalf("standard station key leaked into carbon config: %#v", control)
	}
}
func TestCarbonSamplingProfileReadsDataSchedulesOnly(t *testing.T) {
	profile := carbon.CarbonSamplingProfileFromConfig(uuid.New(), carbon.CarbonDeviceConfig{ID: 107, Control: json.RawMessage(`{
		"misc_invl":"55 0,1,8,12,16","data_capture_invl":"0 0,6,12,18","data_upload_invl":"0 0,6,12,18",
		"image_capture_invl":"","image_upload_invl":""
	}`)})
	if profile.Advanced || profile.ExternalConfigID != 107 {
		t.Fatalf("unexpected carbon profile: %#v", profile)
	}
	if got, want := profile.DataHours, []int{0, 6, 12, 18}; !equalInts(got, want) {
		t.Fatalf("unexpected carbon capture hours: got %v want %v", got, want)
	}
	if len(profile.ImageHours) != 0 || len(profile.ImageUploadHours) != 0 {
		t.Fatalf("carbon profile must not use standard image schedules: %#v", profile)
	}
}
func equalInts(left, right []int) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
func TestSamplingProfileDetectsPresetAndAdvancedConfig(t *testing.T) {
	deviceID := uuid.New()
	standard := platform.SamplingProfileFromConfig(deviceID, platform.DeviceConfig{ID: 9, ControlJSON: json.RawMessage(`{
		"data_capture_invl":"0,30 *","data_upload_invl":"0,30 *",
		"img_capture_invl":"10 8,10,14,16","img_upload_invl":"10 8,10,14,16"
	}`)})
	if standard.Mode != platform.SamplingProfileStandard || standard.Advanced || standard.ExternalConfigID != 9 {
		t.Fatalf("unexpected detected profile: %#v", standard)
	}
	advanced := platform.SamplingProfileFromConfig(deviceID, platform.DeviceConfig{ID: 10, ControlJSON: json.RawMessage(`{
		"data_capture_invl":"*/5 *","data_upload_invl":"*/5 *",
		"img_capture_invl":"10 8","img_upload_invl":"10 8"
	}`)})
	if !advanced.Advanced || advanced.Mode != platform.SamplingProfileCustom {
		t.Fatalf("expected advanced profile, got %#v", advanced)
	}
}
