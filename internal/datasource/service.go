package datasource

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
)

var identifierPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type Service struct {
	queries *sqlc.Queries
}

type Adapter interface {
	Type() string
	QueryTelemetry(ctx context.Context, req TelemetryQuery) (TelemetryResult, error)
	QueryMedia(ctx context.Context, req MediaQuery) (MediaResult, error)
	Health(ctx context.Context) error
}

type TelemetryQuery struct {
	Binding DataStreamBinding
	Start   time.Time
	End     time.Time
	Limit   int
}

type TelemetryResult struct {
	Points []TelemetryPoint `json:"points"`
}

type TelemetryPoint struct {
	Timestamp time.Time `json:"ts"`
	Value     float64   `json:"value"`
	Quality   string    `json:"quality"`
}

type MediaQuery struct {
	Binding   DataStreamBinding
	Start     time.Time
	End       time.Time
	Page      int
	PageSize  int
	MediaType string
}

type MediaResult struct {
	Items []MediaRecord `json:"items"`
	Total int           `json:"total"`
}

type MediaRecord struct {
	ID                 string    `json:"id"`
	CapturedAt         time.Time `json:"captured_at"`
	ObjectKey          string    `json:"object_key"`
	ThumbnailObjectKey *string   `json:"thumbnail_object_key,omitempty"`
	MediaType          string    `json:"media_type"`
}

