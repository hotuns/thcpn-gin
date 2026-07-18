package datasource

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

const (
	SamplingProfileStandard      = "standard"
	SamplingProfileLowPower      = "low_power"
	SamplingProfileHighFrequency = "high_frequency"
	SamplingProfileCustom        = "custom"
)

type SamplingProfileUpdateInput struct {
	DeviceID         uuid.UUID
	Mode             string
	DataMinutes      []int
	ImageMinute      *int
	ImageHours       []int
	ExpectedConfigID int64
	ActorUserID      uuid.UUID
}

type SamplingProfileResponse struct {
	DeviceID         uuid.UUID  `json:"device_id"`
	Mode             string     `json:"mode"`
	Advanced         bool       `json:"advanced"`
	DataMinutes      []int      `json:"data_minutes"`
	ImageMinute      *int       `json:"image_minute,omitempty"`
	ImageHours       []int      `json:"image_hours"`
	DataCron         string     `json:"data_cron"`
	ImageCron        string     `json:"image_cron"`
	Summary          string     `json:"summary"`
	ExternalConfigID int64      `json:"external_config_id"`
	UpdatedAt        *time.Time `json:"updated_at,omitempty"`
	DispatchedAt     *time.Time `json:"dispatched_at,omitempty"`
	CanEdit          bool       `json:"can_edit"`
}

type samplingSchedule struct {
	Mode        string
	DataMinutes []int
	ImageMinute int
	ImageHours  []int
	DataCron    string
	ImageCron   string
}

var samplingPresets = map[string]samplingSchedule{
	SamplingProfileStandard:      newSamplingSchedule(SamplingProfileStandard, []int{0, 30}, 10, []int{8, 10, 14, 16}),
	SamplingProfileLowPower:      newSamplingSchedule(SamplingProfileLowPower, []int{0}, 10, []int{10, 14}),
	SamplingProfileHighFrequency: newSamplingSchedule(SamplingProfileHighFrequency, []int{0, 20, 40}, 10, []int{8, 10, 12, 14, 16, 18}),
}

func (s *Service) GetSamplingProfile(ctx context.Context, deviceID uuid.UUID) (SamplingProfileResponse, error) {
	detail, err := s.GetTHCPNDeviceConfig(ctx, deviceID)
	if err != nil {
		return SamplingProfileResponse{}, err
	}
	return samplingProfileFromConfig(deviceID, detail.LatestConfig), nil
}

func (s *Service) UpdateSamplingProfile(ctx context.Context, input SamplingProfileUpdateInput) (SamplingProfileResponse, error) {
	if input.ExpectedConfigID <= 0 {
		return SamplingProfileResponse{}, apperr.New(apperr.KindInvalidArgument, "expected_config_id is required")
	}
	detail, err := s.GetTHCPNDeviceConfig(ctx, input.DeviceID)
	if err != nil {
		return SamplingProfileResponse{}, err
	}
	if detail.LatestConfig.ID != input.ExpectedConfigID {
		return SamplingProfileResponse{}, apperr.New(apperr.KindConflict, "device config has changed; reload and try again")
	}
	schedule, err := samplingScheduleForInput(input)
	if err != nil {
		return SamplingProfileResponse{}, err
	}
	control, err := mergeSamplingSchedule(detail.LatestConfig.ControlJSON, schedule)
	if err != nil {
		return SamplingProfileResponse{}, err
	}
	updated, err := s.UpdateTHCPNDeviceConfig(ctx, UpdateTHCPNDeviceConfigInput{
		DeviceID: input.DeviceID, DataJSON: detail.LatestConfig.DataJSON, ImageJSON: detail.LatestConfig.ImageJSON,
		ControlJSON: control, ActorUserID: input.ActorUserID, ExpectedConfigID: input.ExpectedConfigID,
	})
	if err != nil {
		return SamplingProfileResponse{}, err
	}
	response := samplingProfileFromConfig(input.DeviceID, updated.Config)
	now := time.Now().UTC()
	response.DispatchedAt = &now
	return response, nil
}

func samplingScheduleForInput(input SamplingProfileUpdateInput) (samplingSchedule, error) {
	if preset, ok := samplingPresets[input.Mode]; ok {
		return preset, nil
	}
	if input.Mode != SamplingProfileCustom {
		return samplingSchedule{}, apperr.New(apperr.KindInvalidArgument, "invalid sampling profile mode")
	}
	if input.ImageMinute == nil {
		return samplingSchedule{}, apperr.New(apperr.KindInvalidArgument, "image_minute is required for custom mode")
	}
	dataMinutes, err := normalizeScheduleValues(input.DataMinutes, 0, 59, "data_minutes")
	if err != nil {
		return samplingSchedule{}, err
	}
	imageHours, err := normalizeScheduleValues(input.ImageHours, 0, 23, "image_hours")
	if err != nil {
		return samplingSchedule{}, err
	}
	if *input.ImageMinute < 0 || *input.ImageMinute > 59 {
		return samplingSchedule{}, apperr.New(apperr.KindInvalidArgument, "image_minute must be between 0 and 59")
	}
	return newSamplingSchedule(SamplingProfileCustom, dataMinutes, *input.ImageMinute, imageHours), nil
}

func newSamplingSchedule(mode string, dataMinutes []int, imageMinute int, imageHours []int) samplingSchedule {
	return samplingSchedule{Mode: mode, DataMinutes: append([]int(nil), dataMinutes...), ImageMinute: imageMinute,
		ImageHours: append([]int(nil), imageHours...), DataCron: joinInts(dataMinutes) + " *",
		ImageCron: strconv.Itoa(imageMinute) + " " + joinInts(imageHours)}
}

