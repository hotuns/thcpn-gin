package thcpn

import (
	"database/sql/driver"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/datasource/platform/statisticstest"
	"thcpn-gin/internal/testdb"
)

func TestStatisticsTHCPNImageReferenceComparisonIsPerRowAndBinary(t *testing.T) {
	expression, args := thcpnStatisticsUniqueImageCount([]string{"a", "b", "c"})
	// b compares against a; c compares against a and b. NULL-safe binary
	// comparisons prevent both NULL suppression and case-insensitive collapsing.
	if strings.Count(expression, "<=>") != 3 || strings.Count(expression, "AS BINARY") != 6 || strings.Count(expression, " IS NOT NULL") != 3 {
		t.Fatalf("missing per-row reference deduplication: %s", expression)
	}
	a := []any{`$."a".value`, `$."a".value`, `$."a"`, `$."a"`}
	b := []any{`$."b".value`, `$."b".value`, `$."b"`, `$."b"`}
	c := []any{`$."c".value`, `$."c".value`, `$."c"`, `$."c"`}
	want := []any{}
	for _, paths := range [][]any{a, b, b, a, c, c, a, c, b} {
		want = append(want, paths...)
	}
	if !reflect.DeepEqual(args, want) {
		t.Fatalf("wrong comparison operands: %v", args)
	}
	if !strings.Contains(expression, "TRIM(LEADING '/' FROM TRIM(JSON_UNQUOTE(") || strings.Contains(expression, "JSON_TABLE") {
		t.Fatalf("unexpected reference normalization: %s", expression)
	}
}

func TestStatisticsTHCPNFutureFormalStartHasKnownZeroImages(t *testing.T) {
	start, end := statisticsTime("2026-07-01 00:00:00"), statisticsTime("2026-07-03 00:00:00")
	for _, cutoff := range []time.Time{end, end.Add(time.Hour)} {
		t.Run(cutoff.Format(time.RFC3339), func(t *testing.T) {
			// No source queries are necessary for an empty formal observation interval.
			db := statisticstest.New(t)
			result, err := readTHCPNStatistics(t.Context(), db, "source/thcpn/42", 42, thcpnShardStrategyCutover, &cutoff, start, end)
			if err != nil {
				t.Fatal(err)
			}
			if result.TotalImages == nil || *result.TotalImages != 0 || result.TotalRecords == nil || *result.TotalRecords != 0 {
				t.Fatalf("empty formal interval must be known zero: %+v", result)
			}
			if len(result.Days) != 2 {
				t.Fatalf("days=%+v", result.Days)
			}
			for _, day := range result.Days {
				if day.Images == nil || *day.Images != 0 || day.Records == nil || *day.Records != 0 {
					t.Fatalf("unknown/positive empty day: %+v", day)
				}
			}
		})
	}
}

// Optional isolated-engine regression; the helper only creates a fresh test
// database when THCPN_TEST_MYSQL_DSN explicitly names an isolated test server.
func TestStatisticsTHCPNImageReferencesMySQL(t *testing.T) {
	db, _ := testdb.MySQL(t, "statistics_images_"+strings.ReplaceAll(uuid.NewString(), "-", ""))
	configs := statisticstest.New(t, statisticstest.Step{Columns: []string{"id", "data", "image"}, Rows: [][]driver.Value{{int64(7), `[]`, `[{"key":"a"},{"key":"b"},{"key":"b"}]`}}})
	expression, expressionArgs, err := thcpnStatisticsImageExpression(t.Context(), configs, 42)
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, payload string
		want          int64
	}{
		{"same nested and direct", `{"a":{"value":"/same.jpg"},"b":"/same.jpg"}`, 1},
		{"normalized references", `{"a":{"value":" /same.jpg "},"b":"same.jpg"}`, 1},
		{"distinct references", `{"a":{"value":"/one.jpg"},"b":"/two.jpg"}`, 2},
		{"case sensitive objects", `{"a":"/A.jpg","b":"/a.jpg"}`, 2},
		{"missing earlier key", `{"b":{"value":"/one.jpg"}}`, 1},
		{"invalid references", `{"a":{"value":null},"b":"  "}`, 0},
		{"non-string references", `{"a":{"value":12},"b":{"other":"/one.jpg"}}`, 0},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			args := append(append([]any(nil), expressionArgs...), test.payload, int64(7))
			var got int64
			err := db.QueryRowContext(t.Context(), "SELECT "+expression+" FROM (SELECT CAST(? AS JSON) AS data, ? AS device_config_id) image_row", args...).Scan(&got)
			if err != nil || got != test.want {
				t.Fatalf("images=%d want=%d err=%v", got, test.want, err)
			}
		})
	}
}
