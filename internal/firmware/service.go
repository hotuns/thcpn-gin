package firmware

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/objectstore"
)

const MaxFileSize int64 = 100 << 20

var md5Base16Pattern = regexp.MustCompile(`^[0-9A-Fa-f]{32}$`)

type Service struct {
	db          *pgxpool.Pool
	stores      map[string]ArtifactStore
	dataSources SourcePublisher
}

type ArtifactStore struct {
	Store           objectstore.Store
	PublicURLPrefix string
}

type LoRaWANV2Publisher interface {
	LoRaWANV2Request(context.Context, uuid.UUID, string, string, url.Values, any) (json.RawMessage, error)
}

type SourceFirmwareWriter interface {
	RegisterSourceFirmware(context.Context, datasource.SourceFirmwareInput) (int64, error)
}

type SourcePublisher interface {
	LoRaWANV2Publisher
	SourceFirmwareWriter
}

type UploadInput struct {
	Filename, ContentType, Version, VerifyValue string
	SizeBytes                                   int64
	Body                                        io.Reader
	DeviceIDs                                   []uuid.UUID
	BuildID                                     *int64
	ActorAdminID                                uuid.UUID
	IdempotencyKey                              uuid.UUID
}

type Release struct {
	ID               uuid.UUID  `json:"id"`
	OriginalFilename string     `json:"original_filename"`
	ObjectKey        string     `json:"object_key"`
	PublicURL        string     `json:"public_url"`
	ContentType      string     `json:"content_type"`
	SizeBytes        int64      `json:"size_bytes"`
	Version          string     `json:"version"`
	FirmwareVersion  uint32     `json:"firmware_version"`
	VerifyValue      string     `json:"verify_value"`
	SourceFamily     string     `json:"source_family"`
	BuildID          *int64     `json:"build_id,omitempty"`
	Status           string     `json:"status"`
	CreatedBy        *uuid.UUID `json:"created_by,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	Targets          []Target   `json:"targets"`
}

type Target struct {
	ID                 uuid.UUID  `json:"id"`
	ReleaseID          uuid.UUID  `json:"release_id"`
	DeviceID           uuid.UUID  `json:"device_id"`
	DeviceName         string     `json:"device_name"`
	WorkspaceName      string     `json:"workspace_name,omitempty"`
	DataSourceID       uuid.UUID  `json:"data_source_id"`
	GatewaySN          string     `json:"gateway_sn"`
	ExternalDeviceID   *int64     `json:"external_device_id,omitempty"`
	UpstreamFirmwareID *int64     `json:"upstream_firmware_id,omitempty"`
	Status             string     `json:"status"`
	RetryCount         int        `json:"retry_count"`
	ErrorMessage       string     `json:"error_message,omitempty"`
	PublishedAt        *time.Time `json:"published_at,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type ListResult struct {
	Items    []Release `json:"items"`
	Total    int64     `json:"total"`
	Page     int       `json:"page"`
	PageSize int       `json:"page_size"`
}

type targetRef struct {
	DeviceID, DataSourceID               uuid.UUID
	DeviceName, WorkspaceName, GatewaySN string
	SourceFamily                         string
	ExternalDeviceID                     *int64
}

func NewService(db *pgxpool.Pool, dataSources SourcePublisher, stores map[string]ArtifactStore) *Service {
	normalized := make(map[string]ArtifactStore, len(stores))
	for family, artifact := range stores {
		artifact.PublicURLPrefix = strings.TrimRight(strings.TrimSpace(artifact.PublicURLPrefix), "/")
		normalized[family] = artifact
	}
	return &Service{db: db, dataSources: dataSources, stores: normalized}
}

func ParseVersion(value string) (string, uint32, error) {
	value = strings.TrimSpace(value)
	parts := strings.Split(value, ".")
	if len(parts) != 4 {
		return "", 0, apperr.New(apperr.KindInvalidArgument, "version must contain four numeric parts")
	}
	var encoded uint32
	for index, part := range parts {
		if part == "" || (len(part) > 1 && part[0] == '0') {
			return "", 0, apperr.New(apperr.KindInvalidArgument, "version parts must be canonical integers between 0 and 255")
		}
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 || n > 255 {
			return "", 0, apperr.New(apperr.KindInvalidArgument, "version parts must be between 0 and 255")
		}
		encoded |= uint32(n) << (8 * index)
	}
	return value, encoded, nil
}

