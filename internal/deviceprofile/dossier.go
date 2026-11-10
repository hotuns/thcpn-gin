package deviceprofile

import (
	"context"
	"errors"
	"strings"
	"thcpn-gin/internal/systemsettings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/observation"
)

type Installation struct {
	DeviceID         uuid.UUID  `json:"device_id"`
	InstalledOn      *string    `json:"installed_on"`
	InstallerID      *uuid.UUID `json:"installer_id,omitempty"`
	InstallerName    string     `json:"installer_name,omitempty"`
	ContactName      string     `json:"contact_name,omitempty"`
	ContactPhone     string     `json:"contact_phone,omitempty"`
	Organization     string     `json:"organization,omitempty"`
	ProjectName      string     `json:"project_name"`
	RecordedProject  string     `json:"recorded_project_name,omitempty"`
	LinkedProject    string     `json:"linked_project_name,omitempty"`
	LocationText     string     `json:"location_text,omitempty"`
	Description      string     `json:"description,omitempty"`
	RetiredOn        *string    `json:"retired_on,omitempty"`
	RetirementReason string     `json:"retirement_reason,omitempty"`
	OpsTags          []string   `json:"ops_tags,omitempty"`
	UpdatedBy        *uuid.UUID `json:"updated_by,omitempty"`
	UpdatedAt        *time.Time `json:"updated_at,omitempty"`
}
type InstallationInput struct {
	ObservationStartAt *time.Time                `json:"observation_start_at"`
	InstalledOn        *string                   `json:"installed_on"`
	ContactName        string                    `json:"contact_name"`
	ContactPhone       string                    `json:"contact_phone"`
	Organization       string                    `json:"organization"`
	ProjectName        string                    `json:"project_name"`
	OpsTags            []string                  `json:"ops_tags"`
	Complete           bool                      `json:"complete_installation"`
	Profile            *InstallationProfileInput `json:"profile"`
}

type InstallationProfileInput struct {
	LocationText string `json:"location_text"`
	Description  string `json:"description"`
}

func (s *Service) Installation(ctx context.Context, id uuid.UUID, admin bool) (Installation, error) {
	result := Installation{DeviceID: id, OpsTags: []string{}}
	err := s.db.QueryRow(ctx, `SELECT i.installed_on::text,i.installer_id,COALESCE(a.name,''),COALESCE(i.contact_name,''),COALESCE(i.contact_phone,''),COALESCE(i.organization,''),COALESCE(i.project_name,''),COALESCE(p.name,''),COALESCE(profile.location_text,''),COALESCE(profile.description,''),i.retired_on::text,COALESCE(i.retirement_reason,''),COALESCE(i.ops_tags,'{}'::text[]),i.updated_by,i.updated_at
 FROM devices d LEFT JOIN device_installation_records i ON i.device_id=d.id LEFT JOIN system_admins a ON a.id=i.installer_id
 LEFT JOIN device_assignments da ON da.device_id=d.id AND da.status='active' LEFT JOIN projects p ON p.id=da.project_id
 LEFT JOIN device_profiles profile ON profile.device_id=d.id
 WHERE d.id=$1`, id).Scan(&result.InstalledOn, &result.InstallerID, &result.InstallerName, &result.ContactName, &result.ContactPhone, &result.Organization, &result.RecordedProject, &result.LinkedProject, &result.LocationText, &result.Description, &result.RetiredOn, &result.RetirementReason, &result.OpsTags, &result.UpdatedBy, &result.UpdatedAt)
	if err != nil {
		return result, mapNotFound(err, "device not found")
	}
	result.ProjectName = result.RecordedProject
	if result.LinkedProject != "" {
		result.ProjectName = result.LinkedProject
	}
	if !admin {
		result.InstallerID = nil
		result.InstallerName = ""
		result.ContactName = ""
		result.ContactPhone = ""
		result.Organization = ""
		result.RecordedProject = ""
		result.LinkedProject = ""
		result.LocationText = ""
		result.Description = ""
		result.OpsTags = nil
		result.UpdatedBy = nil
		result.UpdatedAt = nil
		result.RetirementReason = ""
	}
	return result, nil
}

