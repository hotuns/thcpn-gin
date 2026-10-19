package carbon

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"thcpn-gin/internal/apperr"
	platform "thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/db/sqlc"
	"time"

	"github.com/google/uuid"
)

type CarbonDeviceConfig struct {
	ID        int64
	Data      json.RawMessage
	Image     json.RawMessage
	Control   json.RawMessage
	Misc      json.RawMessage
	CreatedAt *time.Time
	UpdatedAt *time.Time
}

func (s *Service) updateCarbonDeviceConfig(ctx context.Context, input platform.UpdateDeviceConfigInput, ref sqlc.GetNumericDeviceSourceRefByDeviceRow) (platform.UpdateDeviceConfigResult, error) {
	if input.ExpectedConfigID <= 0 {
		return platform.UpdateDeviceConfigResult{}, apperr.New(apperr.KindInvalidArgument, "expected_config_id is required")
	}
	dataJSON, err := platform.NormalizeConfigArrayJSON(input.DataJSON, "data_json")
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	imageJSON, err := platform.NormalizeConfigArrayJSON(input.ImageJSON, "image_json")
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	controlJSON, err := platform.NormalizeConfigObjectJSON(input.ControlJSON, "control_json")
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	db, err := s.openCarbonConfigDB(ctx, ref.DataSourceID)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, apperr.Wrap(apperr.KindDataSource, "begin carbon config transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	previous, err := readLatestCarbonDeviceConfigForUpdate(ctx, tx, ref.ExternalDeviceID)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	if previous.ID != input.ExpectedConfigID {
		return platform.UpdateDeviceConfigResult{}, apperr.New(apperr.KindConflict, "device config has changed; reload and try again")
	}
	return s.WriteConfig(ctx, ref.DataSourceID, input, func() (platform.DeviceConfig, platform.ConfigAudit, error) {
		inserted, err := insertCarbonDeviceConfig(ctx, tx, ref.ExternalDeviceID, previous.Misc, dataJSON, imageJSON, controlJSON)
		if err != nil {
			return platform.DeviceConfig{}, platform.ConfigAudit{}, err
		}
		if err := tx.Commit(); err != nil {
			return platform.DeviceConfig{}, platform.ConfigAudit{}, &platform.UnknownSourceWrite{Err: err}
		}
		committed = true
		audit := platform.SummarizeConfigChange(previous.ID, previous.Data, previous.Image, previous.Control, dataJSON, imageJSON, controlJSON)
		return carbonConfigForResponse(ref.ExternalDeviceID, inserted), audit, nil
	}, func(config platform.DeviceConfig) (platform.UpdateDeviceConfigResult, error) {
		snapshot, err := s.Queries.UpsertDeviceConfigSnapshot(ctx, sqlc.UpsertDeviceConfigSnapshotParams{DeviceID: input.DeviceID, DataSourceID: ref.DataSourceID, AdapterCode: platform.AdapterCarbonSink, ExternalDeviceID: ref.ExternalDeviceID, ExternalConfigID: config.ID, DataJson: config.DataJSON, ImageJson: config.ImageJSON, ControlJson: config.ControlJSON, SourceCreatedAt: platform.TimestamptzFromPtr(config.CreatedAt), SourceUpdatedAt: platform.TimestamptzFromPtr(config.UpdatedAt)})
		if err != nil {
			return platform.UpdateDeviceConfigResult{}, platform.MapWriteError(err, "upsert carbon device config snapshot")
		}
		return platform.UpdateDeviceConfigResult{ConfigSnapshot: platform.DeviceConfigSnapshotFromSQL(snapshot)}, nil
	})
}

