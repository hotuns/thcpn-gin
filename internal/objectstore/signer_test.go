package objectstore

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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
}
