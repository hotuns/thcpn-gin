package deviceclaim

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
)

const manualAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

type Service struct {
	db  *pgxpool.Pool
	key [32]byte
}

type Credential struct {
	DeviceID    uuid.UUID  `json:"device_id"`
	DeviceName  string     `json:"device_name"`
	DeviceType  string     `json:"device_type"`
	SerialNo    string     `json:"serial_no"`
	ClaimSlug   string     `json:"claim_slug"`
	ClaimPath   string     `json:"claim_path"`
	ManualCode  string     `json:"manual_code"`
	PrintedAt   *time.Time `json:"printed_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	ChildCount  int64      `json:"child_count"`
	IsAssigned  bool       `json:"is_assigned"`
	IsClaimable bool       `json:"is_claimable"`
}

type ResolveInput struct {
	ClaimSlug string
	SerialNo  string
	Code      string
}

type ClaimInput struct {
	ResolveInput
	UserID         uuid.UUID
	WorkspaceID    uuid.UUID
	ProjectID      *uuid.UUID
	SiteID         *uuid.UUID
	IdempotencyKey string
}

type ClaimResult struct {
	DeviceID     uuid.UUID `json:"device_id"`
	AssignmentID uuid.UUID `json:"assignment_id"`
	WorkspaceID  uuid.UUID `json:"workspace_id"`
	DeviceName   string    `json:"device_name"`
	DeviceType   string    `json:"device_type"`
	ChildCount   int64     `json:"child_count"`
}

func NewService(db *pgxpool.Pool, secret string) *Service {
	return &Service{db: db, key: sha256.Sum256([]byte(secret + ":device-claim"))}
}

func (s *Service) EnsureEligible(ctx context.Context) (int64, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id FROM devices
		WHERE status = 'active' AND device_type IN ('gateway', 'standalone')
		ORDER BY created_at`)
	if err != nil {
		return 0, apperr.Wrap(apperr.KindInternal, "list claimable devices", err)
	}
	defer rows.Close()
	var count int64
	for rows.Next() {
		var deviceID uuid.UUID
		if err := rows.Scan(&deviceID); err != nil {
			return count, apperr.Wrap(apperr.KindInternal, "scan claimable device", err)
		}
		created, err := s.EnsureForDevice(ctx, deviceID)
		if err != nil {
			return count, err
		}
		if created {
			count++
		}
	}
	return count, rows.Err()
}

func (s *Service) EnsureForDevice(ctx context.Context, deviceID uuid.UUID) (bool, error) {
	var eligible bool
	if err := s.db.QueryRow(ctx, `
		SELECT status = 'active' AND device_type IN ('gateway', 'standalone')
		FROM devices WHERE id = $1`, deviceID).Scan(&eligible); err != nil {
		return false, mapNotFound(err, "device not found")
	}
	if !eligible {
		return false, apperr.New(apperr.KindInvalidArgument, "device type is not eligible for claiming")
	}
	slug, err := randomToken(32)
	if err != nil {
		return false, err
	}
	code, err := randomManualCode(10)
	if err != nil {
		return false, err
	}
	slugCipher, slugNonce, err := s.encrypt(slug)
	if err != nil {
		return false, err
	}
	codeCipher, codeNonce, err := s.encrypt(code)
	if err != nil {
		return false, err
	}
	tag, err := s.db.Exec(ctx, `
		INSERT INTO device_claim_credentials (
			device_id, claim_slug_hash, claim_slug_ciphertext, claim_slug_nonce,
			manual_code_hash, manual_code_ciphertext, manual_code_nonce
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (device_id) DO NOTHING`,
		deviceID, hash(slug), slugCipher, slugNonce, hash(normalizeManualCode(code)), codeCipher, codeNonce)
	if err != nil {
		return false, apperr.Wrap(apperr.KindInternal, "create device claim credential", err)
	}
	return tag.RowsAffected() == 1, nil
}

func (s *Service) GetAdminCredential(ctx context.Context, deviceID uuid.UUID) (Credential, error) {
	_, err := s.EnsureForDevice(ctx, deviceID)
	if err != nil && apperr.KindOf(err) != apperr.KindInvalidArgument {
		return Credential{}, err
	}
	var result Credential
	var slugCipher, slugNonce, codeCipher, codeNonce []byte
	var printedAt *time.Time
	err = s.db.QueryRow(ctx, `
		SELECT d.id, d.name, d.device_type, d.serial_no,
		       c.claim_slug_ciphertext, c.claim_slug_nonce,
		       c.manual_code_ciphertext, c.manual_code_nonce,
		       c.printed_at, c.created_at,
		       EXISTS (SELECT 1 FROM device_assignments da WHERE da.device_id=d.id AND da.status='active'),
		       (SELECT count(*) FROM device_relations dr WHERE dr.parent_device_id=d.id AND dr.status='active')
		FROM devices d
		JOIN device_claim_credentials c ON c.device_id=d.id
		WHERE d.id=$1`, deviceID).Scan(
		&result.DeviceID, &result.DeviceName, &result.DeviceType, &result.SerialNo,
		&slugCipher, &slugNonce, &codeCipher, &codeNonce, &printedAt, &result.CreatedAt,
		&result.IsAssigned, &result.ChildCount)
	if err != nil {
		return Credential{}, mapNotFound(err, "device claim credential not found")
	}
	result.ClaimSlug, err = s.decrypt(slugCipher, slugNonce)
	if err != nil {
		return Credential{}, err
	}
	result.ManualCode, err = s.decrypt(codeCipher, codeNonce)
	if err != nil {
		return Credential{}, err
	}
	result.ManualCode = formatManualCode(result.ManualCode)
	result.ClaimPath = "/claim/" + result.ClaimSlug
	result.PrintedAt = printedAt
	result.IsClaimable = !result.IsAssigned
	return result, nil
}

