package audit

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/httpx"
)

const (
	ActorAnonymous   = "anonymous"
	ActorSystem      = "system"
	ActorSystemAdmin = "system_admin"
	ActorUser        = "user"

	ResultFailure = "failure"
	ResultSuccess = "success"
)

type Service struct {
	db *pgxpool.Pool
}

type Log struct {
	ID           uuid.UUID  `json:"id"`
	WorkspaceID  *uuid.UUID `json:"workspace_id,omitempty"`
	ActorType    string     `json:"actor_type"`
	ActorID      *uuid.UUID `json:"actor_id,omitempty"`
	ActorAdminID *uuid.UUID `json:"actor_admin_id,omitempty"`
	ActorName    *string    `json:"actor_name,omitempty"`
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
	ActorAdminID *uuid.UUID
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
	WorkspaceID  uuid.UUID
	Limit        int32
	Page         int
	PageSize     int
	Action       string
	ResourceType string
	Result       string
	ActorType    string
	Start        *time.Time
	End          *time.Time
}

type ListResult struct {
	Items    []Log `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"page_size"`
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (s *Service) Record(ctx context.Context, input RecordInput) (Log, error) {
	if s == nil || s.db == nil {
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

	row := s.db.QueryRow(ctx, `
		INSERT INTO audit_logs (
			workspace_id, actor_type, actor_id, actor_admin_id, action,
			resource_type, resource_id, result, reason, ip, user_agent, request_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING id, workspace_id, actor_type, actor_id, actor_admin_id, action,
			resource_type, resource_id, result, reason, ip, user_agent, request_id, created_at
	`, input.WorkspaceID, input.ActorType, input.ActorID, input.ActorAdminID, input.Action,
		input.ResourceType, input.ResourceID, input.Result, nullableTrimmedString(input.Reason),
		nullableTrimmedString(input.IP), nullableTrimmedString(input.UserAgent), nullableTrimmedString(input.RequestID))
	var result Log
	err := row.Scan(&result.ID, &result.WorkspaceID, &result.ActorType, &result.ActorID, &result.ActorAdminID,
		&result.Action, &result.ResourceType, &result.ResourceID, &result.Result, &result.Reason,
		&result.IP, &result.UserAgent, &result.RequestID, &result.CreatedAt)
	if err != nil {
		return Log{}, apperr.Wrap(apperr.KindInternal, "write audit log", err)
	}
	return result, nil
}

func (s *Service) ListByWorkspace(ctx context.Context, input ListInput) ([]Log, error) {
	result, err := s.ListPageByWorkspace(ctx, input)
	return result.Items, err
}

func (s *Service) ListPageByWorkspace(ctx context.Context, input ListInput) (ListResult, error) {
	if input.WorkspaceID == uuid.Nil {
		return ListResult{}, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}
	page := input.Page
	if page < 1 {
		page = 1
	}
	pageSize := input.PageSize
	if pageSize <= 0 {
		pageSize = int(input.Limit)
	}
	if pageSize <= 0 {
		pageSize = 100
	}
	if pageSize > 500 {
		pageSize = 500
	}

	conditions := []string{"a.workspace_id = $1"}
	args := []any{input.WorkspaceID}
	add := func(condition string, value any) {
		args = append(args, value)
		conditions = append(conditions, fmt.Sprintf(condition, len(args)))
	}
	if value := strings.TrimSpace(input.Action); value != "" {
		add("a.action = $%d", value)
	}
	if value := strings.TrimSpace(input.ResourceType); value != "" {
		add("a.resource_type = $%d", value)
	}
	if value := strings.TrimSpace(input.Result); value != "" {
		add("a.result = $%d", value)
	}
	if value := strings.TrimSpace(input.ActorType); value != "" {
		add("a.actor_type = $%d", value)
	}
	if input.Start != nil {
		add("a.created_at >= $%d", *input.Start)
	}
	if input.End != nil {
		add("a.created_at < $%d", *input.End)
	}
	where := strings.Join(conditions, " AND ")
	var total int64
	if err := s.db.QueryRow(ctx, "SELECT count(*) FROM audit_logs a WHERE "+where, args...).Scan(&total); err != nil {
		return ListResult{}, apperr.Wrap(apperr.KindInternal, "count audit logs", err)
	}
	args = append(args, pageSize, (page-1)*pageSize)
	query := fmt.Sprintf(`
		SELECT a.id, a.workspace_id, a.actor_type, a.actor_id, a.actor_admin_id,
			COALESCE(sa.name, u.name), a.action, a.resource_type, a.resource_id,
			a.result, a.reason, a.ip, a.user_agent, a.request_id, a.created_at
		FROM audit_logs a
		LEFT JOIN users u ON u.id = a.actor_id
		LEFT JOIN system_admins sa ON sa.id = a.actor_admin_id
		WHERE %s
		ORDER BY a.created_at DESC, a.id DESC
		LIMIT $%d OFFSET $%d
	`, where, len(args)-1, len(args))
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return ListResult{}, apperr.Wrap(apperr.KindInternal, "list audit logs", err)
	}
	defer rows.Close()

	items := make([]Log, 0, pageSize)
	for rows.Next() {
		var item Log
		if err := rows.Scan(&item.ID, &item.WorkspaceID, &item.ActorType, &item.ActorID, &item.ActorAdminID,
			&item.ActorName, &item.Action, &item.ResourceType, &item.ResourceID, &item.Result,
			&item.Reason, &item.IP, &item.UserAgent, &item.RequestID, &item.CreatedAt); err != nil {
			return ListResult{}, apperr.Wrap(apperr.KindInternal, "scan audit log", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return ListResult{}, apperr.Wrap(apperr.KindInternal, "list audit logs", err)
	}
	return ListResult{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func FromRequest(c *gin.Context, input RecordInput) RecordInput {
	if value, ok := c.Get("actor"); ok {
		if actor, ok := value.(interface {
			IsSystemAdministrator() bool
			SystemAdministratorID() uuid.UUID
		}); ok && actor.IsSystemAdministrator() {
			input.ActorType = ActorSystemAdmin
			input.ActorID = nil
			input.ActorAdminID = UserActorID(actor.SystemAdministratorID())
		}
	}
	if reason, ok := c.Get("admin_operation_reason"); ok {
		operationReason, _ := reason.(string)
		if input.Reason == "" {
			input.Reason = operationReason
		} else if operationReason != "" && operationReason != input.Reason {
			input.Reason = operationReason + ": " + input.Reason
		}
	}
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

func nullableTrimmedString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
