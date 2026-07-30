package computedstream

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
)

var keyPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,63}$`)

type Service struct {
	db *pgxpool.Pool
}

type Metadata struct {
	ID        uuid.UUID `json:"id"`
	DeviceID  uuid.UUID `json:"device_id"`
	Key       string    `json:"key"`
	Name      string    `json:"name"`
	ValueType string    `json:"value_type"`
	Value     any       `json:"value"`
	Unit      *string   `json:"unit,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type MetadataInput struct {
	Key       string `json:"key"`
	Name      string `json:"name"`
	ValueType string `json:"value_type"`
	Value     any    `json:"value"`
	Unit      string `json:"unit"`
}

type Definition struct {
	DataStreamID           uuid.UUID `json:"data_stream_id"`
	DeviceID               uuid.UUID `json:"device_id"`
	Code                   string    `json:"code"`
	Name                   string    `json:"name"`
	Unit                   *string   `json:"unit,omitempty"`
	Status                 string    `json:"status"`
	Formula                string    `json:"formula"`
	ReferencedStreamCodes  []string  `json:"referenced_stream_codes"`
	ReferencedMetadataKeys []string  `json:"referenced_metadata_keys"`
	Enabled                bool      `json:"enabled"`
	CreatedAt              time.Time `json:"created_at"`
	UpdatedAt              time.Time `json:"updated_at"`
}

type CreateInput struct {
	DeviceID uuid.UUID
	Code     string
	Name     string
	Unit     string
	Formula  string
	Enabled  bool
	ActorID  uuid.UUID
}

type UpdateInput struct {
	DeviceID     uuid.UUID
	DataStreamID uuid.UUID
	Code         *string
	Name         *string
	Unit         *string
	Formula      *string
	Enabled      *bool
	ActorID      uuid.UUID
}

type PreviewInput struct {
	DeviceID uuid.UUID
	Formula  string
	Streams  map[string]float64
	Metadata map[string]float64
}

type PreviewResult struct {
	Value                  float64  `json:"value"`
	ReferencedStreamCodes  []string `json:"referenced_stream_codes"`
	ReferencedMetadataKeys []string `json:"referenced_metadata_keys"`
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (s *Service) ListMetadata(ctx context.Context, deviceID uuid.UUID) ([]Metadata, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, device_id, key, name, value_type, value_json, unit, created_at, updated_at
		FROM device_metadata WHERE device_id = $1 ORDER BY key
	`, deviceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list device metadata", err)
	}
	defer rows.Close()
	items := make([]Metadata, 0)
	for rows.Next() {
		var item Metadata
		var raw []byte
		if err := rows.Scan(&item.ID, &item.DeviceID, &item.Key, &item.Name, &item.ValueType, &raw, &item.Unit, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan device metadata", err)
		}
		if err := json.Unmarshal(raw, &item.Value); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "decode device metadata", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) NumericMetadata(ctx context.Context, deviceID uuid.UUID) (map[string]float64, error) {
	items, err := s.ListMetadata(ctx, deviceID)
	if err != nil {
		return nil, err
	}
	result := make(map[string]float64)
	for _, item := range items {
		if item.ValueType != "number" {
			continue
		}
		if value, ok := item.Value.(float64); ok {
			result[item.Key] = value
		}
	}
	return result, nil
}

func (s *Service) ReplaceMetadata(ctx context.Context, deviceID, actorID uuid.UUID, inputs []MetadataInput) ([]Metadata, error) {
	if deviceID == uuid.Nil || actorID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "device_id and actor_id are required")
	}
	normalized := make([]MetadataInput, 0, len(inputs))
	keys := make(map[string]struct{}, len(inputs))
	for _, input := range inputs {
		item, err := normalizeMetadata(input)
		if err != nil {
			return nil, err
		}
		if _, exists := keys[item.Key]; exists {
			return nil, apperr.New(apperr.KindInvalidArgument, "metadata keys must be unique")
		}
		keys[item.Key] = struct{}{}
		normalized = append(normalized, item)
	}
	definitions, err := s.ListDefinitions(ctx, deviceID)
	if err != nil {
		return nil, err
	}
	for _, definition := range definitions {
		for _, key := range definition.ReferencedMetadataKeys {
			input, exists := findMetadata(normalized, key)
			if !exists || input.ValueType != "number" {
				return nil, apperr.New(apperr.KindConflict, fmt.Sprintf("metadata %s is required by computed stream %s", key, definition.Code))
			}
		}
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "begin replace metadata", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM device_metadata WHERE device_id = $1`, deviceID); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "clear device metadata", err)
	}
	for _, item := range normalized {
		raw, _ := json.Marshal(item.Value)
		if _, err := tx.Exec(ctx, `
			INSERT INTO device_metadata (device_id, key, name, value_type, value_json, unit, created_by, updated_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
		`, deviceID, item.Key, item.Name, item.ValueType, raw, nullable(item.Unit), actorID); err != nil {
			return nil, mapWriteError(err, "replace device metadata")
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "commit replace metadata", err)
	}
	return s.ListMetadata(ctx, deviceID)
}