func (s *Service) MarkPrinted(ctx context.Context, deviceID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `UPDATE device_claim_credentials SET printed_at=now(), updated_at=now() WHERE device_id=$1`, deviceID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "mark device claim credential printed", err)
	}
	if tag.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "device claim credential not found")
	}
	return nil
}

func (s *Service) Resolve(ctx context.Context, input ResolveInput) (Credential, error) {
	var deviceID uuid.UUID
	switch {
	case strings.TrimSpace(input.ClaimSlug) != "":
		err := s.db.QueryRow(ctx, `SELECT device_id FROM device_claim_credentials WHERE claim_slug_hash=$1`, hash(strings.TrimSpace(input.ClaimSlug))).Scan(&deviceID)
		if err != nil {
			return Credential{}, genericUnavailable(err)
		}
	case strings.TrimSpace(input.SerialNo) != "" && normalizeManualCode(input.Code) != "":
		err := s.db.QueryRow(ctx, `
			SELECT c.device_id
			FROM device_claim_credentials c
			JOIN devices d ON d.id=c.device_id
			WHERE lower(d.serial_no)=lower($1) AND c.manual_code_hash=$2`,
			strings.TrimSpace(input.SerialNo), hash(normalizeManualCode(input.Code))).Scan(&deviceID)
		if err != nil {
			return Credential{}, genericUnavailable(err)
		}
	default:
		return Credential{}, apperr.New(apperr.KindInvalidArgument, "claim credential is required")
	}
	result, err := s.GetAdminCredential(ctx, deviceID)
	if err != nil || !result.IsClaimable || result.DeviceType == "gateway_node" || result.DeviceType == "camera" {
		return Credential{}, apperr.New(apperr.KindConflict, "device is not available for claiming")
	}
	result.ClaimSlug = ""
	result.ClaimPath = ""
	result.ManualCode = ""
	if len(result.SerialNo) > 4 {
		result.SerialNo = result.SerialNo[len(result.SerialNo)-4:]
	}
	return result, nil
}

