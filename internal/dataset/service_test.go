package dataset

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/testdb"
)

func TestDemoDatasetSourcesUseReferenceWorkspaceAndProject(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	demo, user, demoWorkspace, realWorkspace, demoProject, realProject, device, stream := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO users(id,name,username,is_demo) VALUES($1,'Demo','dataset-demo',true)`, demo)
	must(`INSERT INTO users(id,name,email) VALUES($1,'Owner','dataset-owner@example.test')`, user)
	must(`INSERT INTO workspaces(id,type,name,owner_user_id,is_demo_workspace) VALUES($1,'personal','Demo',$2,true),($3,'personal','Real',$4,false)`, demoWorkspace, demo, realWorkspace, user)
	must(`INSERT INTO projects(id,workspace_id,name,created_by) VALUES($1,$2,'Demo project',$3),($4,$5,'Real project',$6)`, demoProject, demoWorkspace, demo, realProject, realWorkspace, user)
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'Selected station','standalone')`, device)
	must(`INSERT INTO demo_showcase_devices(user_id,workspace_id,project_id,device_id,added_by) VALUES($1,$2,$3,$4,$5)`, demo, demoWorkspace, demoProject, device, admin)
	must(`INSERT INTO data_streams(id,device_id,code,name,type,created_by,created_by_type) VALUES($1,$2,'temp','Temperature','telemetry',$3,'system_admin')`, stream, device, admin)
	svc := NewService(db)
	demoCtx := auth.WithActor(ctx, auth.Actor{UserID: demo, IsDemo: true})
	userCtx := auth.WithActor(ctx, auth.Actor{UserID: user})
	for _, assigned := range []bool{false, true} {
		if assigned {
			must(`INSERT INTO device_assignments(device_id,workspace_id,project_id) VALUES($1,$2,$3)`, device, realWorkspace, realProject)
		}
		for _, source := range []SourceInput{{SourceType: "device", SourceID: device}, {SourceType: "data_stream", SourceID: stream}} {
			input := CreateInput{WorkspaceID: demoWorkspace, ProjectID: &demoProject, Name: "Selected source", DataType: "telemetry", TimeStart: time.Now().Add(-time.Hour), TimeEnd: time.Now(), Sources: []SourceInput{source}, ActorUserID: demo}
			created, err := svc.Create(demoCtx, input)
			if err != nil || created.WorkspaceID != demoWorkspace || created.ProjectID == nil || *created.ProjectID != demoProject || len(created.Sources) != 1 {
				t.Fatalf("demo dataset assigned=%t source=%s: %#v %v", assigned, source.SourceType, created, err)
			}
			input.ActorUserID = user
			_, err = svc.Create(userCtx, input)
			want := apperr.KindNotFound
			if assigned {
				want = apperr.KindInvalidArgument
			}
			if apperr.KindOf(err) != want {
				t.Fatalf("ordinary source must use real assignment: %v", err)
			}
			if assigned {
				input.WorkspaceID, input.ProjectID = realWorkspace, &realProject
				if _, err := svc.Create(userCtx, input); err != nil {
					t.Fatalf("ordinary dataset in assigned workspace: %v", err)
				}
			}
			if err := svc.validateSources(demoCtx, realWorkspace, nil, []SourceInput{source}); apperr.KindOf(err) != apperr.KindInvalidArgument {
				t.Fatalf("demo source must not use real workspace: %v", err)
			}
			if err := svc.validateSources(demoCtx, demoWorkspace, &realProject, []SourceInput{source}); apperr.KindOf(err) != apperr.KindInvalidArgument {
				t.Fatalf("demo source must use reference project: %v", err)
			}
		}
	}
	must(`DELETE FROM demo_showcase_devices WHERE device_id=$1`, device)
	if err := svc.validateSources(demoCtx, demoWorkspace, nil, []SourceInput{{SourceType: "data_stream", SourceID: stream}}); apperr.KindOf(err) != apperr.KindPermissionDenied {
		t.Fatalf("unselected source must remain denied: %v", err)
	}
}

func TestNormalizeSourcesDeduplicates(t *testing.T) {
	sourceID := uuid.New()
	sources, err := normalizeSources([]SourceInput{
		{SourceType: "device", SourceID: sourceID},
		{SourceType: "device", SourceID: sourceID},
	})
	if err != nil {
		t.Fatalf("expected sources to be valid: %v", err)
	}
	if len(sources) != 1 {
		t.Fatalf("expected duplicate source to be removed, got %v", sources)
	}
}