func mergeSamplingSchedule(raw json.RawMessage, schedule samplingSchedule) (json.RawMessage, error) {
	control := make(map[string]any)
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &control); err != nil {
			return nil, apperr.New(apperr.KindDataSource, "invalid thcpn control_json")
		}
	}
	control["data_capture_invl"] = schedule.DataCron
	control["data_upload_invl"] = schedule.DataCron
	control["img_capture_invl"] = schedule.ImageCron
	control["img_upload_invl"] = schedule.ImageCron
	encoded, err := json.Marshal(control)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "encode sampling profile", err)
	}
	return encoded, nil
}

func samplingProfileFromConfig(deviceID uuid.UUID, config THCPNDeviceConfig) SamplingProfileResponse {
	response := SamplingProfileResponse{DeviceID: deviceID, Mode: SamplingProfileCustom, Advanced: true,
		DataMinutes: []int{}, ImageHours: []int{}, ExternalConfigID: config.ID, UpdatedAt: config.UpdatedAt}
	var control map[string]any
	if json.Unmarshal(config.ControlJSON, &control) != nil {
		response.Summary = "当前为管理员高级自定义计划"
		return response
	}
	dataCapture, dataOK := control["data_capture_invl"].(string)
	dataUpload, dataUploadOK := control["data_upload_invl"].(string)
	imageCapture, imageOK := control["img_capture_invl"].(string)
	imageUpload, imageUploadOK := control["img_upload_invl"].(string)
	if !dataOK || !dataUploadOK || !imageOK || !imageUploadOK || dataCapture != dataUpload || imageCapture != imageUpload {
		response.Summary = "当前为管理员高级自定义计划"
		return response
	}
	dataMinutes, dataHours, ok := parseTwoFieldSchedule(dataCapture)
	if !ok || len(dataHours) != 1 || dataHours[0] != -1 {
		response.Summary = "当前为管理员高级自定义计划"
		return response
	}
	imageMinutes, imageHours, ok := parseTwoFieldSchedule(imageCapture)
	if !ok || len(imageMinutes) != 1 || len(imageHours) == 1 && imageHours[0] == -1 {
		response.Summary = "当前为管理员高级自定义计划"
		return response
	}
	schedule := newSamplingSchedule(SamplingProfileCustom, dataMinutes, imageMinutes[0], imageHours)
	for mode, preset := range samplingPresets {
		if schedule.DataCron == preset.DataCron && schedule.ImageCron == preset.ImageCron {
			schedule.Mode = mode
			break
		}
	}
	minute := schedule.ImageMinute
	response.Mode, response.Advanced = schedule.Mode, false
	response.DataMinutes, response.ImageMinute, response.ImageHours = schedule.DataMinutes, &minute, schedule.ImageHours
	response.DataCron, response.ImageCron = schedule.DataCron, schedule.ImageCron
	response.Summary = samplingScheduleSummary(schedule)
	return response
}

func parseTwoFieldSchedule(value string) ([]int, []int, bool) {
	parts := strings.Fields(value)
	if len(parts) != 2 {
		return nil, nil, false
	}
	minutes, ok := parseSchedulePart(parts[0], 0, 59, false)
	if !ok {
		return nil, nil, false
	}
	hours, ok := parseSchedulePart(parts[1], 0, 23, true)
	return minutes, hours, ok
}

func parseSchedulePart(value string, min int, max int, allowWildcard bool) ([]int, bool) {
	if value == "*" && allowWildcard {
		return []int{-1}, true
	}
	parts := strings.Split(value, ",")
	values := make([]int, 0, len(parts))
	for _, part := range parts {
		parsed, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || parsed < min || parsed > max {
			return nil, false
		}
		values = append(values, parsed)
	}
	normalized, err := normalizeScheduleValues(values, min, max, "schedule")
	return normalized, err == nil
}

func normalizeScheduleValues(values []int, min int, max int, field string) ([]int, error) {
	if len(values) == 0 {
		return nil, apperr.New(apperr.KindInvalidArgument, field+" must contain at least one value")
	}
	seen := make(map[int]struct{}, len(values))
	for _, value := range values {
		if value < min || value > max {
			return nil, apperr.New(apperr.KindInvalidArgument, fmt.Sprintf("%s values must be between %d and %d", field, min, max))
		}
		seen[value] = struct{}{}
	}
	result := make([]int, 0, len(seen))
	for value := range seen {
		result = append(result, value)
	}
	sort.Ints(result)
	return result, nil
}

func samplingScheduleSummary(schedule samplingSchedule) string {
	data := make([]string, 0, len(schedule.DataMinutes))
	for _, minute := range schedule.DataMinutes {
		data = append(data, fmt.Sprintf("%02d", minute))
	}
	images := make([]string, 0, len(schedule.ImageHours))
	for _, hour := range schedule.ImageHours {
		images = append(images, fmt.Sprintf("%02d:%02d", hour, schedule.ImageMinute))
	}
	return fmt.Sprintf("每小时 %s 分采集数据；每天 %s 采集图片", strings.Join(data, "、"), strings.Join(images, "、"))
}

func joinInts(values []int) string {
	parts := make([]string, len(values))
	for index, value := range values {
		parts[index] = strconv.Itoa(value)
	}
	return strings.Join(parts, ",")
}
