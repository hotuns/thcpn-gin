package notification

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
)

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

type Notification struct {
	ID          uuid.UUID  `json:"id"`
	UserID      uuid.UUID  `json:"user_id"`
	WorkspaceID *uuid.UUID `json:"workspace_id,omitempty"`
	Category    string     `json:"category"`
	Level       string     `json:"level"`
	Title       string     `json:"title"`
	Content     string     `json:"content"`
	ActionURL   *string    `json:"action_url,omitempty"`
	ReadAt      *time.Time `json:"read_at,omitempty"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

type Announcement struct {
	ID           uuid.UUID  `json:"id"`
	Title        string     `json:"title"`
	Content      string     `json:"content"`
	Level        string     `json:"level"`
	AudienceType string     `json:"audience_type"`
	WorkspaceID  *uuid.UUID `json:"workspace_id,omitempty"`
	Status       string     `json:"status"`
	PublishedAt  *time.Time `json:"published_at,omitempty"`
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	CreatedBy    uuid.UUID  `json:"created_by"`
	ReadAt       *time.Time `json:"read_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type NotificationList struct {
	Items       []Notification `json:"items"`
	UnreadCount int            `json:"unread_count"`
}

type AnnouncementList struct {
	Items       []Announcement `json:"items"`
	UnreadCount int            `json:"unread_count"`
}

func (s *Service) List(ctx context.Context, userID uuid.UUID, workspaceID *uuid.UUID, limit int) (NotificationList, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.Query(ctx, `SELECT id,user_id,workspace_id,category,level,title,content,action_url,read_at,expires_at,created_at
		FROM user_notifications WHERE user_id=$1 AND ($2::uuid IS NULL OR workspace_id IS NULL OR workspace_id=$2)
		AND (expires_at IS NULL OR expires_at>now()) ORDER BY created_at DESC LIMIT $3`, userID, workspaceID, limit)
	if err != nil {
		return NotificationList{}, apperr.Wrap(apperr.KindInternal, "list notifications", err)
	}
	defer rows.Close()
	result := NotificationList{Items: []Notification{}}
	for rows.Next() {
		var item Notification
		if err = rows.Scan(&item.ID, &item.UserID, &item.WorkspaceID, &item.Category, &item.Level, &item.Title, &item.Content, &item.ActionURL, &item.ReadAt, &item.ExpiresAt, &item.CreatedAt); err != nil {
			return result, err
		}
		if item.ReadAt == nil {
			result.UnreadCount++
		}
		result.Items = append(result.Items, item)
	}
	return result, rows.Err()
}

func (s *Service) MarkRead(ctx context.Context, userID, id uuid.UUID) error {
	command, err := s.db.Exec(ctx, `UPDATE user_notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2`, id, userID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "mark notification read", err)
	}
	if command.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "notification not found")
	}
	return nil
}

func (s *Service) MarkAllRead(ctx context.Context, userID uuid.UUID, workspaceID *uuid.UUID) error {
	_, err := s.db.Exec(ctx, `UPDATE user_notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL AND ($2::uuid IS NULL OR workspace_id IS NULL OR workspace_id=$2)`, userID, workspaceID)
	return err
}

func (s *Service) ListAnnouncements(ctx context.Context, userID uuid.UUID, workspaceID *uuid.UUID, admin bool) (AnnouncementList, error) {
	where := `a.status='published' AND a.published_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now())
		AND (a.audience_type='all' OR (a.workspace_id=$2 AND EXISTS (
			SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=a.workspace_id AND wm.user_id=$1 AND wm.status='active'
		)))`
	if admin {
		where = `($2::uuid IS NULL OR true)`
	}
	rows, err := s.db.Query(ctx, `SELECT a.id,a.title,a.content,a.level,a.audience_type,a.workspace_id,a.status,a.published_at,a.expires_at,a.created_by,r.read_at,a.created_at,a.updated_at
		FROM system_announcements a LEFT JOIN announcement_reads r ON r.announcement_id=a.id AND r.user_id=$1 WHERE `+where+` ORDER BY COALESCE(a.published_at,a.created_at) DESC`, userID, workspaceID)
	if err != nil {
		return AnnouncementList{}, apperr.Wrap(apperr.KindInternal, "list announcements", err)
	}
	defer rows.Close()
	result := AnnouncementList{Items: []Announcement{}}
	for rows.Next() {
		var item Announcement
		if err = rows.Scan(&item.ID, &item.Title, &item.Content, &item.Level, &item.AudienceType, &item.WorkspaceID, &item.Status, &item.PublishedAt, &item.ExpiresAt, &item.CreatedBy, &item.ReadAt, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return result, err
		}
		if item.ReadAt == nil && item.Status == "published" {
			result.UnreadCount++
		}
		result.Items = append(result.Items, item)
	}
	return result, rows.Err()
}

