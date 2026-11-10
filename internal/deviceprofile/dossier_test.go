package deviceprofile

import (
	"encoding/json"
	"github.com/google/uuid"
	"os"
	"strings"
	"testing"
	"thcpn-gin/internal/testdb"
	"time"
)

func TestInstallationLifecycleAndPrivateFields(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	id := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO devices(id,name,device_type) VALUES($1,'Station','standalone')`, id); err != nil {
		t.Fatal(err)
	}
	svc := NewService(db, nil, nil)
	empty, err := svc.Installation(ctx, id, true)
	if err != nil || empty.InstalledOn != nil {
		t.Fatalf("empty dossier: %#v %v", empty, err)
	}
	date := "2026-10-31"
	input := InstallationInput{InstalledOn: &date, ContactName: "Contact", ContactPhone: "123456", Organization: "Research lab", ProjectName: "Trial", OpsTags: []string{" priority ", "priority"}, Complete: true}
	record, err := svc.SaveInstallation(ctx, id, admin, input)
	if err != nil {
		t.Fatal(err)
	}
	if record.InstallerID == nil || *record.InstallerID != admin || len(record.OpsTags) != 1 {
		t.Fatalf("installer and tags: %#v", record)
	}
	var status string
	if err = db.QueryRow(ctx, "SELECT lifecycle_status FROM devices WHERE id=$1", id).Scan(&status); err != nil || status != "online" {
		t.Fatalf("completion: %s %v", status, err)
	}
	public, err := svc.Installation(ctx, id, false)
	if err != nil {
		t.Fatal(err)
	}
	bytes, _ := json.Marshal(public)
	for _, secret := range []string{"contact_phone", "contact_name", "organization", "installer_id", "installer_name", "ops_tags", "updated_by"} {
		if strings.Contains(string(bytes), secret) {
			t.Fatalf("private field leaked: %s", bytes)
		}
	}
	if public.InstalledOn == nil || public.ProjectName != "Trial" {
		t.Fatal("public installation summary missing")
	}
	second := testdb.Admin(t, db)
	input.ContactName = "Changed"
	input.Complete = false
	after, err := svc.SaveInstallation(ctx, id, second, input)
	if err != nil || after.InstallerID == nil || *after.InstallerID != admin || after.UpdatedBy == nil || *after.UpdatedBy != second {
		t.Fatalf("installer changed on edit: %#v %v", after, err)
	}
	if _, err = db.Exec(ctx, "UPDATE devices SET lifecycle_status='retired' WHERE id=$1", id); err != nil {
		t.Fatal(err)
	}
	input.Complete = true
	if _, err = svc.SaveInstallation(ctx, id, admin, input); err == nil {
		t.Fatal("retired station accepted completion")
	}
}
func TestInstallationValidationAndWorkspaceTagIsolation(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	svc := NewService(db, nil, nil)
	admin := testdb.Admin(t, db)
	id := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO devices(id,name,device_type) VALUES($1,'Station','standalone')`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveInstallation(ctx, id, admin, InstallationInput{Complete: true}); err == nil {
		t.Fatal("missing date accepted")
	}
	invalid := "2026-02-31"
	if _, err := svc.SaveInstallation(ctx, id, admin, InstallationInput{InstalledOn: &invalid}); err == nil {
		t.Fatal("invalid date accepted")
	}
	for _, workspace := range []uuid.UUID{uuid.New(), uuid.New()} {
		// User account identity remains separate from administrator identity.
		user := uuid.New()
		if _, err := db.Exec(ctx, "INSERT INTO users(id,name,status,email) VALUES($1,'Member','active',$2)", user, user.String()+"@example.test"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(ctx, "INSERT INTO workspaces(id,name,type,owner_user_id) VALUES($1,'Workspace','personal',$2)", workspace, user); err != nil {
			t.Fatal(err)
		}
		value := workspace.String()
		if _, err := svc.SaveWorkspaceTags(ctx, id, workspace, user, []string{value}); err != nil {
			t.Fatal(err)
		}
		got, err := svc.WorkspaceTags(ctx, id, workspace)
		if err != nil || len(got) != 1 || got[0] != value {
			t.Fatalf("tag isolation: %v %v", got, err)
		}
	}
	if _, err := cleanTags([]string{strings.Repeat("长", 51)}); err == nil {
		t.Fatal("oversized tag accepted")
	}
}

func TestDossierMigrationPreservesHistory(t *testing.T) {
	db := testdb.Open(t, 48)
	ctx := t.Context()
	id := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO devices(id,name,device_type,lifecycle_status) VALUES($1,'Legacy','standalone','maintenance');`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO device_lifecycle_events(device_id,to_status,occurred_at) VALUES($1,'maintenance',now())`, id); err != nil {
		t.Fatal(err)
	}
	user := uuid.New()
	workspace := uuid.New()
	if _, err := db.Exec(ctx, "INSERT INTO users(id,name,email) VALUES($1,'Owner',$2)", user, user.String()+"@test.example"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "INSERT INTO workspaces(id,type,name,owner_user_id) VALUES($1,'personal','Old workspace',$2)", workspace, user); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "INSERT INTO device_assignments(device_id,workspace_id) VALUES($1,$2)", id, workspace); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "INSERT INTO device_environment_profiles(device_id,research_tags) VALUES($1,ARRAY['legacy-tag'])", id); err != nil {
		t.Fatal(err)
	}
	up, err := os.ReadFile("../../migrations/000049_device_dossiers.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, string(up)); err != nil {
		t.Fatal(err)
	}
	tags, err := NewService(db, nil, nil).WorkspaceTags(ctx, id, workspace)
	if err != nil || len(tags) != 1 || tags[0] != "legacy-tag" {
		t.Fatalf("legacy tags not preserved: %v %v", tags, err)
	}

	var status string
	if err = db.QueryRow(ctx, "SELECT lifecycle_status FROM devices WHERE id=$1", id).Scan(&status); err != nil || status != "online" {
		t.Fatalf("current stage: %s %v", status, err)
	}
	if err = db.QueryRow(ctx, "SELECT to_status FROM device_lifecycle_events WHERE device_id=$1", id).Scan(&status); err != nil || status != "maintenance" {
		t.Fatalf("history changed: %s %v", status, err)
	}
	down, err := os.ReadFile("../../migrations/000049_device_dossiers.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, string(down)); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, string(up)); err != nil {
		t.Fatal(err)
	}
}
func TestCompleteInstallationRegistersObservationStartAtomically(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	actor := testdb.Admin(t, db)
	id := uuid.New()
	if _, err := db.Exec(ctx, "INSERT INTO devices(id,name,device_type) VALUES($1,'Station','standalone')", id); err != nil {
		t.Fatal(err)
	}
	svc := NewService(db, nil, nil)
	date := "2026-11-01"
	formal := time.Date(2026, 11, 1, 1, 0, 0, 0, time.UTC)
	if _, err := svc.SaveInstallation(ctx, id, actor, InstallationInput{InstalledOn: &date, Complete: true, ObservationStartAt: &formal}); err != nil {
		t.Fatal(err)
	}
	var got time.Time
	if err := db.QueryRow(ctx, "SELECT starts_at FROM device_observation_starts WHERE device_id=$1 AND node_index=0", id).Scan(&got); err != nil || !got.Equal(formal) {
		t.Fatalf("installation cutoff: %v", err)
	}
	if _, err := svc.SaveInstallation(ctx, id, actor, InstallationInput{InstalledOn: &date, Complete: true}); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, "SELECT starts_at FROM device_observation_starts WHERE device_id=$1 AND node_index=0", id).Scan(&got); err != nil || !got.Equal(formal) {
		t.Fatal("completing again reset formal start")
	}
}

