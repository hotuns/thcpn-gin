package datasource

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
)

type carbonDeviceConfig struct {
	ID        int64
	Data      json.RawMessage
	Image     json.RawMessage
	Control   json.RawMessage
	Misc      json.RawMessage
	CreatedAt *time.Time
	UpdatedAt *time.Time
}

func (s *Service) GetDeviceConfig(ctx context.Context, deviceID uuid.UUID) (THCPNDeviceConfigDetailResponse, error) {
	if s.db == nil {
		return THCPNDeviceConfigDetailResponse{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	ref, err := s.queries.GetDeviceSourceRefByDevice(ctx, deviceID)
	if err != nil {
		return THCPNDeviceConfigDetailResponse{}, mapNotFoundOrInternal(err, "device source ref not found")
	}
	if ref.AdapterCode != AdapterCarbonSink {
		return s.GetTHCPNDeviceConfig(ctx, deviceID)
	}
	db, err := s.openCarbonConfigDB(ctx, ref.DataSourceID)
	if err != nil {
		return THCPNDeviceConfigDetailResponse{}, err
	}
	defer db.Close()
	config, err := readLatestCarbonDeviceConfig(ctx, db, ref.ExternalDeviceID)
	if err != nil {
		return THCPNDeviceConfigDetailResponse{}, err
	}
	return THCPNDeviceConfigDetailResponse{DeviceID: deviceID, DataSourceID: ref.DataSourceID, ExternalDeviceID: ref.ExternalDeviceID, LatestConfig: carbonConfigForResponse(ref.ExternalDeviceID, config)}, nil
}

func (s *Service) UpdateDeviceConfig(ctx context.Context, input UpdateTHCPNDeviceConfigInput) (UpdateTHCPNDeviceConfigResponse, error) {
	if s.db == nil {
		return UpdateTHCPNDeviceConfigResponse{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	ref, err := s.queries.GetDeviceSourceRefByDevice(ctx, input.DeviceID)
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, mapNotFoundOrInternal(err, "device source ref not found")
	}
	if ref.AdapterCode != AdapterCarbonSink {
		return s.UpdateTHCPNDeviceConfig(ctx, input)
	}
	return s.updateCarbonDeviceConfig(ctx, input, ref)
}

func (s *Service) updateCarbonDeviceConfig(ctx context.Context, input UpdateTHCPNDeviceConfigInput, ref sqlc.DeviceSourceRef) (UpdateTHCPNDeviceConfigResponse, error) {
	if input.ExpectedConfigID <= 0 {
		return UpdateTHCPNDeviceConfigResponse{}, apperr.New(apperr.KindInvalidArgument, "expected_config_id is required")
	}
	dataJSON, err := normalizeTHCPNConfigArrayJSON(input.DataJSON, "data_json")
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	imageJSON, err := normalizeTHCPNConfigArrayJSON(input.ImageJSON, "image_json")
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	controlJSON, err := normalizeTHCPNConfigObjectJSON(input.ControlJSON, "control_json")
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	db, err := s.openCarbonConfigDB(ctx, ref.DataSourceID)
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	defer db.Close()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, apperr.Wrap(apperr.KindDataSource, "begin carbon config transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	previous, err := readLatestCarbonDeviceConfigForUpdate(ctx, tx, ref.ExternalDeviceID)
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	if previous.ID != input.ExpectedConfigID {
		return UpdateTHCPNDeviceConfigResponse{}, apperr.New(apperr.KindConflict, "device config has changed; reload and try again")
	}
	inserted, err := insertCarbonDeviceConfig(ctx, tx, ref.ExternalDeviceID, previous.Misc, dataJSON, imageJSON, controlJSON)
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	if err := tx.Commit(); err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, apperr.Wrap(apperr.KindDataSource, "commit carbon config transaction", err)
	}
	committed = true
	audit := summarizeTHCPNConfigChange(thcpnExternalConfig{ID: previous.ID, Data: previous.Data, Image: previous.Image, Control: previous.Control}, dataJSON, imageJSON, controlJSON)
	return UpdateTHCPNDeviceConfigResponse{DeviceID: input.DeviceID, DataSourceID: ref.DataSourceID, ExternalDeviceID: ref.ExternalDeviceID, Config: carbonConfigForResponse(ref.ExternalDeviceID, inserted), Audit: audit}, nil
}

func insertCarbonDeviceConfig(ctx context.Context, tx *sql.Tx, deviceID int64, misc, data, image, control json.RawMessage) (carbonDeviceConfig, error) {
	result, err := tx.ExecContext(ctx, `INSERT INTO device_configs (device_id, data, image, control, misc, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, deviceID, data, image, control, nullableCarbonConfigJSON(misc))
	if err != nil {
		return carbonDeviceConfig{}, apperr.Wrap(apperr.KindDataSource, "insert carbon device config", err)
	}
	configID, err := result.LastInsertId()
	if err != nil {
		return carbonDeviceConfig{}, apperr.Wrap(apperr.KindDataSource, "read carbon config id", err)
	}
	return readCarbonDeviceConfigByID(ctx, tx, configID)
}

func carbonConfigForResponse(deviceID int64, config carbonDeviceConfig) THCPNDeviceConfig {
	return THCPNDeviceConfig{ID: config.ID, DeviceID: deviceID, DataJSON: config.Data, ImageJSON: config.Image, ControlJSON: config.Control, CreatedAt: config.CreatedAt, UpdatedAt: config.UpdatedAt}
}

func (s *Service) getCarbonSamplingProfile(ctx context.Context, deviceID uuid.UUID, ref sqlc.DeviceSourceRef) (SamplingProfileResponse, error) {
	db, err := s.openCarbonConfigDB(ctx, ref.DataSourceID)
	if err != nil {
		return SamplingProfileResponse{}, err
	}
	defer db.Close()
	config, err := readLatestCarbonDeviceConfig(ctx, db, ref.ExternalDeviceID)
	if err != nil {
		return SamplingProfileResponse{}, err
	}
	return carbonSamplingProfileFromConfig(deviceID, config), nil
}

func (s *Service) updateCarbonSamplingProfile(ctx context.Context, input SamplingProfileUpdateInput, ref sqlc.DeviceSourceRef) (SamplingProfileResponse, error) {
	schedule, err := carbonSamplingScheduleForInput(input)
	if err != nil {
		return SamplingProfileResponse{}, err
	}
	db, err := s.openCarbonConfigDB(ctx, ref.DataSourceID)
	if err != nil {
		return SamplingProfileResponse{}, err
	}
	defer db.Close()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return SamplingProfileResponse{}, apperr.Wrap(apperr.KindDataSource, "begin carbon config transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	previous, err := readLatestCarbonDeviceConfigForUpdate(ctx, tx, ref.ExternalDeviceID)
	if err != nil {
		return SamplingProfileResponse{}, err
	}
	if previous.ID != input.ExpectedConfigID {
		return SamplingProfileResponse{}, apperr.New(apperr.KindConflict, "device config has changed; reload and try again")
	}
	control, err := mergeCarbonSamplingSchedule(previous.Control, schedule)
	if err != nil {
		return SamplingProfileResponse{}, err
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO device_configs (device_id, data, image, control, misc, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, ref.ExternalDeviceID, previous.Data, previous.Image, control, nullableCarbonConfigJSON(previous.Misc))
	if err != nil {
		return SamplingProfileResponse{}, apperr.Wrap(apperr.KindDataSource, "insert carbon device config", err)
	}
	configID, err := result.LastInsertId()
	if err != nil {
		return SamplingProfileResponse{}, apperr.Wrap(apperr.KindDataSource, "read carbon config id", err)
	}
	inserted, err := readCarbonDeviceConfigByID(ctx, tx, configID)
	if err != nil {
		return SamplingProfileResponse{}, err
	}
	if err := tx.Commit(); err != nil {
		return SamplingProfileResponse{}, apperr.Wrap(apperr.KindDataSource, "commit carbon config transaction", err)
	}
	committed = true
	response := carbonSamplingProfileFromConfig(input.DeviceID, inserted)
	now := time.Now().UTC()
	response.DispatchedAt = &now
	return response, nil
}

func (s *Service) openCarbonConfigDB(ctx context.Context, dataSourceID uuid.UUID) (*sql.DB, error) {
	source, err := s.loadTHCPNSyncDataSource(ctx, dataSourceID)
	if err != nil {
		return nil, err
	}
	return NewRuntime(nil).openMySQLDatabase(ctx, dataSourceFromSQL(source), carbonDatabaseName)
}

func readLatestCarbonDeviceConfig(ctx context.Context, db *sql.DB, deviceID int64) (carbonDeviceConfig, error) {
	return scanCarbonDeviceConfig(db.QueryRowContext(ctx, `SELECT id, data, image, control, misc, created_at, updated_at FROM device_configs WHERE device_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`, deviceID))
}

func readLatestCarbonDeviceConfigForUpdate(ctx context.Context, tx *sql.Tx, deviceID int64) (carbonDeviceConfig, error) {
	return scanCarbonDeviceConfig(tx.QueryRowContext(ctx, `SELECT id, data, image, control, misc, created_at, updated_at FROM device_configs WHERE device_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`, deviceID))
}

func readCarbonDeviceConfigByID(ctx context.Context, tx *sql.Tx, configID int64) (carbonDeviceConfig, error) {
	return scanCarbonDeviceConfig(tx.QueryRowContext(ctx, `SELECT id, data, image, control, misc, created_at, updated_at FROM device_configs WHERE id = ?`, configID))
}

type carbonConfigScanner interface{ Scan(...any) error }

func scanCarbonDeviceConfig(row carbonConfigScanner) (carbonDeviceConfig, error) {
	var config carbonDeviceConfig
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

func carbonSamplingScheduleForInput(input SamplingProfileUpdateInput) (samplingSchedule, error) {
	if preset, ok := samplingPresets[input.Mode]; ok {
		return preset, nil
	}
	if input.Mode != SamplingProfileCustom {
		return samplingSchedule{}, apperr.New(apperr.KindInvalidArgument, "invalid sampling profile mode")
	}
	dataMinutes, err := normalizeScheduleValues(input.DataMinutes, 0, 59, "data_minutes")
	if err != nil {
		return samplingSchedule{}, err
	}
	dataHours, err := normalizeScheduleValues(input.DataHours, 0, 23, "data_hours")
	if err != nil {
		return samplingSchedule{}, err
	}
	uploadMinutes, err := normalizeScheduleValues(input.UploadMinutes, 0, 59, "upload_minutes")
	if err != nil {
		return samplingSchedule{}, err
	}
	uploadHours, err := normalizeScheduleValues(input.UploadHours, 0, 23, "upload_hours")
	if err != nil {
		return samplingSchedule{}, err
	}
	return newDetailedSamplingSchedule(SamplingProfileCustom, dataMinutes, dataHours, uploadMinutes, uploadHours, 0, nil, 0, nil), nil
}

func mergeCarbonSamplingSchedule(raw json.RawMessage, schedule samplingSchedule) (json.RawMessage, error) {
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

func carbonSamplingProfileFromConfig(deviceID uuid.UUID, config carbonDeviceConfig) SamplingProfileResponse {
	response := SamplingProfileResponse{DeviceID: deviceID, Mode: SamplingProfileCustom, Advanced: true, DataMinutes: []int{}, DataHours: []int{}, UploadMinutes: []int{}, UploadHours: []int{}, ImageHours: []int{}, ImageUploadHours: []int{}, ExternalConfigID: config.ID, UpdatedAt: config.UpdatedAt}
	var control map[string]any
	if json.Unmarshal(config.Control, &control) != nil {
		response.Summary = "当前为管理员高级自定义计划"
		return response
	}
	dataCapture, dataOK := control["data_capture_invl"].(string)
	dataUpload, uploadOK := control["data_upload_invl"].(string)
	dataMinutes, dataHours, captureValid := parseTwoFieldSchedule(dataCapture)
	uploadMinutes, uploadHours, uploadValid := parseTwoFieldSchedule(dataUpload)
	if !dataOK || !uploadOK || !captureValid || !uploadValid {
		response.Summary = "当前为管理员高级自定义计划"
		return response
	}
	dataHours = expandWildcardHours(dataHours)
	uploadHours = expandWildcardHours(uploadHours)
	schedule := newDetailedSamplingSchedule(SamplingProfileCustom, dataMinutes, dataHours, uploadMinutes, uploadHours, 0, nil, 0, nil)
	for mode, preset := range samplingPresets {
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