type DataSource struct {
	ID           uuid.UUID `json:"id"`
	WorkspaceID  uuid.UUID `json:"workspace_id"`
	Name         string    `json:"name"`
	Type         string    `json:"type"`
	DsnSecretRef string    `json:"dsn_secret_ref"`
	Status       string    `json:"status"`
	CreatedBy    uuid.UUID `json:"created_by"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type DataStreamBinding struct {
	ID              uuid.UUID       `json:"id"`
	DataStreamID    uuid.UUID       `json:"data_stream_id"`
	DataSourceID    uuid.UUID       `json:"data_source_id"`
	DatabaseName    *string         `json:"database_name,omitempty"`
	SchemaName      *string         `json:"schema_name,omitempty"`
	TableName       string          `json:"table_name"`
	DeviceKeyField  string          `json:"device_key_field"`
	DeviceKeyValue  string          `json:"device_key_value"`
	TimeField       string          `json:"time_field"`
	ValueField      string          `json:"value_field"`
	PayloadType     string          `json:"payload_type"`
	QueryConfigJSON json.RawMessage `json:"query_config"`
	Status          string          `json:"status"`
	CreatedBy       uuid.UUID       `json:"created_by"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

type CreateDataSourceInput struct {
	WorkspaceID  uuid.UUID
	Name         string
	Type         string
	DsnSecretRef string
	ActorUserID  uuid.UUID
}

type UpdateDataSourceInput struct {
	DataSourceID uuid.UUID
	Name         *string
	Type         *string
	DsnSecretRef *string
	Status       *string
}

type CreateDataStreamBindingInput struct {
	DataStreamID    uuid.UUID
	DataSourceID    uuid.UUID
	DatabaseName    string
	SchemaName      string
	TableName       string
	DeviceKeyField  string
	DeviceKeyValue  string
	TimeField       string
	ValueField      string
	PayloadType     string
	QueryConfigJSON json.RawMessage
	ActorUserID     uuid.UUID
}

type UpdateDataStreamBindingInput struct {
	BindingID       uuid.UUID
	DataSourceID    *uuid.UUID
	DatabaseName    *string
	SchemaName      *string
	TableName       *string
	DeviceKeyField  *string
	DeviceKeyValue  *string
	TimeField       *string
	ValueField      *string
	PayloadType     *string
	QueryConfigJSON *json.RawMessage
	Status          *string
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{queries: sqlc.New(db)}
}

func (s *Service) CreateDataSource(ctx context.Context, input CreateDataSourceInput) (DataSource, error) {
	name := strings.TrimSpace(input.Name)
	sourceType := strings.TrimSpace(input.Type)
	dsnSecretRef := strings.TrimSpace(input.DsnSecretRef)
	if input.WorkspaceID == uuid.Nil {
		return DataSource{}, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}
	if input.ActorUserID == uuid.Nil {
		return DataSource{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	if name == "" {
		return DataSource{}, apperr.New(apperr.KindInvalidArgument, "data source name is required")
	}
	if !isValidDataSourceType(sourceType) {
		return DataSource{}, apperr.New(apperr.KindInvalidArgument, "invalid data source type")
	}
	if dsnSecretRef == "" {
		return DataSource{}, apperr.New(apperr.KindInvalidArgument, "dsn_secret_ref is required")
	}

	created, err := s.queries.CreateDataSource(ctx, sqlc.CreateDataSourceParams{
		WorkspaceID:  input.WorkspaceID,
		Name:         name,
		Type:         sourceType,
		DsnSecretRef: dsnSecretRef,
		CreatedBy:    input.ActorUserID,
	})
	if err != nil {
		return DataSource{}, mapWriteError(err, "create data source")
	}
	return dataSourceFromSQL(created), nil
}

func (s *Service) GetDataSource(ctx context.Context, dataSourceID uuid.UUID) (DataSource, error) {
	if dataSourceID == uuid.Nil {
		return DataSource{}, apperr.New(apperr.KindInvalidArgument, "data source id is required")
	}
	row, err := s.queries.GetDataSource(ctx, dataSourceID)
	if err != nil {
		return DataSource{}, mapNotFoundOrInternal(err, "data source not found")
	}
	return dataSourceFromSQL(row), nil
}

func (s *Service) ListDataSources(ctx context.Context, workspaceID uuid.UUID) ([]DataSource, error) {
	if workspaceID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}
	rows, err := s.queries.ListDataSourcesByWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list data sources", err)
	}
	items := make([]DataSource, 0, len(rows))
	for _, row := range rows {
		items = append(items, dataSourceFromSQL(row))
	}
	return items, nil
}

func (s *Service) UpdateDataSource(ctx context.Context, input UpdateDataSourceInput) (DataSource, error) {
	if input.DataSourceID == uuid.Nil {
		return DataSource{}, apperr.New(apperr.KindInvalidArgument, "data source id is required")
	}
	current, err := s.queries.GetDataSource(ctx, input.DataSourceID)
	if err != nil {
		return DataSource{}, mapNotFoundOrInternal(err, "data source not found")
	}

	name := current.Name
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
		if name == "" {
			return DataSource{}, apperr.New(apperr.KindInvalidArgument, "data source name is required")
		}
	}

	sourceType := current.Type
	if input.Type != nil {
		sourceType = strings.TrimSpace(*input.Type)
		if !isValidDataSourceType(sourceType) {
			return DataSource{}, apperr.New(apperr.KindInvalidArgument, "invalid data source type")
		}
	}

	dsnSecretRef := current.DsnSecretRef
	if input.DsnSecretRef != nil {
		dsnSecretRef = strings.TrimSpace(*input.DsnSecretRef)
		if dsnSecretRef == "" {
			return DataSource{}, apperr.New(apperr.KindInvalidArgument, "dsn_secret_ref is required")
		}
	}

	status := current.Status
	if input.Status != nil {
		status = strings.TrimSpace(*input.Status)
		if !isValidStatus(status) {
			return DataSource{}, apperr.New(apperr.KindInvalidArgument, "invalid data source status")
		}
	}

	updated, err := s.queries.UpdateDataSource(ctx, sqlc.UpdateDataSourceParams{
		ID:           input.DataSourceID,
		Name:         name,
		Type:         sourceType,
		DsnSecretRef: dsnSecretRef,
		Status:       status,
	})
	if err != nil {
		return DataSource{}, mapWriteError(err, "update data source")
	}
	return dataSourceFromSQL(updated), nil
}