func (s *Service) MarkAnnouncementRead(ctx context.Context, userID, id uuid.UUID) error {
	_, err := s.db.Exec(ctx, `INSERT INTO announcement_reads(announcement_id,user_id) VALUES($1,$2) ON CONFLICT(announcement_id,user_id) DO NOTHING`, id, userID)
	return err
}

type AnnouncementInput struct {
	Title, Content, Level, AudienceType, Status string
	WorkspaceID                                 *uuid.UUID
	ExpiresAt                                   *time.Time
}

func (s *Service) CreateAnnouncement(ctx context.Context, adminID uuid.UUID, input AnnouncementInput) (Announcement, error) {
	input.Title = strings.TrimSpace(input.Title)
	input.Content = strings.TrimSpace(input.Content)
	if input.Title == "" || input.Content == "" {
		return Announcement{}, apperr.New(apperr.KindInvalidArgument, "title and content are required")
	}
	if input.Level == "" {
		input.Level = "info"
	}
	if input.AudienceType == "" {
		input.AudienceType = "all"
	}
	if input.Status == "" {
		input.Status = "draft"
	}
	var publishedAt *time.Time
	if input.Status == "published" {
		now := time.Now().UTC()
		publishedAt = &now
	}
	var item Announcement
	err := s.db.QueryRow(ctx, `INSERT INTO system_announcements(title,content,level,audience_type,workspace_id,status,published_at,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING id,title,content,level,audience_type,workspace_id,status,published_at,expires_at,created_by,created_at,updated_at`, input.Title, input.Content, input.Level, input.AudienceType, input.WorkspaceID, input.Status, publishedAt, input.ExpiresAt, adminID).Scan(&item.ID, &item.Title, &item.Content, &item.Level, &item.AudienceType, &item.WorkspaceID, &item.Status, &item.PublishedAt, &item.ExpiresAt, &item.CreatedBy, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return item, apperr.Wrap(apperr.KindInvalidArgument, "create announcement", err)
	}
	return item, nil
}

func (s *Service) SetAnnouncementStatus(ctx context.Context, id uuid.UUID, status string) error {
	if status != "draft" && status != "published" && status != "archived" {
		return apperr.New(apperr.KindInvalidArgument, "invalid announcement status")
	}
	command, err := s.db.Exec(ctx, `UPDATE system_announcements SET status=$2,published_at=CASE WHEN $2='published' THEN COALESCE(published_at,now()) ELSE published_at END,updated_at=now() WHERE id=$1`, id, status)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "announcement not found")
	}
	return nil
}

type SendInput struct {
	UserID, WorkspaceID                        *uuid.UUID
	Category, Level, Title, Content, ActionURL string
	ExpiresAt                                  *time.Time
}

func (s *Service) Send(ctx context.Context, input SendInput) (int64, error) {
	if strings.TrimSpace(input.Title) == "" || strings.TrimSpace(input.Content) == "" {
		return 0, apperr.New(apperr.KindInvalidArgument, "title and content are required")
	}
	if (input.UserID == nil) == (input.WorkspaceID == nil) {
		return 0, apperr.New(apperr.KindInvalidArgument, "select exactly one user or workspace")
	}
	if input.Category == "" {
		input.Category = "system"
	}
	if input.Level == "" {
		input.Level = "info"
	}
	if input.UserID != nil {
		command, err := s.db.Exec(ctx, `INSERT INTO user_notifications(user_id,category,level,title,content,action_url,expires_at) VALUES($1,$2,$3,$4,$5,NULLIF($6,''),$7)`, input.UserID, input.Category, input.Level, input.Title, input.Content, input.ActionURL, input.ExpiresAt)
		if err != nil {
			return 0, err
		}
		return command.RowsAffected(), nil
	}
	workspaceID := *input.WorkspaceID
	command, err := s.db.Exec(ctx, `INSERT INTO user_notifications(user_id,workspace_id,category,level,title,content,action_url,expires_at)
		SELECT DISTINCT wm.user_id,$1::uuid,$2::text,$3::text,$4::text,$5::text,NULLIF($6,'')::text,$7::timestamptz FROM workspace_members wm WHERE wm.workspace_id=$1::uuid AND wm.status='active'`, workspaceID, input.Category, input.Level, input.Title, input.Content, input.ActionURL, input.ExpiresAt)
	if err != nil {
		return 0, err
	}
	return command.RowsAffected(), nil
}
