package datasource

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchTextLogPreview(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write([]byte("2026-07-17 INFO device online\n"))
	}))
	defer server.Close()

	content, err := fetchTextLogPreview(context.Background(), server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if content != "2026-07-17 INFO device online\n" {
		t.Fatalf("unexpected preview content: %q", content)
	}
}
func TestFetchTextLogPreviewRejectsOversizedContent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(make([]byte, maxLogPreviewBytes+1))
	}))
	defer server.Close()

	if _, err := fetchTextLogPreview(context.Background(), server.URL); err == nil {
		t.Fatal("expected oversized preview to fail")
	}
}
