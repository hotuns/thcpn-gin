package datasource

import (
	"testing"

	"github.com/google/uuid"
	"thcpn-gin/internal/testdb"
)

func TestSensorTemplateVersionMigration(t *testing.T) {
	db := testdb.Open(t, 39)
	ctx := t.Context()
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	var original int64
	if err := db.QueryRow(ctx, `INSERT INTO sensor_templates(sensor_type, params, metrics) VALUES('Shared', '{"contents":[{"key":"temp","info":{"name":"Temperature"}}]}', '[{"key":"temp","info":{"name":"Temperature"}}]') RETURNING id`).Scan(&original); err != nil {
		t.Fatal(err)
	}
	must(`INSERT INTO sensor_template_variants(template_id,source_family,config) VALUES($1,'thcpn','{}'),($1,'lorawan_v2','{"wait_time":60,"content":[["iic",["SHT30","0x44",["temp"]]]]}')`, original)
	device := uuid.New()
	must(`INSERT INTO devices(id,name,serial_no,device_type,status) VALUES($1,'Gateway','version-test','gateway','active')`, device)
	must(`INSERT INTO lorawan_v2_node_config_snapshots(device_id,node_index,content_hash,wait_time,content_json,template_instances,metrics_json,management_status) VALUES($1,1,'hash',60,'[]',jsonb_build_array(jsonb_build_object('template_id',$2::bigint,'sensor_type','Shared')),'[]','managed')`, device, original)
	testdb.Apply(t, db, "../../migrations/000040_separate_sensor_template_versions.up.sql")
	service := &Service{db: db}
	v1, err := service.ListTHCPNSensorTemplates(ctx, THCPNSensorTemplateListInput{})
	if err != nil {
		t.Fatal(err)
	}
	v2, err := service.ListTHCPNSensorTemplates(ctx, THCPNSensorTemplateListInput{SourceFamily: "lorawan_v2"})
	if err != nil {
		t.Fatal(err)
	}
	if len(v1.Items) != 1 || len(v2.Items) != 1 || v1.Items[0].ID != original || v2.Items[0].ID == original {
		t.Fatalf("templates not separated: V1=%+v V2=%+v", v1.Items, v2.Items)
	}
	var linked int64
	if err := db.QueryRow(ctx, `SELECT (template_instances->0->>'template_id')::bigint FROM lorawan_v2_node_config_snapshots WHERE device_id=$1`, device).Scan(&linked); err != nil {
		t.Fatal(err)
	}
	if linked != v2.Items[0].ID {
		t.Fatalf("snapshot references %d, want %d", linked, v2.Items[0].ID)
	}
	_, err = service.UpdateTHCPNSensorTemplate(ctx, linked, THCPNSensorTemplateWriteInput{SensorType: "Changed", Params: map[string]any{}, Status: "active"})
	if err == nil {
		t.Fatal("V2 must not be converted to V1")
	}
	testdb.Apply(t, db, "../../migrations/000040_separate_sensor_template_versions.down.sql")
	testdb.Apply(t, db, "../../migrations/000040_separate_sensor_template_versions.up.sql")
	var count int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM sensor_templates`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("down/up duplicated templates: %d", count)
	}
}

func TestSensorTemplateRejectsMixedVersions(t *testing.T) {
	err := validateSensorTemplateWrite(THCPNSensorTemplateWriteInput{SensorType: "Mixed", Variants: map[string]map[string]any{"thcpn": {}, "lorawan_v2": {}}})
	if err == nil {
		t.Fatal("mixed V1/V2 template must be rejected")
	}
}
