package datasource

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestUniqueUUIDsDropsNilAndDuplicates(t *testing.T) {
	first := uuid.New()
	second := uuid.New()
	result := uniqueUUIDs([]uuid.UUID{uuid.Nil, first, second, first})
	if len(result) != 2 || result[0] != first || result[1] != second {
		t.Fatalf("unexpected unique ids: %#v", result)
	}
}

func TestRuntimePlaceholders(t *testing.T) {
	refs := []thcpnLocationRef{{ExternalDeviceID: 41}, {ExternalDeviceID: 42}}
	placeholders, args := runtimePlaceholders(refs)
	if placeholders != "?,?" {
		t.Fatalf("unexpected placeholders: %q", placeholders)
	}
	if len(args) != 2 || args[0] != int64(41) || args[1] != int64(42) {
		t.Fatalf("unexpected args: %#v", args)
	}
}

func TestTHCPNDeviceRuntimeRejectsOversizedBatch(t *testing.T) {
	ids := make([]uuid.UUID, maxTHCPNRuntimeDevices+1)
	for index := range ids {
		ids[index] = uuid.New()
	}
	_, err := (&Service{}).THCPNDeviceRuntime(context.Background(), ids)
	if err == nil || !strings.Contains(err.Error(), "at most 200") {
		t.Fatalf("expected batch limit error, got %v", err)
	}
}