func (s *Service) Create(ctx context.Context, input UploadInput) (Release, error) {
	if input.ActorAdminID == uuid.Nil {
		return Release{}, apperr.New(apperr.KindInvalidArgument, "administrator is required")
	}
	if input.IdempotencyKey == uuid.Nil {
		return Release{}, apperr.New(apperr.KindInvalidArgument, "idempotency_key is required")
	}
	var existingID uuid.UUID
	if err := s.db.QueryRow(ctx, `SELECT id FROM firmware_releases WHERE created_by=$1 AND idempotency_key=$2`, input.ActorAdminID, input.IdempotencyKey).Scan(&existingID); err == nil {
		return s.Get(ctx, existingID)
	} else if err != pgx.ErrNoRows {
		return Release{}, apperr.Wrap(apperr.KindInternal, "check firmware release idempotency", err)
	}
	if strings.TrimSpace(input.Filename) == "" {
		return Release{}, apperr.New(apperr.KindInvalidArgument, "firmware filename is required")
	}
	if input.Body == nil || input.SizeBytes <= 0 || input.SizeBytes > MaxFileSize {
		return Release{}, apperr.New(apperr.KindInvalidArgument, "firmware file must be between 1 byte and 100 MB")
	}
	if s.dataSources == nil {
		return Release{}, apperr.New(apperr.KindInternal, "firmware service is not configured")
	}
	refs, err := s.targetRefs(ctx, input.DeviceIDs)
	if err != nil {
		return Release{}, err
	}
	family := refs[0].SourceFamily
	dataSourceID := refs[0].DataSourceID
	for _, ref := range refs[1:] {
		if ref.SourceFamily != family || ref.DataSourceID != dataSourceID {
			return Release{}, apperr.New(apperr.KindInvalidArgument, "all firmware targets must belong to the same source")
		}
	}
	version := strings.TrimSpace(input.Version)
	var encoded uint32
	if family == "lorawan_v2" {
		version, encoded, err = ParseVersion(version)
		if err != nil {
			return Release{}, err
		}
	} else if version == "" || len(version) > 96 || (family == "carbon" && len(version) > 64) {
		return Release{}, apperr.New(apperr.KindInvalidArgument, "firmware version is invalid")
	}
	if family == "carbon" && (input.BuildID == nil || *input.BuildID <= 0) {
		return Release{}, apperr.New(apperr.KindInvalidArgument, "carbon firmware build_id is required")
	}
	verify := strings.TrimSpace(input.VerifyValue)
	if !md5Base16Pattern.MatchString(verify) {
		return Release{}, apperr.New(apperr.KindInvalidArgument, "verify_value must be a 32 character MD5 Base16 string")
	}
	artifact, ok := s.stores[family]
	if !ok || artifact.Store == nil {
		return Release{}, apperr.New(apperr.KindInternal, family+" firmware object store is not configured")
	}
	if artifact.PublicURLPrefix == "" {
		return Release{}, apperr.New(apperr.KindInvalidArgument, family+" object store public_url_prefix is required for firmware publishing")
	}
	publicBase, parseErr := url.Parse(artifact.PublicURLPrefix)
	if parseErr != nil || (publicBase.Scheme != "http" && publicBase.Scheme != "https") || publicBase.Host == "" {
		return Release{}, apperr.New(apperr.KindInvalidArgument, family+" object store public_url_prefix must be an absolute HTTP URL")
	}

	releaseID := uuid.New()
	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(input.Filename)))
	if len(ext) > 16 || strings.ContainsAny(ext, "/\\") {
		ext = ""
	}
	objectKey := "firmwares/" + releaseID.String() + ext
	contentType := strings.TrimSpace(input.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	if err := artifact.Store.Put(ctx, objectstore.PutInput{ObjectKey: objectKey, ContentType: contentType, Body: io.LimitReader(input.Body, MaxFileSize+1)}); err != nil {
		return Release{}, apperr.Wrap(apperr.KindInternal, "upload firmware object", err)
	}
	publicURL := artifact.PublicURLPrefix + "/" + objectKey
	tx, err := s.db.Begin(ctx)
	if err != nil {
		_ = artifact.Store.Delete(ctx, objectKey)
		return Release{}, apperr.Wrap(apperr.KindInternal, "begin firmware release", err)
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO firmware_releases(id,original_filename,object_key,public_url,content_type,size_bytes,version,firmware_version,verify_value,source_family,build_id,created_by,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, releaseID, strings.TrimSpace(input.Filename), objectKey, publicURL, contentType, input.SizeBytes, version, int64(encoded), verify, family, input.BuildID, input.ActorAdminID, input.IdempotencyKey)
	if err == nil {
		for _, ref := range refs {
			var gatewaySN any
			if ref.GatewaySN != "" {
				gatewaySN = ref.GatewaySN
			}
			_, err = tx.Exec(ctx, `INSERT INTO firmware_release_targets(release_id,device_id,data_source_id,gateway_sn,external_device_id) VALUES($1,$2,$3,$4,$5)`, releaseID, ref.DeviceID, ref.DataSourceID, gatewaySN, ref.ExternalDeviceID)
			if err != nil {
				break
			}
		}
	}
	if err != nil {
		_ = artifact.Store.Delete(ctx, objectKey)
		return Release{}, apperr.Wrap(apperr.KindInternal, "create firmware release", err)
	}
	if err = tx.Commit(ctx); err != nil {
		_ = artifact.Store.Delete(ctx, objectKey)
		return Release{}, apperr.Wrap(apperr.KindInternal, "commit firmware release", err)
	}

	for _, ref := range refs {
		_ = s.publish(ctx, releaseID, ref.DeviceID, false)
	}
	return s.Get(ctx, releaseID)
}

func (s *Service) Retry(ctx context.Context, releaseID, targetID uuid.UUID) (Release, error) {
	var deviceID uuid.UUID
	var status string
	if err := s.db.QueryRow(ctx, `SELECT device_id,status FROM firmware_release_targets WHERE id=$1 AND release_id=$2`, targetID, releaseID).Scan(&deviceID, &status); err != nil {
		if err == pgx.ErrNoRows {
			return Release{}, apperr.New(apperr.KindNotFound, "firmware release target not found")
		}
		return Release{}, apperr.Wrap(apperr.KindInternal, "load firmware release target", err)
	}
	if status == "completed" {
		return s.Get(ctx, releaseID)
	}
	publishErr := s.publish(ctx, releaseID, deviceID, true)
	result, err := s.Get(ctx, releaseID)
	if err != nil {
		return Release{}, err
	}
	return result, publishErr
}

func (s *Service) publish(ctx context.Context, releaseID, deviceID uuid.UUID, retry bool) error {
	var targetID, dataSourceID uuid.UUID
	var gatewaySN, publicURL, verify, sourceFamily, objectKey, version string
	var externalDeviceID, buildID *int64
	var encoded int64
	err := s.db.QueryRow(ctx, `SELECT t.id,t.data_source_id,COALESCE(t.gateway_sn,''),t.external_device_id,r.source_family,r.object_key,r.public_url,r.version,r.firmware_version,r.verify_value,r.build_id FROM firmware_release_targets t JOIN firmware_releases r ON r.id=t.release_id WHERE t.release_id=$1 AND t.device_id=$2`, releaseID, deviceID).Scan(&targetID, &dataSourceID, &gatewaySN, &externalDeviceID, &sourceFamily, &objectKey, &publicURL, &version, &encoded, &verify, &buildID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "load firmware publishing target", err)
	}
	retryIncrement := 0
	if retry {
		retryIncrement = 1
	}
	expected := "pending"
	if retry {
		expected = "failed"
	}
	claim, claimErr := s.db.Exec(ctx, `UPDATE firmware_release_targets SET status='publishing',retry_count=retry_count+$2,error_message=NULL,updated_at=now() WHERE id=$1 AND status=$3`, targetID, retryIncrement, expected)
	if claimErr != nil {
		return apperr.Wrap(apperr.KindInternal, "claim firmware publishing target", claimErr)
	}
	if claim.RowsAffected() == 0 {
		return nil
	}
	var upstreamID int64
	switch sourceFamily {
	case "lorawan_v2":
		payload, requestErr := s.dataSources.LoRaWANV2Request(ctx, dataSourceID, http.MethodPost, "/device/"+url.PathEscape(gatewaySN)+"/firmware", nil, map[string]any{"firmware_version": uint32(encoded), "url": publicURL, "verify_value": verify})
		if requestErr == nil {
			var response struct {
				ID int64 `json:"id"`
			}
			if json.Unmarshal(payload, &response) != nil || response.ID <= 0 {
				requestErr = apperr.New(apperr.KindDataSource, "lorawan_v2 firmware response is missing id")
			} else {
				upstreamID = response.ID
			}
		}
		err = requestErr
	case "thcpn", "carbon":
		if externalDeviceID == nil {
			err = apperr.New(apperr.KindInternal, "source firmware target is missing external_device_id")
		} else {
			upstreamID, err = s.dataSources.RegisterSourceFirmware(ctx, datasource.SourceFirmwareInput{DataSourceID: dataSourceID, SourceFamily: sourceFamily, ExternalDeviceID: *externalDeviceID, Version: version, BuildID: buildID, ObjectKey: objectKey, PublicURL: publicURL, VerifyValue: verify})
		}
	default:
		err = apperr.New(apperr.KindInvalidArgument, "firmware source family is not supported")
	}
	if err != nil {
		message := apperr.MessageOf(err)
		_, _ = s.db.Exec(ctx, `UPDATE firmware_release_targets SET status='failed',error_message=$2,updated_at=now() WHERE id=$1`, targetID, message)
		_ = s.refreshStatus(ctx, releaseID)
		return err
	}
	_, err = s.db.Exec(ctx, `UPDATE firmware_release_targets SET status='completed',upstream_firmware_id=$2,error_message=NULL,published_at=now(),updated_at=now() WHERE id=$1`, targetID, upstreamID)
	_ = s.refreshStatus(ctx, releaseID)
	return err
}