func (s *Service) CreateDataStreamBinding(ctx context.Context, input CreateDataStreamBindingInput) (DataStreamBinding, error) {
	if input.DataStreamID == uuid.Nil {
		return DataStreamBinding{}, apperr.New(apperr.KindInvalidArgument, "data stream id is required")
	}
	if input.DataSourceID == uuid.Nil {
		return DataStreamBinding{}, apperr.New(apperr.KindInvalidArgument, "data source id is required")
	}
	if input.ActorUserID == uuid.Nil {
		return DataStreamBinding{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}

	stream, source, err := s.resolveBindingParents(ctx, input.DataStreamID, input.DataSourceID)
	if err != nil {
		return DataStreamBinding{}, err
	}
	if stream.WorkspaceID != source.WorkspaceID {
		return DataStreamBinding{}, apperr.New(apperr.KindInvalidArgument, "data source does not belong to data stream workspace")
	}

	params, err := normalizeBinding(input, "active")
	if err != nil {
		return DataStreamBinding{}, err
	}

	created, err := s.queries.CreateDataStreamBinding(ctx, sqlc.CreateDataStreamBindingParams{
		DataStreamID:    input.DataStreamID,
		DataSourceID:    input.DataSourceID,
		DatabaseName:    params.DatabaseName,
		SchemaName:      params.SchemaName,
		TableName:       params.TableName,
		DeviceKeyField:  params.DeviceKeyField,
		DeviceKeyValue:  params.DeviceKeyValue,
		TimeField:       params.TimeField,
		ValueField:      params.ValueField,
		PayloadType:     params.PayloadType,
		QueryConfigJson: params.QueryConfigJSON,
		CreatedBy:       input.ActorUserID,
	})
	if err != nil {
		return DataStreamBinding{}, mapWriteError(err, "create data stream binding")
	}
	return bindingFromSQL(created), nil
}

func (s *Service) GetDataStreamBinding(ctx context.Context, bindingID uuid.UUID) (DataStreamBinding, error) {
	if bindingID == uuid.Nil {
		return DataStreamBinding{}, apperr.New(apperr.KindInvalidArgument, "data stream binding id is required")
	}
	row, err := s.queries.GetDataStreamBinding(ctx, bindingID)
	if err != nil {
		return DataStreamBinding{}, mapNotFoundOrInternal(err, "data stream binding not found")
	}
	return bindingFromSQL(row), nil
}

func (s *Service) GetActiveDataStreamBinding(ctx context.Context, dataStreamID uuid.UUID) (DataStreamBinding, error) {
	if dataStreamID == uuid.Nil {
		return DataStreamBinding{}, apperr.New(apperr.KindInvalidArgument, "data stream id is required")
	}
	row, err := s.queries.GetActiveDataStreamBinding(ctx, dataStreamID)
	if err != nil {
		return DataStreamBinding{}, mapNotFoundOrInternal(err, "active data stream binding not found")
	}
	return bindingFromSQL(row), nil
}

func (s *Service) ListDataStreamBindings(ctx context.Context, dataStreamID uuid.UUID) ([]DataStreamBinding, error) {
	if dataStreamID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "data stream id is required")
	}
	rows, err := s.queries.ListDataStreamBindingsByDataStream(ctx, dataStreamID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list data stream bindings", err)
	}
	items := make([]DataStreamBinding, 0, len(rows))
	for _, row := range rows {
		items = append(items, bindingFromSQL(row))
	}
	return items, nil
}

