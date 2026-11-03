package media

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/billing"
	"thcpn-gin/internal/config"
	platform "thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/objectstore"
	"thcpn-gin/internal/testdb"
)

func TestNormalizePage(t *testing.T) {
	limits := config.QueryLimitsConfig{MaxHistoryDays: 31, MaxMediaPageSize: 100}

	page, pageSize, err := normalizePage(0, 0, limits)
	if err != nil {
		t.Fatalf("default page: %v", err)
	}
	if page != 1 || pageSize != 100 {
		t.Fatalf("unexpected default page/page_size: %d/%d", page, pageSize)
	}

	if _, _, err := normalizePage(1, 101, limits); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected page size limit error, got %v", err)
	}
}

func TestValidateTimeRange(t *testing.T) {
	limits := config.QueryLimitsConfig{MaxHistoryDays: 31, MaxMediaPageSize: 100}
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(2 * time.Hour)
	if err := validateTimeRange(start, end, limits); err != nil {
		t.Fatalf("expected valid range, got %v", err)
	}
	if err := validateTimeRange(end, start, limits); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid reversed range, got %v", err)
	}
}

func TestIsMediaStreamType(t *testing.T) {
	for _, value := range []string{"image", "video", "audio"} {
		if !isMediaStreamType(value) {
			t.Fatalf("expected %q to be media stream type", value)
		}
	}
	if isMediaStreamType("telemetry") {
		t.Fatal("telemetry should not be media stream type")
	}
}

func TestItemsFromDatasourceIncludesDeleteURLWhenAllowed(t *testing.T) {
	signer := objectstore.NewSigner(config.ObjectStoreConfig{
		Provider:        "file",
		Bucket:          "iot-platform",
		PublicURLPrefix: "https://iot-datas.oss-cn-beijing.aliyuncs.com",
	}, "test-secret")
	service := &Service{signer: signer}
	stream := sqlc.DataStream{
		ID:       uuid.New(),
		DeviceID: uuid.New(),
		Type:     "image",
	}
	thumbnailKey := "thumbs/img-1.jpg"

	items, err := service.itemsFromDatasource(stream, []platform.MediaRecord{{
		ID:                 "img-1",
		ObjectKey:          "raw/img-1.jpg",
		ThumbnailObjectKey: &thumbnailKey,
		MediaType:          "image",
	}}, false, true)
	if err != nil {
		t.Fatalf("items from datasource: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one item, got %d", len(items))
	}
	if items[0].PreviewURL != "https://iot-datas.oss-cn-beijing.aliyuncs.com/raw/img-1.jpg?x-oss-process=image%2Fresize%2Cw_1600%2Fquality%2CQ_75%2Fformat%2Cwebp" {
		t.Fatalf("unexpected preview URL: %q", items[0].PreviewURL)
	}
	if items[0].ThumbnailURL != "https://iot-datas.oss-cn-beijing.aliyuncs.com/raw/img-1.jpg?x-oss-process=image%2Fresize%2Cw_480%2Fquality%2CQ_70%2Fformat%2Cwebp" {
		t.Fatalf("unexpected thumbnail URL: %q", items[0].ThumbnailURL)
	}
	if !items[0].DeleteAllowed || items[0].DeleteURL == nil || !strings.HasPrefix(*items[0].DeleteURL, "/api/v1/media?token=") {
		t.Fatalf("expected delete URL when delete is allowed, got %#v", items[0])
	}
	if items[0].DownloadURL != nil {
		t.Fatalf("did not expect download URL, got %q", *items[0].DownloadURL)
	}
}

func TestDeleteMediaObjectDeletesObject(t *testing.T) {
	store := objectstore.NewStore(config.ObjectStoreConfig{
		Provider:  "file",
		Bucket:    "iot-platform",
		LocalPath: t.TempDir(),
	})
	if err := store.Put(t.Context(), objectstore.PutInput{
		ObjectKey: "raw/img-1.jpg",
		Body:      strings.NewReader("image-bytes"),
	}); err != nil {
		t.Fatalf("put object: %v", err)
	}
	service := &Service{store: store}
	target := MediaTarget{
		DataStreamID: uuid.New(),
		DeviceID:     uuid.New(),
		WorkspaceID:  uuid.New(),
		MediaID:      "img-1",
		MediaType:    "image",
		ObjectKey:    "raw/img-1.jpg",
	}

	result, err := service.DeleteMediaObject(t.Context(), target)
	if err != nil {
		t.Fatalf("delete media object: %v", err)
	}
	if !result.Deleted || result.MediaID != "img-1" {
		t.Fatalf("unexpected delete result: %#v", result)
	}
	if _, err := store.Get(t.Context(), "raw/img-1.jpg"); err == nil {
		t.Fatal("expected deleted object to be missing")
	}
}

type demoMediaRuntime struct{}

func (demoMediaRuntime) QueryMedia(_ context.Context, _ platform.DataSource, _ platform.MediaQuery) (platform.MediaResult, error) {
	return platform.MediaResult{Total: 1, Items: []platform.MediaRecord{{ID: "image-1", ObjectKey: "raw/image.jpg", MediaType: "image"}}}, nil
}