func TestNormalizeSourcesRejectsInvalidType(t *testing.T) {
	_, err := normalizeSources([]SourceInput{{SourceType: "raw_sql", SourceID: uuid.New()}})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid source type to be rejected, got %v", err)
	}
}

func TestDatasetValidation(t *testing.T) {
	if !isValidDataType("mixed") || isValidDataType("sql") {
		t.Fatal("unexpected data type validation result")
	}
	if !isValidStatus("published") || isValidStatus("deleted") {
		t.Fatal("unexpected status validation result")
	}
	if !isValidSourceType("data_stream") || isValidSourceType("table") {
		t.Fatal("unexpected source type validation result")
	}
}

func TestValidateTimeRange(t *testing.T) {
	start := time.Now()
	end := start.Add(-time.Hour)
	if apperr.KindOf(validateTimeRange(start, end)) != apperr.KindInvalidArgument {
		t.Fatal("expected invalid time range")
	}
	if err := validateTimeRange(start, start.Add(time.Hour)); err != nil {
		t.Fatalf("expected valid time range: %v", err)
	}
}

func TestResolveTelemetryQueryRangeDefaultsToDatasetRange(t *testing.T) {
	datasetStart := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	datasetEnd := datasetStart.Add(24 * time.Hour)

	start, end, err := resolveTelemetryQueryRange(datasetStart, datasetEnd, time.Time{}, time.Time{}, config.QueryLimitsConfig{MaxHistoryDays: 31})
	if err != nil {
		t.Fatalf("resolve range: %v", err)
	}
	if !start.Equal(datasetStart) || !end.Equal(datasetEnd) {
		t.Fatalf("unexpected resolved range: %s - %s", start, end)
	}
}

func TestResolveTelemetryQueryRangeRejectsOutsideDatasetRange(t *testing.T) {
	datasetStart := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	datasetEnd := datasetStart.Add(24 * time.Hour)

	_, _, err := resolveTelemetryQueryRange(datasetStart, datasetEnd, datasetStart.Add(-time.Second), datasetEnd, config.QueryLimitsConfig{MaxHistoryDays: 31})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected outside range error, got %v", err)
	}
}

func TestResolveTelemetryQueryRangeRejectsLargeSynchronousRange(t *testing.T) {
	datasetStart := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	datasetEnd := datasetStart.Add(48 * time.Hour)

	_, _, err := resolveTelemetryQueryRange(datasetStart, datasetEnd, time.Time{}, time.Time{}, config.QueryLimitsConfig{MaxHistoryDays: 1})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected max history range error, got %v", err)
	}
}

func TestNormalizeTelemetryQueryLimit(t *testing.T) {
	limit, err := normalizeTelemetryQueryLimit(0, config.QueryLimitsConfig{MaxPoints: 100})
	if err != nil {
		t.Fatalf("default query limit: %v", err)
	}
	if limit != 100 {
		t.Fatalf("expected default max points, got %d", limit)
	}
	if _, err := normalizeTelemetryQueryLimit(101, config.QueryLimitsConfig{MaxPoints: 100}); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected max points error, got %v", err)
	}
}

func TestPreviewReportsSavedWindowAndConfiguredLimit(t *testing.T) {
	start := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(10 * 24 * time.Hour)
	limits := config.QueryLimitsConfig{MaxHistoryDays: 2}
	_, _, err := resolveTelemetryQueryRange(start, end, start.Add(-time.Second), end, limits)
	if d := apperr.DetailsOf(err); d["reason"] != "DATASET_TIME_WINDOW" || d["start_at"] != start.Format(time.RFC3339Nano) || d["end_at"] != end.Format(time.RFC3339Nano) {
		t.Fatalf("wrong saved window: %v", d)
	}
	_, _, err = resolveTelemetryQueryRange(start, end, start, start.Add(3*24*time.Hour), limits)
	if d := apperr.DetailsOf(err); d["field"] != "dataset_query_days" || d["maximum"] != int64(2) {
		t.Fatalf("wrong query window: %v", d)
	}
}
