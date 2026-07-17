package deviceprofile

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/objectstore"
)

const (
	MaxImages     = 12
	MaxImageSize  = 10 * 1024 * 1024
	profileURLTTL = 15 * time.Minute
)

type Service struct {
	db     *pgxpool.Pool
	store  objectstore.Store
	signer *objectstore.Signer
}

type Profile struct {
	DeviceID          uuid.UUID      `json:"device_id"`
	Description       *string        `json:"description,omitempty"`
	LocationText      *string        `json:"location_text,omitempty"`
	Latitude          *float64       `json:"latitude,omitempty"`
	Longitude         *float64       `json:"longitude,omitempty"`
	EffectiveLocation *Location      `json:"effective_location,omitempty"`
	LocationSource    string         `json:"location_source"`
	Site              *SiteSummary   `json:"site,omitempty"`
	Images            []ProfileImage `json:"images"`
	CanConfigure      bool           `json:"can_configure"`
	UpdatedBy         *uuid.UUID     `json:"updated_by,omitempty"`
	CreatedAt         *time.Time     `json:"created_at,omitempty"`
	UpdatedAt         *time.Time     `json:"updated_at,omitempty"`
}

type Location struct {
	LocationText *string  `json:"location_text,omitempty"`
	Latitude     *float64 `json:"latitude,omitempty"`
	Longitude    *float64 `json:"longitude,omitempty"`
}

type SiteSummary struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