func (s *Service) UpdateDataStreamBinding(ctx context.Context, input UpdateDataStreamBindingInput) (DataStreamBinding, error) {
	if input.BindingID == uuid.Nil {
		return DataStreamBinding{}, apperr.New(apperr.KindInvalidArgument, "data stream binding id is required")
	}
	current, err := s.queries.GetDataStreamBinding(ctx, input.BindingID)
	if err != nil {
		return DataStreamBinding{}, mapNotFoundOrInternal(err, "data stream binding not found")
	}

	dataSourceID := current.DataSourceID
	if input.DataSourceID != nil {
		dataSourceID = *input.DataSourceID
		if dataSourceID == uuid.Nil {
			return DataStreamBinding{}, apperr.New(apperr.KindInvalidArgument, "data source id is required")
		}
	}

	stream, source, err := s.resolveBindingParents(ctx, current.DataStreamID, dataSourceID)
	if err != nil {
		return DataStreamBinding{}, err
	}
	if stream.WorkspaceID != source.WorkspaceID {
		return DataStreamBinding{}, apperr.New(apperr.KindInvalidArgument, "data source does not belong to data stream workspace")
	}

	sourceInput := CreateDataStreamBindingInput{
		DataStreamID:    current.DataStreamID,
		DataSourceID:    dataSourceID,
		DatabaseName:    derefString(current.DatabaseName),
		SchemaName:      derefString(current.SchemaName),
		TableName:       current.TableName,
		DeviceKeyField:  current.DeviceKeyField,
		DeviceKeyValue:  current.DeviceKeyValue,
		TimeField:       current.TimeField,
		ValueField:      current.ValueField,
		PayloadType:     current.PayloadType,
		QueryConfigJSON: json.RawMessage(current.QueryConfigJson),
		ActorUserID:     current.CreatedBy,
	}
	if input.DatabaseName != nil {
		sourceInput.DatabaseName = *input.DatabaseName
	}
	if input.SchemaName != nil {
		sourceInput.SchemaName = *input.SchemaName
	}
	if input.TableName != nil {
		sourceInput.TableName = *input.TableName
	}
	if input.DeviceKeyField != nil {
		sourceInput.DeviceKeyField = *input.DeviceKeyField
	}
	if input.DeviceKeyValue != nil {
		sourceInput.DeviceKeyValue = *input.DeviceKeyValue
	}
	if input.TimeField != nil {
		sourceInput.TimeField = *input.TimeField
	}
	if input.ValueField != nil {
		sourceInput.ValueField = *input.ValueField
	}
	if input.PayloadType != nil {
		sourceInput.PayloadType = *input.PayloadType
	}
	if input.QueryConfigJSON != nil {
		sourceInput.QueryConfigJSON = *input.QueryConfigJSON
	}

	status := current.Status
	if input.Status != nil {
		status = strings.TrimSpace(*input.Status)
		if !isValidStatus(status) {
			return DataStreamBinding{}, apperr.New(apperr.KindInvalidArgument, "invalid data stream binding status")
		}
	}

	params, err := normalizeBinding(sourceInput, status)
	if err != nil {
		return DataStreamBinding{}, err
	}

	updated, err := s.queries.UpdateDataStreamBinding(ctx, sqlc.UpdateDataStreamBindingParams{
		ID:              input.BindingID,
		DataSourceID:    dataSourceID,
		DatabaseName:    params.DatabaseName,
		SchemaName:      params.SchemaName,
		TableName:       params.TableName,
		DeviceKeyField:  params.DeviceKeyField,
		DeviceKeyValue:  params.DeviceKeyValue,
		TimeField:       params.TimeField,
		ValueField:      params.ValueField,
		PayloadType:     params.PayloadType,
		QueryConfigJson: params.QueryConfigJSON,
		Status:          params.Status,
	})
	if err != nil {
		return DataStreamBinding{}, mapWriteError(err, "update data stream binding")
	}
	return bindingFromSQL(updated), nil
}

func (s *Service) resolveBindingParents(ctx context.Context, dataStreamID uuid.UUID, dataSourceID uuid.UUID) (sqlc.DataStream, sqlc.DataSource, error) {
	stream, err := s.queries.GetDataStream(ctx, dataStreamID)
	if err != nil {
		return sqlc.DataStream{}, sqlc.DataSource{}, mapNotFoundOrInternal(err, "data stream not found")
	}
	source, err := s.queries.GetDataSource(ctx, dataSourceID)
	if err != nil {
		return sqlc.DataStream{}, sqlc.DataSource{}, mapNotFoundOrInternal(err, "data source not found")
	}
	return stream, source, nil
}

type normalizedBinding struct {
	DatabaseName    *string
	SchemaName      *string
	TableName       string
	DeviceKeyField  string
	DeviceKeyValue  string
	TimeField       string
	ValueField      string
	PayloadType     string
	QueryConfigJSON []byte
	Status          string
}

func normalizeBinding(input CreateDataStreamBindingInput, status string) (normalizedBinding, error) {
	tableName, err := requiredIdentifier(input.TableName, "table_name")
	if err != nil {
		return normalizedBinding{}, err
	}
	deviceKeyField, err := requiredIdentifier(input.DeviceKeyField, "device_key_field")
	if err != nil {
		return normalizedBinding{}, err
	}
	timeField, err := requiredIdentifier(input.TimeField, "time_field")
	if err != nil {
		return normalizedBinding{}, err
	}
	valueField, err := requiredIdentifier(input.ValueField, "value_field")
	if err != nil {
		return normalizedBinding{}, err
	}
	deviceKeyValue := strings.TrimSpace(input.DeviceKeyValue)
	if deviceKeyValue == "" {
		return normalizedBinding{}, apperr.New(apperr.KindInvalidArgument, "device_key_value is required")
	}
	payloadType := strings.TrimSpace(input.PayloadType)
	if !isValidPayloadType(payloadType) {
		return normalizedBinding{}, apperr.New(apperr.KindInvalidArgument, "invalid payload_type")
	}
	status = strings.TrimSpace(status)
	if !isValidStatus(status) {
		return normalizedBinding{}, apperr.New(apperr.KindInvalidArgument, "invalid data stream binding status")
	}
	queryConfig, err := normalizeQueryConfig(input.QueryConfigJSON)
	if err != nil {
		return normalizedBinding{}, err
	}
	databaseName, err := optionalIdentifier(input.DatabaseName, "database_name")
	if err != nil {
		return normalizedBinding{}, err
	}
	schemaName, err := optionalIdentifier(input.SchemaName, "schema_name")
	if err != nil {
		return normalizedBinding{}, err
	}
	return normalizedBinding{
		DatabaseName:    databaseName,
		SchemaName:      schemaName,
		TableName:       tableName,
		DeviceKeyField:  deviceKeyField,
		DeviceKeyValue:  deviceKeyValue,
		TimeField:       timeField,
		ValueField:      valueField,
		PayloadType:     payloadType,
		QueryConfigJSON: queryConfig,
		Status:          status,
	}, nil
}

