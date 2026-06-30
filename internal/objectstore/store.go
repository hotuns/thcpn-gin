package objectstore

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

type Store interface {
	Delete(ctx context.Context, objectKey string) error
	Get(ctx context.Context, objectKey string) (GetResult, error)
	Put(ctx context.Context, input PutInput) error
}

type PutInput struct {
	ObjectKey   string
	ContentType string
	Body        io.Reader
}

type GetResult struct {
	Body        io.ReadCloser
	ContentType string
}

type FileStore struct {
	rootDir string
	bucket  string
}

type S3Store struct {
	cfg       config.ObjectStoreConfig
	accessKey string
	secretKey string
	client    *http.Client
	now       func() time.Time
}

func NewStore(cfg config.ObjectStoreConfig) Store {
	switch normalizedProvider(cfg.Provider) {
	case "file", "local":
		root := strings.TrimSpace(cfg.LocalPath)
		if root == "" {
			root = "var/objectstore"
		}
		return &FileStore{rootDir: root, bucket: strings.TrimSpace(cfg.Bucket)}
	default:
		return &S3Store{
			cfg:       cfg,
			accessKey: strings.TrimSpace(os.Getenv(strings.TrimSpace(cfg.AccessKeyEnv))),
			secretKey: strings.TrimSpace(os.Getenv(strings.TrimSpace(cfg.SecretKeyEnv))),
			client:    http.DefaultClient,
			now:       time.Now,
		}
	}
}

func (s *FileStore) Get(ctx context.Context, objectKey string) (GetResult, error) {
	if err := ctx.Err(); err != nil {
		return GetResult{}, err
	}
	target, err := s.objectPath(objectKey)
	if err != nil {
		return GetResult{}, err
	}
	file, err := os.Open(target)
	if err != nil {
		return GetResult{}, apperr.Wrap(apperr.KindNotFound, "object not found", err)
	}
	return GetResult{Body: file}, nil
}

func (s *FileStore) Delete(ctx context.Context, objectKey string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	target, err := s.objectPath(objectKey)
	if err != nil {
		return err
	}
	if err := os.Remove(target); err != nil {
		return apperr.Wrap(apperr.KindNotFound, "object not found", err)
	}
	return nil
}

func (s *FileStore) Put(ctx context.Context, input PutInput) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if input.Body == nil {
		return apperr.New(apperr.KindInvalidArgument, "object body is required")
	}

	target, err := s.objectPath(input.ObjectKey)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return apperr.Wrap(apperr.KindInternal, "create object store directory", err)
	}

	tmp := target + ".tmp"
	file, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "create object file", err)
	}
	if _, err := io.Copy(file, input.Body); err != nil {
		_ = file.Close()
		return apperr.Wrap(apperr.KindInternal, "write object file", err)
	}
	if err := file.Close(); err != nil {
		return apperr.Wrap(apperr.KindInternal, "close object file", err)
	}
	if err := os.Rename(tmp, target); err != nil {
		return apperr.Wrap(apperr.KindInternal, "commit object file", err)
	}
	return nil
}

func (s *FileStore) objectPath(objectKey string) (string, error) {
	objectKey = strings.TrimSpace(objectKey)
	if objectKey == "" {
		return "", apperr.New(apperr.KindInvalidArgument, "object key is required")
	}
	parts := []string{s.rootDir}
	if strings.TrimSpace(s.bucket) != "" {
		parts = append(parts, strings.Trim(strings.TrimSpace(s.bucket), string(filepath.Separator)))
	}
	for _, part := range strings.Split(strings.Trim(objectKey, "/"), "/") {
		part = strings.TrimSpace(part)
		if part == "" || part == "." || part == ".." {
			return "", apperr.New(apperr.KindInvalidArgument, "invalid object key")
		}
		parts = append(parts, part)
	}
	return filepath.Join(parts...), nil
}

