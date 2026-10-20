package export

import (
	"bytes"
	"context"
	"errors"
	"github.com/google/uuid"
	"io"
	"os"
	"testing"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/objectstore"
	"thcpn-gin/internal/testdb"
	"time"
)

func TestInterruptedExportsAndCanceledFailure(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	user, workspace := uuid.New(), uuid.New()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO users(id,name,email) VALUES($1,'Export test','export@test.invalid')`, user)
	exec(`INSERT INTO workspaces(id,type,name,owner_user_id) VALUES($1,'personal','test',$2)`, workspace, user)
	old, active, canceled := uuid.New(), uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{old, active, canceled} {
		exec(`INSERT INTO export_jobs(id,workspace_id,requested_by,resource_type,resource_id,export_type,status,expires_at,started_at) VALUES($1,$2,$3,'device',$4,'media_zip','running',now()+interval '1 day',now())`, id, workspace, user, uuid.New())
	}
	exec(`UPDATE export_jobs SET updated_at=now()-interval '6 minutes' WHERE id=$1`, old)
	p := &Processor{queries: sqlc.New(db), cfg: config.ExportConfig{TempDir: t.TempDir()}}
	// A heartbeat refresh preserves live executions while stale rows are reclaimed.
	if n, err := p.queries.HeartbeatExportJob(ctx, sqlc.HeartbeatExportJobParams{ID: active, ProgressJson: []byte(`{"stage":"packing","packed_images":12,"packed_bytes":1024}`)}); err != nil || n != 1 {
		t.Fatal("heartbeat did not update")
	}
	if err := p.RecoverInterrupted(ctx); err != nil {
		t.Fatal(err)
	}
	row, err := p.queries.GetExportJob(ctx, old)
	if err != nil || row.Status != "failed" {
		t.Fatalf("abandoned task: %s %v", row.Status, err)
	}
	row, err = p.queries.GetExportJob(ctx, active)
	if err != nil || row.Status != "running" {
		t.Fatal("live heartbeat was reclaimed")
	}
	if !bytes.Contains(row.ProgressJson, []byte(`12`)) {
		t.Fatal("progress was not persisted")
	}
	// A restarted worker removes only abandoned task files, never an active task's file.
	for _, id := range []uuid.UUID{old, active} {
		file, e := p.newTempFile(id)
		if e != nil {
			t.Fatal(e)
		}
		name := file.Name()
		file.Close()
		os.Chtimes(name, time.Now().Add(-time.Hour), time.Now().Add(-time.Hour))
		if e = p.RecoverInterrupted(ctx); e != nil {
			t.Fatal(e)
		}
		_, e = os.Stat(name)
		if id == old && !os.IsNotExist(e) {
			t.Fatal("orphan file retained")
		}
		if id == active && e != nil {
			t.Fatal("live file deleted")
		}
	}
	canceledCtx, cancel := context.WithCancel(ctx)
	cancel()
	if err := p.fail(canceledCtx, canceled, errors.New("worker stopped")); err == nil {
		t.Fatal("missing original error")
	}
	row, err = p.queries.GetExportJob(ctx, canceled)
	if err != nil || row.Status != "failed" {
		t.Fatalf("cancellation left running: %s %v", row.Status, err)
	}
	// Exercise actual claim -> disk ZIP -> upload -> success and upload failure cleanup.
	deviceID := uuid.New()
	exec(`INSERT INTO devices(id,name,device_type) VALUES($1,'test station','standalone')`, deviceID)
	for _, failUpload := range []bool{false, true} {
		id := uuid.New()
		exec(`INSERT INTO export_jobs(id,workspace_id,requested_by,resource_type,resource_id,export_type,expires_at,request_config_json) VALUES($1,$2,$3,'device',$4,'media_zip',now()+interval '1 day','{"start_time":"2026-10-01T00:00:00Z","end_time":"2026-10-02T00:00:00Z"}')`, id, workspace, user, deviceID)
		store := &diskInputStore{t: t, fail: failUpload}
		p.store = store
		p.cfg.MaxRows = 1000
		processed, e := p.ProcessJob(ctx, id)
		if !processed || (e != nil) != failUpload {
			t.Fatalf("process: %v %v", processed, e)
		}
		job, e := p.queries.GetExportJob(ctx, id)
		if e != nil {
			t.Fatal(e)
		}
		if failUpload {
			if job.Status != "failed" {
				t.Fatal("upload failure not recorded")
			}
		} else if job.Status != "success" || job.FileSizeBytes.Int64 != store.size {
			t.Fatal("wrong success/file size")
		}
		if _, e = os.Stat(store.path); !os.IsNotExist(e) {
			t.Fatal("completed task temp file retained")
		}
	}
	// Migration remains reversible after applying all preceding migrations from an empty database.
	testdb.Apply(t, db, "../../migrations/000045_export_progress.down.sql")
	testdb.Apply(t, db, "../../migrations/000045_export_progress.up.sql")
}

type diskInputStore struct {
	t    *testing.T
	fail bool
	size int64
	path string
}

func (s *diskInputStore) Delete(context.Context, string) error { return nil }
func (s *diskInputStore) Get(context.Context, string) (objectstore.GetResult, error) {
	return objectstore.GetResult{}, errors.New("unexpected get")
}
func (s *diskInputStore) Put(_ context.Context, input objectstore.PutInput) error {
	file, ok := input.Body.(*os.File)
	if !ok {
		s.t.Fatal("upload did not receive a seekable disk file")
	}
	s.path = file.Name()
	n, err := io.Copy(io.Discard, file)
	s.size = n
	if err != nil {
		return err
	}
	if s.fail {
		return errors.New("simulated upload failure")
	}
	return nil
}

func TestExportConcurrencyAndTempCleanup(t *testing.T) {
	p := &Processor{cfg: config.ExportConfig{TempDir: t.TempDir(), MaxConcurrentJobs: 1}}
	if !p.acquire(t.Context()) {
		t.Fatal("cannot acquire")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Millisecond)
	defer cancel()
	if p.acquire(ctx) {
		t.Fatal("parallel export exceeded limit")
	}
	p.release()
	file, err := p.newTempFile(uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	name := file.Name()
	file.Close()
	os.Remove(name)
	if _, err = os.Stat(name); !os.IsNotExist(err) {
		t.Fatal("temporary file remains")
	}
}
