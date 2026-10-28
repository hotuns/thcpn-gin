package deviceprofile

import (
	"bytes"
	"context"
	"errors"
	"github.com/google/uuid"
	"image"
	"image/png"
	"testing"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/objectstore"
	"thcpn-gin/internal/testdb"
)

func TestAdministratorMaintainsUnassignedInstallationProfile(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	id := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO devices(id,name,device_type) VALUES($1,'New station','standalone')`, id); err != nil {
		t.Fatal(err)
	}
	storeCfg := config.ObjectStoreConfig{Provider: "file", Bucket: "test", LocalPath: t.TempDir(), PublicURLPrefix: "https://example.test/files"}
	sourceLat, sourceLng := 10.0, 20.0
	svc := NewService(db, objectstore.NewStore(storeCfg), objectstore.NewSigner(storeCfg, "test-secret"), func(_ context.Context, _ uuid.UUID) (SourceLocation, bool, error) {
		return SourceLocation{Latitude: &sourceLat, Longitude: &sourceLng}, true, nil
	})
	description := "Installed by operations"
	if _, err := svc.Update(ctx, UpdateProfileInput{DeviceID: id, ActorUserID: admin, Administrator: true, Description: &description}); err != nil {
		t.Fatal(err)
	}
	lat, lng := 40.2, 116.3
	result, err := svc.SetLocation(ctx, id, &lat, &lng)
	if err != nil || result.LocationSource != "device" || result.Latitude == nil || *result.Latitude != lat {
		t.Fatalf("manual position: %#v %v", result, err)
	}
	result, err = svc.Update(ctx, UpdateProfileInput{DeviceID: id, Administrator: true, Description: &description})
	if err != nil || result.ManualLatitude == nil || *result.ManualLatitude != lat {
		t.Fatalf("profile edit erased installation coordinates: %v", err)
	}
	var picture bytes.Buffer
	if err = png.Encode(&picture, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	photos, err := svc.Upload(ctx, id, uuid.Nil, []UploadImageInput{{Filename: "installation.png", ContentType: "image/png", Data: picture.Bytes()}})
	if err != nil || len(photos) != 1 || photos[0].UploadedBy != nil {
		t.Fatalf("administrator photo upload: %v", err)
	}
	result, err = svc.SetLocation(ctx, id, nil, nil)
	if err != nil || result.LocationSource != "source" || result.Latitude == nil || *result.Latitude != sourceLat {
		t.Fatalf("source fallback: %#v %v", result, err)
	}
	invalid := 91.0
	if _, err = svc.SetLocation(ctx, id, &invalid, &lng); err == nil {
		t.Fatal("out-of-range latitude accepted")
	}
	if _, err = svc.SetLocation(ctx, id, &lat, nil); err == nil {
		t.Fatal("half coordinate pair accepted")
	}
	fallback := NewService(db, objectstore.NewStore(storeCfg), objectstore.NewSigner(storeCfg, "test-secret"), func(context.Context, uuid.UUID) (SourceLocation, bool, error) {
		return SourceLocation{}, false, errors.New("source offline")
	})
	result, err = fallback.Get(ctx, id)
	if err != nil || result.LocationWarning == "" {
		t.Fatalf("offline source must not block installation editing: %v", err)
	}
}
