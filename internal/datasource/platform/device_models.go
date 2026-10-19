package platform

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type DeviceConfig struct {
	ID          int64           `json:"id"`
	DeviceID    int64           `json:"device_id"`
	Version     *string         `json:"version,omitempty"`
	UUID        *string         `json:"uuid,omitempty"`
	IsMG        bool            `json:"is_mg"`
	DataJSON    json.RawMessage `json:"data_json"`
	ImageJSON   json.RawMessage `json:"image_json"`
	ControlJSON json.RawMessage `json:"control_json"`
	CreatedAt   *time.Time      `json:"created_at,omitempty"`
	UpdatedAt   *time.Time      `json:"updated_at,omitempty"`
}
type DeviceConfigDetail struct {
	DeviceID         uuid.UUID             `json:"device_id"`
	DataSourceID     uuid.UUID             `json:"data_source_id"`
	ExternalDeviceID int64                 `json:"external_device_id"`
	LatestConfig     DeviceConfig          `json:"latest_config"`
	LatestSnapshot   *DeviceConfigSnapshot `json:"latest_snapshot,omitempty"`
}
type UpdateDeviceConfigInput struct {
	DeviceID         uuid.UUID
	DataJSON         json.RawMessage
	ImageJSON        json.RawMessage
	ControlJSON      json.RawMessage
	ActorUserID      uuid.UUID
	ExpectedConfigID int64
}
type UpdateDeviceConfigResult struct {
	WriteState          *ConfigWriteState    `json:"write_state,omitempty"`
	DeviceID            uuid.UUID            `json:"device_id"`
	DataSourceID        uuid.UUID            `json:"data_source_id"`
	ExternalDeviceID    int64                `json:"external_device_id"`
	Config              DeviceConfig         `json:"config"`
	ConfigSnapshot      DeviceConfigSnapshot `json:"config_snapshot"`
	DataStreams         []SyncedDataStream   `json:"data_streams"`
	Bindings            []DataStreamBinding  `json:"bindings"`
	DisabledDataStreams []SyncedDataStream   `json:"disabled_data_streams,omitempty"`
	DisabledBindings    []DataStreamBinding  `json:"disabled_bindings,omitempty"`
	Warnings            []QueryWarning       `json:"warnings,omitempty"`
	Audit               ConfigAudit          `json:"-"`
}
type ConfigAudit struct {
	PreviousConfigID int64
	ChangedSections  []string
	SensorCount      int
	MetricCount      int
	ImageCount       int
}
type SyncedDevice struct {
	ID           uuid.UUID  `json:"id"`
	AssignmentID *uuid.UUID `json:"assignment_id,omitempty"`
	WorkspaceID  *uuid.UUID `json:"workspace_id,omitempty"`
	ProjectID    *uuid.UUID `json:"project_id,omitempty"`
	SiteID       *uuid.UUID `json:"site_id,omitempty"`
	ProductID    *string    `json:"product_id,omitempty"`
	SerialNo     string     `json:"serial_no"`
	Name         string     `json:"name"`
	Status       string     `json:"status"`
	DeviceType   string     `json:"device_type"`
	AssignedBy   *uuid.UUID `json:"assigned_by,omitempty"`
	AssignedAt   *time.Time `json:"assigned_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}
type DeviceRelation struct {
	ID                     uuid.UUID `json:"id"`
	ParentDeviceID         uuid.UUID `json:"parent_device_id"`
	ChildDeviceID          uuid.UUID `json:"child_device_id"`
	RelationType           string    `json:"relation_type"`
	DataSourceID           uuid.UUID `json:"data_source_id"`
	ExternalParentDeviceID int64     `json:"external_parent_device_id"`
	ExternalChildDeviceID  int64     `json:"external_child_device_id"`
	Status                 string    `json:"status"`
	SyncedAt               time.Time `json:"synced_at"`
	CreatedAt              time.Time `json:"created_at"`
	UpdatedAt              time.Time `json:"updated_at"`
}
type SyncedDataStream struct {
	ID       uuid.UUID `json:"id"`
	DeviceID uuid.UUID `json:"device_id"`
	Code     string    `json:"code"`
	Name     string    `json:"name"`
	Type     string    `json:"type"`
	Unit     *string   `json:"unit,omitempty"`
	Status   string    `json:"status"`
}
type DeviceSourceRef struct {
	ID               uuid.UUID `json:"id"`
	DeviceID         uuid.UUID `json:"device_id"`
	DataSourceID     uuid.UUID `json:"data_source_id"`
	AdapterCode      string    `json:"adapter_code"`
	ExternalDeviceID int64     `json:"external_device_id"`
	Status           string    `json:"status"`
	SyncedAt         time.Time `json:"synced_at"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}