func (s *Service) refreshStatus(ctx context.Context, releaseID uuid.UUID) error {
	_, err := s.db.Exec(ctx, `UPDATE firmware_releases r SET status=CASE WHEN c.completed=c.total THEN 'completed' WHEN c.completed>0 THEN 'partial' WHEN c.pending>0 THEN 'publishing' ELSE 'failed' END,updated_at=now() FROM (SELECT release_id,count(*) total,count(*) FILTER (WHERE status='completed') completed,count(*) FILTER (WHERE status IN ('pending','publishing')) pending FROM firmware_release_targets WHERE release_id=$1 GROUP BY release_id) c WHERE r.id=c.release_id`, releaseID)
	return err
}

func (s *Service) targetRefs(ctx context.Context, ids []uuid.UUID) ([]targetRef, error) {
	if len(ids) == 0 {
		return nil, apperr.New(apperr.KindInvalidArgument, "at least one device_id is required")
	}
	seen := map[uuid.UUID]struct{}{}
	refs := make([]targetRef, 0, len(ids))
	for _, id := range ids {
		if id == uuid.Nil {
			return nil, apperr.New(apperr.KindInvalidArgument, "invalid device_id")
		}
		if _, exists := seen[id]; exists {
			return nil, apperr.New(apperr.KindInvalidArgument, "duplicate device_id")
		}
		seen[id] = struct{}{}
		var ref targetRef
		err := s.db.QueryRow(ctx, `SELECT d.id,ref.data_source_id,d.name,COALESCE(w.name,''),src.source_family,CASE WHEN src.source_family='lorawan_v2' THEN ref.external_key ELSE '' END,CASE WHEN src.source_family IN ('thcpn','carbon') THEN ref.external_key::bigint ELSE NULL END FROM devices d JOIN device_source_refs ref ON ref.device_id=d.id AND ref.status='active' JOIN data_sources src ON src.id=ref.data_source_id AND src.source_family IN ('thcpn','carbon','lorawan_v2') AND src.status='active' LEFT JOIN device_assignments a ON a.device_id=d.id AND a.status='active' LEFT JOIN workspaces w ON w.id=a.workspace_id WHERE d.id=$1 AND EXISTS(SELECT 1 FROM device_capabilities c WHERE c.device_id=d.id AND c.capability_code='firmware_update') ORDER BY ref.created_at DESC LIMIT 1`, id).Scan(&ref.DeviceID, &ref.DataSourceID, &ref.DeviceName, &ref.WorkspaceName, &ref.SourceFamily, &ref.GatewaySN, &ref.ExternalDeviceID)
		if err == pgx.ErrNoRows {
			return nil, apperr.New(apperr.KindInvalidArgument, "device is not an active firmware target")
		}
		if err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "validate firmware target", err)
		}
		if (ref.SourceFamily == "lorawan_v2" && strings.TrimSpace(ref.GatewaySN) == "") || (ref.SourceFamily != "lorawan_v2" && (ref.ExternalDeviceID == nil || *ref.ExternalDeviceID <= 0)) {
			return nil, apperr.New(apperr.KindInvalidArgument, "device source identity is invalid for firmware publishing")
		}
		refs = append(refs, ref)
	}
	return refs, nil
}

