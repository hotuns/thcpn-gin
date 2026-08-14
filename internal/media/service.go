package media

import (
	"context"
	"errors"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/billing"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/objectstore"
)

const mediaURLTTL = 15 * time.Minute

const (
	mediaThumbnailProcess = "image/resize,w_480/quality,Q_70/format,webp"
	mediaPreviewProcess   = "image/resize,w_1600/quality,Q_75/format,webp"
)

type Runtime interface {
	QueryMedia(ctx context.Context, source datasource.DataSource, req datasource.MediaQuery) (datasource.MediaResult, error)
}

type Service struct {
	queries     *sqlc.Queries
	dataSources *datasource.Service
	runtime     Runtime
	signer      *objectstore.Signer
	store       objectstore.Store
	limits      config.QueryLimitsConfig
	billing     *billing.Service
}

func (s *Service) SetBilling(service *billing.Service) { s.billing = service }

type QueryInput struct {
	DeviceID        *uuid.UUID
	DataStreamID    *uuid.UUID
	MediaType       string
	StartTime       time.Time
	EndTime         time.Time
	Page            int
	PageSize        int
	DownloadAllowed bool
	DeleteAllowed   bool
}

type ListResult struct {
	Items    []Item `json:"items"`
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
	Total    int    `json:"total"`
}

type Item struct {
	ID              string    `json:"id"`
	DeviceID        uuid.UUID `json:"device_id"`
	DataStreamID    uuid.UUID `json:"data_stream_id"`
	CapturedAt      time.Time `json:"captured_at"`
	MediaType       string    `json:"media_type"`
	ThumbnailURL    string    `json:"thumbnail_url,omitempty"`
	PreviewURL      string    `json:"preview_url"`
	DownloadAllowed bool      `json:"download_allowed"`
	DownloadURL     *string   `json:"download_url,omitempty"`
	DeleteAllowed   bool      `json:"delete_allowed"`
	DeleteURL       *string   `json:"delete_url,omitempty"`
}

type DownloadResult struct {
	DataStreamID uuid.UUID `json:"data_stream_id"`
	DeviceID     uuid.UUID `json:"device_id"`
	WorkspaceID  uuid.UUID `json:"-"`
	MediaID      string    `json:"media_id"`
	MediaType    string    `json:"media_type"`
	URL          string    `json:"url"`
	ExpiresAt    time.Time `json:"expires_at"`
}

type DeleteResult struct {
	DataStreamID uuid.UUID `json:"data_stream_id"`
	DeviceID     uuid.UUID `json:"device_id"`
	WorkspaceID  uuid.UUID `json:"-"`
	MediaID      string    `json:"media_id"`
	MediaType    string    `json:"media_type"`
	Deleted      bool      `json:"deleted"`
}

type MediaTarget struct {
	DataStreamID uuid.UUID
	DeviceID     uuid.UUID
	WorkspaceID  uuid.UUID
	MediaID      string
	MediaType    string
	ObjectKey    string
}

func NewService(db *pgxpool.Pool, dataSources *datasource.Service, runtime Runtime, signer *objectstore.Signer, limits config.QueryLimitsConfig, stores ...objectstore.Store) *Service {
	if dataSources == nil {
		dataSources = datasource.NewService(db)
	}
	if runtime == nil {
		runtime = datasource.NewRuntime(nil)
	}
	var store objectstore.Store
	if len(stores) > 0 {
		store = stores[0]
	}
	return &Service{
		queries:     sqlc.New(db),
		dataSources: dataSources,
		runtime:     runtime,
		signer:      signer,
		store:       store,
		limits:      normalizeLimits(limits),
	}
}

func (s *Service) List(ctx context.Context, input QueryInput) (ListResult, error) {
	if input.DeviceID == nil && input.DataStreamID == nil {
		return ListResult{}, apperr.New(apperr.KindInvalidArgument, "device_id or data_stream_id is required")
	}
	page, pageSize, err := normalizePage(input.Page, input.PageSize, s.limits)
	if err != nil {
		return ListResult{}, err
	}
	if err := validateTimeRange(input.StartTime, input.EndTime, s.limits); err != nil {
		return ListResult{}, err
	}
	if input.DataStreamID != nil {
		return s.listDataStream(ctx, *input.DataStreamID, input.DeviceID, input.MediaType, input.StartTime, input.EndTime, page, pageSize, input.DownloadAllowed, input.DeleteAllowed)
	}
	return s.listDevice(ctx, *input.DeviceID, input.MediaType, input.StartTime, input.EndTime, page, pageSize, input.DownloadAllowed, input.DeleteAllowed)
}

