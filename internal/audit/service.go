package audit

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/httpx"
)

const (
	ActorAnonymous = "anonymous"
	ActorSystem    = "system"
	ActorUser      = "user"

	ResultFailure = "failure"
	ResultSuccess = "success"
)

type Service struct {
	queries *sqlc.Queries
}

type Log struct {
	ID           uuid.UUID  `json:"id"`
	WorkspaceID  *uuid.UUID `json:"workspace_id,omitempty"`
	ActorType    string     `json:"actor_type"`
	ActorID      *uuid.UUID `json:"actor_id,omitempty"`
	Action       string     `json:"action"`
	ResourceType string     `json:"resource_type"`
	ResourceID   *uuid.UUID `json:"resource_id,omitempty"`
	Result       string     `json:"result"`
	Reason       *string    `json:"reason,omitempty"`
	IP           *string    `json:"ip,omitempty"`
	UserAgent    *string    `json:"user_agent,omitempty"`
	RequestID    *string    `json:"request_id,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

type RecordInput struct {
	WorkspaceID  *uuid.UUID
	ActorType    string
	ActorID      *uuid.UUID
	Action       string
	ResourceType string
	ResourceID   *uuid.UUID
	Result       string
	Reason       string
	IP           string
	UserAgent    string
	RequestID    string
}

type ListInput struct {
	WorkspaceID uuid.UUID
	Limit       int32
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{queries: sqlc.New(db)}
}

func (s *Service) Record(ctx context.Context, input RecordInput) (Log, error) {
	if s == nil || s.queries == nil {
		return Log{}, apperr.New(apperr.KindInternal, "audit service is not configured")
	}
	input = normalizeRecordInput(input)
	if input.Action == "" {
		return Log{}, apperr.New(apperr.KindInvalidArgument, "audit action is required")
	}
	if input.ResourceType == "" {
		return Log{}, apperr.New(apperr.KindInvalidArgument, "audit resource_type is required")
	}
	if input.Result != ResultSuccess && input.Result != ResultFailure {
		return Log{}, apperr.New(apperr.KindInvalidArgument, "audit result must be success or failure")
	}

	row, err := s.queries.CreateAuditLog(ctx, sqlc.CreateAuditLogParams{
		WorkspaceID:  input.WorkspaceID,
		ActorType:    input.ActorType,
		ActorID:      input.ActorID,
		Action:       input.Action,
		ResourceType: input.ResourceType,
		ResourceID:   input.ResourceID,
		Result:       input.Result,
		Reason:       nullableTrimmedString(input.Reason),
		Ip:           nullableTrimmedString(input.IP),
		UserAgent:    nullableTrimmedString(input.UserAgent),
		RequestID:    nullableTrimmedString(input.RequestID),
	})
	if err != nil {
		return Log{}, apperr.Wrap(apperr.KindInternal, "write audit log", err)
	}
	return fromSQL(row), nil
}

func (s *Service) ListByWorkspace(ctx context.Context, input ListInput) ([]Log, error) {
	if input.WorkspaceID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}

	rows, err := s.queries.ListAuditLogsByWorkspace(ctx, sqlc.ListAuditLogsByWorkspaceParams{
		WorkspaceID: &input.WorkspaceID,
		Limit:       limit,
	})
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list audit logs", err)
	}

	items := make([]Log, 0, len(rows))
	for _, row := range rows {
		items = append(items, fromSQL(row))
	}
	return items, nil
}

func FromRequest(c *gin.Context, input RecordInput) RecordInput {
	input.IP = c.ClientIP()
	input.UserAgent = c.Request.UserAgent()
	input.RequestID = httpx.RequestIDFromContext(c)
	return input
}

func UserActorID(userID uuid.UUID) *uuid.UUID {
	if userID == uuid.Nil {
		return nil
	}
	return &userID
}

func WorkspaceID(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	return &id
}

func ResourceID(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	return &id
}

func ParseLimit(value string) int32 {
	if strings.TrimSpace(value) == "" {
		return 100
	}
	parsed, err := strconv.ParseInt(value, 10, 32)
	if err != nil {
		return 100
	}
	if parsed < 1 {
		return 100
	}
	if parsed > 500 {
		return 500
	}
	return int32(parsed)
}

func normalizeRecordInput(input RecordInput) RecordInput {
	input.ActorType = strings.TrimSpace(input.ActorType)
	if input.ActorType == "" {
		input.ActorType = ActorAnonymous
	}
	input.Action = strings.TrimSpace(input.Action)
	input.ResourceType = strings.TrimSpace(input.ResourceType)
	input.Result = strings.TrimSpace(input.Result)
	input.Reason = strings.TrimSpace(input.Reason)
	input.IP = strings.TrimSpace(input.IP)
	input.UserAgent = strings.TrimSpace(input.UserAgent)
	input.RequestID = strings.TrimSpace(input.RequestID)
	return input
}

func fromSQL(model sqlc.AuditLog) Log {
	return Log{
		ID:           model.ID,
		WorkspaceID:  model.WorkspaceID,
		ActorType:    model.ActorType,
		ActorID:      model.ActorID,
		Action:       model.Action,
		ResourceType: model.ResourceType,
		ResourceID:   model.ResourceID,
		Result:       model.Result,
		Reason:       model.Reason,
		IP:           model.Ip,
		UserAgent:    model.UserAgent,
		RequestID:    model.RequestID,
		CreatedAt:    pgTime(model.CreatedAt),
	}
}

func nullableTrimmedString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func pgTime(value pgtype.Timestamptz) time.Time {
	if !value.Valid {
		return time.Time{}
	}
	return value.Time
}
