package objectstore

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/config"
)

func TestSignerRoundTripDownloadToken(t *testing.T) {
	signer := NewSigner(config.ObjectStoreConfig{
		Provider: "file",
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
		Provider: "file",
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

func TestSignObjectURLUsesPublicPrefix(t *testing.T) {
	for _, input := range []string{
		"https://iot-datas.oss-cn-beijing.aliyuncs.com",
		"https://iot-datas.oss-cn-beijing.aliyuncs.com/",
		"https://iot-datas.oss-cn-beijing.aliyuncs.com=",
	} {
		t.Run(input, func(t *testing.T) {
			signer := NewSigner(config.ObjectStoreConfig{
				Bucket:          "iot-platform",
				PublicURLPrefix: input,
			}, "")
			signer.now = func() time.Time {
				return time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC)
			}

			signed, err := signer.SignObjectURL("raw/img-1.jpg", 15*time.Minute)
			if err != nil {
				t.Fatalf("sign url: %v", err)
			}
			if signed.URL != "https://iot-datas.oss-cn-beijing.aliyuncs.com/raw/img-1.jpg" {
				t.Fatalf("unexpected public URL: %q", signed.URL)
			}
			if signed.ExpiresAt.IsZero() {
				t.Fatal("expected expires_at")
			}
		})
	}
}

func TestSignObjectURLUsesOSSPresign(t *testing.T) {
	t.Setenv("TEST_OSS_ACCESS_KEY", "ak")
	t.Setenv("TEST_OSS_SECRET_KEY", "sk")
	signer := NewSigner(config.ObjectStoreConfig{
		Provider:     "oss",
		Endpoint:     "https://oss-cn-beijing.aliyuncs.com",
		Bucket:       "iot-platform",
		Region:       "cn-beijing",
		AccessKeyEnv: "TEST_OSS_ACCESS_KEY",
		SecretKeyEnv: "TEST_OSS_SECRET_KEY",
	}, "test-secret")
	signer.now = func() time.Time {
		return time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC)
	}

	signed, err := signer.SignObjectURL("raw/img-1.jpg", 15*time.Minute)
	if err != nil {
		t.Fatalf("sign oss url: %v", err)
	}
	if !strings.Contains(signed.URL, "iot-platform.oss-cn-beijing.aliyuncs.com/raw/img-1.jpg?") {
		t.Fatalf("expected OSS signed URL, got %q", signed.URL)
	}
	if !strings.Contains(signed.URL, "x-oss-signature=") {
		t.Fatalf("expected OSS signature query, got %q", signed.URL)
	}
	if signed.ExpiresAt.IsZero() {
		t.Fatal("expected expires_at")
	}
}

func TestSignObjectURLRequiresOSSCredentials(t *testing.T) {
	signer := NewSigner(config.ObjectStoreConfig{
		Provider: "oss",
		Endpoint: "https://oss-cn-beijing.aliyuncs.com",
		Bucket:   "iot-platform",
		Region:   "cn-beijing",
	}, "test-secret")

	if _, err := signer.SignObjectURL("raw/img-1.jpg", 15*time.Minute); err == nil || !strings.Contains(err.Error(), "access key") {
		t.Fatalf("expected OSS credential error, got %v", err)
	}
}

func TestSignObjectURLReturnsAbsoluteHTTPURL(t *testing.T) {
	signer := NewSigner(config.ObjectStoreConfig{
		Bucket:          "iot-platform",
		PublicURLPrefix: "https://iot-datas.oss-cn-beijing.aliyuncs.com",
	}, "")

	signed, err := signer.SignObjectURL("https://cdn.example.com/raw/img-1.jpg", 15*time.Minute)
	if err != nil {
		t.Fatalf("sign url: %v", err)
	}
	if signed.URL != "https://cdn.example.com/raw/img-1.jpg" {
		t.Fatalf("expected absolute URL to pass through, got %q", signed.URL)
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

	if err := store.Delete(t.Context(), "exports/job-001.csv"); err != nil {
		t.Fatalf("delete object: %v", err)
	}
	if _, err := store.Get(t.Context(), "exports/job-001.csv"); err == nil {
		t.Fatal("expected deleted object to be missing")
	}
}

func TestNewStoreCreatesOSSStore(t *testing.T) {
	store := NewStore(config.ObjectStoreConfig{
		Provider: "oss",
	})
	if _, ok := store.(*OSSStore); !ok {
		t.Fatalf("expected OSSStore, got %T", store)
	}
}

func TestOSSStoreRequiresConfig(t *testing.T) {
	store := &OSSStore{
		cfg: config.ObjectStoreConfig{
			Provider: "oss",
			Endpoint: "https://oss-cn-beijing.aliyuncs.com",
			Bucket:   "iot-platform",
			Region:   "cn-beijing",
		},
	}
	err := store.Put(t.Context(), PutInput{
		ObjectKey: "exports/job-001.csv",
		Body:      strings.NewReader("a,b\n"),
	})
	if err == nil || !strings.Contains(err.Error(), "access key") {
		t.Fatalf("expected credential error, got %v", err)
	}
}

func TestOSSStorePutGetDelete(t *testing.T) {
	client := &fakeOSSClient{
		getBody:        "hello oss",
		getContentType: "text/plain",
	}
	store := &OSSStore{
		cfg: config.ObjectStoreConfig{
			Provider: "oss",
			Endpoint: "https://oss-cn-beijing.aliyuncs.com",
			Bucket:   "iot-platform",
			Region:   "cn-beijing",
		},
		accessKey: "ak",
		secretKey: "sk",
		client:    client,
	}

	if err := store.Put(t.Context(), PutInput{
		ObjectKey:   "exports/job-001.csv",
		ContentType: "text/csv",
		Body:        strings.NewReader("a,b\n1,2\n"),
	}); err != nil {
		t.Fatalf("put oss object: %v", err)
	}
	if client.putBucket != "iot-platform" || client.putKey != "exports/job-001.csv" || client.putContentType != "text/csv" || client.putBody != "a,b\n1,2\n" {
		t.Fatalf("unexpected put request: %#v", client)
	}

	got, err := store.Get(t.Context(), "exports/job-001.csv")
	if err != nil {
		t.Fatalf("get oss object: %v", err)
	}
	defer got.Body.Close()
	data, err := io.ReadAll(got.Body)
	if err != nil {
		t.Fatalf("read oss object: %v", err)
	}
	if string(data) != "hello oss" || got.ContentType != "text/plain" {
		t.Fatalf("unexpected get result: body=%q content_type=%q", string(data), got.ContentType)
	}
	if client.getBucket != "iot-platform" || client.getKey != "exports/job-001.csv" {
		t.Fatalf("unexpected get request: %#v", client)
	}

	if err := store.Delete(t.Context(), "exports/job-001.csv"); err != nil {
		t.Fatalf("delete oss object: %v", err)
	}
	if client.deleteBucket != "iot-platform" || client.deleteKey != "exports/job-001.csv" {
		t.Fatalf("unexpected delete request: %#v", client)
	}
}

func TestOSSStoreRejectsPathTraversalKey(t *testing.T) {
	store := &OSSStore{
		cfg:       config.ObjectStoreConfig{Endpoint: "https://oss-cn-beijing.aliyuncs.com", Bucket: "iot-platform", Region: "cn-beijing"},
		accessKey: "ak",
		secretKey: "sk",
		client:    &fakeOSSClient{},
	}
	err := store.Put(t.Context(), PutInput{
		ObjectKey: "../exports/job-001.csv",
		Body:      strings.NewReader("a,b\n"),
	})
	if err == nil || !strings.Contains(err.Error(), "invalid object key") {
		t.Fatalf("expected invalid object key error, got %v", err)
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

type fakeOSSClient struct {
	putBucket      string
	putKey         string
	putContentType string
	putBody        string
	putErr         error

	getBucket      string
	getKey         string
	getBody        string
	getContentType string
	getErr         error

	deleteBucket string
	deleteKey    string
	deleteErr    error
}

func (f *fakeOSSClient) PutObject(_ context.Context, request *oss.PutObjectRequest, _ ...func(*oss.Options)) (*oss.PutObjectResult, error) {
	if f.putErr != nil {
		return nil, f.putErr
	}
	f.putBucket = oss.ToString(request.Bucket)
	f.putKey = oss.ToString(request.Key)
	if request.ContentType != nil {
		f.putContentType = *request.ContentType
	}
	if request.Body != nil {
		data, err := io.ReadAll(request.Body)
		if err != nil {
			return nil, err
		}
		f.putBody = string(data)
	}
	return &oss.PutObjectResult{}, nil
}

func (f *fakeOSSClient) GetObject(_ context.Context, request *oss.GetObjectRequest, _ ...func(*oss.Options)) (*oss.GetObjectResult, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	f.getBucket = oss.ToString(request.Bucket)
	f.getKey = oss.ToString(request.Key)
	return &oss.GetObjectResult{
		Body:        io.NopCloser(strings.NewReader(f.getBody)),
		ContentType: oss.Ptr(f.getContentType),
	}, nil
}

func (f *fakeOSSClient) DeleteObject(_ context.Context, request *oss.DeleteObjectRequest, _ ...func(*oss.Options)) (*oss.DeleteObjectResult, error) {
	if f.deleteErr != nil {
		return nil, f.deleteErr
	}
	f.deleteBucket = oss.ToString(request.Bucket)
	f.deleteKey = oss.ToString(request.Key)
	return &oss.DeleteObjectResult{}, nil
}

func queryValue(t *testing.T, rawURL string, key string) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, rawURL, nil)
	return req.URL.Query().Get(key)
}
