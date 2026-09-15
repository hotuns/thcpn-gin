package datasource

import (
	"context"
	"github.com/google/uuid"
	"testing"
)

type changingResolver struct{ value string }

func (r *changingResolver) Resolve(context.Context, string) (string, error) { return r.value, nil }

func TestMySQLConnectionsReuseAndRotateCredentials(t *testing.T) {
	resolver := &changingResolver{value: "user:first@tcp(127.0.0.1:1)/test"}
	runtime := NewRuntime(resolver)
	defer runtime.Close()
	source := DataSource{ID: uuid.New(), Type: "mysql", Status: "active"}
	first, err := runtime.openMySQL(t.Context(), source)
	if err != nil {
		t.Fatal(err)
	}
	same, err := runtime.openMySQL(t.Context(), source)
	if err != nil || same != first {
		t.Fatalf("pool not reused: %v", err)
	}
	resolver.value = "user:second@tcp(127.0.0.1:1)/test"
	changed, err := runtime.openMySQL(t.Context(), source)
	if err != nil || changed == first {
		t.Fatalf("pool credentials not rotated: %v", err)
	}
	if err := first.PingContext(t.Context()); err == nil || err.Error() != "sql: database is closed" {
		t.Fatalf("old pool remains usable: %v", err)
	}
	source.Status = "disabled"
	if _, err := runtime.openMySQL(t.Context(), source); err == nil {
		t.Fatal("disabled source accepted")
	}
}