func (s *Service) ListDefinitions(ctx context.Context, deviceID uuid.UUID) ([]Definition, error) {
	rows, err := s.db.Query(ctx, definitionSelect+` WHERE ds.device_id = $1 ORDER BY ds.created_at, ds.id`, deviceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list computed data streams", err)
	}
	defer rows.Close()
	items := make([]Definition, 0)
	for rows.Next() {
		item, err := scanDefinition(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) Definition(ctx context.Context, dataStreamID uuid.UUID) (Definition, bool, error) {
	item, err := scanDefinition(s.db.QueryRow(ctx, definitionSelect+` WHERE cds.data_stream_id = $1`, dataStreamID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Definition{}, false, nil
	}
	if err != nil {
		return Definition{}, false, err
	}
	return item, true, nil
}

func (s *Service) DefinitionMap(ctx context.Context, deviceID uuid.UUID) (map[uuid.UUID]Definition, error) {
	items, err := s.ListDefinitions(ctx, deviceID)
	if err != nil {
		return nil, err
	}
	result := make(map[uuid.UUID]Definition, len(items))
	for _, item := range items {
		result[item.DataStreamID] = item
	}
	return result, nil
}

func (s *Service) Create(ctx context.Context, input CreateInput) (Definition, error) {
	code, name := strings.TrimSpace(input.Code), strings.TrimSpace(input.Name)
	if input.DeviceID == uuid.Nil || input.ActorID == uuid.Nil || !keyPattern.MatchString(code) || name == "" {
		return Definition{}, apperr.New(apperr.KindInvalidArgument, "device_id, actor_id, valid code and name are required")
	}
	if _, err := s.validateFormula(ctx, input.DeviceID, input.Formula); err != nil {
		return Definition{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Definition{}, apperr.Wrap(apperr.KindInternal, "begin create computed stream", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var streamID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO data_streams (device_id, code, name, type, unit, status, created_by, created_by_type)
		VALUES ($1,$2,$3,'telemetry',$4,$5,$6,'user') RETURNING id
	`, input.DeviceID, code, name, nullable(input.Unit), enabledStatus(input.Enabled), input.ActorID).Scan(&streamID)
	if err != nil {
		return Definition{}, mapWriteError(err, "create computed data stream")
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO computed_data_streams (data_stream_id, formula, created_by, updated_by)
		VALUES ($1,$2,$3,$3)
	`, streamID, strings.TrimSpace(input.Formula), input.ActorID)
	if err != nil {
		return Definition{}, mapWriteError(err, "create computed definition")
	}
	if err := tx.Commit(ctx); err != nil {
		return Definition{}, apperr.Wrap(apperr.KindInternal, "commit create computed stream", err)
	}
	item, _, err := s.Definition(ctx, streamID)
	return item, err
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (Definition, error) {
	current, found, err := s.Definition(ctx, input.DataStreamID)
	if err != nil {
		return Definition{}, err
	}
	if !found || current.DeviceID != input.DeviceID {
		return Definition{}, apperr.New(apperr.KindNotFound, "computed data stream not found")
	}
	code, name, unit, formula, enabled := current.Code, current.Name, stringValue(current.Unit), current.Formula, current.Enabled
	if input.Code != nil {
		code = strings.TrimSpace(*input.Code)
	}
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
	}
	if input.Unit != nil {
		unit = strings.TrimSpace(*input.Unit)
	}
	if input.Formula != nil {
		formula = strings.TrimSpace(*input.Formula)
	}
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	if !keyPattern.MatchString(code) || name == "" {
		return Definition{}, apperr.New(apperr.KindInvalidArgument, "valid code and name are required")
	}
	if _, err := s.validateFormula(ctx, input.DeviceID, formula); err != nil {
		return Definition{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Definition{}, apperr.Wrap(apperr.KindInternal, "begin update computed stream", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		UPDATE data_streams SET code=$2,name=$3,unit=$4,status=$5,updated_at=now() WHERE id=$1
	`, input.DataStreamID, code, name, nullable(unit), enabledStatus(enabled)); err != nil {
		return Definition{}, mapWriteError(err, "update computed data stream")
	}
	if _, err := tx.Exec(ctx, `
		UPDATE computed_data_streams SET formula=$2,updated_by=$3,updated_at=now()
		WHERE data_stream_id=$1
	`, input.DataStreamID, formula, input.ActorID); err != nil {
		return Definition{}, mapWriteError(err, "update computed definition")
	}
	if err := tx.Commit(ctx); err != nil {
		return Definition{}, apperr.Wrap(apperr.KindInternal, "commit update computed stream", err)
	}
	item, _, err := s.Definition(ctx, input.DataStreamID)
	return item, err
}

func (s *Service) Delete(ctx context.Context, deviceID, dataStreamID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `
		DELETE FROM data_streams ds USING computed_data_streams cds
		WHERE ds.id=$1 AND cds.data_stream_id=ds.id AND ds.device_id=$2
	`, dataStreamID, deviceID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete computed data stream", err)
	}
	if tag.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "computed data stream not found")
	}
	return nil
}

func (s *Service) Preview(ctx context.Context, input PreviewInput) (PreviewResult, error) {
	expression, err := s.validateFormula(ctx, input.DeviceID, input.Formula)
	if err != nil {
		return PreviewResult{}, err
	}
	metadata, err := s.NumericMetadata(ctx, input.DeviceID)
	if err != nil {
		return PreviewResult{}, err
	}
	for key, value := range input.Metadata {
		metadata[key] = value
	}
	value, err := expression.Evaluate(input.Streams, metadata)
	if err != nil {
		return PreviewResult{}, apperr.New(apperr.KindInvalidArgument, err.Error())
	}
	return PreviewResult{Value: value, ReferencedStreamCodes: expression.StreamCodes(), ReferencedMetadataKeys: expression.MetadataKeys()}, nil
}

func (s *Service) CompileDefinition(definition Definition) (Expression, error) {
	return Compile(definition.Formula)
}

func (s *Service) validateFormula(ctx context.Context, deviceID uuid.UUID, formula string) (Expression, error) {
	expression, err := Compile(strings.TrimSpace(formula))
	if err != nil {
		return Expression{}, apperr.New(apperr.KindInvalidArgument, err.Error())
	}
	if len(expression.StreamCodes()) == 0 {
		return Expression{}, apperr.New(apperr.KindInvalidArgument, "formula must reference at least one stream")
	}
	if err := s.validateStreamCodes(ctx, deviceID, expression.StreamCodes()); err != nil {
		return Expression{}, err
	}
	if err := s.validateMetadataKeys(ctx, deviceID, expression.MetadataKeys()); err != nil {
		return Expression{}, err
	}
	return expression, nil
}

func (s *Service) validateStreamCodes(ctx context.Context, deviceID uuid.UUID, codes []string) error {
	rows, err := s.db.Query(ctx, `
		SELECT ds.code FROM data_streams ds
		LEFT JOIN computed_data_streams cds ON cds.data_stream_id=ds.id
		WHERE ds.device_id=$1 AND ds.code=ANY($2::text[]) AND ds.type='telemetry'
			AND ds.status='active' AND cds.data_stream_id IS NULL
	`, deviceID, codes)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "validate formula streams", err)
	}
	defer rows.Close()
	found := map[string]struct{}{}
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan formula stream", err)
		}
		found[code] = struct{}{}
	}
	for _, code := range codes {
		if _, ok := found[code]; !ok {
			return apperr.New(apperr.KindInvalidArgument, "unknown or computed stream."+code)
		}
	}
	return nil
}

func (s *Service) validateMetadataKeys(ctx context.Context, deviceID uuid.UUID, keys []string) error {
	if len(keys) == 0 {
		return nil
	}
	rows, err := s.db.Query(ctx, `SELECT key FROM device_metadata WHERE device_id=$1 AND key=ANY($2::text[]) AND value_type='number'`, deviceID, keys)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "validate formula metadata", err)
	}
	defer rows.Close()
	found := map[string]struct{}{}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan formula metadata", err)
		}
		found[key] = struct{}{}
	}
	for _, key := range keys {
		if _, ok := found[key]; !ok {
			return apperr.New(apperr.KindInvalidArgument, "unknown or non-numeric meta."+key)
		}
	}
	return nil
}

const definitionSelect = `
	SELECT cds.data_stream_id,ds.device_id,ds.code,ds.name,ds.unit,ds.status,
		cds.formula,cds.created_at,cds.updated_at
	FROM computed_data_streams cds JOIN data_streams ds ON ds.id=cds.data_stream_id
`

type scanner interface {
	Scan(...any) error
}

func scanDefinition(row scanner) (Definition, error) {
	var item Definition
	err := row.Scan(&item.DataStreamID, &item.DeviceID, &item.Code, &item.Name, &item.Unit, &item.Status,
		&item.Formula, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Definition{}, err
		}
		return Definition{}, apperr.Wrap(apperr.KindInternal, "scan computed data stream", err)
	}
	expression, err := Compile(item.Formula)
	if err != nil {
		return Definition{}, apperr.Wrap(apperr.KindInternal, "compile stored computed data stream", err)
	}
	item.ReferencedStreamCodes = expression.StreamCodes()
	item.ReferencedMetadataKeys = expression.MetadataKeys()
	item.Enabled = item.Status == "active"
	return item, nil
}

func normalizeMetadata(input MetadataInput) (MetadataInput, error) {
	input.Key, input.Name, input.Unit = strings.TrimSpace(input.Key), strings.TrimSpace(input.Name), strings.TrimSpace(input.Unit)
	if !keyPattern.MatchString(input.Key) || input.Name == "" {
		return MetadataInput{}, apperr.New(apperr.KindInvalidArgument, "metadata requires a valid key and name")
	}
	switch input.ValueType {
	case "number":
		value, ok := input.Value.(float64)
		if !ok || !isFinite(value) {
			return MetadataInput{}, apperr.New(apperr.KindInvalidArgument, "number metadata requires a finite numeric value")
		}
	case "string":
		if _, ok := input.Value.(string); !ok {
			return MetadataInput{}, apperr.New(apperr.KindInvalidArgument, "string metadata requires a string value")
		}
	case "boolean":
		if _, ok := input.Value.(bool); !ok {
			return MetadataInput{}, apperr.New(apperr.KindInvalidArgument, "boolean metadata requires a boolean value")
		}
	default:
		return MetadataInput{}, apperr.New(apperr.KindInvalidArgument, "invalid metadata value_type")
	}
	return input, nil
}

func findMetadata(items []MetadataInput, key string) (MetadataInput, bool) {
	for _, item := range items {
		if item.Key == key {
			return item, true
		}
	}
	return MetadataInput{}, false
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

func nullable(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
func enabledStatus(enabled bool) string {
	if enabled {
		return "active"
	}
	return "disabled"
}
