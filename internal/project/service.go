package project

import (
	"context"
	"errors"
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

type Service struct {
	queries *sqlc.Queries
}

type Project struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspace_id"`
	Name        string    `json:"name"`
	Description *string   `json:"description,omitempty"`
	Status      string    `json:"status"`
	CreatedBy   uuid.UUID `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type CreateInput struct {
	WorkspaceID uuid.UUID
	Name        string
	Description string
	ActorUserID uuid.UUID
}

type UpdateInput struct {
	ProjectID   uuid.UUID
	Name        *string
	Description *string
	Status      *string
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{queries: sqlc.New(db)}
}

func (s *Service) Create(ctx context.Context, input CreateInput) (Project, error) {
	name := strings.TrimSpace(input.Name)
	if input.WorkspaceID == uuid.Nil {
		return Project{}, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}
	if input.ActorUserID == uuid.Nil {
		return Project{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	if name == "" {
		return Project{}, apperr.New(apperr.KindInvalidArgument, "project name is required")
	}

	created, err := s.queries.CreateProject(ctx, sqlc.CreateProjectParams{
		WorkspaceID: input.WorkspaceID,
		Name:        name,
		Description: nullableTrimmedString(input.Description),
		CreatedBy:   input.ActorUserID,
	})
	if err != nil {
		return Project{}, mapWriteError(err, "create project")
	}

	return fromSQL(created), nil
}

func (s *Service) Get(ctx context.Context, projectID uuid.UUID) (Project, error) {
	if projectID == uuid.Nil {
		return Project{}, apperr.New(apperr.KindInvalidArgument, "project id is required")
	}

	row, err := s.queries.GetProject(ctx, projectID)
	if err != nil {
		return Project{}, mapNotFoundOrInternal(err, "project not found")
	}

	return fromSQL(row), nil
}

func (s *Service) List(ctx context.Context, workspaceID uuid.UUID) ([]Project, error) {
	if workspaceID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}

	rows, err := s.queries.ListProjectsByWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list projects", err)
	}

	items := make([]Project, 0, len(rows))
	for _, row := range rows {
		items = append(items, fromSQL(row))
	}
	return items, nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (Project, error) {
	if input.ProjectID == uuid.Nil {
		return Project{}, apperr.New(apperr.KindInvalidArgument, "project id is required")
	}

	current, err := s.queries.GetProject(ctx, input.ProjectID)
	if err != nil {
		return Project{}, mapNotFoundOrInternal(err, "project not found")
	}

	name := current.Name
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
		if name == "" {
			return Project{}, apperr.New(apperr.KindInvalidArgument, "project name is required")
		}
	}

	description := current.Description
	if input.Description != nil {
		description = nullableTrimmedString(*input.Description)
	}

	status := current.Status
	if input.Status != nil {
		status = strings.TrimSpace(*input.Status)
		if !isValidProjectStatus(status) {
			return Project{}, apperr.New(apperr.KindInvalidArgument, "invalid project status")
		}
	}

	updated, err := s.queries.UpdateProject(ctx, sqlc.UpdateProjectParams{
		ID:          input.ProjectID,
		Name:        name,
		Description: description,
		Status:      status,
	})
	if err != nil {
		return Project{}, mapWriteError(err, "update project")
	}

	return fromSQL(updated), nil
}

func isValidProjectStatus(status string) bool {
	switch status {
	case "active", "archived":
		return true
	default:
		return false
	}
}

func fromSQL(model sqlc.Project) Project {
	return Project{
		ID:          model.ID,
		WorkspaceID: model.WorkspaceID,
		Name:        model.Name,
		Description: model.Description,
		Status:      model.Status,
		CreatedBy:   model.CreatedBy,
		CreatedAt:   pgTime(model.CreatedAt),
		UpdatedAt:   pgTime(model.UpdatedAt),
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
