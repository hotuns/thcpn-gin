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

func TestRuntimeAttributeQueriesUseLatestPerDeviceAndAttribute(t *testing.T) {
	refs := []thcpnLocationRef{{ExternalDeviceID: 41}, {ExternalDeviceID: 42}, {ExternalDeviceID: 41}}
	unresolved := map[string]map[int64]bool{
		"battery":  {41: true, 42: true},
		"signal":   {42: true},
		"ext_info": {},
	}
	queries := runtimeAttributeQueries("device_attribute_202609", refs, unresolved)
	if len(queries) != 1 {
		t.Fatalf("expected one query, got %d", len(queries))
	}
	if got := strings.Count(queries[0].sql, "LIMIT 1"); got != 3 {
		t.Fatalf("expected three latest-row selects, got %d", got)
	}
	if !strings.Contains(queries[0].sql, "ORDER BY ts DESC, id DESC") {
		t.Fatalf("query must break equal-timestamp ties by id: %s", queries[0].sql)
	}
	want := []any{int64(41), "battery", int64(42), "battery", int64(42), "signal"}
	if got := queries[0].args; len(got) != len(want) {
		t.Fatalf("unexpected args: %#v", got)
	} else {
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("arg %d: got %v, want %v", i, got[i], want[i])
			}
		}
	}
	if runtimeAttributesResolved(unresolved) {
		t.Fatal("unresolved attributes must not stop the lookback")
	}
	for _, key := range runtimeAttributeKeys {
		clear(unresolved[key])
	}
	if !runtimeAttributesResolved(unresolved) {
		t.Fatal("complete attributes should stop the lookback")
	}
}

func TestRuntimeAttributeQueriesAreBounded(t *testing.T) {
	refs := make([]thcpnLocationRef, 25)
	unresolved := map[string]map[int64]bool{
		"battery": {}, "signal": {}, "ext_info": {},
	}
	for i := range refs {
		id := int64(i + 1)
		refs[i].ExternalDeviceID = id
		for _, key := range runtimeAttributeKeys {
			unresolved[key][id] = true
		}
	}
	queries := runtimeAttributeQueries("device_attribute_202609", refs, unresolved)
	if len(queries) != 2 {
		t.Fatalf("expected two query batches, got %d", len(queries))
	}
	if len(queries[0].args) != maxRuntimeAttributePairsPerQuery*2 || len(queries[1].args) != 30 {
		t.Fatalf("unexpected query batches: %d, args %d/%d", len(queries), len(queries[0].args), len(queries[1].args))
	}
	if got := runtimeAttributeQueries("device_attribute_202609; DROP TABLE devices", refs, unresolved); len(got) != 0 {
		t.Fatalf("unsafe table name accepted: %#v", got)
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