func requiredIdentifier(value string, field string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", apperr.New(apperr.KindInvalidArgument, field+" is required")
	}
	if !identifierPattern.MatchString(trimmed) {
		return "", apperr.New(apperr.KindInvalidArgument, "invalid "+field)
	}
	return trimmed, nil
}

func optionalIdentifier(value string, field string) (*string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, nil
	}
	if !identifierPattern.MatchString(trimmed) {
		return nil, apperr.New(apperr.KindInvalidArgument, "invalid "+field)
	}
	return &trimmed, nil
}

func normalizeQueryConfig(value json.RawMessage) ([]byte, error) {
	if len(value) == 0 {
		return []byte("{}"), nil
	}
	if !json.Valid(value) {
		return nil, apperr.New(apperr.KindInvalidArgument, "query_config must be valid JSON")
	}
	var object map[string]any
	if err := json.Unmarshal(value, &object); err != nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "query_config must be a JSON object")
	}
	if object == nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "query_config must be a JSON object")
	}
	return append([]byte(nil), value...), nil
}

func isValidDataSourceType(value string) bool {
	switch value {
	case "postgres", "mysql", "clickhouse", "http_api", "file":
		return true
	default:
		return false
	}
}

func isValidPayloadType(value string) bool {
	switch value {
	case "columns", "json", "media":
		return true
	default:
		return false
	}
}

func isValidStatus(value string) bool {
	switch value {
	case "active", "disabled", "archived":
		return true
	default:
		return false
	}
}

func dataSourceFromSQL(model sqlc.DataSource) DataSource {
	return DataSource{
		ID:           model.ID,
		WorkspaceID:  model.WorkspaceID,
		Name:         model.Name,
		Type:         model.Type,
		DsnSecretRef: model.DsnSecretRef,
		Status:       model.Status,
		CreatedBy:    model.CreatedBy,
		CreatedAt:    pgTime(model.CreatedAt),
		UpdatedAt:    pgTime(model.UpdatedAt),
	}
}

func bindingFromSQL(model sqlc.DataStreamBinding) DataStreamBinding {
	return DataStreamBinding{
		ID:              model.ID,
		DataStreamID:    model.DataStreamID,
		DataSourceID:    model.DataSourceID,
		DatabaseName:    model.DatabaseName,
		SchemaName:      model.SchemaName,
		TableName:       model.TableName,
		DeviceKeyField:  model.DeviceKeyField,
		DeviceKeyValue:  model.DeviceKeyValue,
		TimeField:       model.TimeField,
		ValueField:      model.ValueField,
		PayloadType:     model.PayloadType,
		QueryConfigJSON: json.RawMessage(model.QueryConfigJson),
		Status:          model.Status,
		CreatedBy:       model.CreatedBy,
		CreatedAt:       pgTime(model.CreatedAt),
		UpdatedAt:       pgTime(model.UpdatedAt),
	}
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func pgTime(value pgtype.Timestamptz) time.Time {
	if !value.Valid {
		return time.Time{}
	}
	return value.Time
}

func mapWriteError(err error, message string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return apperr.Wrap(apperr.KindConflict, "resource already exists", err)
		case "23503", "23514":
			return apperr.Wrap(apperr.KindInvalidArgument, message, err)
		}
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}

func mapNotFoundOrInternal(err error, message string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.New(apperr.KindNotFound, message)
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}
