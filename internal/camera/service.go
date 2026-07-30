package camera

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/db/sqlc"
	devicex "thcpn-gin/internal/device"
)

const (
	ProviderEzviz = "ezviz"
)

type Service struct {
	db          *pgxpool.Pool
	queries     *sqlc.Queries
	cfg         config.EzvizConfig
	httpClient  *http.Client
	now         func() time.Time
	tokenMu     sync.Mutex
	cachedToken cachedToken
}

type CameraBinding struct {
	ID                    uuid.UUID `json:"id"`
	DeviceID              uuid.UUID `json:"device_id"`
	Provider              string    `json:"provider"`
	DeviceSerial          string    `json:"device_serial"`
	ChannelNo             int32     `json:"channel_no"`
	DefaultQuality        string    `json:"default_quality"`
	IsEncrypted           bool      `json:"is_encrypted"`
	ValidateCodeSecretRef *string   `json:"validate_code_secret_ref,omitempty"`
	Status                string    `json:"status"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}

type Camera struct {
	Device  devicex.Device `json:"device"`
	Binding CameraBinding  `json:"binding"`
}

type CreateInput struct {
	ProductID             string
	SerialNo              string
	Name                  string
	DeviceSerial          string
	ChannelNo             int32
	DefaultQuality        string
	IsEncrypted           bool
	ValidateCodeSecretRef string
	Status                string
	TargetWorkspaceID     *uuid.UUID
	ProjectID             *uuid.UUID
	SiteID                *uuid.UUID
	ActorUserID           uuid.UUID
}

type UpdateInput struct {
	DeviceID              uuid.UUID
	DeviceSerial          *string
	ChannelNo             *int32
	DefaultQuality        *string
	IsEncrypted           *bool
	ValidateCodeSecretRef *string
	Status                *string
	ActorUserID           uuid.UUID
}

type LiveSessionInput struct {
	DeviceID    uuid.UUID
	ActorUserID uuid.UUID
}

type LiveSession struct {
	Provider     string    `json:"provider"`
	AccessToken  string    `json:"access_token"`
	URL          string    `json:"url"`
	Quality      string    `json:"quality"`
	ExpiresAt    time.Time `json:"expires_at"`
	DeviceSerial string    `json:"device_serial"`
	ChannelNo    int32     `json:"channel_no"`
}

type cachedToken struct {
	value     string
	expiresAt time.Time
}

type ezvizTokenResponse struct {
	Code string `json:"code"`
	Msg  string `json:"msg"`
	Data struct {
		AccessToken string `json:"accessToken"`
		ExpireTime  int64  `json:"expireTime"`
	} `json:"data"`
}

func NewService(db *pgxpool.Pool, cfg config.EzvizConfig) *Service {
	if cfg.OpenAPIDomain == "" {
		cfg = config.Default().Ezviz
	}
	return &Service{
		db:         db,
		queries:    sqlc.New(db),
		cfg:        cfg,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		now:        time.Now,
	}
}

func (s *Service) Create(ctx context.Context, input CreateInput) (Camera, error) {
	if input.ActorUserID == uuid.Nil {
		return Camera{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	serialNo := strings.TrimSpace(input.SerialNo)
	name := strings.TrimSpace(input.Name)
	if serialNo == "" {
		return Camera{}, apperr.New(apperr.KindInvalidArgument, "serial_no is required")
	}
	if name == "" {
		return Camera{}, apperr.New(apperr.KindInvalidArgument, "camera name is required")
	}
	bindingInput, err := normalizeBindingInput(input.DeviceSerial, input.ChannelNo, input.DefaultQuality, input.Status, input.ValidateCodeSecretRef)
	if err != nil {
		return Camera{}, err
	}
	if input.SiteID != nil && input.ProjectID == nil {
		return Camera{}, apperr.New(apperr.KindInvalidArgument, "project_id is required when site_id is set")
	}
	if input.TargetWorkspaceID != nil {
		if err := s.validateAssignmentTarget(ctx, *input.TargetWorkspaceID, input.ProjectID, input.SiteID); err != nil {
			return Camera{}, err
		}
	}
	if s.db == nil {
		return Camera{}, apperr.New(apperr.KindInternal, "database is not configured")
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Camera{}, apperr.Wrap(apperr.KindInternal, "begin create camera transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()
	q := s.queries.WithTx(tx)

	device, err := q.UpsertCameraDevice(ctx, sqlc.UpsertCameraDeviceParams{
		ProductID: nullableTrimmedString(input.ProductID),
		SerialNo:  serialNo,
		Name:      name,
	})
	if err != nil {
		return Camera{}, mapWriteError(err, "upsert camera device")
	}
	binding, err := q.UpsertCameraBinding(ctx, sqlc.UpsertCameraBindingParams{
		DeviceID:              device.ID,
		DeviceSerial:          bindingInput.deviceSerial,
		ChannelNo:             bindingInput.channelNo,
		DefaultQuality:        bindingInput.defaultQuality,
		IsEncrypted:           input.IsEncrypted,
		ValidateCodeSecretRef: bindingInput.validateCodeSecretRef,
		Status:                bindingInput.status,
	})
	if err != nil {
		return Camera{}, mapWriteError(err, "upsert camera binding")
	}
	if _, err := q.AddDeviceCapability(ctx, sqlc.AddDeviceCapabilityParams{
		DeviceID:       device.ID,
		CapabilityCode: "video_stream",
	}); err != nil {
		return Camera{}, mapWriteError(err, "add camera capability")
	}
	capabilities, err := q.ListDeviceCapabilities(ctx, device.ID)
	if err != nil {
		return Camera{}, apperr.Wrap(apperr.KindInternal, "list camera capabilities", err)
	}
	var assignment *sqlc.DeviceAssignment
	if input.TargetWorkspaceID != nil {
		assigned, err := assignDeviceInTx(ctx, q, assignDeviceInTxInput{
			DeviceID:          device.ID,
			TargetWorkspaceID: *input.TargetWorkspaceID,
			ProjectID:         input.ProjectID,
			SiteID:            input.SiteID,
			ActorUserID:       input.ActorUserID,
		})
		if err != nil {
			return Camera{}, err
		}
		assignment = &assigned
	}
	if err := tx.Commit(ctx); err != nil {
		return Camera{}, apperr.Wrap(apperr.KindInternal, "commit create camera transaction", err)
	}
	committed = true
	return Camera{Device: deviceFromSQL(device, assignment, capabilities), Binding: bindingFromSQL(binding)}, nil
}

func (s *Service) Get(ctx context.Context, deviceID uuid.UUID) (Camera, error) {
	if deviceID == uuid.Nil {
		return Camera{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}
	device, err := s.queries.GetDevice(ctx, deviceID)
	if err != nil {
		return Camera{}, mapNotFoundOrInternal(err, "camera device not found")
	}
	if device.DeviceType != "camera" {
		return Camera{}, apperr.New(apperr.KindInvalidArgument, "device is not a camera")
	}
	binding, err := s.queries.GetCameraBindingByDevice(ctx, deviceID)
	if err != nil {
		return Camera{}, mapNotFoundOrInternal(err, "camera binding not found")
	}
	capabilities, err := s.queries.ListDeviceCapabilities(ctx, deviceID)
	if err != nil {
		return Camera{}, apperr.Wrap(apperr.KindInternal, "list camera capabilities", err)
	}
	assignment, err := s.queries.GetActiveDeviceAssignment(ctx, deviceID)
	var assignmentPtr *sqlc.DeviceAssignment
	if err == nil {
		assignmentPtr = &assignment
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Camera{}, mapNotFoundOrInternal(err, "active device assignment not found")
	}
	return Camera{Device: deviceFromSQL(device, assignmentPtr, capabilities), Binding: bindingFromSQL(binding)}, nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (Camera, error) {
	if input.DeviceID == uuid.Nil {
		return Camera{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}
	if input.ActorUserID == uuid.Nil {
		return Camera{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	current, err := s.Get(ctx, input.DeviceID)
	if err != nil {
		return Camera{}, err
	}
	deviceSerial := current.Binding.DeviceSerial
	if input.DeviceSerial != nil {
		deviceSerial = *input.DeviceSerial
	}
	channelNo := current.Binding.ChannelNo
	if input.ChannelNo != nil {
		channelNo = *input.ChannelNo
	}
	defaultQuality := current.Binding.DefaultQuality
	if input.DefaultQuality != nil {
		defaultQuality = *input.DefaultQuality
	}
	status := current.Binding.Status
	if input.Status != nil {
		status = *input.Status
	}
	validateCodeSecretRef := ""
	if current.Binding.ValidateCodeSecretRef != nil {
		validateCodeSecretRef = *current.Binding.ValidateCodeSecretRef
	}
	if input.ValidateCodeSecretRef != nil {
		validateCodeSecretRef = *input.ValidateCodeSecretRef
	}
	isEncrypted := current.Binding.IsEncrypted
	if input.IsEncrypted != nil {
		isEncrypted = *input.IsEncrypted
	}
	bindingInput, err := normalizeBindingInput(deviceSerial, channelNo, defaultQuality, status, validateCodeSecretRef)
	if err != nil {
		return Camera{}, err
	}
	updated, err := s.queries.UpsertCameraBinding(ctx, sqlc.UpsertCameraBindingParams{
		DeviceID:              input.DeviceID,
		DeviceSerial:          bindingInput.deviceSerial,
		ChannelNo:             bindingInput.channelNo,
		DefaultQuality:        bindingInput.defaultQuality,
		IsEncrypted:           isEncrypted,
		ValidateCodeSecretRef: bindingInput.validateCodeSecretRef,
		Status:                bindingInput.status,
	})
	if err != nil {
		return Camera{}, mapWriteError(err, "update camera binding")
	}
	current.Binding = bindingFromSQL(updated)
	return current, nil
}

func (s *Service) CreateLiveSession(ctx context.Context, input LiveSessionInput) (LiveSession, error) {
	if input.DeviceID == uuid.Nil {
		return LiveSession{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}
	device, err := s.queries.GetDevice(ctx, input.DeviceID)
	if err != nil {
		return LiveSession{}, mapNotFoundOrInternal(err, "camera device not found")
	}
	if device.DeviceType != "camera" {
		return LiveSession{}, apperr.New(apperr.KindInvalidArgument, "device is not a camera")
	}
	binding, err := s.queries.GetCameraBindingByDevice(ctx, input.DeviceID)
	if err != nil {
		return LiveSession{}, mapNotFoundOrInternal(err, "camera binding not found")
	}
	if binding.Status != "active" {
		return LiveSession{}, apperr.New(apperr.KindInvalidArgument, "camera binding is not active")
	}
	token, expiresAt, err := s.accessToken(ctx)
	if err != nil {
		return LiveSession{}, err
	}
	return LiveSession{
		Provider:     binding.Provider,
		AccessToken:  token,
		URL:          ezopenLiveURL(binding.DeviceSerial, binding.ChannelNo, binding.DefaultQuality),
		Quality:      binding.DefaultQuality,
		ExpiresAt:    expiresAt,
		DeviceSerial: binding.DeviceSerial,
		ChannelNo:    binding.ChannelNo,
	}, nil
}

func (s *Service) accessToken(ctx context.Context) (string, time.Time, error) {
	s.tokenMu.Lock()
	defer s.tokenMu.Unlock()
	now := s.now()
	if s.cachedToken.value != "" && s.cachedToken.expiresAt.After(now.Add(30*time.Second)) {
		return s.cachedToken.value, s.cachedToken.expiresAt, nil
	}
	token, expiresAt, err := s.fetchAccessToken(ctx, now)
	if err != nil {
		return "", time.Time{}, err
	}
	s.cachedToken = cachedToken{value: token, expiresAt: expiresAt}
	return token, expiresAt, nil
}

func (s *Service) fetchAccessToken(ctx context.Context, now time.Time) (string, time.Time, error) {
	appKey := strings.TrimSpace(os.Getenv(strings.TrimSpace(s.cfg.AppKeyEnv)))
	appSecret := strings.TrimSpace(os.Getenv(strings.TrimSpace(s.cfg.AppSecretEnv)))
	if appKey == "" || appSecret == "" {
		return "", time.Time{}, apperr.New(apperr.KindInternal, "ezviz credentials are not configured")
	}
	endpoint, err := url.JoinPath(strings.TrimRight(s.cfg.OpenAPIDomain, "/"), "/api/lapp/token/get")
	if err != nil {
		return "", time.Time{}, apperr.Wrap(apperr.KindInternal, "build ezviz token endpoint", err)
	}
	form := url.Values{}
	form.Set("appKey", appKey)
	form.Set("appSecret", appSecret)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", time.Time{}, apperr.Wrap(apperr.KindInternal, "create ezviz token request", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", time.Time{}, apperr.Wrap(apperr.KindDataSource, "request ezviz access token", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return "", time.Time{}, apperr.New(apperr.KindDataSource, "ezviz access token request failed")
	}
	var decoded ezvizTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return "", time.Time{}, apperr.Wrap(apperr.KindDataSource, "decode ezviz access token", err)
	}
	if decoded.Code != "200" || strings.TrimSpace(decoded.Data.AccessToken) == "" {
		return "", time.Time{}, apperr.New(apperr.KindDataSource, "ezviz access token response is invalid")
	}
	expiresAt := now.Add(time.Duration(s.cfg.AccessTokenTTLSeconds) * time.Second)
	if decoded.Data.ExpireTime > 0 {
		ezvizExpiresAt := time.UnixMilli(decoded.Data.ExpireTime)
		if ezvizExpiresAt.After(now) && ezvizExpiresAt.Before(expiresAt) {
			expiresAt = ezvizExpiresAt
		}
	}
	return decoded.Data.AccessToken, expiresAt, nil
}

type normalizedBindingInput struct {
	deviceSerial          string
	channelNo             int32
	defaultQuality        string
	status                string
	validateCodeSecretRef *string
}

func normalizeBindingInput(deviceSerial string, channelNo int32, defaultQuality string, status string, validateCodeSecretRef string) (normalizedBindingInput, error) {
	deviceSerial = strings.TrimSpace(deviceSerial)
	if deviceSerial == "" {
		return normalizedBindingInput{}, apperr.New(apperr.KindInvalidArgument, "ezviz device_serial is required")
	}
	if channelNo <= 0 {
		channelNo = 1
	}
	defaultQuality = strings.TrimSpace(defaultQuality)
	if defaultQuality == "" {
		defaultQuality = "hd"
	}
	if !isValidQuality(defaultQuality) {
		return normalizedBindingInput{}, apperr.New(apperr.KindInvalidArgument, "invalid camera quality")
	}
	status = strings.TrimSpace(status)
	if status == "" {
		status = "active"
	}
	if status != "active" && status != "disabled" {
		return normalizedBindingInput{}, apperr.New(apperr.KindInvalidArgument, "invalid camera binding status")
	}
	return normalizedBindingInput{
		deviceSerial:          deviceSerial,
		channelNo:             channelNo,
		defaultQuality:        defaultQuality,
		status:                status,
		validateCodeSecretRef: nullableTrimmedString(validateCodeSecretRef),
	}, nil
}

func isValidQuality(value string) bool {
	switch value {
	case "fluent", "standard", "hd", "ultra_hd":
		return true
	default:
		return false
	}
}

func ezopenLiveURL(deviceSerial string, channelNo int32, quality string) string {
	suffix := ".live"
	if quality == "hd" {
		suffix = ".hd.live"
	}
	return "ezopen://open.ys7.com/" + deviceSerial + "/" + strconv.FormatInt(int64(channelNo), 10) + suffix
}

func (s *Service) validateAssignmentTarget(ctx context.Context, workspaceID uuid.UUID, projectID *uuid.UUID, siteID *uuid.UUID) error {
	if _, err := s.queries.GetWorkspace(ctx, workspaceID); err != nil {
		return mapNotFoundOrInternal(err, "target workspace not found")
	}
	if projectID != nil {
		project, err := s.queries.GetProject(ctx, *projectID)
		if err != nil {
			return mapNotFoundOrInternal(err, "target project not found")
		}
		if project.WorkspaceID != workspaceID {
			return apperr.New(apperr.KindInvalidArgument, "target project does not belong to target workspace")
		}
	}
	if siteID != nil {
		site, err := s.queries.GetSite(ctx, *siteID)
		if err != nil {
			return mapNotFoundOrInternal(err, "target site not found")
		}
		if site.WorkspaceID != workspaceID {
			return apperr.New(apperr.KindInvalidArgument, "target site does not belong to target workspace")
		}
		if projectID != nil && site.ProjectID != *projectID {
			return apperr.New(apperr.KindInvalidArgument, "target site does not belong to target project")
		}
	}
	return nil
}

type assignDeviceInTxInput struct {
	DeviceID          uuid.UUID
	TargetWorkspaceID uuid.UUID
	ProjectID         *uuid.UUID
	SiteID            *uuid.UUID
	ActorUserID       uuid.UUID
}

func assignDeviceInTx(ctx context.Context, q *sqlc.Queries, input assignDeviceInTxInput) (sqlc.DeviceAssignment, error) {
	current, err := q.GetActiveDeviceAssignment(ctx, input.DeviceID)
	hasCurrent := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return sqlc.DeviceAssignment{}, mapNotFoundOrInternal(err, "active device assignment not found")
	}
	if hasCurrent && current.WorkspaceID == input.TargetWorkspaceID {
		return q.UpdateDeviceAssignment(ctx, sqlc.UpdateDeviceAssignmentParams{
			ID:        current.ID,
			ProjectID: input.ProjectID,
			SiteID:    input.SiteID,
		})
	}
	if hasCurrent {
		if _, err := q.CloseActiveDeviceAssignment(ctx, sqlc.CloseActiveDeviceAssignmentParams{
			DeviceID: input.DeviceID,
			Status:   "transferred",
		}); err != nil {
			return sqlc.DeviceAssignment{}, mapWriteError(err, "close active device assignment")
		}
	}
	return q.CreateDeviceAssignment(ctx, sqlc.CreateDeviceAssignmentParams{
		DeviceID:       input.DeviceID,
		WorkspaceID:    input.TargetWorkspaceID,
		ProjectID:      input.ProjectID,
		SiteID:         input.SiteID,
		AssignedBy:     &input.ActorUserID,
		AssignedByType: "system_admin",
	})
}

func deviceFromSQL(model sqlc.Device, assignment *sqlc.DeviceAssignment, capabilities []string) devicex.Device {
	result := devicex.Device{
		ID:                 model.ID,
		ProductID:          model.ProductID,
		SerialNo:           model.SerialNo,
		Name:               model.Name,
		Status:             model.Status,
		ActivatedAt:        pgTimePtr(model.ActivatedAt),
		LifecycleStatus:    model.LifecycleStatus,
		LifecycleUpdatedAt: pgTimePtr(model.LifecycleUpdatedAt),
		DeviceType:         model.DeviceType,
		Capabilities:       capabilities,
		TopologyRole:       model.DeviceType,
		CreatedAt:          pgTime(model.CreatedAt),
		UpdatedAt:          pgTime(model.UpdatedAt),
	}
	if assignment != nil {
		result.AssignmentID = &assignment.ID
		result.WorkspaceID = &assignment.WorkspaceID
		result.ProjectID = assignment.ProjectID
		result.SiteID = assignment.SiteID
		result.AssignedBy = assignment.AssignedBy
		result.AssignedAt = pgTimePtr(assignment.AssignedAt)
	}
	return result
}

func bindingFromSQL(model sqlc.CameraBinding) CameraBinding {
	return CameraBinding{
		ID:                    model.ID,
		DeviceID:              model.DeviceID,
		Provider:              model.Provider,
		DeviceSerial:          model.DeviceSerial,
		ChannelNo:             model.ChannelNo,
		DefaultQuality:        model.DefaultQuality,
		IsEncrypted:           model.IsEncrypted,
		ValidateCodeSecretRef: model.ValidateCodeSecretRef,
		Status:                model.Status,
		CreatedAt:             pgTime(model.CreatedAt),
		UpdatedAt:             pgTime(model.UpdatedAt),
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

func pgTimePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}

func mapNotFoundOrInternal(err error, message string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.New(apperr.KindNotFound, message)
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}

func mapWriteError(err error, message string) error {
	if err == nil {
		return nil
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}
