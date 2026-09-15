package datasource

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"testing"
	"thcpn-gin/internal/testdb"
)

type recordingSyncQueue struct {
	ids []uuid.UUID
	err error
}

func (q *recordingSyncQueue) EnqueueSourceSync(_ context.Context, id uuid.UUID) error {
	q.ids = append(q.ids, id)
	return q.err
}
func TestSourceSyncQueueKeepsOneActiveOperationAndRecordsEnqueueFailure(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2','env:UNUSED',$2)`, source, admin); err != nil {
		t.Fatal(err)
	}
	svc := NewService(db)
	queue := &recordingSyncQueue{}
	svc.SetSyncQueue(queue)
	op, err := svc.StartSourceSync(ctx, source, admin)
	if err != nil {
		t.Fatal(err)
	}
	if op.Status != "queued" || len(queue.ids) != 1 || queue.ids[0] != op.ID {
		t.Fatalf("not queued: %#v", op)
	}
	if _, err := svc.StartSourceSync(ctx, source, admin); err == nil {
		t.Fatal("duplicate source sync accepted")
	}
	if err := svc.finishSourceOperation(op.ID, "completed", map[string]int{"synced": 1}, nil); err != nil {
		t.Fatal(err)
	}
	if err := svc.RunSourceSync(ctx, op.ID); err != nil {
		t.Fatal("completed job should be idempotent", err)
	}
	queue.err = errors.New("queue unavailable")
	if _, err := svc.StartSourceSync(ctx, source, admin); err == nil {
		t.Fatal("enqueue failure hidden")
	}
	items, err := svc.ListSourceOperations(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].Status != "failed" {
		t.Fatalf("missing persisted failure: %#v", items)
	}
}
