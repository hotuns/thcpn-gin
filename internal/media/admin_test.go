package media

import (
	"github.com/google/uuid"
	"testing"
	"thcpn-gin/internal/billing"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/objectstore"
	"thcpn-gin/internal/testdb"
	"time"
)

func TestAdministratorCanReadAndDownloadUnassignedMedia(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	id, stream := uuid.New(), uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO devices(id,name,device_type) VALUES($1,'Installation station','standalone')`, id); err != nil {
		t.Fatal(err)
	}
	signer := objectstore.NewSigner(config.ObjectStoreConfig{Provider: "file", Bucket: "test", PublicURLPrefix: "https://example.test/files"}, "test-secret")
	svc := NewService(db, nil, nil, signer, config.QueryLimitsConfig{MaxHistoryDays: 31, MaxMediaPageSize: 100})
	// A zero-value billing service would panic if this administrative path tried
	// to consult a user's plan or download budget.
	svc.billing = &billing.Service{}
	input := QueryInput{DeviceID: &id, StartTime: time.Now().Add(-time.Hour), EndTime: time.Now(), Page: 1, PageSize: 20, Administrative: true, DownloadAllowed: true}
	if _, err := svc.List(ctx, input); err != nil {
		t.Fatal(err)
	}
	input.Administrative = false
	if _, err := svc.List(ctx, input); err == nil {
		t.Fatal("ordinary requests must require an assignment")
	}
	if _, err := db.Exec(ctx, `INSERT INTO data_streams(id,device_id,code,name,type,created_by,created_by_type) VALUES($1,$2,'image','Camera image','image',$3,'system_admin')`, stream, id, admin); err != nil {
		t.Fatal(err)
	}
	token, _, err := signer.SignDownloadToken(objectstore.DownloadTokenClaims{DataStreamID: stream, DeviceID: id, MediaID: "image-1", MediaType: "image", ObjectKey: "raw/image.jpg"}, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	result, err := svc.PrepareAdminDownload(ctx, token)
	if err != nil || result.URL == "" || result.WorkspaceID != uuid.Nil {
		t.Fatalf("administrator download: %#v %v", result, err)
	}
	if _, err = svc.ResolveMediaToken(ctx, token); err == nil {
		t.Fatal("ordinary download must retain assignment checks")
	}
}
