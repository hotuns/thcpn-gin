package media

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/objectstore"
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

	items, err := service.itemsFromDatasource(stream, []datasource.MediaRecord{{
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
	if items[0].PreviewURL != "https://iot-datas.oss-cn-beijing.aliyuncs.com/raw/img-1.jpg" {
		t.Fatalf("unexpected preview URL: %q", items[0].PreviewURL)
	}
	if items[0].ThumbnailURL != "https://iot-datas.oss-cn-beijing.aliyuncs.com/thumbs/img-1.jpg" {
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
