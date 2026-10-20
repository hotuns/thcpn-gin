package objectstore

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"thcpn-gin/internal/config"
	"time"
)

func TestS3LargeUploadUsesMultipart(t *testing.T) {
	parts, starts, completes := 0, 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "POST" && r.URL.Query().Has("uploads"):
			starts++
			io.WriteString(w, `<InitiateMultipartUploadResult><UploadId>test-id</UploadId></InitiateMultipartUploadResult>`)
		case r.Method == "PUT" && r.URL.Query().Get("uploadId") == "test-id":
			parts++
			io.Copy(io.Discard, r.Body)
			w.Header().Set("ETag", `"part"`)
		case r.Method == "POST" && r.URL.Query().Get("uploadId") == "test-id":
			completes++
			io.WriteString(w, `<CompleteMultipartUploadResult><ETag>done</ETag></CompleteMultipartUploadResult>`)
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL)
			w.WriteHeader(400)
		}
	}))
	defer server.Close()
	s := &S3Store{cfg: config.ObjectStoreConfig{Endpoint: server.URL, Bucket: "test"}, accessKey: "key", secretKey: "secret", client: server.Client(), now: time.Now}
	if err := s.Put(context.Background(), PutInput{ObjectKey: "large.zip", Body: bytes.NewReader(make([]byte, 33<<20))}); err != nil {
		t.Fatal(err)
	}
	if starts != 1 || parts < 2 || completes != 1 {
		t.Fatalf("multipart lifecycle missing: %d/%d/%d", starts, parts, completes)
	}
}

func TestS3PartRetryAndAbort(t *testing.T) {
	for _, permanent := range []bool{false, true} {
		t.Run(fmt.Sprint(permanent), func(t *testing.T) {
			var attempts, aborts atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.Method {
				case "POST":
					if r.URL.Query().Has("uploads") {
						io.WriteString(w, `<InitiateMultipartUploadResult><UploadId>id</UploadId></InitiateMultipartUploadResult>`)
					} else {
						io.WriteString(w, `<CompleteMultipartUploadResult/>`)
					}
				case "PUT":
					n := attempts.Add(1)
					io.Copy(io.Discard, r.Body)
					if permanent || n == 1 {
						w.WriteHeader(503)
						return
					}
					w.Header().Set("ETag", `"ok"`)
				case "DELETE":
					aborts.Add(1)
				}
			}))
			defer server.Close()
			s := &S3Store{cfg: config.ObjectStoreConfig{Endpoint: server.URL, Bucket: "test"}, accessKey: "key", secretKey: "secret", client: server.Client(), now: time.Now}
			err := s.putMultipart(t.Context(), "file.zip", "application/zip", bytes.NewReader([]byte("payload")), 7)
			if permanent {
				if err == nil || aborts.Load() != 1 || attempts.Load() != 3 {
					t.Fatalf("missing bounded retries/abort: %v %d %d", err, attempts.Load(), aborts.Load())
				}
			} else if err != nil || attempts.Load() != 2 || aborts.Load() != 0 {
				t.Fatalf("part not retried: %v", err)
			}
		})
	}
}

func TestOSSUsesOfficialMultipartUploader(t *testing.T) {
	var starts, parts, completes atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "POST" && r.URL.Query().Has("uploads"):
			starts.Add(1)
			io.WriteString(w, `<InitiateMultipartUploadResult><Bucket>test</Bucket><Key>large.zip</Key><UploadId>oss-test</UploadId></InitiateMultipartUploadResult>`)
		case r.Method == "PUT" && r.URL.Query().Get("uploadId") == "oss-test":
			parts.Add(1)
			io.Copy(io.Discard, r.Body)
			w.Header().Set("ETag", `"part"`)
		case r.Method == "POST" && r.URL.Query().Get("uploadId") == "oss-test":
			completes.Add(1)
			io.WriteString(w, `<CompleteMultipartUploadResult><Bucket>test</Bucket><Key>large.zip</Key><ETag>done</ETag></CompleteMultipartUploadResult>`)
		default:
			w.WriteHeader(400)
		}
	}))
	defer server.Close()
	cfg := config.ObjectStoreConfig{Endpoint: server.URL, Bucket: "test", Region: "cn-beijing"}
	store := &OSSStore{cfg: cfg, accessKey: "key", secretKey: "secret", client: newOSSClient(cfg, "key", "secret")}
	if err := store.Put(t.Context(), PutInput{ObjectKey: "large.zip", Body: bytes.NewReader(make([]byte, 17<<20))}); err != nil {
		t.Fatal(err)
	}
	if starts.Load() != 1 || parts.Load() != 2 || completes.Load() != 1 {
		t.Fatalf("OSS multipart lifecycle: %d/%d/%d", starts.Load(), parts.Load(), completes.Load())
	}
}
