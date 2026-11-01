package export

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"testing"
	"thcpn-gin/internal/observation"
)

func TestExportObservationScopeCannotBeSelectedByUserJob(t *testing.T) {
	cfg := json.RawMessage(`{"data_phase":"all"}`)
	ctx := observationContextForJob(observation.WithPhase(context.Background(), observation.All), Job{RequestConfig: cfg})
	if observation.Phase(ctx) != observation.Formal {
		t.Fatal("user export bypassed formal observation boundary")
	}
	admin := uuid.New()
	for _, phase := range []string{observation.All, observation.Formal, observation.Testing} {
		cfg, _ := json.Marshal(map[string]string{"data_phase": phase})
		ctx := observationContextForJob(context.Background(), Job{RequestedByAdmin: &admin, RequestConfig: cfg})
		if observation.Phase(ctx) != phase {
			t.Fatal("administrator export phase ignored")
		}
	}
}