func (s *Service) PrepareDownload(ctx context.Context, token string, actorIDs ...uuid.UUID) (DownloadResult, error) {
	actorID := uuid.Nil
	if len(actorIDs) > 0 {
		actorID = actorIDs[0]
	}
	target, err := s.ResolveMediaToken(ctx, token)
	if err != nil {
		return DownloadResult{}, err
	}
	if s.signer == nil {
		return DownloadResult{}, apperr.New(apperr.KindInternal, "object store signer is not configured")
	}
	if s.billing != nil {
		if err := s.billing.RequireProfessional(ctx, target.WorkspaceID); err != nil {
			return DownloadResult{}, err
		}
		if s.store == nil {
			return DownloadResult{}, apperr.New(apperr.KindInternal, "object store is not configured")
		}
		info, err := objectstore.Stat(ctx, s.store, target.ObjectKey)
		if err != nil {
			return DownloadResult{}, err
		}
		resourceID := target.DataStreamID
		if info.SizeBytes <= 0 {
			return DownloadResult{}, apperr.New(apperr.KindConflict, "media object size is unavailable")
		}
		var actorUserID *uuid.UUID
		if actorID != uuid.Nil {
			actorUserID = &actorID
		}
		if err = s.billing.ReserveDownload(ctx, billing.ReserveDownloadInput{WorkspaceID: target.WorkspaceID, SourceType: "media", ResourceID: &resourceID, ObjectKey: target.ObjectKey, Bytes: info.SizeBytes, ActorUserID: actorUserID, IdempotencyKey: "media:" + target.MediaID + ":" + uuid.NewString()}); err != nil {
			return DownloadResult{}, err
		}
	}
	mediaURL, external := externalMediaURL(target.ObjectKey)
	expiresAt := time.Now().Add(mediaURLTTL)
	if !external {
		signed, err := s.signer.SignObjectURL(target.ObjectKey, mediaURLTTL)
		if err != nil {
			return DownloadResult{}, err
		}
		mediaURL = signed.URL
		expiresAt = signed.ExpiresAt
	}
	return DownloadResult{
		DataStreamID: target.DataStreamID,
		DeviceID:     target.DeviceID,
		WorkspaceID:  target.WorkspaceID,
		MediaID:      target.MediaID,
		MediaType:    target.MediaType,
		URL:          mediaURL,
		ExpiresAt:    expiresAt,
	}, nil
}

func (s *Service) ResolveMediaToken(ctx context.Context, token string) (MediaTarget, error) {
	if s.signer == nil {
		return MediaTarget{}, apperr.New(apperr.KindInternal, "object store signer is not configured")
	}
	claims, err := s.signer.VerifyDownloadToken(token)
	if err != nil {
		return MediaTarget{}, err
	}
	stream, err := s.queries.GetDataStream(ctx, claims.DataStreamID)
	if err != nil {
		return MediaTarget{}, mapNotFoundOrInternal(err, "data stream not found")
	}
	if stream.DeviceID != claims.DeviceID {
		return MediaTarget{}, apperr.New(apperr.KindInvalidArgument, "media token does not match data stream")
	}
	assignment, err := s.queries.GetActiveDeviceAssignmentByDataStream(ctx, stream.ID)
	if err != nil {
		return MediaTarget{}, mapNotFoundOrInternal(err, "active device assignment not found")
	}
	return MediaTarget{
		DataStreamID: claims.DataStreamID,
		DeviceID:     claims.DeviceID,
		WorkspaceID:  assignment.WorkspaceID,
		MediaID:      claims.MediaID,
		MediaType:    claims.MediaType,
		ObjectKey:    claims.ObjectKey,
	}, nil
}

