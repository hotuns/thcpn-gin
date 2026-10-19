package datasource

import (
	"context"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"

	"github.com/google/uuid"
)

func TestSourcePackageIsolation(t *testing.T) {
	const base = "thcpn-gin/internal/datasource"
	dirs := []string{"platform"}
	entries, err := os.ReadDir("sources")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			dirs = append(dirs, "sources/"+entry.Name())
		}
	}
	for _, dir := range dirs {
		err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			f, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
			if err != nil {
				return err
			}
			for _, imp := range f.Imports {
				name, err := strconv.Unquote(imp.Path.Value)
				if err != nil {
					return err
				}
				own := name == base+"/"+dir || strings.HasPrefix(name, base+"/"+dir+"/")
				shared := name == base+"/platform" || strings.HasPrefix(name, base+"/platform/")
				if name == base || strings.HasPrefix(name, base+"/") && !own && !shared {
					t.Errorf("%s imports another source or the composition root: %s", path, name)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}

type configRecorder struct {
	reads, writes               int
	runtimeCalls, locationCalls int
	last                        uuid.UUID
}

func (r *configRecorder) GetDeviceConfig(_ context.Context, id uuid.UUID) (platform.DeviceConfigDetail, error) {
	r.reads++
	r.last = id
	return platform.DeviceConfigDetail{DeviceID: id}, nil
}
func (r *configRecorder) UpdateDeviceConfig(_ context.Context, in platform.UpdateDeviceConfigInput) (platform.UpdateDeviceConfigResult, error) {
	r.writes++
	r.last = in.DeviceID
	return platform.UpdateDeviceConfigResult{DeviceID: in.DeviceID}, nil
}

func (r *configRecorder) ReadDeviceRuntime(_ context.Context, ids []uuid.UUID) (platform.DeviceRuntimeBatch, error) {
	r.runtimeCalls++
	return platform.DeviceRuntimeBatch{Items: []platform.DeviceRuntimeItem{{DeviceID: ids[0]}}}, nil
}
func (r *configRecorder) ReadLiveLocations(_ context.Context, ids []uuid.UUID) (map[uuid.UUID]platform.DeviceLocation, error) {
	r.locationCalls++
	latitude := 1.5
	return map[uuid.UUID]platform.DeviceLocation{ids[0]: {Latitude: &latitude}}, nil
}
func TestConfigurationDispatchUsesRegisteredCapability(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source, id := uuid.New(), uuid.New()
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'Carbon','mysql','carbon','env:NOT_USED',$2)`, []any{source, admin}},
		{`INSERT INTO devices(id,name) VALUES($1,'Device')`, []any{id}},
		{`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'carbon_sink_mysql','7')`, []any{id, source}},
	} {
		if _, err := db.Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	s := NewService(db)
	driver := &configRecorder{}
	s.modules[platform.SourceFamilyCarbon] = sourceModule{Config: driver, Runtime: driver, Locations: driver}
	if _, err := s.GetDeviceConfig(ctx, id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateDeviceConfig(ctx, platform.UpdateDeviceConfigInput{DeviceID: id}); err != nil {
		t.Fatal(err)
	}
	if driver.reads != 1 || driver.writes != 1 || driver.last != id {
		t.Fatalf("wrong capability dispatch: %+v", driver)
	}
	if runtime, err := s.DeviceRuntime(ctx, []uuid.UUID{id}); err != nil || len(runtime.Items) != 1 || runtime.Items[0].DeviceID != id {
		t.Fatalf("runtime capability: %+v %v", runtime, err)
	}
	if positions, err := s.LiveDeviceLocations(ctx, []uuid.UUID{id}); err != nil || positions[id].Latitude == nil || *positions[id].Latitude != 1.5 {
		t.Fatalf("location capability: %+v %v", positions, err)
	}
	if driver.runtimeCalls != 1 || driver.locationCalls != 1 {
		t.Fatalf("wrong projection provider: %+v", driver)
	}
	// Unsupported operations must never fall back to another source.
	if _, err := s.ReconcileDeviceConfig(ctx, id, admin); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("unsupported reconcile: %v", err)
	}
	if _, err := db.Exec(ctx, `UPDATE data_sources SET status='disabled' WHERE id=$1`, source); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetDeviceConfig(ctx, id); err == nil {
		t.Fatal("disabled source accepted")
	}
	if driver.reads != 1 {
		t.Fatal("disabled source still invoked")
	}
}

func TestCatalogAcceptsRegisteredSourceWithoutProtocolBranches(t *testing.T) {
	catalog := platform.NewCatalog()
	catalog.Families["future_sensor"] = "http_api"
	definition := platform.AdapterDefinition{Code: "future_sensor_v1", SourceTypes: []string{"http_api"}, PayloadTypes: []string{"json"}, OptionalMapping: true}
	catalog.Adapters[definition.Code] = definition
	family := "future_sensor"
	if _, err := catalog.NormalizeSourceFamily(&family); err != nil {
		t.Fatal(err)
	}
	if err := catalog.ValidateSourceType(&family, "http_api"); err != nil {
		t.Fatal(err)
	}
	if err := catalog.ValidateSourceType(&family, "mysql"); err == nil {
		t.Fatal("incompatible transport accepted")
	}
	if _, err := platform.NormalizeBinding(platform.CreateDataStreamBindingInput{AdapterCode: definition.Code, PayloadType: "json", AdapterConfigJSON: []byte(`{}`)}, "active", definition); err != nil {
		t.Fatal(err)
	}
}
