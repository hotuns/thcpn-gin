package platform

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/billing"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/objectstore"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var identifierPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

const (
	AdapterGenericColumns = "generic_columns"
	AdapterGenericMedia   = "generic_media"
	AdapterHTTPAPI        = "http_api"
	AdapterTHCPNLegacy    = "thcpn_legacy_mysql"
	AdapterTHCPNCamera    = "thcpn_legacy_camera"
	AdapterCarbonSink     = "carbon_sink_mysql"
	AdapterLoRaWANV2      = "lorawan_v2"
	SourceFamilyTHCPN     = "thcpn"
	SourceFamilyCarbon    = "carbon"
	SourceFamilyLoRaWANV2 = "lorawan_v2"
)

type Service struct {
	Catalog              *Catalog
	Runtime              *Runtime
	TemplateValidators   map[string]TemplateValidator
	TemplateProjectors   map[string]TemplateProjector
	SensorTargetResolver func(context.Context, uuid.UUID) (string, *string, error)

	DB           *pgxpool.Pool
	Queries      *sqlc.Queries
	store        objectstore.Store
	billing      *billing.Service
	SyncQueue    SyncQueue
	ClaimEnsurer interface {
		EnsureEligible(context.Context) (int64, error)
	}
}

func (s *Service) SetBilling(service *billing.Service) { s.billing = service }
func (s *Service) ValidateDeviceHistory(ctx context.Context, deviceID uuid.UUID, start time.Time) error {
	if s.billing == nil {
		return nil
	}
	assignment, err := s.Queries.GetActiveDeviceAssignment(ctx, deviceID)
	if err != nil {
		return MapNotFoundOrInternal(err, "active device assignment not found")
	}
	summary, err := s.billing.Summary(ctx, assignment.WorkspaceID)
	if err != nil {
		return err
	}
	if summary.Plan == billing.PlanBase && start.Before(time.Now().UTC().AddDate(0, 0, -s.billing.BaseHistoryDays())) {
		return apperr.New(apperr.KindPermissionDenied, "base plan online history is outside the configured window")
	}
	return nil
}

type TelemetryQuery struct {
	Binding      DataStreamBinding
	Start        time.Time
	End          time.Time
	Limit        int
	Adaptive     bool
	TargetPoints int
}
type TelemetryBatchQuery struct {
	Bindings     []DataStreamBinding
	Start        time.Time
	End          time.Time
	Limit        int
	Adaptive     bool
	TargetPoints int
}
type TelemetryBatchResult struct {
	Errors         map[uuid.UUID]string
	Series         map[uuid.UUID]TelemetryResult
	SourceScans    int
	RowsRead       int
	ReturnedPoints int
	SampledSeries  int
}
type TelemetryResult struct {
	Points      []TelemetryPoint `json:"points"`
	Warnings    []QueryWarning   `json:"warnings,omitempty"`
	SourceCount int              `json:"source_count"`
	Sampled     bool             `json:"sampled"`
	Complete    bool             `json:"complete"`
}
type TelemetryPoint struct {
	Timestamp time.Time `json:"ts"`
	Value     float64   `json:"value"`
	Quality   string    `json:"quality"`
}
type QueryWarning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Count   int    `json:"count,omitempty"`
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
	ID                 uuid.UUID `json:"id"`
	Name               string    `json:"name"`
	Type               string    `json:"type"`
	SourceFamily       *string   `json:"source_family"`
	SourceFamilyLocked bool      `json:"source_family_locked"`
	DsnSecretRef       string    `json:"dsn_secret_ref"`
	Status             string    `json:"status"`
	CreatedBy          uuid.UUID `json:"created_by"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}
type DataStreamBinding struct {
	ID                uuid.UUID       `json:"id"`
	DataStreamID      uuid.UUID       `json:"data_stream_id"`
	DataSourceID      uuid.UUID       `json:"data_source_id"`
	AdapterCode       string          `json:"adapter_code"`
	DatabaseName      *string         `json:"database_name,omitempty"`
	SchemaName        *string         `json:"schema_name,omitempty"`
	TableName         *string         `json:"table_name,omitempty"`
	DeviceKeyField    *string         `json:"device_key_field,omitempty"`
	DeviceKeyValue    *string         `json:"device_key_value,omitempty"`
	TimeField         *string         `json:"time_field,omitempty"`
	ValueField        *string         `json:"value_field,omitempty"`
	PayloadType       string          `json:"payload_type"`
	AdapterConfigJSON json.RawMessage `json:"adapter_config"`
	Status            string          `json:"status"`
	CreatedBy         uuid.UUID       `json:"created_by"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}
