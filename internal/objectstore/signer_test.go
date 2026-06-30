package objectstore

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/config"
)

func TestSignerRoundTripDownloadToken(t *testing.T) {
	signer := NewSigner(config.ObjectStoreConfig{
		Endpoint: "127.0.0.1:9000",
		Bucket:   "iot-platform",
	}, "test-secret")
	signer.now = func() time.Time {
		return time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC)
	}

	streamID := uuid.New()
	deviceID := uuid.New()
	token, expiresAt, err := signer.SignDownloadToken(DownloadTokenClaims{
		DataStreamID: streamID,
		DeviceID:     deviceID,
		MediaID:      "img-001",
		ObjectKey:    "images/raw/img-001.jpg",
		MediaType:    "image",
	}, 15*time.Minute)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	if expiresAt.IsZero() {
		t.Fatal("expected expires_at")
	}

	claims, err := signer.VerifyDownloadToken(token)
	if err != nil {
		t.Fatalf("verify token: %v", err)
	}
	if claims.DataStreamID != streamID || claims.DeviceID != deviceID || claims.ObjectKey != "images/raw/img-001.jpg" {
		t.Fatalf("unexpected claims: %#v", claims)
	}
}

func TestSignObjectURL(t *testing.T) {
	signer := NewSigner(config.ObjectStoreConfig{
		Endpoint: "127.0.0.1:9000",
		Bucket:   "iot-platform",
	}, "test-secret")
	signer.now = func() time.Time {
		return time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC)
	}

	signed, err := signer.SignObjectURL("images/raw/img-001.jpg", 15*time.Minute)
	if err != nil {
		t.Fatalf("sign url: %v", err)
	}
	if signed.URL == "" || signed.ExpiresAt.IsZero() {
		t.Fatalf("unexpected signed url: %#v", signed)
	}
	if !strings.HasPrefix(signed.URL, signedObjectDownloadPath+"?") {
		t.Fatalf("expected platform signed object URL, got %q", signed.URL)
	}
	if err := signer.VerifyObjectURLSignature(http.MethodGet, "images/raw/img-001.jpg", queryValue(t, signed.URL, "expires"), queryValue(t, signed.URL, "signature")); err != nil {
		t.Fatalf("verify object signature: %v", err)
	}
}

func TestFileStorePut(t *testing.T) {
	root := t.TempDir()
	store := NewStore(config.ObjectStoreConfig{
		Provider:  "file",
		Bucket:    "iot-platform",
		LocalPath: root,
	})

	err := store.Put(t.Context(), PutInput{
		ObjectKey:   "exports/job-001.csv",
		ContentType: "text/csv",
		Body:        strings.NewReader("a,b\n1,2\n"),
	})
	if err != nil {
		t.Fatalf("put object: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(root, "iot-platform", "exports", "job-001.csv"))
	if err != nil {
		t.Fatalf("read object: %v", err)
	}
	if string(data) != "a,b\n1,2\n" {
		t.Fatalf("unexpected object content: %q", data)
	}

	got, err := store.Get(t.Context(), "exports/job-001.csv")
	if err != nil {
		t.Fatalf("get object: %v", err)
	}
	defer got.Body.Close()
	readBack, err := io.ReadAll(got.Body)
	if err != nil {
		t.Fatalf("read object body: %v", err)
	}
	if string(readBack) != "a,b\n1,2\n" {
		t.Fatalf("unexpected readback content: %q", readBack)
	}
}

func TestDownloadHandlerServesSignedFileObject(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)

	root := t.TempDir()
	cfg := config.ObjectStoreConfig{
		Provider:  "file",
		Endpoint:  "127.0.0.1:8080",
		Bucket:    "iot-platform",
		LocalPath: root,
	}
	store := NewStore(cfg)
	signer := NewSigner(cfg, "test-secret")
	signer.now = func() time.Time {
		return time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC)
	}
	if err := store.Put(t.Context(), PutInput{
		ObjectKey:   "exports/job-001.csv",
		ContentType: "text/csv",
		Body:        strings.NewReader("a,b\n1,2\n"),
	}); err != nil {
		t.Fatalf("put object: %v", err)
	}

	signed, err := signer.SignObjectURL("exports/job-001.csv", 15*time.Minute)
	if err != nil {
		t.Fatalf("sign object URL: %v", err)
	}

	router := gin.New()
	router.GET(signedObjectDownloadPath, NewHandler(store, signer).Download)

	req := httptest.NewRequest(http.MethodGet, signed.URL, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d: %s", http.StatusOK, rec.Code, rec.Body.String())
	}
	if rec.Body.String() != "a,b\n1,2\n" {
		t.Fatalf("unexpected response body: %q", rec.Body.String())
	}
}

func TestDownloadHandlerRejectsInvalidSignature(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)

	cfg := config.ObjectStoreConfig{
		Provider:  "file",
		Endpoint:  "127.0.0.1:8080",
		Bucket:    "iot-platform",
		LocalPath: t.TempDir(),
	}
	store := NewStore(cfg)
	signer := NewSigner(cfg, "test-secret")

	router := gin.New()
	router.GET(signedObjectDownloadPath, NewHandler(store, signer).Download)

	req := httptest.NewRequest(http.MethodGet, signedObjectDownloadPath+"?object_key=exports/job-001.csv&expires=9999999999&signature=bad", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d", http.StatusBadRequest, rec.Code)
	}
}

func queryValue(t *testing.T, rawURL string, key string) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, rawURL, nil)
	return req.URL.Query().Get(key)
}
