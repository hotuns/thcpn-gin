package processing

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"thcpn-gin/internal/apperr"
)

func TestProcessingClientContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/processors":
			_, _ = w.Write([]byte(`{"items":[{"code":"ndvi","version":"1","name":"NDVI"}]}`))
		case "/v1/executions":
			var input ExecuteRequest
			_ = json.NewDecoder(r.Body).Decode(&input)
			_, _ = w.Write([]byte(`{"execution_id":"exec-1","request_id":"` + input.RequestID + `","status":"queued"}`))
		case "/v1/executions/exec-1":
			_, _ = w.Write([]byte(`{"execution_id":"exec-1","status":"succeeded"}`))
		default:
			http.Error(w, "missing", http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	client := NewClient(server.URL + "/")
	items, err := client.Catalog(t.Context())
	if err != nil || len(items) != 1 || items[0].Code != "ndvi" || len(items[0].Raw) == 0 {
		t.Fatalf("unexpected catalog: %#v, %v", items, err)
	}
	state, err := client.Submit(t.Context(), ExecuteRequest{RequestID: "request-1"})
	if err != nil || state.ExecutionID != "exec-1" || state.RequestID != "request-1" {
		t.Fatalf("unexpected submission: %#v, %v", state, err)
	}
	state, err = client.Execution(t.Context(), "exec-1")
	if err != nil || state.Status != "succeeded" {
		t.Fatalf("unexpected execution: %#v, %v", state, err)
	}
	if got := client.ResolveURL("/artifacts/result.csv"); got != server.URL+"/artifacts/result.csv" {
		t.Fatalf("unexpected resolved URL: %q", got)
	}
}

func TestProcessingClientMapsHTTPFailures(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(server.Close)
	_, err := NewClient(server.URL).Catalog(t.Context())
	if apperr.KindOf(err) != apperr.KindDataSource {
		t.Fatalf("expected data source error, got %v", err)
	}
}
