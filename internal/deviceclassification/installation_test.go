package deviceclassification

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/testdb"
)

func TestManualInstallationMapDoesNotRequireSourceAvailability(t *testing.T) {
	db := testdb.Open(t, 0)
	id := uuid.New()
	ctx := t.Context()
	if _, err := db.Exec(ctx, `INSERT INTO devices(id,name,device_type) VALUES($1,'Installation','standalone')`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO device_profiles(device_id,latitude,longitude) VALUES($1,40.1,116.2)`, id); err != nil {
		t.Fatal(err)
	}
	called := false
	svc := NewService(db, func(context.Context, []uuid.UUID) (map[uuid.UUID]SourceLocation, error) {
		called = true
		return nil, nil
	})
	result, err := svc.Map(ctx, nil, false)
	if err != nil || len(result.Items) != 1 {
		t.Fatalf("map: %#v %v", result, err)
	}
	if called {
		t.Fatal("source lookup should be skipped for an explicit installation position")
	}
	if result.Items[0].LocationSource != "device" || result.Items[0].Latitude == nil || *result.Items[0].Latitude != 40.1 {
		t.Fatalf("installation position missing: %#v", result.Items[0])
	}
}

func TestMapKeepsGatewayAndPhysicalNodeIdentitiesSeparate(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source, gateway := uuid.New(), uuid.New()
	const gatewayAsset = "LR-82000001"
	const nodeAsset = "LR-82000002"
	const nodeSN = "FACTORY-NODE-031"
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by)
		VALUES($1,'LoRa source','http_api','lorawan_v2','env:UNUSED',$2)`, source, admin)
	must(`INSERT INTO devices(id,name,serial_no,asset_no,device_type)
		VALUES($1,'Gateway','LEGACY-GATEWAY-SERIAL',$2,'gateway')`, gateway, gatewayAsset)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key)
		VALUES($1,$2,'lorawan_v2','UPSTREAM-GATEWAY-SN')`, gateway, source)
	must(`INSERT INTO node_profiles(device_id,node_index,name,latitude,longitude,updated_by,updated_by_type)
		VALUES($1,31,'Soil node',40.1,116.2,$2,'system_admin')`, gateway, admin)
	must(`INSERT INTO lorawan_physical_nodes(data_source_id,external_id,sn,gateway_device_id,node_index,asset_no)
		VALUES($1,31,$2,$3,31,$4)`, source, nodeSN, gateway, nodeAsset)

	result, err := NewService(db).Map(ctx, nil, true)
	if err != nil || len(result.Items) != 2 {
		t.Fatalf("map: %#v %v", result, err)
	}
	parent, child := result.Items[0], result.Items[1]
	if parent.DeviceID != gateway || parent.AssetNo != gatewayAsset || parent.NodeSN != "" {
		t.Fatalf("gateway identity: %#v", parent)
	}
	if child.GatewayDeviceID == nil || *child.GatewayDeviceID != gateway || child.NodeIndex == nil || *child.NodeIndex != 31 ||
		child.AssetNo != nodeAsset || child.NodeSN != nodeSN || child.Name != "Soil node" {
		t.Fatalf("physical node inherited gateway identity: %#v", child)
	}
	encoded, err := json.Marshal(result)
	if err != nil || strings.Contains(string(encoded), "serial_no") || strings.Contains(string(encoded), "LEGACY-GATEWAY-SERIAL") {
		t.Fatalf("map exposes legacy identity: %s %v", encoded, err)
	}
}

func TestSimplifiedClassificationMigrationAndInheritance(t *testing.T) {
	db := testdb.Open(t, 61)
	ctx := t.Context()

	// Seed pre-migration site & device with legacy tables to verify data migration.
	userID, wsID, projectID, siteID, devID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	var forestID, grasslandID uuid.UUID
	if err := db.QueryRow(ctx, `SELECT id FROM device_taxonomy_terms WHERE kind='ecosystem' AND code='forest'`).Scan(&forestID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `SELECT id FROM device_taxonomy_terms WHERE kind='ecosystem' AND code='grassland'`).Scan(&grasslandID); err != nil {
		t.Fatal(err)
	}
	must := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO users(id,name,email) VALUES($1,'U',$2)`, userID, userID.String()+"@test.local")
	must(`INSERT INTO workspaces(id,type,name,owner_user_id) VALUES($1,'personal','WS',$2)`, wsID, userID)
	must(`INSERT INTO projects(id,workspace_id,name,created_by) VALUES($1,$2,'P',$3)`, projectID, wsID, userID)
	must(`INSERT INTO sites(id,workspace_id,project_id,name,description,latitude,longitude,created_by) VALUES($1,$2,$3,'S','坡向北',40,116,$4)`, siteID, wsID, projectID, userID)
	must(`INSERT INTO site_environment_profiles(site_id,ecosystem_term_id,altitude_m,research_tags) VALUES($1,$2,1234.5,ARRAY['长期观测'])`, siteID, forestID)
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'Station','standalone')`, devID)
	must(`INSERT INTO device_assignments(device_id,workspace_id,project_id,site_id) VALUES($1,$2,$3,$4)`, devID, wsID, projectID, siteID)
	must(`INSERT INTO device_environment_profiles(device_id,ecosystem_term_id,research_tags,overridden_fields) VALUES($1,$2,ARRAY['old-tag'],ARRAY['ecosystem'])`, devID, grasslandID)

	up, err := os.ReadFile("../../migrations/000062_simplify_device_classification.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, string(up)); err != nil {
		t.Fatalf("000062 up: %v", err)
	}

	svc := NewService(db)
	// Legacy device override and site default were migrated.
	env, err := svc.Get(ctx, devID)
	if err != nil {
		t.Fatal(err)
	}
	if env.Effective.Ecosystem == nil || env.Effective.Ecosystem.ID != grasslandID || env.Sources["ecosystem"] != "device" {
		t.Fatalf("expected migrated device ecosystem override, got %#v", env)
	}
	if env.Effective.AltitudeM == nil || *env.Effective.AltitudeM != 1234.5 {
		t.Fatalf("expected inherited site altitude, got %#v", env.Effective.AltitudeM)
	}
	var description string
	if err := db.QueryRow(ctx, `SELECT description FROM sites WHERE id=$1`, siteID).Scan(&description); err != nil || description != "坡向北\n研究方向：长期观测" {
		t.Fatalf("site description after migration: %q, %v", description, err)
	}
	offline := NewService(db, func(context.Context, []uuid.UUID) (map[uuid.UUID]SourceLocation, error) {
		return nil, errors.New("source unavailable")
	})
	mapped, err := offline.Map(ctx, &wsID, false)
	if err != nil || len(mapped.Items) != 1 {
		t.Fatalf("map: %+v, %v", mapped, err)
	}
	point := mapped.Items[0]
	if point.LocationSource != "site" || point.Latitude == nil || *point.Latitude != 40 || point.Longitude == nil || *point.Longitude != 116 ||
		point.Environment.Ecosystem == nil || point.Environment.Ecosystem.ID != grasslandID || len(point.Tags) != 1 || point.Tags[0] != "old-tag" {
		t.Fatalf("site fallback and workspace tags: %+v", point)
	}
	// Create a product dictionary term and attach it to the device without touching ecosystem override.
	product, err := svc.UpsertTerm(ctx, Term{Kind: "product", Code: "zc200_weather", NameZH: "ZC200气象观测站", NameEN: "ZC200 Weather Station", SortOrder: 10})
	if err != nil {
		t.Fatalf("upsert product term: %v", err)
	}
	env, err = svc.Update(ctx, UpdateInput{DeviceID: devID, ProductID: &product.ID, ProductSet: true, ActorID: userID, ActorType: "system_admin"})
	if err != nil {
		t.Fatalf("set product: %v", err)
	}
	if env.Effective.Product == nil || env.Effective.Product.Code != "zc200_weather" || env.Effective.Ecosystem == nil || env.Effective.Ecosystem.ID != grasslandID {
		t.Fatalf("product update unexpectedly altered ecosystem: %#v", env)
	}
	// Deleting an in-use product term must fail with conflict.
	if err := svc.DeleteTerm(ctx, product.ID); err == nil {
		t.Fatal("expected delete of referenced product term to fail")
	}
	// A child inherits the gateway's ecological classification, but not its product name.
	child, source := uuid.New(), uuid.New()
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'Probe','gateway_node')`, child)
	must(`UPDATE devices SET device_type='gateway' WHERE id=$1`, devID)
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'Source','mysql','thcpn','env:UNUSED',$2)`, source, testdb.Admin(t, db))
	must(`INSERT INTO device_relations(parent_device_id,child_device_id,data_source_id,external_parent_device_id,external_child_device_id,relation_type) VALUES($1,$2,$3,1,2,'gateway_node')`, devID, child, source)
	childEnv, err := svc.Get(ctx, child)
	if err != nil || childEnv.Effective.Ecosystem == nil || childEnv.Effective.Ecosystem.ID != grasslandID || childEnv.Sources["ecosystem"] != "gateway" || childEnv.Effective.Product != nil {
		t.Fatalf("child classification: %+v, %v", childEnv, err)
	}
	// Clearing ecosystem override falls back to site ecosystem while keeping product.
	env, err = svc.Update(ctx, UpdateInput{DeviceID: devID, OverriddenFields: []string{}, OverriddenSet: true, ActorID: userID, ActorType: "system_admin"})
	if err != nil {
		t.Fatalf("clear ecosystem override: %v", err)
	}
	if env.Effective.Ecosystem == nil || env.Effective.Ecosystem.ID != forestID || env.Sources["ecosystem"] != "site" {
		t.Fatalf("expected fallback to site forest ecosystem, got %#v", env)
	}
	if env.Effective.Product == nil || env.Effective.Product.ID != product.ID {
		t.Fatalf("expected product to remain after ecosystem reset, got %#v", env)
	}

	if _, err := svc.Update(ctx, UpdateInput{DeviceID: devID, ProductSet: true, ProductID: &forestID, ActorID: userID}); err == nil {
		t.Fatal("accepted ecosystem term as a product")
	}
	var removed bool
	if err := db.QueryRow(ctx, `SELECT to_regclass('device_environment_profiles') IS NULL AND to_regclass('device_environment_terms') IS NULL
   AND to_regclass('site_environment_profiles') IS NULL AND to_regclass('site_environment_terms') IS NULL`).Scan(&removed); err != nil || !removed {
		t.Fatalf("legacy tables still present: %v", err)
	}

	// Verify down -> up migration round-trip.
	down, err := os.ReadFile("../../migrations/000062_simplify_device_classification.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, string(down)); err != nil {
		t.Fatalf("000062 down: %v", err)
	}
	if _, err := db.Exec(ctx, string(up)); err != nil {
		t.Fatalf("000062 re-up: %v", err)
	}
}
