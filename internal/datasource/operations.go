package datasource

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
)

type SourceOperation struct {
	ID           uuid.UUID       `json:"id"`
	DataSourceID uuid.UUID       `json:"data_source_id"`
	DeviceID     *uuid.UUID      `json:"device_id,omitempty"`
	Kind         string          `json:"kind"`
	Status       string          `json:"status"`
	Result       json.RawMessage `json:"result"`
	Error        string          `json:"error,omitempty"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
}

type ConfigWriteState struct {
	OperationID uuid.UUID `json:"operation_id"`
	Source      string    `json:"source"`
	Platform    string    `json:"platform"`
	Device      string    `json:"device"`
}

func (s *Service) beginSourceOperation(ctx context.Context, sourceID uuid.UUID, deviceID *uuid.UUID, kind, status string, request any, actorID uuid.UUID) (uuid.UUID, error) {
	raw, err := json.Marshal(request)
	if err != nil {
		return uuid.Nil, err
	}
	id := uuid.New()
	_, err = s.db.Exec(ctx, `INSERT INTO source_operations(id,data_source_id,device_id,kind,status,request,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)`, id, sourceID, deviceID, kind, status, raw, actorID)
	if err != nil {
		return uuid.Nil, mapWriteError(err, "record source operation")
	}
	return id, nil
}

func (s *Service) finishSourceOperation(id uuid.UUID, status string, result any, operationErr error) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if result == nil {
		result = map[string]any{}
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `UPDATE source_operations SET status=$2,result=$3,error=$4,updated_at=now() WHERE id=$1`, id, status, raw, apperr.MessageOf(operationErr))
	return err
}

func (s *Service) GetSourceOperation(ctx context.Context, id uuid.UUID) (SourceOperation, error) {
	var op SourceOperation
	err := s.db.QueryRow(ctx, `SELECT id,data_source_id,device_id,kind,status,result,error,created_at,updated_at FROM source_operations WHERE id=$1`, id).Scan(&op.ID, &op.DataSourceID, &op.DeviceID, &op.Kind, &op.Status, &op.Result, &op.Error, &op.CreatedAt, &op.UpdatedAt)
	if err != nil {
		return op, mapNotFoundOrInternal(err, "source operation not found")
	}
	return op, nil
}

func (s *Service) ListSourceOperations(ctx context.Context, sourceID uuid.UUID) ([]SourceOperation, error) {
	rows, err := s.db.Query(ctx, `SELECT id,data_source_id,device_id,kind,status,result,error,created_at,updated_at FROM source_operations WHERE data_source_id=$1 ORDER BY created_at DESC LIMIT 50`, sourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []SourceOperation{}
	for rows.Next() {
		var op SourceOperation
		if err := rows.Scan(&op.ID, &op.DataSourceID, &op.DeviceID, &op.Kind, &op.Status, &op.Result, &op.Error, &op.CreatedAt, &op.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, op)
	}
	return items, rows.Err()
}