func TestDossierEditsExistingLocationWithoutChangingCoordinatesOrObservation(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	actor := testdb.Admin(t, db)
	id := uuid.New()
	if _, err := db.Exec(ctx, "INSERT INTO devices(id,name,device_type) VALUES($1,'Station','standalone')", id); err != nil {
		t.Fatal(err)
	}
	svc := NewService(db, nil, nil)
	legacyAddress := "森林站样地西侧"
	if _, err := svc.Update(ctx, UpdateProfileInput{DeviceID: id, LocationText: &legacyAddress, Administrator: true}); err != nil {
		t.Fatal(err)
	}
	lat, lon := 39.9, 116.4
	if _, err := svc.SetLocation(ctx, id, &lat, &lon); err != nil {
		t.Fatal(err)
	}
	if initial, err := svc.Installation(ctx, id, true); err != nil || initial.LocationText != legacyAddress {
		t.Fatalf("legacy address missing: %#v %v", initial, err)
	}
	address := "北京市 海淀区 森林站样地西侧"
	input := InstallationInput{ContactName: "Contact", Profile: &InstallationProfileInput{
		LocationText: address, Description: "支架已固定",
	}}
	record, err := svc.SaveInstallation(ctx, id, actor, input)
	if err != nil || record.LocationText != address || record.Description != "支架已固定" {
		t.Fatalf("address and dossier not saved together: %#v %v", record, err)
	}
	profile, err := svc.Get(ctx, id)
	if err != nil || profile.LocationText == nil || *profile.LocationText != address ||
		profile.ManualLatitude == nil || *profile.ManualLatitude != lat || profile.ManualLongitude == nil || *profile.ManualLongitude != lon {
		t.Fatalf("shared address or coordinates changed unexpectedly: %#v %v", profile, err)
	}
	var stage string
	var hasStart bool
	err = db.QueryRow(ctx, `SELECT lifecycle_status, EXISTS(SELECT 1 FROM device_observation_starts WHERE device_id=$1) FROM devices WHERE id=$1`, id).Scan(&stage, &hasStart)
	if err != nil || stage != "inbound" || hasStart {
		t.Fatalf("saving a draft must not complete installation: %q %v %v", stage, hasStart, err)
	}
	input.ContactName = "Changed"
	input.Profile.LocationText = strings.Repeat("长", 501)
	if _, err = svc.SaveInstallation(ctx, id, actor, input); err == nil {
		t.Fatal("oversized address accepted")
	}
	record, err = svc.Installation(ctx, id, true)
	if err != nil || record.LocationText != address || record.ContactName != "Contact" {
		t.Fatalf("failed edit changed stored data: %#v %v", record, err)
	}
	record, err = svc.SaveInstallation(ctx, id, actor, InstallationInput{ContactName: "Changed"})
	if err != nil || record.LocationText != address || record.Description != "支架已固定" {
		t.Fatalf("omitting the profile erased the address or notes: %#v %v", record, err)
	}
	public, err := svc.Installation(ctx, id, false)
	if err != nil || public.LocationText != "" || public.Description != "" {
		t.Fatalf("admin profile fields were included in the installation summary: %#v %v", public, err)
	}
}