func (s *Service) List(ctx context.Context, page, pageSize int, status, version, deviceQuery string) (ListResult, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	where := []string{"1=1"}
	args := []any{}
	add := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}
	if status = strings.TrimSpace(status); status != "" {
		add("r.status=$%d", status)
	}
	if version = strings.TrimSpace(version); version != "" {
		add("r.version=$%d", version)
	}
	if deviceQuery = strings.TrimSpace(deviceQuery); deviceQuery != "" {
		add("EXISTS(SELECT 1 FROM firmware_release_targets ft JOIN devices d ON d.id=ft.device_id WHERE ft.release_id=r.id AND (d.name || ' ' || COALESCE(ft.gateway_sn,'') || ' ' || COALESCE(ft.external_device_id::text,'')) ILIKE '%%'||$%d||'%%')", deviceQuery)
	}
	whereSQL := strings.Join(where, " AND ")
	var total int64
	if err := s.db.QueryRow(ctx, "SELECT count(*) FROM firmware_releases r WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return ListResult{}, apperr.Wrap(apperr.KindInternal, "count firmware releases", err)
	}
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(ctx, fmt.Sprintf(`SELECT id,original_filename,object_key,public_url,content_type,size_bytes,version,firmware_version,verify_value,source_family,build_id,status,created_by,created_at,updated_at FROM firmware_releases r WHERE %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d`, whereSQL, len(args)-1, len(args)), args...)
	if err != nil {
		return ListResult{}, apperr.Wrap(apperr.KindInternal, "list firmware releases", err)
	}
	defer rows.Close()
	items := []Release{}
	for rows.Next() {
		var item Release
		var encoded int64
		if err = rows.Scan(&item.ID, &item.OriginalFilename, &item.ObjectKey, &item.PublicURL, &item.ContentType, &item.SizeBytes, &item.Version, &encoded, &item.VerifyValue, &item.SourceFamily, &item.BuildID, &item.Status, &item.CreatedBy, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return ListResult{}, err
		}
		item.FirmwareVersion = uint32(encoded)
		item.Targets, err = s.listTargets(ctx, item.ID)
		if err != nil {
			return ListResult{}, err
		}
		items = append(items, item)
	}
	return ListResult{Items: items, Total: total, Page: page, PageSize: pageSize}, rows.Err()
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (Release, error) {
	var item Release
	var encoded int64
	err := s.db.QueryRow(ctx, `SELECT id,original_filename,object_key,public_url,content_type,size_bytes,version,firmware_version,verify_value,source_family,build_id,status,created_by,created_at,updated_at FROM firmware_releases WHERE id=$1`, id).Scan(&item.ID, &item.OriginalFilename, &item.ObjectKey, &item.PublicURL, &item.ContentType, &item.SizeBytes, &item.Version, &encoded, &item.VerifyValue, &item.SourceFamily, &item.BuildID, &item.Status, &item.CreatedBy, &item.CreatedAt, &item.UpdatedAt)
	if err == pgx.ErrNoRows {
		return Release{}, apperr.New(apperr.KindNotFound, "firmware release not found")
	}
	if err != nil {
		return Release{}, apperr.Wrap(apperr.KindInternal, "get firmware release", err)
	}
	item.FirmwareVersion = uint32(encoded)
	item.Targets, err = s.listTargets(ctx, id)
	return item, err
}

