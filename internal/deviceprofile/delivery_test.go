package deviceprofile

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/testdb"
)

func TestUpdateDeliveryPreservesInstallationAndLinkedProject(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	svc := NewService(db, nil, nil)
	id, emptyID := uuid.New(), uuid.New()
	owner, workspace, project := uuid.New(), uuid.New(), uuid.New()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("INSERT INTO devices(id,name,device_type) VALUES($1,'Installed station','standalone'),($2,'New station','standalone')", id, emptyID)
	exec("INSERT INTO users(id,name,email) VALUES($1,'Owner','delivery-owner@example.test')", owner)
	exec("INSERT INTO workspaces(id,type,name,owner_user_id) VALUES($1,'personal','Field team',$2)", workspace, owner)
	exec("INSERT INTO projects(id,workspace_id,name,created_by) VALUES($1,$2,'Linked project',$3)", project, workspace, owner)
	exec("INSERT INTO device_assignments(device_id,workspace_id,project_id) VALUES($1,$2,$3)", id, workspace, project)

	date := "2026-11-01"
	formalStart := time.Date(2026, 11, 1, 1, 0, 0, 0, time.UTC)
	if _, err := svc.SaveInstallation(ctx, id, admin, InstallationInput{
		InstalledOn: &date, Complete: true, ObservationStartAt: &formalStart,
		Organization: "Existing organization", ProjectName: "Recorded project", ContactName: "Existing contact",
		OpsTags: []string{"Field team"}, Profile: &InstallationProfileInput{
			LocationText: "North gate", Description: "Check mounting",
		},
	}); err != nil {
		t.Fatal(err)
	}

	input := DeliveryUpdateInput{DeliveryFields: DeliveryFields{
		Organization: " New organization ", ProjectName: "New project", ContactName: "New contact", ContactPhone: "123456",
	}}
	result, err := svc.UpdateDelivery(ctx, id, admin, input)
	if err != nil || result.Updated || !result.LinkedProjectRetained {
		t.Fatalf("fill must skip an existing organization, a partial contact, and a linked project: %+v, %v", result, err)
	}
	record, err := svc.Installation(ctx, id, true)
	if err != nil || record.Organization != "Existing organization" || record.ContactName != "Existing contact" || record.ContactPhone != "" {
		t.Fatalf("fill changed existing delivery information: %+v, %v", record, err)
	}

	input.Overwrite = true
	result, err = svc.UpdateDelivery(ctx, id, admin, input)
	if err != nil || !result.Updated || !result.LinkedProjectRetained {
		t.Fatalf("overwrite: %+v, %v", result, err)
	}
	record, err = svc.Installation(ctx, id, true)
	if err != nil || record.Organization != "New organization" || record.ContactName != "New contact" || record.ContactPhone != "123456" ||
		record.ProjectName != "Linked project" || record.RecordedProject != "Recorded project" {
		t.Fatalf("delivery or project values: %+v, %v", record, err)
	}
	if record.InstalledOn == nil || *record.InstalledOn != date || record.InstallerID == nil || *record.InstallerID != admin ||
		record.LocationText != "North gate" || record.Description != "Check mounting" || len(record.OpsTags) != 1 || record.OpsTags[0] != "Field team" {
		t.Fatalf("overwrite changed unrelated installation fields: %+v", record)
	}
	var lifecycle string
	var startsAt time.Time
	err = db.QueryRow(ctx, `SELECT lifecycle_status, starts_at FROM devices JOIN device_observation_starts ON device_id=id AND node_index=0 WHERE id=$1`, id).Scan(&lifecycle, &startsAt)
	if err != nil || lifecycle != "online" || !startsAt.Equal(formalStart) {
		t.Fatalf("lifecycle or formal observation changed: %s, %v, %v", lifecycle, startsAt, err)
	}

	input.Overwrite = false
	result, err = svc.UpdateDelivery(ctx, emptyID, admin, input)
	if err != nil || !result.Updated || result.LinkedProjectRetained {
		t.Fatalf("fill new dossier: %+v, %v", result, err)
	}
	partial := DeliveryUpdateInput{DeliveryFields: DeliveryFields{Organization: "Changed", ContactPhone: "55555"}, Overwrite: true}
	if _, err = svc.UpdateDelivery(ctx, emptyID, admin, partial); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("phone without a contact should be rejected: %v", err)
	}
	record, err = svc.Installation(ctx, emptyID, true)
	if err != nil || record.Organization != "New organization" || record.ProjectName != "New project" || record.ContactPhone != "123456" ||
		record.InstalledOn != nil || record.InstallerID != nil {
		t.Fatalf("new delivery edit must not install or record a partial update: %+v, %v", record, err)
	}
}