func (s *Service) DeleteMediaObject(ctx context.Context, target MediaTarget) (DeleteResult, error) {
	if s.store == nil {
		return DeleteResult{}, apperr.New(apperr.KindInternal, "object store is not configured")
	}
	if target.DataStreamID == uuid.Nil || target.DeviceID == uuid.Nil {
		return DeleteResult{}, apperr.New(apperr.KindInvalidArgument, "media target is required")
	}
	if err := s.store.Delete(ctx, target.ObjectKey); err != nil {
		return DeleteResult{}, err
	}
	return DeleteResult{
		DataStreamID: target.DataStreamID,
		DeviceID:     target.DeviceID,
		WorkspaceID:  target.WorkspaceID,
		MediaID:      target.MediaID,
		MediaType:    target.MediaType,
		Deleted:      true,
	}, nil
}

func (s *Service) listDevice(ctx context.Context, deviceID uuid.UUID, mediaType string, start time.Time, end time.Time, page int, pageSize int, downloadAllowed bool, deleteAllowed bool) (ListResult, error) {
	if deviceID == uuid.Nil {
		return ListResult{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}
	device, err := s.queries.GetDevice(ctx, deviceID)
	if err != nil {
		return ListResult{}, mapNotFoundOrInternal(err, "device not found")
	}
	_ = device
	assignment, err := s.queries.GetActiveDeviceAssignment(ctx, deviceID)
	if err != nil {
		return ListResult{}, mapNotFoundOrInternal(err, "active device assignment not found")
	}
	downloadAllowed, err = s.professionalDownloadAllowed(ctx, assignment.WorkspaceID, downloadAllowed)
	if err != nil {
		return ListResult{}, err
	}
	streams, err := s.queries.ListDataStreamsByDevice(ctx, deviceID)
	if err != nil {
		return ListResult{}, apperr.Wrap(apperr.KindInternal, "list data streams", err)
	}

	items := make([]Item, 0)
	total := 0
	for _, stream := range streams {
		if !isMediaStreamType(stream.Type) || stream.Status != "active" {
			continue
		}
		if mediaType != "" && stream.Type != mediaType {
			continue
		}
		result, err := s.queryStream(ctx, stream, start, end, 1, s.limits.MaxMediaPageSize, downloadAllowed, deleteAllowed)
		if err != nil {
			return ListResult{}, err
		}
		total += result.Total
		items = append(items, result.Items...)
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].CapturedAt.After(items[j].CapturedAt)
	})
	offset := (page - 1) * pageSize
	if offset > len(items) {
		items = []Item{}
	} else {
		endIndex := offset + pageSize
		if endIndex > len(items) {
			endIndex = len(items)
		}
		items = items[offset:endIndex]
	}
	return ListResult{Items: items, Page: page, PageSize: pageSize, Total: total}, nil
}

func (s *Service) listDataStream(ctx context.Context, dataStreamID uuid.UUID, deviceID *uuid.UUID, mediaType string, start time.Time, end time.Time, page int, pageSize int, downloadAllowed bool, deleteAllowed bool) (ListResult, error) {
	if dataStreamID == uuid.Nil {
		return ListResult{}, apperr.New(apperr.KindInvalidArgument, "data stream id is required")
	}
	stream, err := s.queries.GetDataStream(ctx, dataStreamID)
	if err != nil {
		return ListResult{}, mapNotFoundOrInternal(err, "data stream not found")
	}
	if deviceID != nil && *deviceID != stream.DeviceID {
		return ListResult{}, apperr.New(apperr.KindInvalidArgument, "data stream does not belong to device")
	}
	if !isMediaStreamType(stream.Type) {
		return ListResult{}, apperr.New(apperr.KindInvalidArgument, "data stream is not media")
	}
	if mediaType != "" && stream.Type != mediaType {
		return ListResult{}, apperr.New(apperr.KindInvalidArgument, "data stream media type does not match")
	}
	if stream.Status != "active" {
		return ListResult{}, apperr.New(apperr.KindInvalidArgument, "data stream is not active")
	}
	assignment, err := s.queries.GetActiveDeviceAssignmentByDataStream(ctx, dataStreamID)
	if err != nil {
		return ListResult{}, mapNotFoundOrInternal(err, "active device assignment not found")
	}
	downloadAllowed, err = s.professionalDownloadAllowed(ctx, assignment.WorkspaceID, downloadAllowed)
	if err != nil {
		return ListResult{}, err
	}
	return s.queryStream(ctx, stream, start, end, page, pageSize, downloadAllowed, deleteAllowed)
}