func (s *Service) listTargets(ctx context.Context, id uuid.UUID) ([]Target, error) {
	rows, err := s.db.Query(ctx, `SELECT t.id,t.release_id,t.device_id,d.name,COALESCE(w.name,''),t.data_source_id,COALESCE(t.gateway_sn,''),t.external_device_id,t.upstream_firmware_id,t.status,t.retry_count,COALESCE(t.error_message,''),t.published_at,t.created_at,t.updated_at FROM firmware_release_targets t JOIN devices d ON d.id=t.device_id LEFT JOIN device_assignments a ON a.device_id=d.id AND a.status='active' LEFT JOIN workspaces w ON w.id=a.workspace_id WHERE t.release_id=$1 ORDER BY d.name,COALESCE(t.gateway_sn,''),t.external_device_id`, id)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list firmware release targets", err)
	}
	defer rows.Close()
	items := []Target{}
	for rows.Next() {
		var x Target
		if err = rows.Scan(&x.ID, &x.ReleaseID, &x.DeviceID, &x.DeviceName, &x.WorkspaceName, &x.DataSourceID, &x.GatewaySN, &x.ExternalDeviceID, &x.UpstreamFirmwareID, &x.Status, &x.RetryCount, &x.ErrorMessage, &x.PublishedAt, &x.CreatedAt, &x.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, x)
	}
	return items, rows.Err()
}
