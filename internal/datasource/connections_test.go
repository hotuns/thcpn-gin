package datasource

import (
	"context"
	"testing"
	platform "thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
)

type changingResolver struct{ value string }

func (r *changingResolver) Resolve(context.Context, string) (string, error) { return r.value, nil }
func TestMySQLConnectionsReuseAndRotateCredentials(t *testing.T) {
	resolver := &changingResolver{value: "user:first@tcp(127.0.0.1:1)/test"}
	runtime := NewRuntime(resolver)
	defer runtime.Close()
	source := platform.DataSource{ID: uuid.New(), Type: "mysql", Status: "active"}
	first, err := runtime.OpenMySQL(t.Context(), source)
	if err != nil {
		t.Fatal(err)
	}
	same, err := runtime.OpenMySQL(t.Context(), source)
	if err != nil || same != first {
		t.Fatalf("pool not reused: %v", err)
	}
	resolver.value = "user:second@tcp(127.0.0.1:1)/test"
	changed, err := runtime.OpenMySQL(t.Context(), source)
	if err != nil || changed == first {
		t.Fatalf("pool credentials not rotated: %v", err)
	}
	if err := first.PingContext(t.Context()); err == nil || err.Error() != "sql: database is closed" {
		t.Fatalf("old pool remains usable: %v", err)
	}
	source.Status = "disabled"
	if _, err := runtime.OpenMySQL(t.Context(), source); err == nil {
		t.Fatal("disabled source accepted")
	}
}