func insertCarbonDeviceConfig(ctx context.Context, tx *sql.Tx, deviceID int64, misc, data, image, control json.RawMessage) (CarbonDeviceConfig, error) {
	result, err := tx.ExecContext(ctx, `INSERT INTO device_configs (device_id, data, image, control, misc, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, deviceID, data, image, control, nullableCarbonConfigJSON(misc))
	if err != nil {
		return CarbonDeviceConfig{}, apperr.Wrap(apperr.KindDataSource, "insert carbon device config", err)
	}
	configID, err := result.LastInsertId()
	if err != nil {
		return CarbonDeviceConfig{}, apperr.Wrap(apperr.KindDataSource, "read carbon config id", err)
	}
	return readCarbonDeviceConfigByID(ctx, tx, configID)
}
func carbonConfigForResponse(deviceID int64, config CarbonDeviceConfig) platform.DeviceConfig {
	return platform.DeviceConfig{ID: config.ID, DeviceID: deviceID, DataJSON: config.Data, ImageJSON: config.Image, ControlJSON: config.Control, CreatedAt: config.CreatedAt, UpdatedAt: config.UpdatedAt}
}
func (s *Service) getCarbonSamplingProfile(ctx context.Context, deviceID uuid.UUID, ref sqlc.GetNumericDeviceSourceRefByDeviceRow) (platform.SamplingProfileResponse, error) {
	db, err := s.openCarbonConfigDB(ctx, ref.DataSourceID)
	if err != nil {
		return platform.SamplingProfileResponse{}, err
	}
	config, err := readLatestCarbonDeviceConfig(ctx, db, ref.ExternalDeviceID)
	if err != nil {
		return platform.SamplingProfileResponse{}, err
	}
	return CarbonSamplingProfileFromConfig(deviceID, config), nil
}
func (s *Service) updateCarbonSamplingProfile(ctx context.Context, input platform.SamplingProfileUpdateInput, ref sqlc.GetNumericDeviceSourceRefByDeviceRow) (platform.SamplingProfileResponse, error) {
	schedule, err := carbonSamplingScheduleForInput(input)
	if err != nil {
		return platform.SamplingProfileResponse{}, err
	}
	detail, err := s.GetDeviceConfig(ctx, input.DeviceID)
	if err != nil {
		return platform.SamplingProfileResponse{}, err
	}
	control, err := MergeCarbonSamplingSchedule(detail.LatestConfig.ControlJSON, schedule)
	if err != nil {
		return platform.SamplingProfileResponse{}, err
	}
	updated, err := s.UpdateDeviceConfig(ctx, platform.UpdateDeviceConfigInput{DeviceID: input.DeviceID, ExpectedConfigID: input.ExpectedConfigID, ActorUserID: input.ActorUserID, DataJSON: detail.LatestConfig.DataJSON, ImageJSON: detail.LatestConfig.ImageJSON, ControlJSON: control})
	if err != nil {
		return platform.SamplingProfileResponse{}, err
	}
	native := CarbonDeviceConfig{ID: updated.Config.ID, Data: updated.Config.DataJSON, Image: updated.Config.ImageJSON, Control: updated.Config.ControlJSON, CreatedAt: updated.Config.CreatedAt, UpdatedAt: updated.Config.UpdatedAt}
	response := CarbonSamplingProfileFromConfig(input.DeviceID, native)
	response.WriteState = updated.WriteState
	response.Warnings = updated.Warnings
	return response, nil
}

func (s *Service) openCarbonConfigDB(ctx context.Context, dataSourceID uuid.UUID) (*sql.DB, error) {
	source, err := s.loadCarbonSyncDataSource(ctx, dataSourceID)
	if err != nil {
		return nil, err
	}
	return s.Runtime.OpenMySQLDatabase(ctx, platform.DataSourceFromSQL(source), carbonDatabaseName)
}
func readLatestCarbonDeviceConfig(ctx context.Context, db *sql.DB, deviceID int64) (CarbonDeviceConfig, error) {
	return scanCarbonDeviceConfig(db.QueryRowContext(ctx, `SELECT id, data, image, control, misc, created_at, updated_at FROM device_configs WHERE device_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`, deviceID))
}
func readLatestCarbonDeviceConfigForUpdate(ctx context.Context, tx *sql.Tx, deviceID int64) (CarbonDeviceConfig, error) {
	return scanCarbonDeviceConfig(tx.QueryRowContext(ctx, `SELECT id, data, image, control, misc, created_at, updated_at FROM device_configs WHERE device_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`, deviceID))
}
func readCarbonDeviceConfigByID(ctx context.Context, tx *sql.Tx, configID int64) (CarbonDeviceConfig, error) {
	return scanCarbonDeviceConfig(tx.QueryRowContext(ctx, `SELECT id, data, image, control, misc, created_at, updated_at FROM device_configs WHERE id = ?`, configID))
}

type carbonConfigScanner interface{ Scan(...any) error }

func scanCarbonDeviceConfig(row carbonConfigScanner) (CarbonDeviceConfig, error) {
	var config CarbonDeviceConfig
	var data, image, control, misc []byte
	var createdAt, updatedAt sql.NullTime
	if err := row.Scan(&config.ID, &data, &image, &control, &misc, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return config, apperr.New(apperr.KindNotFound, "carbon device config not found")
		}
		return config, apperr.Wrap(apperr.KindDataSource, "read carbon device config", err)
	}
	config.Data, config.Image, config.Control, config.Misc = data, image, control, misc
	if createdAt.Valid {
		config.CreatedAt = &createdAt.Time
	}
	if updatedAt.Valid {
		config.UpdatedAt = &updatedAt.Time
	}
	return config, nil
}
func nullableCarbonConfigJSON(value json.RawMessage) any {
	if len(value) == 0 || string(value) == "null" {
		return nil
	}
	return value
}
func carbonSamplingScheduleForInput(input platform.SamplingProfileUpdateInput) (platform.SamplingSchedule, error) {
	if preset, ok := platform.SamplingPresets[input.Mode]; ok {
		return preset, nil
	}
	if input.Mode != platform.SamplingProfileCustom {
		return platform.SamplingSchedule{}, apperr.New(apperr.KindInvalidArgument, "invalid sampling profile mode")
	}
	dataMinutes, err := platform.NormalizeScheduleValues(input.DataMinutes, 0, 59, "data_minutes")
	if err != nil {
		return platform.SamplingSchedule{}, err
	}
	dataHours, err := platform.NormalizeScheduleValues(input.DataHours, 0, 23, "data_hours")
	if err != nil {
		return platform.SamplingSchedule{}, err
	}
	uploadMinutes, err := platform.NormalizeScheduleValues(input.UploadMinutes, 0, 59, "upload_minutes")
	if err != nil {
		return platform.SamplingSchedule{}, err
	}
	uploadHours, err := platform.NormalizeScheduleValues(input.UploadHours, 0, 23, "upload_hours")
	if err != nil {
		return platform.SamplingSchedule{}, err
	}
	return platform.NewDetailedSamplingSchedule(platform.SamplingProfileCustom, dataMinutes, dataHours, uploadMinutes, uploadHours, 0, nil, 0, nil), nil
}
func MergeCarbonSamplingSchedule(raw json.RawMessage, schedule platform.SamplingSchedule) (json.RawMessage, error) {
	control := make(map[string]any)
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &control); err != nil {
			return nil, apperr.New(apperr.KindDataSource, "invalid carbon control config")
		}
	}
	control["data_capture_invl"] = schedule.DataCron
	control["data_upload_invl"] = schedule.UploadCron
	encoded, err := json.Marshal(control)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "encode carbon sampling profile", err)
	}
	return encoded, nil
}
func CarbonSamplingProfileFromConfig(deviceID uuid.UUID, config CarbonDeviceConfig) platform.SamplingProfileResponse {
	response := platform.SamplingProfileResponse{DeviceID: deviceID, Mode: platform.SamplingProfileCustom, Advanced: true, DataMinutes: []int{}, DataHours: []int{}, UploadMinutes: []int{}, UploadHours: []int{}, ImageHours: []int{}, ImageUploadHours: []int{}, ExternalConfigID: config.ID, UpdatedAt: config.UpdatedAt}
	var control map[string]any
	if json.Unmarshal(config.Control, &control) != nil {
		response.Summary = "当前为管理员高级自定义计划"
		return response
	}
	dataCapture, dataOK := control["data_capture_invl"].(string)
	dataUpload, uploadOK := control["data_upload_invl"].(string)
	dataMinutes, dataHours, captureValid := platform.ParseTwoFieldSchedule(dataCapture)
	uploadMinutes, uploadHours, uploadValid := platform.ParseTwoFieldSchedule(dataUpload)
	if !dataOK || !uploadOK || !captureValid || !uploadValid {
		response.Summary = "当前为管理员高级自定义计划"
		return response
	}
	dataHours = platform.ExpandWildcardHours(dataHours)
	uploadHours = platform.ExpandWildcardHours(uploadHours)
	schedule := platform.NewDetailedSamplingSchedule(platform.SamplingProfileCustom, dataMinutes, dataHours, uploadMinutes, uploadHours, 0, nil, 0, nil)
	for mode, preset := range platform.SamplingPresets {
		if schedule.DataCron == preset.DataCron && schedule.UploadCron == preset.UploadCron {
			schedule.Mode = mode
			break
		}
	}
	response.Mode, response.Advanced = schedule.Mode, false
	response.DataMinutes, response.DataHours = schedule.DataMinutes, schedule.DataHours
	response.UploadMinutes, response.UploadHours = schedule.UploadMinutes, schedule.UploadHours
	response.DataCron, response.UploadCron = schedule.DataCron, schedule.UploadCron
	response.Summary = "数据采集 " + strings.TrimSpace(schedule.DataCron) + "；数据上传 " + strings.TrimSpace(schedule.UploadCron)
	return response
}