type CreateDataSourceInput struct {
	Name         string
	Type         string
	SourceFamily *string
	DsnSecretRef string
	ActorAdminID uuid.UUID
}
type UpdateDataSourceInput struct {
	DataSourceID uuid.UUID
	Name         *string
	Type         *string
	SourceFamily *string
	DsnSecretRef *string
	Status       *string
}
type CreateDataStreamBindingInput struct {
	DataStreamID      uuid.UUID
	DataSourceID      uuid.UUID
	AdapterCode       string
	DatabaseName      string
	SchemaName        string
	TableName         string
	DeviceKeyField    string
	DeviceKeyValue    string
	TimeField         string
	ValueField        string
	PayloadType       string
	AdapterConfigJSON json.RawMessage
	ActorUserID       uuid.UUID
}
type UpdateDataStreamBindingInput struct {
	BindingID         uuid.UUID
	DataSourceID      *uuid.UUID
	AdapterCode       *string
	DatabaseName      *string
	SchemaName        *string
	TableName         *string
	DeviceKeyField    *string
	DeviceKeyValue    *string
	TimeField         *string
	ValueField        *string
	PayloadType       *string
	AdapterConfigJSON *json.RawMessage
	Status            *string
}

func NewService(db *pgxpool.Pool, stores ...objectstore.Store) *Service {
	var store objectstore.Store
	if len(stores) > 0 {
		store = stores[0]
	}
	return &Service{DB: db, Queries: sqlc.New(db), store: store, Runtime: NewRuntime(nil), Catalog: NewCatalog()}
}
func (s *Service) CreateDataSource(ctx context.Context, input CreateDataSourceInput) (DataSource, error) {
	name := strings.TrimSpace(input.Name)
	sourceType := strings.TrimSpace(input.Type)
	sourceFamily, err := s.Catalog.NormalizeSourceFamily(input.SourceFamily)
	if err != nil {
		return DataSource{}, err
	}
	dsnSecretRef := strings.TrimSpace(input.DsnSecretRef)
	if input.ActorAdminID == uuid.Nil {
		return DataSource{}, apperr.New(apperr.KindInvalidArgument, "actor admin id is required")
	}
	if name == "" {
		return DataSource{}, apperr.New(apperr.KindInvalidArgument, "data source name is required")
	}
	if !isValidDataSourceType(sourceType) {
		return DataSource{}, apperr.New(apperr.KindInvalidArgument, "invalid data source type")
	}
	if err := s.Catalog.ValidateSourceType(sourceFamily, sourceType); err != nil {
		return DataSource{}, err
	}
	if dsnSecretRef == "" {
		return DataSource{}, apperr.New(apperr.KindInvalidArgument, "dsn_secret_ref is required")
	}

	created, err := s.Queries.CreateDataSource(ctx, sqlc.CreateDataSourceParams{
		Name:         name,
		Type:         sourceType,
		SourceFamily: sourceFamily,
		DsnSecretRef: dsnSecretRef,
		CreatedBy:    input.ActorAdminID,
	})
	if err != nil {
		return DataSource{}, MapWriteError(err, "create data source")
	}
	return DataSourceFromSQL(created), nil
}
func (s *Service) GetDataSource(ctx context.Context, dataSourceID uuid.UUID) (DataSource, error) {
	if dataSourceID == uuid.Nil {
		return DataSource{}, apperr.New(apperr.KindInvalidArgument, "data source id is required")
	}
	row, err := s.Queries.GetDataSource(ctx, dataSourceID)
	if err != nil {
		return DataSource{}, MapNotFoundOrInternal(err, "data source not found")
	}
	return s.dataSourceForResponse(ctx, row)
}
func (s *Service) ListDataSources(ctx context.Context) ([]DataSource, error) {
	rows, err := s.Queries.ListDataSources(ctx)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list data sources", err)
	}
	items := make([]DataSource, 0, len(rows))
	for _, row := range rows {
		item, err := s.dataSourceForResponse(ctx, row)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}
