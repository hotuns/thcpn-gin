package deviceprofile

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
)

type DeliveryFields struct {
	Organization string `json:"organization"`
	ProjectName  string `json:"project_name"`
	ContactName  string `json:"contact_name"`
	ContactPhone string `json:"contact_phone"`
}

type DeliveryUpdateInput struct {
	DeliveryFields
	Overwrite bool `json:"overwrite"`
}

type DeliveryUpdateResult struct {
	Updated               bool `json:"updated"`
	LinkedProjectRetained bool `json:"linked_project_retained"`
}

func (s *Service) UpdateDelivery(ctx context.Context, id, actor uuid.UUID, input DeliveryUpdateInput) (DeliveryUpdateResult, error) {
	values := input.DeliveryFields
	for _, field := range []*string{&values.Organization, &values.ProjectName, &values.ContactName, &values.ContactPhone} {
		*field = strings.TrimSpace(*field)
		if utf8.RuneCountInString(*field) > 200 {
			return DeliveryUpdateResult{}, apperr.New(apperr.KindInvalidArgument, "交付信息每项最多200个字符")
		}
	}
	if values == (DeliveryFields{}) {
		return DeliveryUpdateResult{}, apperr.New(apperr.KindInvalidArgument, "请填写至少一项交付信息")
	}
	if (values.ContactName == "") != (values.ContactPhone == "") {
		return DeliveryUpdateResult{}, apperr.New(apperr.KindInvalidArgument, "联系人和联系电话请一起填写")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return DeliveryUpdateResult{}, err
	}
	defer tx.Rollback(ctx)

	var existing DeliveryFields
	var linkedProject bool
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(i.organization,''), COALESCE(i.project_name,''), COALESCE(i.contact_name,''), COALESCE(i.contact_phone,''),
		       EXISTS (SELECT 1 FROM device_assignments da WHERE da.device_id=d.id AND da.status='active' AND da.project_id IS NOT NULL)
		FROM devices d
		LEFT JOIN device_installation_records i ON i.device_id=d.id
		WHERE d.id=$1 FOR UPDATE OF d`, id).Scan(&existing.Organization, &existing.ProjectName, &existing.ContactName, &existing.ContactPhone, &linkedProject)
	if err != nil {
		return DeliveryUpdateResult{}, mapNotFound(err, "device not found")
	}

	next := existing
	if values.Organization != "" && (input.Overwrite || strings.TrimSpace(existing.Organization) == "") {
		next.Organization = values.Organization
	}
	if values.ProjectName != "" && !linkedProject && (input.Overwrite || strings.TrimSpace(existing.ProjectName) == "") {
		next.ProjectName = values.ProjectName
	}
	emptyContact := strings.TrimSpace(existing.ContactName) == "" && strings.TrimSpace(existing.ContactPhone) == ""
	if values.ContactName != "" && (input.Overwrite || emptyContact) {
		next.ContactName, next.ContactPhone = values.ContactName, values.ContactPhone
	}
	result := DeliveryUpdateResult{Updated: next != existing, LinkedProjectRetained: linkedProject && values.ProjectName != ""}
	if !result.Updated {
		return result, nil
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO device_installation_records(device_id,organization,project_name,contact_name,contact_phone,updated_by)
		VALUES($1,$2,$3,$4,$5,$6)
		ON CONFLICT(device_id) DO UPDATE SET organization=EXCLUDED.organization, project_name=EXCLUDED.project_name,
		  contact_name=EXCLUDED.contact_name, contact_phone=EXCLUDED.contact_phone, updated_by=EXCLUDED.updated_by, updated_at=now()`,
		id, next.Organization, next.ProjectName, next.ContactName, next.ContactPhone, actor)
	if err != nil {
		return DeliveryUpdateResult{}, err
	}
	return result, tx.Commit(ctx)
}
