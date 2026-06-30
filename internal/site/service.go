package site

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

type Site struct {
	ID           uuid.UUID `json:"id"`
	WorkspaceID  uuid.UUID `json:"workspace_id"`
	ProjectID    uuid.UUID `json:"project_id"`
	Name         string    `json:"name"`
	Description  *string   `json:"description,omitempty"`
	LocationText *string   `json:"location_text,omitempty"`
	Latitude     *float64  `json:"latitude,omitempty"`
	Longitude    *float64  `json:"longitude,omitempty"`
	Status       string    `json:"status"`
	CreatedBy    uuid.UUID `json:"created_by"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type CreateInput struct {
	WorkspaceID  uuid.UUID
	ProjectID    uuid.UUID
	Name         string
	Description  string
	LocationText string
	Latitude     *float64
	Longitude    *float64
	ActorUserID  uuid.UUID
}

type ListInput struct {
	WorkspaceID uuid.UUID
	ProjectID   uuid.UUID
}

type UpdateInput struct {
	SiteID       uuid.UUID
	Name         *string
	Description  *string
	LocationText *string
	Latitude     *float64
	Longitude    *float64
	Status       *string
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{queries: sqlc.New(db)}
}

func (s *Service) Create(ctx context.Context, input CreateInput) (Site, error) {
	name := strings.TrimSpace(input.Name)
	if input.WorkspaceID == uuid.Nil {
		return Site{}, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}
	if input.ProjectID == uuid.Nil {
		return Site{}, apperr.New(apperr.KindInvalidArgument, "project id is required")
	}
	if input.ActorUserID == uuid.Nil {
		return Site{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	if name == "" {
		return Site{}, apperr.New(apperr.KindInvalidArgument, "site name is required")
	}
	if err := validateCoordinates(input.Latitude, input.Longitude); err != nil {
		return Site{}, err
	}

	created, err := s.queries.CreateSite(ctx, sqlc.CreateSiteParams{
		WorkspaceID:  input.WorkspaceID,
		ProjectID:    input.ProjectID,
		Name:         name,
		Description:  nullableTrimmedString(input.Description),
		LocationText: nullableTrimmedString(input.LocationText),
		Latitude:     pgFloat8(input.Latitude),
		Longitude:    pgFloat8(input.Longitude),
		CreatedBy:    input.ActorUserID,
	})
	if err != nil {
		return Site{}, mapWriteError(err, "create site")
	}

	return fromSQL(created), nil
}

func (s *Service) Get(ctx context.Context, siteID uuid.UUID) (Site, error) {
	if siteID == uuid.Nil {
		return Site{}, apperr.New(apperr.KindInvalidArgument, "site id is required")
	}

	row, err := s.queries.GetSite(ctx, siteID)
	if err != nil {
		return Site{}, mapNotFoundOrInternal(err, "site not found")
	}

	return fromSQL(row), nil
}

func (s *Service) List(ctx context.Context, input ListInput) ([]Site, error) {
	if input.WorkspaceID == uuid.Nil && input.ProjectID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "workspace_id or project_id is required")
	}

	var (
		rows []sqlc.Site
		err  error
	)
	if input.ProjectID != uuid.Nil {
		rows, err = s.queries.ListSitesByProject(ctx, input.ProjectID)
	} else {
		rows, err = s.queries.ListSitesByWorkspace(ctx, input.WorkspaceID)
	}
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list sites", err)
	}

	items := make([]Site, 0, len(rows))
	for _, row := range rows {
		items = append(items, fromSQL(row))
	}
	return items, nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (Site, error) {
	if input.SiteID == uuid.Nil {
		return Site{}, apperr.New(apperr.KindInvalidArgument, "site id is required")
	}
	if err := validateCoordinates(input.Latitude, input.Longitude); err != nil {
		return Site{}, err
	}

	current, err := s.queries.GetSite(ctx, input.SiteID)
	if err != nil {
		return Site{}, mapNotFoundOrInternal(err, "site not found")
	}

	name := current.Name
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
		if name == "" {
			return Site{}, apperr.New(apperr.KindInvalidArgument, "site name is required")
		}
	}

	description := current.Description
	if input.Description != nil {
		description = nullableTrimmedString(*input.Description)
	}

	locationText := current.LocationText
	if input.LocationText != nil {
		locationText = nullableTrimmedString(*input.LocationText)
	}

	latitude := current.Latitude
	if input.Latitude != nil {
		latitude = pgFloat8(input.Latitude)
	}

	longitude := current.Longitude
	if input.Longitude != nil {
		longitude = pgFloat8(input.Longitude)
	}

	status := current.Status
	if input.Status != nil {
		status = strings.TrimSpace(*input.Status)
		if !isValidSiteStatus(status) {
			return Site{}, apperr.New(apperr.KindInvalidArgument, "invalid site status")
		}
	}

	updated, err := s.queries.UpdateSite(ctx, sqlc.UpdateSiteParams{
		ID:           input.SiteID,
		Name:         name,
		Description:  description,
		LocationText: locationText,
		Latitude:     latitude,
		Longitude:    longitude,
		Status:       status,
	})
	if err != nil {
		return Site{}, mapWriteError(err, "update site")
	}

	return fromSQL(updated), nil
}

func isValidSiteStatus(status string) bool {
	switch status {
	case "active", "archived":
		return true
	default:
		return false
	}
}

func validateCoordinates(latitude *float64, longitude *float64) error {
	if latitude != nil && (*latitude < -90 || *latitude > 90) {
		return apperr.New(apperr.KindInvalidArgument, "latitude must be between -90 and 90")
	}
	if longitude != nil && (*longitude < -180 || *longitude > 180) {
		return apperr.New(apperr.KindInvalidArgument, "longitude must be between -180 and 180")
	}
	return nil
}

func fromSQL(model sqlc.Site) Site {
	return Site{
		ID:           model.ID,
		WorkspaceID:  model.WorkspaceID,
		ProjectID:    model.ProjectID,
		Name:         model.Name,
		Description:  model.Description,
		LocationText: model.LocationText,
		Latitude:     float8Ptr(model.Latitude),
		Longitude:    float8Ptr(model.Longitude),
		Status:       model.Status,
		CreatedBy:    model.CreatedBy,
		CreatedAt:    pgTime(model.CreatedAt),
		UpdatedAt:    pgTime(model.UpdatedAt),
	}
}

func nullableTrimmedString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func pgFloat8(value *float64) pgtype.Float8 {
	if value == nil {
		return pgtype.Float8{}
	}
	return pgtype.Float8{Float64: *value, Valid: true}
}

func float8Ptr(value pgtype.Float8) *float64 {
	if !value.Valid {
		return nil
	}
	return &value.Float64
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