func (s *Service) ListSystemDataSources(ctx context.Context) ([]DataSource, error) {
	return s.ListDataSources(ctx)
}
func (s *Service) UpdateDataSource(ctx context.Context, input UpdateDataSourceInput) (DataSource, error) {
	if input.DataSourceID == uuid.Nil {
		return DataSource{}, apperr.New(apperr.KindInvalidArgument, "data source id is required")
	}
	current, err := s.Queries.GetDataSource(ctx, input.DataSourceID)
	if err != nil {
		return DataSource{}, MapNotFoundOrInternal(err, "data source not found")
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

	sourceFamily := current.SourceFamily
	if input.SourceFamily != nil {
		sourceFamily, err = s.Catalog.NormalizeSourceFamily(input.SourceFamily)
		if err != nil {
			return DataSource{}, err
		}
		if !sameSourceFamily(current.SourceFamily, sourceFamily) {
			locked, err := s.Queries.HasDataSourceFamilyReferences(ctx, input.DataSourceID)
			if err != nil {
				return DataSource{}, apperr.Wrap(apperr.KindInternal, "check data source family references", err)
			}
			if locked.Bool {
				return DataSource{}, apperr.New(apperr.KindInvalidArgument, "data source family cannot change while source references or bindings exist")
			}
		}
	}
	if err := s.Catalog.ValidateSourceType(sourceFamily, sourceType); err != nil {
		return DataSource{}, err
	}

	updated, err := s.Queries.UpdateDataSource(ctx, sqlc.UpdateDataSourceParams{
		ID:           input.DataSourceID,
		Name:         name,
		Type:         sourceType,
		SourceFamily: sourceFamily,
		DsnSecretRef: dsnSecretRef,
		Status:       status,
	})
	if err != nil {
		return DataSource{}, MapWriteError(err, "update data source")
	}
	return s.dataSourceForResponse(ctx, updated)
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

	_, source, err := s.resolveBindingParents(ctx, input.DataStreamID, input.DataSourceID)
	if err != nil {
		return DataStreamBinding{}, err
	}
	if err := s.Catalog.ValidateAdapterSource(input.AdapterCode, source.Type); err != nil {
		return DataStreamBinding{}, err
	}

	params, err := NormalizeBinding(input, "active", s.Catalog.Adapters[strings.TrimSpace(input.AdapterCode)])
	if err != nil {
		return DataStreamBinding{}, err
	}

	created, err := s.Queries.CreateDataStreamBinding(ctx, sqlc.CreateDataStreamBindingParams{
		DataStreamID:      input.DataStreamID,
		DataSourceID:      input.DataSourceID,
		AdapterCode:       params.AdapterCode,
		DatabaseName:      params.DatabaseName,
		SchemaName:        params.SchemaName,
		TableName:         params.TableName,
		DeviceKeyField:    params.DeviceKeyField,
		DeviceKeyValue:    params.DeviceKeyValue,
		TimeField:         params.TimeField,
		ValueField:        params.ValueField,
		PayloadType:       params.PayloadType,
		AdapterConfigJson: params.AdapterConfigJSON,
		CreatedBy:         input.ActorUserID,
		CreatedByType:     "user",
	})
	if err != nil {
		return DataStreamBinding{}, MapWriteError(err, "create data stream binding")
	}
	return BindingFromSQL(created), nil
}
func (s *Service) GetDataStreamBinding(ctx context.Context, bindingID uuid.UUID) (DataStreamBinding, error) {
	if bindingID == uuid.Nil {
		return DataStreamBinding{}, apperr.New(apperr.KindInvalidArgument, "data stream binding id is required")
	}
	row, err := s.Queries.GetDataStreamBinding(ctx, bindingID)
	if err != nil {
		return DataStreamBinding{}, MapNotFoundOrInternal(err, "data stream binding not found")
	}
	return BindingFromSQL(row), nil
}
func (s *Service) GetActiveDataStreamBinding(ctx context.Context, dataStreamID uuid.UUID) (DataStreamBinding, error) {
	if dataStreamID == uuid.Nil {
		return DataStreamBinding{}, apperr.New(apperr.KindInvalidArgument, "data stream id is required")
	}
	row, err := s.Queries.GetActiveDataStreamBinding(ctx, dataStreamID)
	if err != nil {
		return DataStreamBinding{}, MapNotFoundOrInternal(err, "active data stream binding not found")
	}
	return BindingFromSQL(row), nil
}
func (s *Service) ListDataStreamBindings(ctx context.Context, dataStreamID uuid.UUID) ([]DataStreamBinding, error) {
	if dataStreamID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "data stream id is required")
	}
	rows, err := s.Queries.ListDataStreamBindingsByDataStream(ctx, dataStreamID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list data stream bindings", err)
	}
	items := make([]DataStreamBinding, 0, len(rows))
	for _, row := range rows {
		items = append(items, BindingFromSQL(row))
	}
	return items, nil
}
func (s *Service) UpdateDataStreamBinding(ctx context.Context, input UpdateDataStreamBindingInput) (DataStreamBinding, error) {
	if input.BindingID == uuid.Nil {
		return DataStreamBinding{}, apperr.New(apperr.KindInvalidArgument, "data stream binding id is required")
	}
	current, err := s.Queries.GetDataStreamBinding(ctx, input.BindingID)
	if err != nil {
		return DataStreamBinding{}, MapNotFoundOrInternal(err, "data stream binding not found")
	}

	dataSourceID := current.DataSourceID
	if input.DataSourceID != nil {
		dataSourceID = *input.DataSourceID
		if dataSourceID == uuid.Nil {
			return DataStreamBinding{}, apperr.New(apperr.KindInvalidArgument, "data source id is required")
		}
	}

	_, source, err := s.resolveBindingParents(ctx, current.DataStreamID, dataSourceID)
	if err != nil {
		return DataStreamBinding{}, err
	}

	sourceInput := CreateDataStreamBindingInput{
		DataStreamID:      current.DataStreamID,
		DataSourceID:      dataSourceID,
		AdapterCode:       current.AdapterCode,
		DatabaseName:      DerefString(current.DatabaseName),
		SchemaName:        DerefString(current.SchemaName),
		TableName:         DerefString(current.TableName),
		DeviceKeyField:    DerefString(current.DeviceKeyField),
		DeviceKeyValue:    DerefString(current.DeviceKeyValue),
		TimeField:         DerefString(current.TimeField),
		ValueField:        DerefString(current.ValueField),
		PayloadType:       current.PayloadType,
		AdapterConfigJSON: json.RawMessage(current.AdapterConfigJson),
		ActorUserID:       current.CreatedBy,
	}
	if input.AdapterCode != nil {
		sourceInput.AdapterCode = *input.AdapterCode
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
	if input.AdapterConfigJSON != nil {
		sourceInput.AdapterConfigJSON = *input.AdapterConfigJSON
	}

	status := current.Status
	if input.Status != nil {
		status = strings.TrimSpace(*input.Status)
		if !isValidStatus(status) {
			return DataStreamBinding{}, apperr.New(apperr.KindInvalidArgument, "invalid data stream binding status")
		}
	}
	if err := s.Catalog.ValidateAdapterSource(sourceInput.AdapterCode, source.Type); err != nil {
		return DataStreamBinding{}, err
	}

	params, err := NormalizeBinding(sourceInput, status, s.Catalog.Adapters[strings.TrimSpace(sourceInput.AdapterCode)])
	if err != nil {
		return DataStreamBinding{}, err
	}

	updated, err := s.Queries.UpdateDataStreamBinding(ctx, sqlc.UpdateDataStreamBindingParams{
		ID:                input.BindingID,
		DataSourceID:      dataSourceID,
		AdapterCode:       params.AdapterCode,
		DatabaseName:      params.DatabaseName,
		SchemaName:        params.SchemaName,
		TableName:         params.TableName,
		DeviceKeyField:    params.DeviceKeyField,
		DeviceKeyValue:    params.DeviceKeyValue,
		TimeField:         params.TimeField,
		ValueField:        params.ValueField,
		PayloadType:       params.PayloadType,
		AdapterConfigJson: params.AdapterConfigJSON,
		Status:            params.Status,
	})
	if err != nil {
		return DataStreamBinding{}, MapWriteError(err, "update data stream binding")
	}
	return BindingFromSQL(updated), nil
}
func (s *Service) resolveBindingParents(ctx context.Context, dataStreamID uuid.UUID, dataSourceID uuid.UUID) (sqlc.DataStream, sqlc.DataSource, error) {
	stream, err := s.Queries.GetDataStream(ctx, dataStreamID)
	if err != nil {
		return sqlc.DataStream{}, sqlc.DataSource{}, MapNotFoundOrInternal(err, "data stream not found")
	}
	source, err := s.Queries.GetDataSource(ctx, dataSourceID)
	if err != nil {
		return sqlc.DataStream{}, sqlc.DataSource{}, MapNotFoundOrInternal(err, "data source not found")
	}
	return stream, source, nil
}

type normalizedBinding struct {
	AdapterCode       string
	DatabaseName      *string
	SchemaName        *string
	TableName         *string
	DeviceKeyField    *string
	DeviceKeyValue    *string
	TimeField         *string
	ValueField        *string
	PayloadType       string
	AdapterConfigJSON []byte
	Status            string
}

func NormalizeBinding(input CreateDataStreamBindingInput, status string, definitions ...AdapterDefinition) (normalizedBinding, error) {
	adapterCode := strings.TrimSpace(input.AdapterCode)
	definition := NewCatalog().Adapters[adapterCode]
	if len(definitions) > 0 {
		definition = definitions[0]
	}
	if definition.Code != adapterCode {
		return normalizedBinding{}, apperr.New(apperr.KindInvalidArgument, "invalid adapter_code")
	}
	payloadType := strings.TrimSpace(input.PayloadType)
	if !isValidPayloadType(payloadType) {
		return normalizedBinding{}, apperr.New(apperr.KindInvalidArgument, "invalid payload_type")
	}
	if err := definition.ValidatePayload(payloadType); err != nil {
		return normalizedBinding{}, err
	}
	status = strings.TrimSpace(status)
	if !isValidStatus(status) {
		return normalizedBinding{}, apperr.New(apperr.KindInvalidArgument, "invalid data stream binding status")
	}
	adapterConfig, err := NormalizeAdapterConfig(input.AdapterConfigJSON)
	if err != nil {
		return normalizedBinding{}, err
	}
	if err := validateAdapterConfig(adapterCode, adapterConfig); err != nil {
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
	tableName, deviceKeyField, deviceKeyValue, timeField, valueField, err := normalizeBindingMapping(input, definition)
	if err != nil {
		return normalizedBinding{}, err
	}
	return normalizedBinding{
		AdapterCode:       adapterCode,
		DatabaseName:      databaseName,
		SchemaName:        schemaName,
		TableName:         tableName,
		DeviceKeyField:    deviceKeyField,
		DeviceKeyValue:    deviceKeyValue,
		TimeField:         timeField,
		ValueField:        valueField,
		PayloadType:       payloadType,
		AdapterConfigJSON: adapterConfig,
		Status:            status,
	}, nil
}
func normalizeBindingMapping(input CreateDataStreamBindingInput, definition AdapterDefinition) (*string, *string, *string, *string, *string, error) {
	adapterCode := definition.Code
	switch {
	case definition.OptionalMapping:
		tableName, err := optionalIdentifier(input.TableName, "table_name")
		if err != nil {
			return nil, nil, nil, nil, nil, err
		}
		deviceKeyField, err := optionalIdentifier(input.DeviceKeyField, "device_key_field")
		if err != nil {
			return nil, nil, nil, nil, nil, err
		}
		timeField, err := optionalIdentifier(input.TimeField, "time_field")
		if err != nil {
			return nil, nil, nil, nil, nil, err
		}
		valueField, err := optionalIdentifier(input.ValueField, "value_field")
		if err != nil {
			return nil, nil, nil, nil, nil, err
		}
		return tableName, deviceKeyField, OptionalString(input.DeviceKeyValue), timeField, valueField, nil
	case adapterCode == AdapterGenericColumns:
		tableName, deviceKeyField, deviceKeyValue, timeField, valueField, err := normalizeRequiredTableDeviceTimeMapping(input)
		if err != nil {
			return nil, nil, nil, nil, nil, err
		}
		if valueField == nil {
			return nil, nil, nil, nil, nil, apperr.New(apperr.KindInvalidArgument, "value_field is required")
		}
		return tableName, deviceKeyField, deviceKeyValue, timeField, valueField, nil
	case adapterCode == AdapterGenericMedia:
		tableName, deviceKeyField, deviceKeyValue, timeField, _, err := normalizeRequiredTableDeviceTimeMapping(input)
		if err != nil {
			return nil, nil, nil, nil, nil, err
		}
		valueField, err := optionalIdentifier(input.ValueField, "value_field")
		if err != nil {
			return nil, nil, nil, nil, nil, err
		}
		return tableName, deviceKeyField, deviceKeyValue, timeField, valueField, nil
	default:
		return nil, nil, nil, nil, nil, apperr.New(apperr.KindInvalidArgument, "invalid adapter_code")
	}
}
func normalizeRequiredTableDeviceTimeMapping(input CreateDataStreamBindingInput) (*string, *string, *string, *string, *string, error) {
	tableName, err := requiredIdentifierPtr(input.TableName, "table_name")
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	deviceKeyField, err := requiredIdentifierPtr(input.DeviceKeyField, "device_key_field")
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	timeField, err := requiredIdentifierPtr(input.TimeField, "time_field")
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	valueField, err := optionalIdentifier(input.ValueField, "value_field")
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	deviceKeyValue := OptionalString(input.DeviceKeyValue)
	if deviceKeyValue == nil {
		return nil, nil, nil, nil, nil, apperr.New(apperr.KindInvalidArgument, "device_key_value is required")
	}
	return tableName, deviceKeyField, deviceKeyValue, timeField, valueField, nil
}
func requiredIdentifierPtr(value string, field string) (*string, error) {
	identifier, err := RequiredIdentifier(value, field)
	if err != nil {
		return nil, err
	}
	return &identifier, nil
}
func RequiredIdentifier(value string, field string) (string, error) {
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
func OptionalString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
func NormalizeAdapterConfig(value json.RawMessage) ([]byte, error) {
	if len(value) == 0 {
		return []byte("{}"), nil
	}
	if !json.Valid(value) {
		return nil, apperr.New(apperr.KindInvalidArgument, "adapter_config must be valid JSON")
	}
	var object map[string]any
	if err := json.Unmarshal(value, &object); err != nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "adapter_config must be a JSON object")
	}
	if object == nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "adapter_config must be a JSON object")
	}
	return append([]byte(nil), value...), nil
}
func normalizeQueryConfig(value json.RawMessage) ([]byte, error) {
	return NormalizeAdapterConfig(value)
}
func validateAdapterConfig(adapterCode string, raw []byte) error {
	if adapterCode != AdapterGenericMedia {
		return nil
	}
	cfg, err := parseMediaBindingConfig(raw)
	if err != nil {
		return err
	}
	if _, err := RequiredIdentifier(cfg.ObjectKeyField, "adapter_config.object_key_field"); err != nil {
		return err
	}
	if _, err := optionalIdentifier(cfg.IDField, "adapter_config.id_field"); err != nil {
		return err
	}
	if _, err := optionalIdentifier(cfg.ThumbnailKeyField, "adapter_config.thumbnail_key_field"); err != nil {
		return err
	}
	if _, err := optionalIdentifier(cfg.MediaTypeField, "adapter_config.media_type_field"); err != nil {
		return err
	}
	return nil
}