func (s *S3Store) Get(ctx context.Context, objectKey string) (GetResult, error) {
	objectKey = strings.TrimSpace(objectKey)
	if objectKey == "" {
		return GetResult{}, apperr.New(apperr.KindInvalidArgument, "object key is required")
	}
	if strings.TrimSpace(s.cfg.Endpoint) == "" {
		return GetResult{}, apperr.New(apperr.KindInternal, "object store endpoint is required")
	}
	if strings.TrimSpace(s.cfg.Bucket) == "" {
		return GetResult{}, apperr.New(apperr.KindInternal, "object store bucket is required")
	}
	if s.accessKey == "" || s.secretKey == "" {
		return GetResult{}, apperr.New(apperr.KindInternal, "object store access key and secret key are required")
	}
	url, err := presignGetObjectURL(s.cfg.Endpoint, s.cfg.Bucket, objectKey, s.accessKey, s.secretKey, s.cfg.Region, s.now(), 15*time.Minute)
	if err != nil {
		return GetResult{}, apperr.Wrap(apperr.KindInternal, "presign object download", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return GetResult{}, apperr.Wrap(apperr.KindInternal, "create object download request", err)
	}
	client := s.client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return GetResult{}, apperr.Wrap(apperr.KindInternal, "download object", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		_ = resp.Body.Close()
		return GetResult{}, apperr.New(apperr.KindInternal, "download object failed with status "+resp.Status)
	}
	return GetResult{Body: resp.Body, ContentType: resp.Header.Get("Content-Type")}, nil
}

func (s *S3Store) Delete(ctx context.Context, objectKey string) error {
	objectKey = strings.TrimSpace(objectKey)
	if objectKey == "" {
		return apperr.New(apperr.KindInvalidArgument, "object key is required")
	}
	if err := s.validateRemoteConfig(); err != nil {
		return err
	}
	req, err := s.newSignedRequest(ctx, http.MethodDelete, objectKey, nil, "")
	if err != nil {
		return err
	}
	client := s.client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete object", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return apperr.New(apperr.KindInternal, "delete object failed with status "+resp.Status)
	}
	return nil
}

func (s *S3Store) Put(ctx context.Context, input PutInput) error {
	objectKey := strings.TrimSpace(input.ObjectKey)
	if objectKey == "" {
		return apperr.New(apperr.KindInvalidArgument, "object key is required")
	}
	if input.Body == nil {
		return apperr.New(apperr.KindInvalidArgument, "object body is required")
	}
	if err := s.validateRemoteConfig(); err != nil {
		return err
	}

	body, err := io.ReadAll(input.Body)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "read object body", err)
	}
	req, err := s.newSignedRequest(ctx, http.MethodPut, objectKey, bytes.NewReader(body), input.ContentType)
	if err != nil {
		return err
	}

	client := s.client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "upload object", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return apperr.New(apperr.KindInternal, "upload object failed with status "+resp.Status)
	}
	return nil
}

func (s *S3Store) validateRemoteConfig() error {
	if strings.TrimSpace(s.cfg.Endpoint) == "" {
		return apperr.New(apperr.KindInternal, "object store endpoint is required")
	}
	if strings.TrimSpace(s.cfg.Bucket) == "" {
		return apperr.New(apperr.KindInternal, "object store bucket is required")
	}
	if s.accessKey == "" || s.secretKey == "" {
		return apperr.New(apperr.KindInternal, "object store access key and secret key are required")
	}
	return nil
}

func (s *S3Store) newSignedRequest(ctx context.Context, method string, objectKey string, body io.Reader, contentType string) (*http.Request, error) {
	payloadHash := sha256HexString("")
	if body != nil {
		if seeker, ok := body.(io.Seeker); ok {
			current, _ := seeker.Seek(0, io.SeekCurrent)
			data, err := io.ReadAll(body)
			if err != nil {
				return nil, apperr.Wrap(apperr.KindInternal, "read object body", err)
			}
			if _, err := seeker.Seek(current, io.SeekStart); err != nil {
				return nil, apperr.Wrap(apperr.KindInternal, "rewind object body", err)
			}
			payloadHash = sha256HexBytes(data)
		} else {
			return nil, apperr.New(apperr.KindInternal, "object body must be seekable")
		}
	}
	u, err := url.Parse(normalizedEndpoint(s.cfg.Endpoint))
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "parse object store endpoint", err)
	}
	u.Path = joinURLPath(s.cfg.Bucket, objectKey)

	now := s.now().UTC()
	amzDate := now.Format(amzDateLayout)
	date := now.Format(shortDateLayout)
	region := normalizedRegion(s.cfg.Region)
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalHeaders := "host:" + u.Host + "\n" +
		"x-amz-content-sha256:" + payloadHash + "\n" +
		"x-amz-date:" + amzDate + "\n"
	canonicalRequest := strings.Join([]string{
		method,
		u.EscapedPath(),
		"",
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	}, "\n")
	scope := credentialScope(date, region)
	signature := s3Signature(s.secretKey, date, region, strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		sha256HexString(canonicalRequest),
	}, "\n"))

	req, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "create object store request", err)
	}
	if strings.TrimSpace(contentType) != "" {
		req.Header.Set("Content-Type", strings.TrimSpace(contentType))
	} else if method == http.MethodPut {
		req.Header.Set("Content-Type", "application/octet-stream")
	}
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+s.accessKey+"/"+scope+", SignedHeaders="+signedHeaders+", Signature="+signature)
	return req, nil
}

func normalizedProvider(provider string) string {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == "" {
		return "minio"
	}
	return provider
}

func sha256HexBytes(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func sha256HexString(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
