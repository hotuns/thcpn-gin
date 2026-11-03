package lorawanv2

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"thcpn-gin/internal/datasource/platform"
)

func statisticsPayload() map[string]any {
	return map[string]any{
		"gateway_sn": "GW", "node_index": 2, "timezone": "Asia/Shanghai",
		"generated_at": "2026-11-03T16:00:01Z", "as_of": "2026-11-03T16:00:00Z",
		"count_unit": "sample_record", "complete": true,
		"records": map[string]any{"total": 8, "first_at": "2026-10-01T00:00:00Z", "last_at": "2026-11-03T12:00:00Z", "daily": []any{
			map[string]any{"date": "2026-11-02", "count": 3},
			map[string]any{"date": "2026-11-03", "count": 2},
		}},
		"images": map[string]any{"supported": false, "total": nil, "daily": nil},
	}
}

func statisticsTestClient(t *testing.T, handler http.HandlerFunc) *LoraWANV2Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	secret, _ := json.Marshal(map[string]string{"base_url": server.URL + "/api", "username": "reader", "password": "test-password"})
	client, err := newLoRaWANV2Client(t.Context(), staticResolver(secret), platform.DataSource{Type: "http_api"})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func TestNodeObservationStatisticsContract(t *testing.T) {
	start := time.Date(2026, 11, 2, 0, 0, 0, 0, platform.LegacySourceLocation)
	end := start.AddDate(0, 0, 2)
	cutoff := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	calls := 0
	client := statisticsTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		user, password, ok := r.BasicAuth()
		if !ok || user != "reader" || password != "test-password" || r.Method != http.MethodGet || r.URL.Path != "/api/device/GW/node/2/statistics" {
			t.Error("statistics request lost authentication or target")
		}
		q := r.URL.Query()
		if q.Get("start_at") != fmt.Sprint(start.Unix()) || q.Get("end_at") != fmt.Sprint(end.Unix()) || q.Get("observation_start_at") != fmt.Sprint(cutoff.Unix()) || q.Get("timezone") != "Asia/Shanghai" || len(q) != 4 {
			t.Errorf("wrong statistics parameters: %v", q)
		}
		json.NewEncoder(w).Encode(map[string]any{"success": true, "payload": statisticsPayload()})
	})
	result, err := client.observationStatistics(t.Context(), "GW", 2, &cutoff, start, end)
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 || result.TotalRecords == nil || *result.TotalRecords != 8 || len(result.Days) != 2 || *result.Days[0].Records != 3 || *result.Days[1].Records != 2 || result.FirstObservedAt == nil || !result.FirstObservedAt.Equal(cutoff) || result.LastObservedAt == nil {
		t.Fatalf("statistics lost cumulative/daily counts: %+v", result)
	}
	if result.TotalImages != nil || result.Days[0].Images != nil || result.ExpectedIntervalSeconds != nil {
		t.Fatal("unsupported images or gateway cadence became a known value")
	}
}

func TestNodeObservationStatisticsRejectsIncompleteOrInvalidResults(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(map[string]any)
	}{
		{"partial", func(p map[string]any) { p["complete"] = false }},
		{"missing total", func(p map[string]any) { delete(p["records"].(map[string]any), "total") }},
		{"negative total", func(p map[string]any) { p["records"].(map[string]any)["total"] = -1 }},
		{"other gateway", func(p map[string]any) { p["gateway_sn"] = "OTHER" }},
		{"other node", func(p map[string]any) { p["node_index"] = 3 }},
		{"other timezone", func(p map[string]any) { p["timezone"] = "UTC" }},
		{"other count unit", func(p map[string]any) { p["count_unit"] = "metric" }},
		{"missing last", func(p map[string]any) { p["records"].(map[string]any)["last_at"] = nil }},
		{"last at excluded end", func(p map[string]any) { p["records"].(map[string]any)["last_at"] = p["as_of"] }},
		{"missing as of", func(p map[string]any) { delete(p, "as_of") }},
		{"future as of", func(p map[string]any) { p["as_of"] = "2026-11-04T00:00:00Z" }},
		{"missing images", func(p map[string]any) { delete(p, "images") }},
		{"missing date", func(p map[string]any) { p["records"].(map[string]any)["daily"] = []any{} }},
		{"duplicate date", func(p map[string]any) {
			d := p["records"].(map[string]any)["daily"].([]any)
			d[1].(map[string]any)["date"] = "2026-11-02"
		}},
		{"negative day", func(p map[string]any) {
			p["records"].(map[string]any)["daily"].([]any)[0].(map[string]any)["count"] = -1
		}},
		{"daily exceeds total", func(p map[string]any) { p["records"].(map[string]any)["total"] = 4 }},
		{"incomplete daily sum", func(p map[string]any) { p["records"].(map[string]any)["first_at"] = "2026-11-02T00:00:00Z" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := statisticsTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				payload := statisticsPayload()
				test.mutate(payload)
				json.NewEncoder(w).Encode(map[string]any{"success": true, "payload": payload})
			})
			_, err := client.observationStatistics(t.Context(), "GW", 2, nil, time.Date(2026, 11, 2, 0, 0, 0, 0, platform.LegacySourceLocation), time.Date(2026, 11, 4, 0, 0, 0, 0, platform.LegacySourceLocation))
			if err == nil {
				t.Fatal("invalid statistics accepted as complete")
			}
		})
	}
}

func TestNodeObservationStatisticsFailureNeverBecomesZero(t *testing.T) {
	for _, status := range []int{400, 401, 404, 500, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			client := statisticsTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				fmt.Fprint(w, `{"success":false,"error_message":"sensitive source details"}`)
			})
			out, err := client.observationStatistics(t.Context(), "GW", 2, nil, time.Now().Add(-time.Hour), time.Now())
			if err == nil || out.TotalRecords != nil || strings.Contains(err.Error(), "sensitive") {
				t.Fatal("source error leaked or became a confirmed zero")
			}
		})
	}
}

func TestNodeObservationStatisticsConfirmedEmpty(t *testing.T) {
	client := statisticsTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		p := statisticsPayload()
		records := p["records"].(map[string]any)
		records["total"], records["first_at"], records["last_at"] = 0, nil, nil
		for _, d := range records["daily"].([]any) {
			d.(map[string]any)["count"] = 0
		}
		json.NewEncoder(w).Encode(map[string]any{"success": true, "payload": p})
	})
	start := time.Date(2026, 11, 2, 0, 0, 0, 0, platform.LegacySourceLocation)
	out, err := client.observationStatistics(t.Context(), "GW", 2, nil, start, start.AddDate(0, 0, 2))
	if err != nil || out.TotalRecords == nil || *out.TotalRecords != 0 || out.FirstObservedAt != nil || out.LastObservedAt != nil || *out.Days[1].Records != 0 {
		t.Fatalf("empty source is not confirmed zero: %+v %v", out, err)
	}
}
