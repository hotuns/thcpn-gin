package thcpn

import (
	"strings"
	"testing"
	"time"
)

func TestMonthTableAndMonthsBetween(t *testing.T) {
	start := time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	months := monthsBetween(start, end)
	if got, want := len(months), 3; got != want {
		t.Fatalf("monthsBetween() length = %d, want %d", got, want)
	}
	if got := monthTable(thcpnAttributeTablePrefix, months[1]); got != "device_attribute_202607" {
		t.Fatalf("monthTable() = %q", got)
	}
	if !thcpnAttributeTablePattern.MatchString("device_attribute_202607") {
		t.Fatal("expected attribute table name to be valid")
	}
	if thcpnAttributeTablePattern.MatchString("device_attribute_202607;drop") {
		t.Fatal("unsafe attribute table name matched")
	}
}
func TestBuildLogUnionUsesValidatedTableNamesAndFilters(t *testing.T) {
	query, args := buildLogUnion([]string{"device_log_202607", "device_log_202608"}, 2471, time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC), "camera")
	if strings.Contains(query, "device_log_202607;drop") {
		t.Fatal("unsafe table name was included")
	}
	for _, expected := range []string{"deleted_at IS NULL", "path LIKE ?", "uuid LIKE ?", "UNION ALL"} {
		if !strings.Contains(query, expected) {
			t.Fatalf("query does not contain %q: %s", expected, query)
		}
	}
	if got, want := len(args), 10; got != want {
		t.Fatalf("argument count = %d, want %d", got, want)
	}
}
func TestNormalizeLogRange(t *testing.T) {
	start, end, err := normalizeLogRange(time.Date(2026, 7, 1, 15, 0, 0, 0, time.UTC), time.Date(2026, 7, 3, 8, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	zone := time.FixedZone("Beijing", 8*3600)
	if !start.Equal(time.Date(2026, 7, 1, 0, 0, 0, 0, zone)) || !end.Equal(time.Date(2026, 7, 4, 0, 0, 0, 0, zone)) {
		t.Fatalf("normalized range = %s - %s", start, end)
	}
	if _, _, err := normalizeLogRange(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2027, 2, 1, 0, 0, 0, 0, time.UTC)); err == nil {
		t.Fatal("expected long date range to fail")
	}
}
