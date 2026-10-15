package firmware

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
)

type Artifact struct {
	ID               uuid.UUID `json:"id"`
	DataSourceID     uuid.UUID `json:"data_source_id"`
	DataSourceName   string    `json:"data_source_name"`
	SourceFamily     string    `json:"source_family"`
	DeviceType       string    `json:"device_type"`
	ProductID        *string   `json:"product_id,omitempty"`
	OriginalFilename string    `json:"original_filename"`
	ObjectKey        string    `json:"object_key"`
	PublicURL        string    `json:"public_url"`
	ContentType      string    `json:"content_type"`
	SizeBytes        int64     `json:"size_bytes"`
	Version          string    `json:"version"`
	FirmwareVersion  uint32    `json:"firmware_version"`
	VerifyValue      string    `json:"verify_value"`
	BuildID          *int64    `json:"build_id,omitempty"`
	Archived         bool      `json:"archived"`
	CreatedAt        time.Time `json:"created_at"`
}
type ArtifactList struct {
	Items    []Artifact `json:"items"`
	Total    int64      `json:"total"`
	Page     int        `json:"page"`
	PageSize int        `json:"page_size"`
}

// Candidates are resolved server-side so the UI cannot accidentally mix source
// instances, even when its device list is paginated.
type Candidate struct {
	ID             uuid.UUID `json:"id"`
	Name           string    `json:"name"`
	SerialNo       string    `json:"serial_no"`
	DataSourceID   uuid.UUID `json:"data_source_id"`
	DataSourceName string    `json:"data_source_name"`
	SourceFamily   string    `json:"source_family"`
	DeviceType     string    `json:"device_type"`
	ProductID      *string   `json:"product_id,omitempty"`
}

func (s *Service) Candidates(ctx context.Context, firmwareID *uuid.UUID, page, size int) ([]Candidate, error) {
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 100
	}
	var artifact *Artifact
	if firmwareID != nil {
		a, err := s.GetFirmware(ctx, *firmwareID)
		if err != nil {
			return nil, err
		}
		artifact = &a
	}
	var sourceID *uuid.UUID
	family := ""
	if artifact != nil {
		sourceID = &artifact.DataSourceID
		family = artifact.SourceFamily
	}
	rows, err := s.db.Query(ctx, `SELECT d.id,d.name,COALESCE(d.serial_no,''),s.id,s.name,s.source_family,d.device_type,d.product_id
 FROM devices d JOIN LATERAL (SELECT data_source_id,external_key FROM device_source_refs WHERE device_id=d.id AND status='active' ORDER BY created_at DESC,id DESC LIMIT 1) ref ON true
 JOIN data_sources s ON s.id=ref.data_source_id
 WHERE d.status='active' AND s.status='active' AND s.source_family IN ('lorawan_v2','thcpn','carbon')
 AND ((s.source_family='lorawan_v2' AND d.device_type='gateway' AND btrim(ref.external_key)!='') OR (s.source_family IN ('thcpn','carbon') AND ref.external_key ~ '^[0-9]{1,18}$' AND ref.external_key !~ '^0+$'))
 AND EXISTS(SELECT 1 FROM device_capabilities c WHERE c.device_id=d.id AND c.capability_code='firmware_update')
 AND ($1::uuid IS NULL OR (s.id=$1 AND s.source_family=$2))
 ORDER BY d.name,d.id LIMIT $3 OFFSET $4`, sourceID, family, size, (page-1)*size)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Candidate{}
	for rows.Next() {
		var c Candidate
		if err := rows.Scan(&c.ID, &c.Name, &c.SerialNo, &c.DataSourceID, &c.DataSourceName, &c.SourceFamily, &c.DeviceType, &c.ProductID); err != nil {
			return nil, err
		}
		items = append(items, c)
	}
	return items, rows.Err()
}

type PublishInput struct {
	FirmwareID     uuid.UUID   `json:"firmware_id"`
	DeviceIDs      []uuid.UUID `json:"device_ids"`
	IdempotencyKey uuid.UUID   `json:"idempotency_key"`
	ActorAdminID   uuid.UUID   `json:"-"`
}

const artifactSelect = `SELECT a.id,a.data_source_id,s.name,a.source_family,a.device_type,a.product_id,a.original_filename,a.object_key,a.public_url,a.content_type,a.size_bytes,a.version,a.firmware_version,a.verify_value,a.build_id,a.archived,a.created_at FROM firmware_artifacts a JOIN data_sources s ON s.id=a.data_source_id`