type DeviceConfigSnapshot struct {
	ID               uuid.UUID       `json:"id"`
	DeviceID         uuid.UUID       `json:"device_id"`
	DataSourceID     uuid.UUID       `json:"data_source_id"`
	AdapterCode      string          `json:"adapter_code"`
	ExternalDeviceID int64           `json:"external_device_id"`
	ExternalConfigID int64           `json:"external_config_id"`
	Version          *string         `json:"version,omitempty"`
	DataJSON         json.RawMessage `json:"data_json"`
	ImageJSON        json.RawMessage `json:"image_json"`
	ControlJSON      json.RawMessage `json:"control_json"`
	SourceCreatedAt  *time.Time      `json:"source_created_at,omitempty"`
	SourceUpdatedAt  *time.Time      `json:"source_updated_at,omitempty"`
	SyncedAt         time.Time       `json:"synced_at"`
	CreatedAt        time.Time       `json:"created_at"`
}

func JsonSemanticallyEqual(left, right json.RawMessage) bool {
	var leftValue, rightValue any
	if json.Unmarshal(left, &leftValue) != nil || json.Unmarshal(right, &rightValue) != nil {
		return false
	}
	return reflect.DeepEqual(leftValue, rightValue)
}
func (s *Service) LoadMySQLDataSourceForFamily(ctx context.Context, dataSourceID uuid.UUID, family string) (sqlc.DataSource, error) {
	if dataSourceID == uuid.Nil {
		return sqlc.DataSource{}, apperr.New(apperr.KindInvalidArgument, "data_source_id is required")
	}
	source, err := s.Queries.GetDataSource(ctx, dataSourceID)
	if err != nil {
		return sqlc.DataSource{}, MapNotFoundOrInternal(err, "data source not found")
	}
	if source.Type != "mysql" {
		return sqlc.DataSource{}, apperr.New(apperr.KindInvalidArgument, "source family requires mysql data source")
	}
	if source.Status != "active" {
		return sqlc.DataSource{}, apperr.New(apperr.KindInvalidArgument, "data source is not active")
	}
	if source.SourceFamily == nil || *source.SourceFamily != family {
		return sqlc.DataSource{}, apperr.New(apperr.KindInvalidArgument, "data source family does not support this operation")
	}
	return source, nil
}
func AddDeviceCapabilityIfMissing(ctx context.Context, q *sqlc.Queries, deviceID uuid.UUID, capability string) error {
	_, err := q.AddDeviceCapability(ctx, sqlc.AddDeviceCapabilityParams{
		DeviceID:       deviceID,
		CapabilityCode: capability,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return MapWriteError(err, "add device capability")
	}
	return nil
}
func NormalizeSourceJSON(value sql.NullString, fallback []byte) (json.RawMessage, error) {
	if !value.Valid || strings.TrimSpace(value.String) == "" || strings.TrimSpace(value.String) == "null" {
		return append(json.RawMessage(nil), fallback...), nil
	}
	raw := []byte(strings.TrimSpace(value.String))
	if json.Valid(raw) {
		var decoded string
		if len(raw) > 0 && raw[0] == '"' && json.Unmarshal(raw, &decoded) == nil && json.Valid([]byte(decoded)) {
			return json.RawMessage(decoded), nil
		}
		return append(json.RawMessage(nil), raw...), nil
	}
	return nil, apperr.New(apperr.KindDataSource, "invalid JSON")
}
func NormalizeConfigArrayJSON(raw json.RawMessage, field string) (json.RawMessage, error) {
	if len(raw) == 0 {
		return nil, apperr.New(apperr.KindInvalidArgument, field+" is required")
	}
	var value []any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "invalid "+field)
	}
	normalized, err := json.Marshal(value)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "normalize "+field, err)
	}
	return json.RawMessage(normalized), nil
}
func NormalizeConfigObjectJSON(raw json.RawMessage, field string) (json.RawMessage, error) {
	if len(raw) == 0 {
		return nil, apperr.New(apperr.KindInvalidArgument, field+" is required")
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "invalid "+field)
	}
	normalized, err := json.Marshal(value)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "normalize "+field, err)
	}
	return json.RawMessage(normalized), nil
}
func NullableStringArg(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}
func BoolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
func MarshalAdapterConfig(value map[string]any) json.RawMessage {
	encoded, err := json.Marshal(value)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return encoded
}
func FirstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
func NullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	trimmed := strings.TrimSpace(value.String)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
func NullInt64Ptr(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}
func NullTimePtr(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}
func TimestamptzFromPtr(value *time.Time) pgtype.Timestamptz {
	if value == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *value, Valid: true}
}
func pgTimePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}
func SyncedDeviceFromSQL(model sqlc.Device, assignment *sqlc.DeviceAssignment) SyncedDevice {
	device := SyncedDevice{
		ID:         model.ID,
		ProductID:  model.ProductID,
		SerialNo:   model.SerialNo,
		Name:       model.Name,
		Status:     model.Status,
		DeviceType: model.DeviceType,
		CreatedAt:  pgTime(model.CreatedAt),
		UpdatedAt:  pgTime(model.UpdatedAt),
	}
	if assignment != nil {
		device.AssignmentID = &assignment.ID
		device.WorkspaceID = &assignment.WorkspaceID
		device.ProjectID = assignment.ProjectID
		device.SiteID = assignment.SiteID
		device.AssignedBy = assignment.AssignedBy
		device.AssignedAt = pgTimePtr(assignment.AssignedAt)
	}
	return device
}
func SyncedDataStreamFromSQL(model sqlc.DataStream) SyncedDataStream {
	return SyncedDataStream{
		ID:       model.ID,
		DeviceID: model.DeviceID,
		Code:     model.Code,
		Name:     model.Name,
		Type:     model.Type,
		Unit:     model.Unit,
		Status:   model.Status,
	}
}
func DeviceSourceRefFromSQL(model sqlc.UpsertNumericDeviceSourceRefRow) DeviceSourceRef {
	return DeviceSourceRef{
		ID:               model.ID,
		DeviceID:         model.DeviceID,
		DataSourceID:     model.DataSourceID,
		AdapterCode:      model.AdapterCode,
		ExternalDeviceID: model.ExternalDeviceID,
		Status:           model.Status,
		SyncedAt:         pgTime(model.SyncedAt),
		CreatedAt:        pgTime(model.CreatedAt),
		UpdatedAt:        pgTime(model.UpdatedAt),
	}
}
func DeviceConfigSnapshotFromSQL(model sqlc.DeviceConfigSnapshot) DeviceConfigSnapshot {
	return DeviceConfigSnapshot{
		ID:               model.ID,
		DeviceID:         model.DeviceID,
		DataSourceID:     model.DataSourceID,
		AdapterCode:      model.AdapterCode,
		ExternalDeviceID: model.ExternalDeviceID,
		ExternalConfigID: model.ExternalConfigID,
		Version:          model.Version,
		DataJSON:         json.RawMessage(model.DataJson),
		ImageJSON:        json.RawMessage(model.ImageJson),
		ControlJSON:      json.RawMessage(model.ControlJson),
		SourceCreatedAt:  pgTimePtr(model.SourceCreatedAt),
		SourceUpdatedAt:  pgTimePtr(model.SourceUpdatedAt),
		SyncedAt:         pgTime(model.SyncedAt),
		CreatedAt:        pgTime(model.CreatedAt),
	}
}
func DeviceRelationFromSQL(model sqlc.DeviceRelation) DeviceRelation {
	return DeviceRelation{
		ID:                     model.ID,
		ParentDeviceID:         model.ParentDeviceID,
		ChildDeviceID:          model.ChildDeviceID,
		RelationType:           model.RelationType,
		DataSourceID:           model.DataSourceID,
		ExternalParentDeviceID: model.ExternalParentDeviceID,
		ExternalChildDeviceID:  model.ExternalChildDeviceID,
		Status:                 model.Status,
		SyncedAt:               pgTime(model.SyncedAt),
		CreatedAt:              pgTime(model.CreatedAt),
		UpdatedAt:              pgTime(model.UpdatedAt),
	}
}
func DeviceRelationFromUpsertRow(model sqlc.UpsertDeviceRelationRow) DeviceRelation {
	return DeviceRelation{
		ID:                     model.ID,
		ParentDeviceID:         model.ParentDeviceID,
		ChildDeviceID:          model.ChildDeviceID,
		RelationType:           model.RelationType,
		DataSourceID:           model.DataSourceID,
		ExternalParentDeviceID: model.ExternalParentDeviceID,
		ExternalChildDeviceID:  model.ExternalChildDeviceID,
		Status:                 model.Status,
		SyncedAt:               pgTime(model.SyncedAt),
		CreatedAt:              pgTime(model.CreatedAt),
		UpdatedAt:              pgTime(model.UpdatedAt),
	}
}