func isValidDataSourceType(value string) bool {
	switch value {
	case "postgres", "mysql", "clickhouse", "http_api", "file":
		return true
	default:
		return false
	}
}

func sameSourceFamily(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
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
func DataSourceFromSQL(model sqlc.DataSource) DataSource {
	return DataSource{
		ID:           model.ID,
		Name:         model.Name,
		Type:         model.Type,
		SourceFamily: model.SourceFamily,
		DsnSecretRef: model.DsnSecretRef,
		Status:       model.Status,
		CreatedBy:    model.CreatedBy,
		CreatedAt:    pgTime(model.CreatedAt),
		UpdatedAt:    pgTime(model.UpdatedAt),
	}
}
func (s *Service) dataSourceForResponse(ctx context.Context, model sqlc.DataSource) (DataSource, error) {
	result := DataSourceFromSQL(model)
	locked, err := s.Queries.HasDataSourceFamilyReferences(ctx, model.ID)
	if err != nil {
		return DataSource{}, apperr.Wrap(apperr.KindInternal, "check data source family references", err)
	}
	result.SourceFamilyLocked = locked.Bool
	return result, nil
}
func BindingFromSQL(model sqlc.DataStreamBinding) DataStreamBinding {
	return DataStreamBinding{
		ID:                model.ID,
		DataStreamID:      model.DataStreamID,
		DataSourceID:      model.DataSourceID,
		AdapterCode:       model.AdapterCode,
		DatabaseName:      model.DatabaseName,
		SchemaName:        model.SchemaName,
		TableName:         model.TableName,
		DeviceKeyField:    model.DeviceKeyField,
		DeviceKeyValue:    model.DeviceKeyValue,
		TimeField:         model.TimeField,
		ValueField:        model.ValueField,
		PayloadType:       model.PayloadType,
		AdapterConfigJSON: json.RawMessage(model.AdapterConfigJson),
		Status:            model.Status,
		CreatedBy:         model.CreatedBy,
		CreatedAt:         pgTime(model.CreatedAt),
		UpdatedAt:         pgTime(model.UpdatedAt),
	}
}

func DerefString(value *string) string {
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
func MapWriteError(err error, message string) error {
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
func MapNotFoundOrInternal(err error, message string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.New(apperr.KindNotFound, message)
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}
