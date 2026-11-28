package site

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/testdb"
)

func TestCreateRequiresSiteName(t *testing.T) {
	service := NewService(nil)

	_, err := service.Create(context.Background(), CreateInput{
		WorkspaceID: uuid.New(),
		ProjectID:   uuid.New(),
		ActorUserID: uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestValidateCoordinates(t *testing.T) {
	lat := 91.0
	if apperr.KindOf(validateCoordinates(&lat, nil)) != apperr.KindInvalidArgument {
		t.Fatal("expected invalid latitude to be rejected")
	}

	lon := 181.0
	if apperr.KindOf(validateCoordinates(nil, &lon)) != apperr.KindInvalidArgument {
		t.Fatal("expected invalid longitude to be rejected")
	}
}

func TestSiteStatusValidation(t *testing.T) {
	for _, status := range []string{"active", "archived"} {
		if !isValidSiteStatus(status) {
			t.Fatalf("expected %q to be valid", status)
		}
	}
	if isValidSiteStatus("disabled") {
		t.Fatal("disabled should not be a valid site status")
	}
}

func TestSiteClassificationAndNullableLocation(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	user, workspace, project := uuid.New(), uuid.New(), uuid.New()
	for _, seed := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO users(id,name,email) VALUES($1,'Owner',$2)`, []any{user, user.String() + "@test.local"}},
		{`INSERT INTO workspaces(id,type,name,owner_user_id) VALUES($1,'personal','Workspace',$2)`, []any{workspace, user}},
		{`INSERT INTO projects(id,workspace_id,name,created_by) VALUES($1,$2,'Project',$3)`, []any{project, workspace, user}},
	} {
		if _, err := db.Exec(ctx, seed.sql, seed.args...); err != nil {
			t.Fatal(err)
		}
	}
	var forest uuid.UUID
	if err := db.QueryRow(ctx, `SELECT id FROM device_taxonomy_terms WHERE kind='ecosystem' AND code='forest'`).Scan(&forest); err != nil {
		t.Fatal(err)
	}
	zero := 0.0
	svc := NewService(db)
	created, err := svc.Create(ctx, CreateInput{WorkspaceID: workspace, ProjectID: project, ActorUserID: user, Name: "Forest", Description: "坡向北", LocationText: "东灵山", Latitude: &zero, Longitude: &zero, AltitudeM: &zero, EcosystemTermID: &forest})
	if err != nil || created.ID == uuid.Nil {
		t.Fatalf("create site: %+v %v", created, err)
	}
	var patch updateSiteRequest
	if err = json.Unmarshal([]byte(`{"latitude":null,"longitude":null,"altitude_m":null}`), &patch); err != nil {
		t.Fatal(err)
	}
	updated, err := svc.Update(ctx, UpdateInput{SiteID: created.ID, LatitudeSet: patch.LatitudeSet, LongitudeSet: patch.LongitudeSet, AltitudeMSet: patch.AltitudeMSet, EcosystemTermIDSet: patch.EcosystemTermIDSet})
	if err != nil || updated.Latitude != nil || updated.Longitude != nil || updated.AltitudeM != nil || updated.EcosystemTermID == nil || *updated.EcosystemTermID != forest || updated.Description == nil || *updated.Description != "坡向北" {
		t.Fatalf("clear location only: %+v %v", updated, err)
	}
	status := "archived"
	updated, err = svc.Update(ctx, UpdateInput{SiteID: created.ID, EcosystemTermIDSet: true, Status: &status})
	if err != nil || updated.Status != "archived" || updated.EcosystemTermID != nil {
		t.Fatalf("clear classification and archive: %+v %v", updated, err)
	}
}