func cleanTags(tags []string, contexts ...context.Context) ([]string, error) {
	ctx := systemsettings.Context(contexts...)
	out := []string{}
	seen := map[string]bool{}
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || seen[tag] {
			continue
		}
		if utf8.RuneCountInString(tag) > systemsettings.Int(ctx, "tag_length", 50) {
			return nil, apperr.LimitExceeded("tag_length", int64(systemsettings.Int(ctx, "tag_length", 50)), int64(utf8.RuneCountInString(tag)), "characters")
		}
		seen[tag] = true
		out = append(out, tag)
	}
	if len(out) > systemsettings.Int(ctx, "tag_count", 30) {
		return nil, apperr.LimitExceeded("tag_count", int64(systemsettings.Int(ctx, "tag_count", 30)), int64(len(out)), "items")
	}
	return out, nil
}
func (s *Service) SaveInstallation(ctx context.Context, id, actor uuid.UUID, input InstallationInput) (Installation, error) {
	tags, err := cleanTags(input.OpsTags, ctx)
	if err != nil {
		return Installation{}, err
	}
	if input.Complete && input.InstalledOn == nil {
		return Installation{}, apperr.New(apperr.KindInvalidArgument, "完成安装需要安装日期")
	}
	if input.InstalledOn != nil {
		if _, err = time.Parse("2006-01-02", *input.InstalledOn); err != nil {
			return Installation{}, apperr.New(apperr.KindInvalidArgument, "安装日期格式应为 YYYY-MM-DD")
		}
	}
	for _, str := range []string{input.ContactName, input.ContactPhone, input.Organization, input.ProjectName} {
		if utf8.RuneCountInString(str) > 200 {
			return Installation{}, apperr.New(apperr.KindInvalidArgument, "安装档案字段最多200个字符")
		}
	}
	var location, description *string
	if input.Profile != nil {
		location = cleanOptional(&input.Profile.LocationText)
		description = cleanOptional(&input.Profile.Description)
		if location != nil && utf8.RuneCountInString(*location) > 500 {
			return Installation{}, apperr.New(apperr.KindInvalidArgument, "安装地址最多500个字符")
		}
		if description != nil && utf8.RuneCountInString(*description) > 4000 {
			return Installation{}, apperr.New(apperr.KindInvalidArgument, "安装说明最多4000个字符")
		}
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Installation{}, err
	}
	defer tx.Rollback(ctx)
	var status string
	if err = tx.QueryRow(ctx, "SELECT lifecycle_status FROM devices WHERE id=$1 FOR UPDATE", id).Scan(&status); err != nil {
		return Installation{}, mapNotFound(err, "device not found")
	}
	if input.Complete && status == "retired" {
		return Installation{}, apperr.New(apperr.KindInvalidArgument, "已退役设备请先调整生命周期再完成安装")
	}
	_, err = tx.Exec(ctx, `INSERT INTO device_installation_records(device_id,installed_on,installer_id,contact_name,contact_phone,organization,project_name,ops_tags,updated_by)
 VALUES($1,$2,CASE WHEN $2::date IS NULL THEN NULL ELSE $3::uuid END,$4,$5,$6,$7,$8,$3)
 ON CONFLICT(device_id) DO UPDATE SET installed_on=EXCLUDED.installed_on,installer_id=COALESCE(device_installation_records.installer_id,EXCLUDED.installer_id),contact_name=EXCLUDED.contact_name,contact_phone=EXCLUDED.contact_phone,organization=EXCLUDED.organization,project_name=EXCLUDED.project_name,ops_tags=EXCLUDED.ops_tags,updated_by=$3,updated_at=now()`, id, input.InstalledOn, actor, strings.TrimSpace(input.ContactName), strings.TrimSpace(input.ContactPhone), strings.TrimSpace(input.Organization), strings.TrimSpace(input.ProjectName), tags)
	if err != nil {
		return Installation{}, err
	}
	if input.Profile != nil {
		_, err = sqlc.New(tx).UpsertDeviceProfile(ctx, sqlc.UpsertDeviceProfileParams{
			DeviceID: id, LocationText: location, Description: description,
		})
		if err != nil {
			return Installation{}, apperr.Wrap(apperr.KindInternal, "save installation location and description", err)
		}
	}
	if input.Complete && status != "online" {
		if _, err = tx.Exec(ctx, `UPDATE devices SET lifecycle_status='online',lifecycle_updated_at=now(),updated_at=now() WHERE id=$1`, id); err != nil {
			return Installation{}, err
		}
		// System administrator identity is retained on the installation and audit records.
		if _, err = tx.Exec(ctx, `INSERT INTO device_lifecycle_events(device_id,from_status,to_status,occurred_at,note) VALUES($1,$2,'online',now(),'完成安装')`, id, status); err != nil {
			return Installation{}, err
		}
	}
	if input.Complete {
		at := input.ObservationStartAt
		if at == nil {
			var existing bool
			if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM device_observation_starts WHERE device_id=$1 AND node_index=0)", id).Scan(&existing); err != nil {
				return Installation{}, err
			}
			if !existing {
				now := time.Now().UTC()
				at = &now
			}
		}
		if at != nil {
			if err = observation.SetTx(ctx, tx, id, actor, 0, at, "完成安装，开始正式观测"); err != nil {
				return Installation{}, err
			}
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return Installation{}, err
	}
	return s.Installation(ctx, id, true)
}
func (s *Service) WorkspaceTags(ctx context.Context, id, workspace uuid.UUID) ([]string, error) {
	tags := []string{}
	err := s.db.QueryRow(ctx, "SELECT tags FROM device_workspace_tags WHERE device_id=$1 AND workspace_id=$2", id, workspace).Scan(&tags)
	if errors.Is(err, pgx.ErrNoRows) {
		return []string{}, nil
	}
	return tags, err
}
func (s *Service) SaveWorkspaceTags(ctx context.Context, id, workspace, actor uuid.UUID, tags []string) ([]string, error) {
	cleaned, err := cleanTags(tags, ctx)
	if err != nil {
		return nil, err
	}
	_, err = s.db.Exec(ctx, `INSERT INTO device_workspace_tags(device_id,workspace_id,tags,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(device_id,workspace_id) DO UPDATE SET tags=$3,updated_by=$4,updated_at=now()`, id, workspace, cleaned, actor)
	return cleaned, err
}