func (s *Service) Claim(ctx context.Context, input ClaimInput) (ClaimResult, error) {
	if input.UserID == uuid.Nil || input.WorkspaceID == uuid.Nil {
		return ClaimResult{}, apperr.New(apperr.KindInvalidArgument, "user and workspace are required")
	}
	key := strings.TrimSpace(input.IdempotencyKey)
	if key == "" || len(key) > 128 {
		return ClaimResult{}, apperr.New(apperr.KindInvalidArgument, "valid idempotency key is required")
	}
	resolved, err := s.Resolve(ctx, input.ResolveInput)
	if err != nil {
		return ClaimResult{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return ClaimResult{}, apperr.Wrap(apperr.KindInternal, "begin device claim", err)
	}
	defer tx.Rollback(ctx)

	var existing ClaimResult
	err = tx.QueryRow(ctx, `
		SELECT r.device_id, r.assignment_id, r.workspace_id, d.name, d.device_type,
		       (SELECT count(*) FROM device_relations dr WHERE dr.parent_device_id=d.id AND dr.status='active')
		FROM device_claim_requests r JOIN devices d ON d.id=r.device_id
		WHERE r.user_id=$1 AND r.idempotency_key=$2`, input.UserID, key).Scan(
		&existing.DeviceID, &existing.AssignmentID, &existing.WorkspaceID,
		&existing.DeviceName, &existing.DeviceType, &existing.ChildCount)
	if err == nil {
		if existing.WorkspaceID != input.WorkspaceID {
			return ClaimResult{}, apperr.New(apperr.KindConflict, "idempotency key was used for another workspace")
		}
		return existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return ClaimResult{}, apperr.Wrap(apperr.KindInternal, "read device claim request", err)
	}

	var status, deviceType, name string
	if err := tx.QueryRow(ctx, `SELECT status, device_type, name FROM devices WHERE id=$1 FOR UPDATE`, resolved.DeviceID).Scan(&status, &deviceType, &name); err != nil {
		return ClaimResult{}, genericUnavailable(err)
	}
	if status != "active" || (deviceType != "gateway" && deviceType != "standalone") {
		return ClaimResult{}, apperr.New(apperr.KindConflict, "device is not available for claiming")
	}
	var assigned bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM device_assignments WHERE device_id=$1 AND status='active')`, resolved.DeviceID).Scan(&assigned); err != nil {
		return ClaimResult{}, apperr.Wrap(apperr.KindInternal, "check device assignment", err)
	}
	if assigned {
		return ClaimResult{}, apperr.New(apperr.KindConflict, "device is not available for claiming")
	}
	if err := validateTarget(ctx, tx, input.WorkspaceID, input.ProjectID, input.SiteID); err != nil {
		return ClaimResult{}, err
	}
	var assignmentID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO device_assignments (device_id, workspace_id, project_id, site_id, assigned_by, assigned_by_type)
		VALUES ($1,$2,$3,$4,$5,'user') RETURNING id`,
		resolved.DeviceID, input.WorkspaceID, input.ProjectID, input.SiteID, input.UserID).Scan(&assignmentID)
	if err != nil {
		return ClaimResult{}, apperr.Wrap(apperr.KindConflict, "device is not available for claiming", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO device_claim_requests (user_id,idempotency_key,device_id,workspace_id,assignment_id)
		VALUES ($1,$2,$3,$4,$5)`,
		input.UserID, key, resolved.DeviceID, input.WorkspaceID, assignmentID); err != nil {
		return ClaimResult{}, apperr.Wrap(apperr.KindInternal, "record device claim request", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return ClaimResult{}, apperr.Wrap(apperr.KindInternal, "commit device claim", err)
	}
	return ClaimResult{
		DeviceID: resolved.DeviceID, AssignmentID: assignmentID, WorkspaceID: input.WorkspaceID,
		DeviceName: name, DeviceType: deviceType, ChildCount: resolved.ChildCount,
	}, nil
}

func validateTarget(ctx context.Context, tx pgx.Tx, workspaceID uuid.UUID, projectID, siteID *uuid.UUID) error {
	var active bool
	if err := tx.QueryRow(ctx, `SELECT status='active' FROM workspaces WHERE id=$1`, workspaceID).Scan(&active); err != nil || !active {
		return apperr.New(apperr.KindInvalidArgument, "target workspace is not active")
	}
	if projectID != nil {
		var matches bool
		if err := tx.QueryRow(ctx, `SELECT workspace_id=$2 FROM projects WHERE id=$1 AND status='active'`, *projectID, workspaceID).Scan(&matches); err != nil || !matches {
			return apperr.New(apperr.KindInvalidArgument, "project does not belong to target workspace")
		}
	}
	if siteID != nil {
		if projectID == nil {
			return apperr.New(apperr.KindInvalidArgument, "project is required when site is set")
		}
		var matches bool
		if err := tx.QueryRow(ctx, `SELECT workspace_id=$2 AND project_id=$3 FROM sites WHERE id=$1 AND status='active'`, *siteID, workspaceID, *projectID).Scan(&matches); err != nil || !matches {
			return apperr.New(apperr.KindInvalidArgument, "site does not belong to target project")
		}
	}
	return nil
}

func (s *Service) encrypt(value string) ([]byte, []byte, error) {
	block, err := aes.NewCipher(s.key[:])
	if err != nil {
		return nil, nil, apperr.Wrap(apperr.KindInternal, "create claim cipher", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, apperr.Wrap(apperr.KindInternal, "create claim gcm", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, apperr.Wrap(apperr.KindInternal, "generate claim nonce", err)
	}
	return gcm.Seal(nil, nonce, []byte(value), nil), nonce, nil
}

func (s *Service) decrypt(ciphertext, nonce []byte) (string, error) {
	block, err := aes.NewCipher(s.key[:])
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "create claim cipher", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "create claim gcm", err)
	}
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "decrypt claim credential", err)
	}
	return string(plain), nil
}

func randomToken(size int) (string, error) {
	raw := make([]byte, size)
	if _, err := io.ReadFull(rand.Reader, raw); err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "generate claim token", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func randomManualCode(size int) (string, error) {
	raw := make([]byte, size)
	if _, err := io.ReadFull(rand.Reader, raw); err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "generate manual claim code", err)
	}
	out := make([]byte, size)
	for i, value := range raw {
		out[i] = manualAlphabet[int(value)%len(manualAlphabet)]
	}
	return string(out), nil
}

func normalizeManualCode(value string) string {
	return strings.Map(func(r rune) rune {
		switch r {
		case '-', ' ', '\t', '\n', '\r':
			return -1
		default:
			return r
		}
	}, strings.ToUpper(strings.TrimSpace(value)))
}

func formatManualCode(value string) string {
	value = normalizeManualCode(value)
	if len(value) <= 4 {
		return value
	}
	parts := make([]string, 0, 3)
	for len(value) > 4 {
		parts = append(parts, value[:4])
		value = value[4:]
	}
	if value != "" {
		parts = append(parts, value)
	}
	return strings.Join(parts, "-")
}

func hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func mapNotFound(err error, message string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.New(apperr.KindNotFound, message)
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}

func genericUnavailable(err error) error {
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return apperr.Wrap(apperr.KindInternal, "resolve device claim credential", err)
	}
	return apperr.New(apperr.KindNotFound, "device is not available for claiming")
}
