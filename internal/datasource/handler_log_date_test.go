package datasource

import (
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestOptionalLogDateTimezone(t *testing.T) {
	for _, test := range []struct {
		raw, utc string
		valid    bool
	}{
		{"2026-10-20", "2026-10-19T16:00:00Z", true},
		{"2026-10-20T00:00:00+08:00", "2026-10-19T16:00:00Z", true},
		{"2026-10-19T16:00:00Z", "2026-10-19T16:00:00Z", true},
		{"", "", true},
		{"2026-02-30", "", false},
	} {
		t.Run(test.raw, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest("GET", "/?start_date="+url.QueryEscape(test.raw), nil)
			got, valid := parseOptionalLogDate(ctx, "start_date")
			if valid != test.valid {
				t.Fatalf("valid=%v, want %v", valid, test.valid)
			}
			if test.utc != "" && got.UTC().Format(time.RFC3339) != test.utc {
				t.Fatalf("got %s, want %s", got, test.utc)
			}
			if test.raw == "" && !got.IsZero() {
				t.Fatal("empty date must retain default-range semantics")
			}
		})
	}
}