type ProfileImage struct {
	ID               uuid.UUID `json:"id"`
	DeviceID         uuid.UUID `json:"device_id"`
	OriginalFilename string    `json:"original_filename"`
	ContentType      string    `json:"content_type"`
	SizeBytes        int64     `json:"size_bytes"`
	Width            *int32    `json:"width,omitempty"`
	Height           *int32    `json:"height,omitempty"`
	Caption          *string   `json:"caption,omitempty"`
	SortOrder        int32     `json:"sort_order"`
	IsCover          bool      `json:"is_cover"`
	PreviewURL       string    `json:"preview_url"`
	PreviewExpiresAt time.Time `json:"preview_expires_at"`
	UploadedBy       uuid.UUID `json:"uploaded_by"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type UpdateProfileInput struct {
	DeviceID     uuid.UUID
	Description  *string
	LocationText *string
	Latitude     *float64
	Longitude    *float64
	ActorUserID  uuid.UUID
}

type UploadImageInput struct {
	Filename    string
	ContentType string
	Data        []byte
}

type UpdateImageInput struct {
	DeviceID uuid.UUID
	ImageID  uuid.UUID
	Caption  *string
	IsCover  *bool
}

func NewService(db *pgxpool.Pool, store objectstore.Store, signer *objectstore.Signer) *Service {
	return &Service{db: db, store: store, signer: signer}
}

func (s *Service) Get(ctx context.Context, deviceID uuid.UUID) (Profile, error) {
	q := sqlc.New(s.db)
	if _, err := q.GetDevice(ctx, deviceID); err != nil {
		return Profile{}, mapNotFound(err, "device not found")
	}
	var model *sqlc.DeviceProfile
	row, err := q.GetDeviceProfile(ctx, deviceID)
	if err == nil {
		model = &row
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, apperr.Wrap(apperr.KindInternal, "get device profile", err)
	}
	return s.buildProfile(ctx, q, deviceID, model)
}

func (s *Service) Update(ctx context.Context, input UpdateProfileInput) (Profile, error) {
	if input.DeviceID == uuid.Nil || input.ActorUserID == uuid.Nil {
		return Profile{}, apperr.New(apperr.KindInvalidArgument, "device id and actor user id are required")
	}
	if (input.Latitude == nil) != (input.Longitude == nil) {
		return Profile{}, apperr.New(apperr.KindInvalidArgument, "latitude and longitude must be provided together")
	}
	if input.Latitude != nil && (*input.Latitude < -90 || *input.Latitude > 90) {
		return Profile{}, apperr.New(apperr.KindInvalidArgument, "latitude must be between -90 and 90")
	}
	if input.Longitude != nil && (*input.Longitude < -180 || *input.Longitude > 180) {
		return Profile{}, apperr.New(apperr.KindInvalidArgument, "longitude must be between -180 and 180")
	}
	q := sqlc.New(s.db)
	if _, err := q.GetDevice(ctx, input.DeviceID); err != nil {
		return Profile{}, mapNotFound(err, "device not found")
	}
	description := cleanOptional(input.Description)
	locationText := cleanOptional(input.LocationText)
	row, err := q.UpsertDeviceProfile(ctx, sqlc.UpsertDeviceProfileParams{
		DeviceID: input.DeviceID, Description: description, LocationText: locationText,
		Latitude: pgFloat8(input.Latitude), Longitude: pgFloat8(input.Longitude), UpdatedBy: &input.ActorUserID,
	})
	if err != nil {
		return Profile{}, apperr.Wrap(apperr.KindInternal, "update device profile", err)
	}
	return s.buildProfile(ctx, q, input.DeviceID, &row)
}

func (s *Service) Upload(ctx context.Context, deviceID, actorUserID uuid.UUID, inputs []UploadImageInput) ([]ProfileImage, error) {
	if len(inputs) == 0 {
		return nil, apperr.New(apperr.KindInvalidArgument, "at least one image is required")
	}
	q := sqlc.New(s.db)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "begin image upload", err)
	}
	defer tx.Rollback(ctx)
	tq := q.WithTx(tx)
	if _, err := tq.LockDeviceProfileUploads(ctx, deviceID); err != nil {
		return nil, mapNotFound(err, "device not found")
	}
	count, err := tq.CountDeviceProfileImages(ctx, deviceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "count device profile images", err)
	}
	if count+int64(len(inputs)) > MaxImages {
		return nil, apperr.New(apperr.KindInvalidArgument, fmt.Sprintf("a device can have at most %d profile images", MaxImages))
	}
	uploadedKeys := make([]string, 0, len(inputs))
	cleanup := func() {
		for _, key := range uploadedKeys {
			_ = s.store.Delete(context.Background(), key)
		}
	}
	created := make([]sqlc.DeviceProfileImage, 0, len(inputs))
	for index, input := range inputs {
		if len(input.Data) == 0 || len(input.Data) > MaxImageSize {
			cleanup()
			return nil, apperr.New(apperr.KindInvalidArgument, "image size must be between 1 byte and 10 MB")
		}
		if !allowedContentType(input.ContentType) {
			cleanup()
			return nil, apperr.New(apperr.KindInvalidArgument, "only JPEG, PNG and WebP images are supported")
		}
		imageID := uuid.New()
		key := fmt.Sprintf("device-profiles/%s/%s%s", deviceID, imageID, extensionFor(input.ContentType))
		if err := s.store.Put(ctx, objectstore.PutInput{ObjectKey: key, ContentType: input.ContentType, Body: bytes.NewReader(input.Data)}); err != nil {
			cleanup()
			return nil, err
		}
		uploadedKeys = append(uploadedKeys, key)
		width, height := imageDimensions(input.Data, input.ContentType)
		row, err := tq.CreateDeviceProfileImage(ctx, sqlc.CreateDeviceProfileImageParams{
			DeviceID: deviceID, ObjectKey: key, OriginalFilename: filepath.Base(strings.TrimSpace(input.Filename)),
			ContentType: input.ContentType, SizeBytes: int64(len(input.Data)), Width: width, Height: height,
			SortOrder: int32(count) + int32(index), IsCover: count == 0 && index == 0, UploadedBy: actorUserID,
		})
		if err != nil {
			cleanup()
			return nil, apperr.Wrap(apperr.KindInternal, "create device profile image", err)
		}
		created = append(created, row)
	}
	if err := tx.Commit(ctx); err != nil {
		cleanup()
		return nil, apperr.Wrap(apperr.KindInternal, "commit image upload", err)
	}
	result := make([]ProfileImage, 0, len(created))
	for _, row := range created {
		item, err := s.imageFromSQL(row)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, nil
}

func (s *Service) UpdateImage(ctx context.Context, input UpdateImageInput) (ProfileImage, error) {
	q := sqlc.New(s.db)
	current, err := q.GetDeviceProfileImage(ctx, sqlc.GetDeviceProfileImageParams{ID: input.ImageID, DeviceID: input.DeviceID})
	if err != nil {
		return ProfileImage{}, mapNotFound(err, "device profile image not found")
	}
	isCover := current.IsCover
	if input.IsCover != nil {
		isCover = *input.IsCover
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return ProfileImage{}, apperr.Wrap(apperr.KindInternal, "begin image update", err)
	}
	defer tx.Rollback(ctx)
	tq := q.WithTx(tx)
	if isCover && !current.IsCover {
		if err := tq.ClearDeviceProfileImageCover(ctx, input.DeviceID); err != nil {
			return ProfileImage{}, err
		}
	}
	caption := current.Caption
	if input.Caption != nil {
		caption = cleanOptional(input.Caption)
	}
	row, err := tq.UpdateDeviceProfileImage(ctx, sqlc.UpdateDeviceProfileImageParams{ID: input.ImageID, DeviceID: input.DeviceID, Caption: caption, IsCover: isCover})
	if err != nil {
		return ProfileImage{}, apperr.Wrap(apperr.KindInternal, "update device profile image", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return ProfileImage{}, apperr.Wrap(apperr.KindInternal, "commit image update", err)
	}
	return s.imageFromSQL(row)
}

func (s *Service) Reorder(ctx context.Context, deviceID uuid.UUID, imageIDs []uuid.UUID) ([]ProfileImage, error) {
	q := sqlc.New(s.db)
	current, err := q.ListDeviceProfileImages(ctx, deviceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list device profile images", err)
	}
	if len(current) != len(imageIDs) {
		return nil, apperr.New(apperr.KindInvalidArgument, "image_ids must contain every device profile image")
	}
	expected := make(map[uuid.UUID]struct{}, len(current))
	for _, item := range current {
		expected[item.ID] = struct{}{}
	}
	seen := make(map[uuid.UUID]struct{}, len(imageIDs))
	for _, id := range imageIDs {
		if _, ok := expected[id]; !ok {
			return nil, apperr.New(apperr.KindInvalidArgument, "image_ids contains an unknown image")
		}
		if _, ok := seen[id]; ok {
			return nil, apperr.New(apperr.KindInvalidArgument, "image_ids contains duplicates")
		}
		seen[id] = struct{}{}
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	tq := q.WithTx(tx)
	for index, id := range imageIDs {
		if err := tq.SetDeviceProfileImageOrder(ctx, sqlc.SetDeviceProfileImageOrderParams{ID: id, DeviceID: deviceID, SortOrder: int32(index)}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	profile, err := s.Get(ctx, deviceID)
	return profile.Images, err
}

func (s *Service) DeleteImage(ctx context.Context, deviceID, imageID uuid.UUID) error {
	q := sqlc.New(s.db)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tq := q.WithTx(tx)
	row, err := tq.DeleteDeviceProfileImage(ctx, sqlc.DeleteDeviceProfileImageParams{ID: imageID, DeviceID: deviceID})
	if err != nil {
		return mapNotFound(err, "device profile image not found")
	}
	if row.IsCover {
		if err := tq.PromoteFirstDeviceProfileImageCover(ctx, deviceID); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if err := s.store.Delete(ctx, row.ObjectKey); err != nil {
		return err
	}
	return nil
}

func (s *Service) buildProfile(ctx context.Context, q *sqlc.Queries, deviceID uuid.UUID, model *sqlc.DeviceProfile) (Profile, error) {
	result := Profile{DeviceID: deviceID, LocationSource: "none", Images: []ProfileImage{}}
	if model != nil {
		result.Description = model.Description
		result.LocationText = model.LocationText
		result.Latitude = float64Ptr(model.Latitude)
		result.Longitude = float64Ptr(model.Longitude)
		result.UpdatedBy = model.UpdatedBy
		result.CreatedAt = timePtr(model.CreatedAt)
		result.UpdatedAt = timePtr(model.UpdatedAt)
	}
	customLocation := result.LocationText != nil || result.Latitude != nil || result.Longitude != nil
	if customLocation {
		result.LocationSource = "device"
		result.EffectiveLocation = &Location{LocationText: result.LocationText, Latitude: result.Latitude, Longitude: result.Longitude}
	} else {
		site, err := q.GetDeviceProfileSite(ctx, deviceID)
		if err == nil {
			result.Site = &SiteSummary{ID: site.ID, Name: site.Name}
			lat, lng := float64Ptr(site.Latitude), float64Ptr(site.Longitude)
			if site.LocationText != nil || lat != nil || lng != nil {
				result.LocationSource = "site"
				result.EffectiveLocation = &Location{LocationText: site.LocationText, Latitude: lat, Longitude: lng}
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return Profile{}, apperr.Wrap(apperr.KindInternal, "get device profile site", err)
		}
	}
	rows, err := q.ListDeviceProfileImages(ctx, deviceID)
	if err != nil {
		return Profile{}, apperr.Wrap(apperr.KindInternal, "list device profile images", err)
	}
	for _, row := range rows {
		item, err := s.imageFromSQL(row)
		if err != nil {
			return Profile{}, err
		}
		result.Images = append(result.Images, item)
	}
	return result, nil
}

func (s *Service) imageFromSQL(row sqlc.DeviceProfileImage) (ProfileImage, error) {
	signed, err := s.signer.SignObjectURL(row.ObjectKey, profileURLTTL)
	if err != nil {
		return ProfileImage{}, err
	}
	return ProfileImage{ID: row.ID, DeviceID: row.DeviceID, OriginalFilename: row.OriginalFilename, ContentType: row.ContentType,
		SizeBytes: row.SizeBytes, Width: int32Ptr(row.Width), Height: int32Ptr(row.Height), Caption: row.Caption,
		SortOrder: row.SortOrder, IsCover: row.IsCover, PreviewURL: signed.URL, PreviewExpiresAt: signed.ExpiresAt,
		UploadedBy: row.UploadedBy, CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time}, nil
}

func cleanOptional(value *string) *string {
	if value == nil {
		return nil
	}
	v := strings.TrimSpace(*value)
	if v == "" {
		return nil
	}
	return &v
}
func pgFloat8(value *float64) pgtype.Float8 {
	if value == nil {
		return pgtype.Float8{}
	}
	return pgtype.Float8{Float64: *value, Valid: true}
}
func float64Ptr(value pgtype.Float8) *float64 {
	if !value.Valid {
		return nil
	}
	v := value.Float64
	return &v
}
func int32Ptr(value pgtype.Int4) *int32 {
	if !value.Valid {
		return nil
	}
	v := value.Int32
	return &v
}
func timePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	v := value.Time
	return &v
}
func allowedContentType(value string) bool {
	return value == "image/jpeg" || value == "image/png" || value == "image/webp"
}
func extensionFor(value string) string {
	if value == "image/png" {
		return ".png"
	}
	if value == "image/webp" {
		return ".webp"
	}
	return ".jpg"
}
func imageDimensions(data []byte, contentType string) (pgtype.Int4, pgtype.Int4) {
	if contentType == "image/webp" {
		return pgtype.Int4{}, pgtype.Int4{}
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return pgtype.Int4{}, pgtype.Int4{}
	}
	return pgtype.Int4{Int32: int32(config.Width), Valid: true}, pgtype.Int4{Int32: int32(config.Height), Valid: true}
}
func mapNotFound(err error, message string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.Wrap(apperr.KindNotFound, message, err)
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}
