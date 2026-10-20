package thcpn

import (
	"testing"
	"time"
)

func TestShardMonthUsesSourceCalendar(t *testing.T) {
	// October 1 in Beijing, still September in UTC.
	start := time.Date(2026, 9, 30, 16, 5, 0, 0, time.UTC)
	shards, err := monthlyTHCPNShardTables(start, start.Add(time.Hour), 5)
	if err != nil || len(shards) != 1 || shards[0].Name != "device_data_202610" {
		t.Fatalf("shards=%v err=%v", shards, err)
	}
	if got := monthTable(thcpnAttributeTablePrefix, start); got != "device_attribute_202610" {
		t.Fatalf("attribute month=%s", got)
	}
	if got := monthsBetween(start, start.Add(time.Hour)); len(got) != 1 || got[0].Month() != time.October {
		t.Fatalf("log months=%v", got)
	}
}

func TestLogRangeUsesBeijingMidnight(t *testing.T) {
	zone := time.FixedZone("Beijing", 8*3600)
	input := time.Date(2026, 10, 1, 1, 0, 0, 0, zone)
	start, end, err := normalizeLogRange(input.UTC(), input.UTC())
	if err != nil || !start.Equal(time.Date(2026, 10, 1, 0, 0, 0, 0, zone)) || !end.Equal(time.Date(2026, 10, 2, 0, 0, 0, 0, zone)) {
		t.Fatalf("range=%s..%s err=%v", start, end, err)
	}
}

func TestAttributeLookbackDoesNotSkipShortMonths(t *testing.T) {
	month := sourceMonthStart(time.Date(2026, 3, 31, 23, 0, 0, 0, time.UTC))
	for offset, want := range []string{"device_attribute_202604", "device_attribute_202603", "device_attribute_202602"} {
		if got := monthTable(thcpnAttributeTablePrefix, month.AddDate(0, -offset, 0)); got != want {
			t.Errorf("offset %d: %s, want %s", offset, got, want)
		}
	}
}