func scanArtifact(row pgx.Row) (Artifact, error) {
	var a Artifact
	var encoded int64
	err := row.Scan(&a.ID, &a.DataSourceID, &a.DataSourceName, &a.SourceFamily, &a.DeviceType, &a.ProductID, &a.OriginalFilename, &a.ObjectKey, &a.PublicURL, &a.ContentType, &a.SizeBytes, &a.Version, &encoded, &a.VerifyValue, &a.BuildID, &a.Archived, &a.CreatedAt)
	a.FirmwareVersion = uint32(encoded)
	if err == pgx.ErrNoRows {
		return a, apperr.New(apperr.KindNotFound, "firmware artifact not found")
	}
	return a, err
}
func (s *Service) GetFirmware(ctx context.Context, id uuid.UUID) (Artifact, error) {
	return scanArtifact(s.db.QueryRow(ctx, artifactSelect+` WHERE a.id=$1`, id))
}
func (s *Service) ListFirmware(ctx context.Context, page, size int, family string) (ArtifactList, error) {
	return s.listFirmware(ctx, page, size, family, nil)
}
func (s *Service) ListFirmwareForDevice(ctx context.Context, page, size int, family string, deviceID uuid.UUID) (ArtifactList, error) {
	refs, err := s.targetRefs(ctx, []uuid.UUID{deviceID})
	if err != nil {
		return ArtifactList{}, err
	}
	return s.listFirmware(ctx, page, size, family, &refs[0])
}
func (s *Service) listFirmware(ctx context.Context, page, size int, family string, ref *targetRef) (ArtifactList, error) {
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 20
	}
	if size > 100 {
		size = 100
	}
	if family != "" && family != "thcpn" && family != "carbon" && family != "lorawan_v2" {
		return ArtifactList{}, apperr.New(apperr.KindInvalidArgument, "invalid source_family")
	}
	result := ArtifactList{Items: []Artifact{}, Page: page, PageSize: size}
	var sourceID *uuid.UUID
	sourceFamily := ""
	if ref != nil {
		sourceID = &ref.DataSourceID
		sourceFamily = ref.SourceFamily
	}
	const filter = ` WHERE ($1='' OR a.source_family=$1) AND ($2::uuid IS NULL OR (a.data_source_id=$2 AND a.source_family=$3))`
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM firmware_artifacts a`+filter, family, sourceID, sourceFamily).Scan(&result.Total); err != nil {
		return result, err
	}
	rows, err := s.db.Query(ctx, artifactSelect+filter+` ORDER BY a.created_at DESC,a.id LIMIT $4 OFFSET $5`, family, sourceID, sourceFamily, size, (page-1)*size)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		item, err := scanArtifact(rows)
		if err != nil {
			return result, err
		}
		result.Items = append(result.Items, item)
	}
	return result, rows.Err()
}
func sameFirmwareScope(a, b targetRef) bool {
	return a.SourceFamily == b.SourceFamily && a.DataSourceID == b.DataSourceID
}
func artifactMatches(a Artifact, ref targetRef) bool {
	return sameFirmwareScope(targetRef{SourceFamily: a.SourceFamily, DataSourceID: a.DataSourceID, DeviceType: a.DeviceType, ProductID: a.ProductID}, ref)
}
func recordFirmwareAudit(ctx context.Context, tx pgx.Tx, admin uuid.UUID, action string, id uuid.UUID) error {
	request, _ := ctx.Value(auditRequestKey{}).(audit.RecordInput)
	_, err := tx.Exec(ctx, `INSERT INTO audit_logs(actor_type,actor_admin_id,action,resource_type,resource_id,result,reason,ip,user_agent,request_id) VALUES('system_admin',$1,$2,'firmware',$3,'success',$4,$5,$6,$7)`, admin, action, id, request.Reason, request.IP, request.UserAgent, request.RequestID)
	return err
}
func (s *Service) SetFirmwareArchived(ctx context.Context, id uuid.UUID, archived bool, admin uuid.UUID) error {
	if admin == uuid.Nil {
		return apperr.New(apperr.KindUnauthorized, "administrator is required")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE firmware_artifacts SET archived=$2 WHERE id=$1`, id, archived)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return apperr.New(apperr.KindNotFound, "firmware not found")
	}
	if err = recordFirmwareAudit(ctx, tx, admin, "firmware.library.archive", id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Service) PublishFirmware(ctx context.Context, input PublishInput) (Release, error) {
	if input.ActorAdminID == uuid.Nil || input.FirmwareID == uuid.Nil || input.IdempotencyKey == uuid.Nil {
		return Release{}, apperr.New(apperr.KindInvalidArgument, "firmware, administrator and idempotency key are required")
	}
	if s.dataSources == nil {
		return Release{}, apperr.New(apperr.KindInternal, "firmware publisher is not configured")
	}
	existing := func(id uuid.UUID) (Release, error) {
		item, err := s.Get(ctx, id)
		if err != nil {
			return item, err
		}
		if item.FirmwareID == nil || *item.FirmwareID != input.FirmwareID || len(item.Targets) != len(input.DeviceIDs) {
			return Release{}, apperr.New(apperr.KindConflict, "idempotency key belongs to a different release")
		}
		seen := map[uuid.UUID]bool{}
		for _, target := range item.Targets {
			seen[target.DeviceID] = true
		}
		for _, id := range input.DeviceIDs {
			if !seen[id] {
				return Release{}, apperr.New(apperr.KindConflict, "idempotency target mismatch")
			}
			delete(seen, id)
		}
		return item, nil
	}
	var existingID uuid.UUID
	err := s.db.QueryRow(ctx, `SELECT id FROM firmware_releases WHERE created_by=$1 AND idempotency_key=$2`, input.ActorAdminID, input.IdempotencyKey).Scan(&existingID)
	if err == nil {
		return existing(existingID)
	}
	if err != pgx.ErrNoRows {
		return Release{}, err
	}
	refs, err := s.targetRefs(ctx, input.DeviceIDs)
	if err != nil {
		return Release{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Release{}, err
	}
	defer tx.Rollback(ctx)
	artifact, err := scanArtifact(tx.QueryRow(ctx, artifactSelect+` WHERE a.id=$1 FOR SHARE OF a`, input.FirmwareID))
	if err != nil {
		return Release{}, err
	}
	if artifact.Archived {
		return Release{}, apperr.New(apperr.KindInvalidArgument, "firmware is archived")
	}
	for _, ref := range refs {
		if !artifactMatches(artifact, ref) {
			return Release{}, apperr.New(apperr.KindInvalidArgument, "firmware and device must match the same data source and family")
		}
	}
	releaseID := uuid.New()
	err = tx.QueryRow(ctx, `INSERT INTO firmware_releases(id,firmware_id,original_filename,object_key,public_url,content_type,size_bytes,version,firmware_version,verify_value,source_family,build_id,created_by,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(created_by,idempotency_key) DO NOTHING RETURNING id`, releaseID, artifact.ID, artifact.OriginalFilename, artifact.ObjectKey, artifact.PublicURL, artifact.ContentType, artifact.SizeBytes, artifact.Version, int64(artifact.FirmwareVersion), artifact.VerifyValue, artifact.SourceFamily, artifact.BuildID, input.ActorAdminID, input.IdempotencyKey).Scan(&releaseID)
	if err == pgx.ErrNoRows {
		_ = tx.Rollback(ctx)
		if e := s.db.QueryRow(ctx, `SELECT id FROM firmware_releases WHERE created_by=$1 AND idempotency_key=$2`, input.ActorAdminID, input.IdempotencyKey).Scan(&existingID); e != nil {
			return Release{}, e
		}
		return existing(existingID)
	}
	if err != nil {
		return Release{}, err
	}
	for _, ref := range refs {
		var sn any
		if ref.GatewaySN != "" {
			sn = ref.GatewaySN
		}
		if _, err = tx.Exec(ctx, `INSERT INTO firmware_release_targets(release_id,device_id,data_source_id,gateway_sn,external_device_id) VALUES($1,$2,$3,$4,$5)`, releaseID, ref.DeviceID, ref.DataSourceID, sn, ref.ExternalDeviceID); err != nil {
			return Release{}, err
		}
	}
	if err = recordFirmwareAudit(ctx, tx, input.ActorAdminID, "firmware.release.create", releaseID); err != nil {
		return Release{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Release{}, err
	}
	for _, ref := range refs {
		_ = s.publish(ctx, releaseID, ref.DeviceID, false)
	}
	return s.Get(ctx, releaseID)
}

// Re-check live bindings on retries. A device may have moved to another source
// since the original release, but the artifact's URL must never be repurposed.
func (s *Service) validatePublishingTarget(ctx context.Context, releaseID, deviceID, sourceID uuid.UUID, sn string, external *int64) error {
	refs, err := s.targetRefs(ctx, []uuid.UUID{deviceID})
	if err != nil {
		return err
	}
	ref := refs[0]
	sameExternal := ref.ExternalDeviceID == nil && external == nil || ref.ExternalDeviceID != nil && external != nil && *ref.ExternalDeviceID == *external
	if ref.DataSourceID != sourceID || ref.GatewaySN != sn || !sameExternal {
		return apperr.New(apperr.KindInvalidArgument, "device source binding changed; publication blocked")
	}
	var artifactID *uuid.UUID
	if err = s.db.QueryRow(ctx, `SELECT firmware_id FROM firmware_releases WHERE id=$1`, releaseID).Scan(&artifactID); err != nil {
		return err
	}
	if artifactID != nil {
		artifact, err := s.GetFirmware(ctx, *artifactID)
		if err != nil {
			return err
		}
		if artifact.Archived || !artifactMatches(artifact, ref) {
			return apperr.New(apperr.KindInvalidArgument, "firmware is archived or incompatible with current device")
		}
	}
	return nil
}