func TestDemoMediaUsesSelectedWorkspaceForListsAndTokens(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	demo, user, demoWorkspace, realWorkspace, device, stream, source := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO users(id,name,username,is_demo) VALUES($1,'Demo','media-demo',true)`, demo)
	must(`INSERT INTO users(id,name,email) VALUES($1,'Owner','media-owner@example.test')`, user)
	must(`INSERT INTO workspaces(id,type,name,owner_user_id,is_demo_workspace) VALUES($1,'personal','Demo',$2,true),($3,'personal','Real',$4,false)`, demoWorkspace, demo, realWorkspace, user)
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'Selected station','standalone')`, device)
	must(`INSERT INTO demo_showcase_devices(user_id,workspace_id,device_id,added_by) VALUES($1,$2,$3,$4)`, demo, demoWorkspace, device, admin)
	must(`INSERT INTO data_streams(id,device_id,code,name,type,created_by,created_by_type) VALUES($1,$2,'image','Image','image',$3,'system_admin')`, stream, device, admin)
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'Source','mysql','thcpn','env:UNUSED',$2)`, source, admin)
	must(`INSERT INTO data_stream_bindings(data_stream_id,data_source_id,payload_type,adapter_code,created_by,created_by_type) VALUES($1,$2,'json','thcpn_legacy_mysql',$3,'system_admin')`, stream, source, admin)
	signer := objectstore.NewSigner(config.ObjectStoreConfig{Provider: "file", Bucket: "test", PublicURLPrefix: "https://example.test/files"}, "test-secret")
	svc := NewService(db, nil, demoMediaRuntime{}, signer, config.QueryLimitsConfig{MaxHistoryDays: 31, MaxMediaPageSize: 100})
	svc.SetBilling(billing.NewService(db, billing.Policy{}))
	demoCtx := auth.WithActor(ctx, auth.Actor{UserID: demo, IsDemo: true})
	userCtx := auth.WithActor(ctx, auth.Actor{UserID: user})
	token, _, err := signer.SignDownloadToken(objectstore.DownloadTokenClaims{DataStreamID: stream, DeviceID: device, MediaID: "image-1", MediaType: "image", ObjectKey: "raw/image.jpg"}, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	for _, assigned := range []bool{false, true} {
		if assigned {
			must(`INSERT INTO device_assignments(device_id,workspace_id) VALUES($1,$2)`, device, realWorkspace)
		}
		for _, byStream := range []bool{false, true} {
			input := QueryInput{DeviceID: &device, StartTime: time.Now().Add(-time.Hour), EndTime: time.Now(), DownloadAllowed: true, AllowUnassigned: true}
			if byStream {
				input.DataStreamID = &stream
			}
			result, err := svc.List(demoCtx, input)
			if err != nil || len(result.Items) != 1 || !result.Items[0].DownloadAllowed || result.Items[0].DownloadURL == nil {
				t.Fatalf("demo media assigned=%t byStream=%t: %#v %v", assigned, byStream, result, err)
			}
			result, err = svc.List(userCtx, input)
			if err != nil || len(result.Items) != 1 || result.Items[0].DownloadAllowed {
				t.Fatalf("ordinary/public media retains unassigned/base-plan behavior: %#v %v", result, err)
			}
			input.AllowUnassigned = false
			if _, err := svc.List(userCtx, input); !assigned && apperr.KindOf(err) != apperr.KindNotFound {
				t.Fatalf("ordinary media must require a real assignment: %v", err)
			}
		}
		target, err := svc.ResolveMediaToken(demoCtx, token)
		if err != nil || target.WorkspaceID != demoWorkspace {
			t.Fatalf("demo token workspace: %#v %v", target, err)
		}
		target, err = svc.ResolveMediaToken(userCtx, token)
		if (!assigned && apperr.KindOf(err) != apperr.KindNotFound) || (assigned && (err != nil || target.WorkspaceID != realWorkspace)) {
			t.Fatalf("ordinary token workspace: %#v %v", target, err)
		}
	}
	must(`DELETE FROM demo_showcase_devices WHERE device_id=$1`, device)
	if _, err := svc.List(demoCtx, QueryInput{DeviceID: &device, StartTime: time.Now().Add(-time.Hour), EndTime: time.Now(), AllowUnassigned: true}); apperr.KindOf(err) != apperr.KindPermissionDenied {
		t.Fatalf("unselected media must remain denied: %v", err)
	}
	if _, err := svc.ResolveMediaToken(demoCtx, token); apperr.KindOf(err) != apperr.KindPermissionDenied {
		t.Fatalf("unselected media token must remain denied: %v", err)
	}
}

func TestConfiguredMediaLimitDetails(t *testing.T) {
	limits := config.QueryLimitsConfig{MaxHistoryDays: 2, MaxMediaPageSize: 7}
	_, _, err := normalizePage(1, 8, limits)
	if d := apperr.DetailsOf(err); d["field"] != "media_page_size" || d["maximum"] != int64(7) {
		t.Fatalf("wrong page limit: %v", d)
	}
	start := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	err = validateTimeRange(start, start.Add(49*time.Hour), limits)
	if d := apperr.DetailsOf(err); d["field"] != "media_days" || d["maximum"] != int64(2) {
		t.Fatalf("wrong time limit: %v", d)
	}
}
