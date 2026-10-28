package export

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/testdb"
)

type offlineExportQueue struct{}

func (offlineExportQueue) EnqueueExportJob(context.Context, uuid.UUID) error {
	return errors.New("queue temporarily unavailable")
}

func TestAdminExportWorksWithoutUserOrAssignment(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	device := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO devices(id,name,device_type) VALUES($1,'Unassigned station','standalone')`, device); err != nil {
		t.Fatal(err)
	}
	svc := NewService(db, nil, config.ExportConfig{})
	cfg, _ := json.Marshal(map[string]any{"device_ids": []string{device.String()}, "start_time": time.Now().Add(-time.Hour), "end_time": time.Now(), "include_data": true, "include_images": false})
	job, err := svc.CreateAdmin(ctx, admin, CreateInput{ResourceType: "device_batch", ResourceID: device, ExportType: "standard_station_zip", RequestConfig: cfg})
	if err != nil {
		t.Fatal(err)
	}
	if job.RequestedByAdmin == nil || *job.RequestedByAdmin != admin || job.RequestedBy != uuid.Nil || job.WorkspaceID != uuid.Nil {
		t.Fatalf("wrong owner: %#v", job)
	}
	stored, err := svc.queries.MarkExportJobRunning(ctx, job.ID)
	if err != nil || stored.RequestedByAdmin == nil {
		t.Fatalf("worker claim lost administrator origin: %v", err)
	}
	// The worker uses the persisted origin to skip user grants, while retaining
	// the normal source/type/topology validation.
	if err = svc.validateDeviceBatch(ctx, uuid.Nil, uuid.Nil, device, job.ExportType, cfg, true); err != nil {
		t.Fatal(err)
	}
	if err = svc.validateDeviceBatch(ctx, uuid.Nil, uuid.Nil, device, job.ExportType, cfg); err == nil {
		t.Fatal("ordinary exports must still enforce user access")
	}
	rows, err := svc.queries.ListAdminExportJobs(ctx, sqlc.ListAdminExportJobsParams{DeviceID: &device, MaxJobs: 20})
	if err != nil || len(rows) != 1 {
		t.Fatalf("device export lookup: %d %v", len(rows), err)
	}
	h := NewHandler(svc, nil)
	if allowed, _ := h.canAccessJob(nil, auth.Actor{UserID: uuid.New()}, job, ResolvedResource{}); allowed {
		t.Fatal("user API must not expose administrator jobs")
	}
	// A queue outage must not turn a persisted job into a failed creation and
	// invite duplicate submissions; the worker's DB scanner can still claim it.
	h.SetJobEnqueuer(offlineExportQueue{})
	body, _ := json.Marshal(map[string]any{"resource_type": "device_batch", "resource_id": device, "export_type": "standard_station_zip", "request_config": json.RawMessage(cfg)})
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("POST", "/api/v1/admin/export-jobs", strings.NewReader(string(body)))
	c.Request.Header.Set("Content-Type", "application/json")
	auth.SetActorContext(c, auth.Actor{UserID: admin, IsSystemAdmin: true})
	h.AdminCreate(c)
	if recorder.Code != 202 {
		t.Fatalf("queue outage should preserve pending task: %d %s", recorder.Code, recorder.Body.String())
	}
	var queued Job
	if err = json.Unmarshal(recorder.Body.Bytes(), &queued); err != nil || queued.Status != "pending" {
		t.Fatalf("pending result: %v", err)
	}
}

func TestAdminExportRejectsNonAdministratorBeforeDatabaseAccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, actor := range []auth.Actor{{}, {UserID: uuid.New()}} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest("POST", "/api/v1/admin/export-jobs", strings.NewReader(`{}`))
		if actor.UserID != uuid.Nil {
			auth.SetActorContext(c, actor)
		}
		NewHandler(nil, nil).AdminCreate(c)
		if recorder.Code != 401 {
			t.Fatalf("non-administrator got %d", recorder.Code)
		}
	}
}

func TestAdminExportStillRejectsInvalidResourceAndRange(t *testing.T) {
	svc := NewService(nil, nil, config.ExportConfig{})
	if _, err := svc.CreateAdmin(t.Context(), uuid.Nil, CreateInput{}); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatal(err)
	}
	if _, err := svc.CreateAdmin(t.Context(), uuid.New(), CreateInput{ResourceType: "device", ExportType: "unknown"}); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatal(err)
	}
}

func TestOperationsMigrationsRoundTrip(t *testing.T) {
	db := testdb.Open(t, 0)
	for _, path := range []string{"../../migrations/000047_device_manual_location.down.sql", "../../migrations/000046_admin_device_exports.down.sql", "../../migrations/000046_admin_device_exports.up.sql", "../../migrations/000047_device_manual_location.up.sql"} {
		testdb.Apply(t, db, path)
	}
	var columns int
	if err := db.QueryRow(t.Context(), `SELECT count(*) FROM information_schema.columns WHERE table_name='export_jobs' AND column_name='requested_by_admin'`).Scan(&columns); err != nil || columns != 1 {
		t.Fatalf("export migration: %d %v", columns, err)
	}
}

func TestUserExportViewsExcludeAdministratorJobs(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	// Admin and user IDs are separate namespaces. Even an equal UUID must not
	// turn a background operations task into a personal export.
	user, otherUser, workspace, device := admin, uuid.New(), uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{user, otherUser} {
		if _, err := db.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1,'Export user',$2)`, id, id.String()+"@example.test"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(ctx, `INSERT INTO workspaces(id,type,name,owner_user_id) VALUES($1,'personal','User workspace',$2)`, workspace, user); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO devices(id,name,device_type) VALUES($1,'Assigned station','standalone')`, device); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO device_assignments(device_id,workspace_id) VALUES($1,$2)`, device, workspace); err != nil {
		t.Fatal(err)
	}
	svc := NewService(db, nil, config.ExportConfig{})
	cfg, _ := json.Marshal(map[string]any{"device_ids": []string{device.String()}, "start_time": time.Now().Add(-time.Hour), "end_time": time.Now(), "include_data": true, "include_images": false})
	adminJob, err := svc.CreateAdmin(ctx, admin, CreateInput{ResourceType: "device_batch", ResourceID: device, ExportType: "standard_station_zip", RequestConfig: cfg})
	if err != nil {
		t.Fatal(err)
	}
	userJobIDs := map[uuid.UUID]bool{}
	for _, requester := range []uuid.UUID{user, otherUser} {
		job, err := svc.queries.CreateExportJob(ctx, sqlc.CreateExportJobParams{WorkspaceID: &workspace, RequestedBy: &requester, ResourceType: "device", ResourceID: device, ExportType: "telemetry_csv", RequestConfigJson: cfg, ExpiresAt: pgTime(time.Now().Add(time.Hour))})
		if err != nil {
			t.Fatal(err)
		}
		userJobIDs[job.ID] = true
	}
	for _, tc := range []struct {
		name  string
		input ListInput
		want  int
	}{
		{"personal", ListInput{RequestedBy: &user}, 1},
		{"personal in workspace", ListInput{RequestedBy: &user, WorkspaceID: workspace}, 1},
		{"workspace all", ListInput{WorkspaceID: workspace}, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			items, err := svc.List(ctx, tc.input)
			if err != nil || len(items) != tc.want {
				t.Fatalf("user export list: len=%d, err=%v", len(items), err)
			}
			for _, item := range items {
				if item.RequestedByAdmin != nil || !userJobIDs[item.ID] {
					t.Fatalf("administrator task exposed: %s", item.ID)
				}
			}
		})
	}
	h := NewHandler(svc, nil)
	for _, action := range []struct {
		name   string
		handle gin.HandlerFunc
	}{{"details", h.Get}, {"download", h.Download}} {
		t.Run(action.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest("GET", "/api/v1/export-jobs/"+adminJob.ID.String(), nil)
			c.Params = gin.Params{{Key: "export_job_id", Value: adminJob.ID.String()}}
			auth.SetActorContext(c, auth.Actor{UserID: user})
			action.handle(c)
			if recorder.Code != 403 {
				t.Fatalf("user reached admin %s: %d %s", action.name, recorder.Code, recorder.Body.String())
			}
		})
	}
	all, err := svc.queries.ListAdminExportJobs(ctx, sqlc.ListAdminExportJobsParams{DeviceID: &device, MaxJobs: 20})
	if err != nil || len(all) != 3 {
		t.Fatalf("admin should still see both origins: %d %v", len(all), err)
	}
}