func (s *Service) professionalDownloadAllowed(ctx context.Context, workspaceID uuid.UUID, allowed bool) (bool, error) {
	if !allowed || s.billing == nil {
		return allowed, nil
	}
	summary, err := s.billing.Summary(ctx, workspaceID)
	if err != nil {
		return false, err
	}
	return summary.Plan == billing.PlanProfessional, nil
}

func (s *Service) queryStream(ctx context.Context, stream sqlc.DataStream, start time.Time, end time.Time, page int, pageSize int, downloadAllowed bool, deleteAllowed bool) (ListResult, error) {
	binding, err := s.dataSources.GetActiveDataStreamBinding(ctx, stream.ID)
	if err != nil {
		return ListResult{}, err
	}
	source, err := s.dataSources.GetDataSource(ctx, binding.DataSourceID)
	if err != nil {
		return ListResult{}, err
	}
	result, err := s.runtime.QueryMedia(ctx, source, datasource.MediaQuery{
		Binding:   binding,
		Start:     start,
		End:       end,
		Page:      page,
		PageSize:  pageSize,
		MediaType: stream.Type,
	})
	if err != nil {
		return ListResult{}, err
	}
	items, err := s.itemsFromDatasource(stream, result.Items, downloadAllowed, deleteAllowed)
	if err != nil {
		return ListResult{}, err
	}
	return ListResult{Items: items, Page: page, PageSize: pageSize, Total: result.Total}, nil
}

func (s *Service) itemsFromDatasource(stream sqlc.DataStream, records []datasource.MediaRecord, downloadAllowed bool, deleteAllowed bool) ([]Item, error) {
	if s.signer == nil {
		return nil, apperr.New(apperr.KindInternal, "object store signer is not configured")
	}
	items := make([]Item, 0, len(records))
	for _, record := range records {
		previewURL := ""
		thumbnailURL := ""
		if record.ThumbnailObjectKey != nil && *record.ThumbnailObjectKey != "" {
			var external bool
			thumbnailURL, external = externalMediaURL(*record.ThumbnailObjectKey)
			if !external {
				thumbnail, err := s.signer.SignObjectURL(*record.ThumbnailObjectKey, mediaURLTTL)
				if err != nil {
					return nil, err
				}
				thumbnailURL = thumbnail.URL
			}
		}
		if record.MediaType == "image" {
			previewURL, _ = externalOSSImagePreviewURL(record.ObjectKey, mediaPreviewProcess)
			if previewURL == "" {
				if preview, err := s.signer.SignImagePreviewURL(record.ObjectKey, mediaPreviewProcess, mediaURLTTL); err == nil {
					previewURL = preview.URL
				}
			}
			if previewURL == "" {
				previewURL = thumbnailURL
			}
			thumbnailURL, _ = externalOSSImagePreviewURL(record.ObjectKey, mediaThumbnailProcess)
			if thumbnailURL == "" {
				if thumbnail, err := s.signer.SignImagePreviewURL(record.ObjectKey, mediaThumbnailProcess, mediaURLTTL); err == nil {
					thumbnailURL = thumbnail.URL
				}
			}
			if thumbnailURL == "" {
				thumbnailURL = previewURL
			}
			if previewURL == "" {
				continue
			}
		} else {
			previewURL, _ = externalMediaURL(record.ObjectKey)
			if previewURL == "" {
				preview, err := s.signer.SignObjectURL(record.ObjectKey, mediaURLTTL)
				if err != nil {
					return nil, err
				}
				previewURL = preview.URL
			}
			if thumbnailURL == "" {
				thumbnailURL = previewURL
			}
		}
		item := Item{
			ID:              record.ID,
			DeviceID:        stream.DeviceID,
			DataStreamID:    stream.ID,
			CapturedAt:      record.CapturedAt,
			MediaType:       record.MediaType,
			ThumbnailURL:    thumbnailURL,
			PreviewURL:      previewURL,
			DownloadAllowed: downloadAllowed,
			DeleteAllowed:   deleteAllowed,
		}
		if downloadAllowed {
			token, _, err := s.signer.SignDownloadToken(objectstore.DownloadTokenClaims{
				DataStreamID: stream.ID,
				DeviceID:     stream.DeviceID,
				MediaID:      record.ID,
				ObjectKey:    record.ObjectKey,
				MediaType:    record.MediaType,
			}, mediaURLTTL)
			if err != nil {
				return nil, err
			}
			downloadURL := "/api/v1/media/download?token=" + token
			item.DownloadURL = &downloadURL
		}
		if deleteAllowed {
			token, _, err := s.signer.SignDownloadToken(objectstore.DownloadTokenClaims{
				DataStreamID: stream.ID,
				DeviceID:     stream.DeviceID,
				MediaID:      record.ID,
				ObjectKey:    record.ObjectKey,
				MediaType:    record.MediaType,
			}, mediaURLTTL)
			if err != nil {
				return nil, err
			}
			deleteURL := "/api/v1/media?token=" + token
			item.DeleteURL = &deleteURL
		}
		items = append(items, item)
	}
	return items, nil
}

