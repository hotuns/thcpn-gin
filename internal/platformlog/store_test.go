package platformlog

import (
	"context"
	"testing"
	"time"
)

func TestStoreWriteListGetAndRebuild(t *testing.T) {
	store, err := Open("api", Config{Directory: t.TempDir(), RetentionDays: 30, MaxTotalSizeMB: 10, MaxFileSizeMB: 1, SQLiteIndex: true})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	now := time.Now().UTC().Truncate(time.Second)
	if err := store.Write(context.Background(), Entry{Timestamp: now, Level: "INFO", Message: "http_request", ActorID: "user-1", RequestID: "req-1", Status: 200}); err != nil {
		t.Fatal(err)
	}
	result, err := store.List(context.Background(), Query{ActorID: "user-1", Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 1 || len(result.Items) != 1 || result.Items[0].ID == 0 {
		t.Fatalf("unexpected list result: %#v", result)
	}
	item, err := store.Get(context.Background(), result.Items[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if item.RequestID != "req-1" || item.SourceFile == "" {
		t.Fatalf("unexpected item: %#v", item)
	}
	if err := store.Rebuild(context.Background()); err != nil {
		t.Fatal(err)
	}
	rebuilt, err := store.List(context.Background(), Query{RequestID: "req-1"})
	if err != nil || rebuilt.Total != 1 {
		t.Fatalf("unexpected rebuilt result: %#v, %v", rebuilt, err)
	}
}

func TestStoreQueryRangeAndPageLimits(t *testing.T) {
	store, err := Open("worker", Config{Directory: t.TempDir(), RetentionDays: 30, MaxTotalSizeMB: 10, MaxFileSizeMB: 1, SQLiteIndex: true})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.Write(context.Background(), Entry{Level: "ERROR", Message: "job failed", Fields: map[string]any{"job_id": "job-1"}}); err != nil {
		t.Fatal(err)
	}
	result, err := store.List(context.Background(), Query{Level: "error", Keyword: "job-1", PageSize: 999})
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 1 || result.PageSize != 500 {
		t.Fatalf("unexpected result: %#v", result)
	}
}
