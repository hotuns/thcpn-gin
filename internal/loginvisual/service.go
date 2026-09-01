package loginvisual

import (
	"bytes"
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/objectstore"
)

type Service struct {
	db    *pgxpool.Pool
	store objectstore.Store
}
type Visual struct {
	ID               uuid.UUID `json:"id"`
	URL              string    `json:"url"`
	OriginalFilename string    `json:"original_filename"`
	CreatedAt        time.Time `json:"created_at"`
}
type UploadInput struct {
	Filename, ContentType string
	Data                  []byte
}

func NewService(db *pgxpool.Pool, store objectstore.Store) *Service {
	return &Service{db: db, store: store}
}

func (s *Service) List(ctx context.Context) ([]Visual, error) {
	rows, err := s.db.Query(ctx, `SELECT id,original_filename,created_at FROM login_visuals ORDER BY sort_order,created_at`)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list login visuals", err)
	}
	defer rows.Close()
	items := []Visual{}
	for rows.Next() {
		var item Visual
		if err := rows.Scan(&item.ID, &item.OriginalFilename, &item.CreatedAt); err != nil {
			return nil, err
		}
		item.URL = "/api/v1/auth/login-visuals/" + item.ID.String()
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) Upload(ctx context.Context, input UploadInput) (Visual, error) {
	if len(input.Data) == 0 || len(input.Data) > 10<<20 {
		return Visual{}, apperr.New(apperr.KindInvalidArgument, "image must be between 1 byte and 10 MB")
	}
	if input.ContentType != "image/jpeg" && input.ContentType != "image/png" && input.ContentType != "image/webp" {
		return Visual{}, apperr.New(apperr.KindInvalidArgument, "only JPEG, PNG and WebP images are supported")
	}
	id := uuid.New()
	ext := strings.ToLower(filepath.Ext(input.Filename))
	if ext == "" {
		ext = ".img"
	}
	key := fmt.Sprintf("platform/login-visuals/%s%s", id, ext)
	if err := s.store.Put(ctx, objectstore.PutInput{ObjectKey: key, ContentType: input.ContentType, Body: bytes.NewReader(input.Data)}); err != nil {
		return Visual{}, apperr.Wrap(apperr.KindInternal, "store login visual", err)
	}
	var item Visual
	err := s.db.QueryRow(ctx, `INSERT INTO login_visuals(id,object_key,original_filename,content_type,size_bytes,sort_order) VALUES($1,$2,$3,$4,$5,(SELECT COALESCE(max(sort_order),-1)+1 FROM login_visuals)) RETURNING id,original_filename,created_at`, id, key, input.Filename, input.ContentType, len(input.Data)).Scan(&item.ID, &item.OriginalFilename, &item.CreatedAt)
	if err != nil {
		_ = s.store.Delete(ctx, key)
		return Visual{}, apperr.Wrap(apperr.KindInternal, "create login visual", err)
	}
	item.URL = "/api/v1/auth/login-visuals/" + item.ID.String()
	return item, nil
}

func (s *Service) Open(ctx context.Context, id uuid.UUID) (objectstore.GetResult, error) {
	var key, contentType string
	err := s.db.QueryRow(ctx, `SELECT object_key,content_type FROM login_visuals WHERE id=$1`, id).Scan(&key, &contentType)
	if err != nil {
		if err == pgx.ErrNoRows {
			return objectstore.GetResult{}, apperr.New(apperr.KindNotFound, "login visual not found")
		}
		return objectstore.GetResult{}, apperr.Wrap(apperr.KindInternal, "get login visual", err)
	}
	result, err := s.store.Get(ctx, key)
	if err == nil && result.ContentType == "" {
		result.ContentType = contentType
	}
	return result, err
}
func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	var key string
	err := s.db.QueryRow(ctx, `DELETE FROM login_visuals WHERE id=$1 RETURNING object_key`, id).Scan(&key)
	if err != nil {
		if err == pgx.ErrNoRows {
			return apperr.New(apperr.KindNotFound, "login visual not found")
		}
		return apperr.Wrap(apperr.KindInternal, "delete login visual", err)
	}
	return s.store.Delete(ctx, key)
}