func externalMediaURL(value string) (string, bool) {
	value = strings.TrimSpace(value)
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", false
	}
	return parsed.String(), true
}

func externalOSSImagePreviewURL(value string, process string) (string, bool) {
	value, external := externalMediaURL(value)
	if !external {
		return "", false
	}
	parsed, err := url.Parse(value)
	if err != nil || !strings.HasSuffix(strings.ToLower(parsed.Hostname()), ".aliyuncs.com") {
		return "", false
	}
	query := parsed.Query()
	query.Set("x-oss-process", process)
	parsed.RawQuery = query.Encode()
	return parsed.String(), true
}

func isMediaStreamType(value string) bool {
	switch value {
	case "image", "video", "audio":
		return true
	default:
		return false
	}
}

func normalizeLimits(limits config.QueryLimitsConfig) config.QueryLimitsConfig {
	if limits.MaxHistoryDays <= 0 {
		limits.MaxHistoryDays = 366
	}
	if limits.MaxMediaPageSize <= 0 {
		limits.MaxMediaPageSize = 100
	}
	return limits
}

func normalizePage(page int, pageSize int, limits config.QueryLimitsConfig) (int, int, error) {
	limits = normalizeLimits(limits)
	if page == 0 {
		page = 1
	}
	if page < 0 {
		return 0, 0, apperr.New(apperr.KindInvalidArgument, "page must be greater than 0")
	}
	if pageSize == 0 {
		pageSize = limits.MaxMediaPageSize
	}
	if pageSize < 0 {
		return 0, 0, apperr.New(apperr.KindInvalidArgument, "page_size must be greater than 0")
	}
	if pageSize > limits.MaxMediaPageSize {
		return 0, 0, apperr.New(apperr.KindInvalidArgument, "page_size exceeds max_media_page_size")
	}
	return page, pageSize, nil
}

func validateTimeRange(start time.Time, end time.Time, limits config.QueryLimitsConfig) error {
	limits = normalizeLimits(limits)
	if start.IsZero() {
		return apperr.New(apperr.KindInvalidArgument, "start_time is required")
	}
	if end.IsZero() {
		return apperr.New(apperr.KindInvalidArgument, "end_time is required")
	}
	if !end.After(start) {
		return apperr.New(apperr.KindInvalidArgument, "end_time must be after start_time")
	}
	maxRange := time.Duration(limits.MaxHistoryDays) * 24 * time.Hour
	if end.Sub(start) > maxRange {
		return apperr.New(apperr.KindInvalidArgument, "time range exceeds max_history_days")
	}
	return nil
}

func mapNotFoundOrInternal(err error, message string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.New(apperr.KindNotFound, message)
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}
