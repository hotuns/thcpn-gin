package objectstore

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss"
	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss/credentials"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

type Signer struct {
	cfg       config.ObjectStoreConfig
	accessKey string
	secretKey string
	secret    string
	now       func() time.Time
}

type SignedURL struct {
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
}

const signedObjectDownloadPath = "/api/v1/objects/download"

type DownloadTokenClaims struct {
	DataStreamID uuid.UUID `json:"data_stream_id"`
	DeviceID     uuid.UUID `json:"device_id"`
	MediaID      string    `json:"media_id"`
	ObjectKey    string    `json:"object_key"`
	MediaType    string    `json:"media_type"`
	ExpiresAt    int64     `json:"expires_at"`
}

func NewSigner(cfg config.ObjectStoreConfig, fallbackSecret string) *Signer {
	accessKey := strings.TrimSpace(os.Getenv(strings.TrimSpace(cfg.AccessKeyEnv)))
	secretKey := strings.TrimSpace(os.Getenv(strings.TrimSpace(cfg.SecretKeyEnv)))
	secret := secretKey
	if secret == "" {
		secret = strings.TrimSpace(fallbackSecret)
	}
	return &Signer{
		cfg:       cfg,
		accessKey: accessKey,
		secretKey: secretKey,
		secret:    secret,
		now:       time.Now,
	}
}

func (s *Signer) SignObjectURL(objectKey string, ttl time.Duration) (SignedURL, error) {
	objectKey = strings.TrimSpace(objectKey)
	if objectKey == "" {
		return SignedURL{}, apperr.New(apperr.KindInvalidArgument, "object key is required")
	}
	if ttl <= 0 {
		return SignedURL{}, apperr.New(apperr.KindInvalidArgument, "url ttl must be greater than 0")
	}

	expiresAt := s.now().Add(ttl).UTC()
	if isAbsoluteHTTPURL(objectKey) {
		return SignedURL{URL: objectKey, ExpiresAt: expiresAt}, nil
	}
	validObjectKey, err := validateObjectKey(objectKey)
	if err != nil {
		return SignedURL{}, err
	}
	if publicURLPrefix := normalizedPublicURLPrefix(s.cfg.PublicURLPrefix); publicURLPrefix != "" {
		return SignedURL{URL: joinPublicObjectURL(publicURLPrefix, validObjectKey), ExpiresAt: expiresAt}, nil
	}
	if err := s.validate(); err != nil {
		return SignedURL{}, err
	}

	provider := normalizedProvider(s.cfg.Provider)
	if provider == "oss" {
		if s.accessKey == "" || s.secretKey == "" {
			return SignedURL{}, apperr.New(apperr.KindInternal, "object store access key and secret key are required")
		}
		u, err := presignOSSGetObjectURL(s.cfg, validObjectKey, s.accessKey, s.secretKey, expiresAt)
		if err != nil {
			return SignedURL{}, apperr.Wrap(apperr.KindInternal, "presign oss object url", err)
		}
		return SignedURL{URL: u, ExpiresAt: expiresAt}, nil
	}
	if (provider == "minio" || provider == "s3") && s.accessKey != "" && s.secretKey != "" {
		u, err := presignGetObjectURL(s.cfg.Endpoint, s.cfg.Bucket, validObjectKey, s.accessKey, s.secretKey, s.cfg.Region, s.now(), ttl)
		if err != nil {
			return SignedURL{}, apperr.Wrap(apperr.KindInternal, "presign object url", err)
		}
		return SignedURL{URL: u, ExpiresAt: expiresAt}, nil
	}

	expires := strconv.FormatInt(expiresAt.Unix(), 10)
	signature := s.signature("GET", validObjectKey, expires)

	u := url.URL{Path: signedObjectDownloadPath}
	q := u.Query()
	q.Set("object_key", validObjectKey)
	q.Set("expires", expires)
	q.Set("signature", signature)
	u.RawQuery = q.Encode()

	return SignedURL{URL: u.String(), ExpiresAt: expiresAt}, nil
}

func (s *Signer) SignImagePreviewURL(objectKey string, process string, ttl time.Duration) (SignedURL, error) {
	process = strings.TrimSpace(process)
	if process == "" {
		return SignedURL{}, apperr.New(apperr.KindInvalidArgument, "image process is required")
	}
	validObjectKey, err := s.NormalizeObjectKey(objectKey)
	if err != nil {
		return SignedURL{}, err
	}
	expiresAt := s.now().Add(ttl).UTC()
	if publicURLPrefix := normalizedPublicURLPrefix(s.cfg.PublicURLPrefix); publicURLPrefix != "" {
		u, err := url.Parse(joinPublicObjectURL(publicURLPrefix, validObjectKey))
		if err != nil {
			return SignedURL{}, apperr.Wrap(apperr.KindInternal, "build image preview url", err)
		}
		query := u.Query()
		query.Set("x-oss-process", process)
		u.RawQuery = query.Encode()
		return SignedURL{URL: u.String(), ExpiresAt: expiresAt}, nil
	}
	if normalizedProvider(s.cfg.Provider) != "oss" || s.accessKey == "" || s.secretKey == "" {
		return SignedURL{}, apperr.New(apperr.KindConflict, "generated image preview is unavailable")
	}
	u, err := presignOSSImageURL(s.cfg, validObjectKey, process, s.accessKey, s.secretKey, expiresAt)
	if err != nil {
		return SignedURL{}, apperr.Wrap(apperr.KindInternal, "presign oss image preview url", err)
	}
	return SignedURL{URL: u, ExpiresAt: expiresAt}, nil
}

// NormalizeObjectKey converts a configured OSS URL or an object key into the
// key accepted by the signer. Absolute URLs are only accepted when they point
// at this signer's configured endpoint and bucket.
func (s *Signer) NormalizeObjectKey(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", apperr.New(apperr.KindInvalidArgument, "object key is required")
	}
	if !isAbsoluteHTTPURL(raw) {
		return validateObjectKey(raw)
	}

	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return "", apperr.New(apperr.KindInvalidArgument, "invalid object url")
	}
	endpoint, err := url.Parse(strings.TrimSpace(s.cfg.Endpoint))
	if err != nil || endpoint.Hostname() == "" {
		return "", apperr.New(apperr.KindInternal, "object store endpoint is required")
	}
	host := strings.ToLower(u.Hostname())
	endpointHost := strings.ToLower(endpoint.Hostname())
	bucketHost := strings.ToLower(strings.TrimSpace(s.cfg.Bucket) + "." + endpointHost)
	if host != endpointHost && host != bucketHost {
		return "", apperr.New(apperr.KindPermissionDenied, "object url host is not allowed")
	}

	key := strings.TrimPrefix(u.Path, "/")
	if host == endpointHost {
		bucket := strings.Trim(strings.TrimSpace(s.cfg.Bucket), "/")
		key = strings.TrimPrefix(key, bucket+"/")
	}
	return validateObjectKey(key)
}

func presignOSSGetObjectURL(cfg config.ObjectStoreConfig, objectKey string, accessKey string, secretKey string, expiresAt time.Time) (string, error) {
	return presignOSSObjectURL(cfg, objectKey, "", accessKey, secretKey, expiresAt)
}

func presignOSSImageURL(cfg config.ObjectStoreConfig, objectKey string, process string, accessKey string, secretKey string, expiresAt time.Time) (string, error) {
	return presignOSSObjectURL(cfg, objectKey, process, accessKey, secretKey, expiresAt)
}

func presignOSSObjectURL(cfg config.ObjectStoreConfig, objectKey string, process string, accessKey string, secretKey string, expiresAt time.Time) (string, error) {
	if strings.TrimSpace(cfg.Endpoint) == "" {
		return "", apperr.New(apperr.KindInternal, "object store endpoint is required")
	}
	if strings.TrimSpace(cfg.Bucket) == "" {
		return "", apperr.New(apperr.KindInternal, "object store bucket is required")
	}
	if strings.TrimSpace(cfg.Region) == "" {
		return "", apperr.New(apperr.KindInternal, "object store region is required")
	}
	if strings.TrimSpace(accessKey) == "" || strings.TrimSpace(secretKey) == "" {
		return "", apperr.New(apperr.KindInternal, "object store access key and secret key are required")
	}
	ossCfg := oss.LoadDefaultConfig().
		WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey)).
		WithRegion(strings.TrimSpace(cfg.Region)).
		WithEndpoint(strings.TrimSpace(cfg.Endpoint)).
		WithSignatureVersion(oss.SignatureVersionV4)
	request := &oss.GetObjectRequest{
		Bucket: oss.Ptr(strings.TrimSpace(cfg.Bucket)),
		Key:    oss.Ptr(objectKey),
	}
	if strings.TrimSpace(process) != "" {
		request.Process = oss.Ptr(strings.TrimSpace(process))
	}
	result, err := oss.NewClient(ossCfg).Presign(context.Background(), request, oss.PresignExpiration(expiresAt))
	if err != nil {
		return "", err
	}
	return result.URL, nil
}

func (s *Signer) VerifyObjectURLSignature(method string, objectKey string, expires string, signature string) error {
	if err := s.validate(); err != nil {
		return err
	}
	objectKey = strings.TrimSpace(objectKey)
	if objectKey == "" {
		return apperr.New(apperr.KindInvalidArgument, "object key is required")
	}
	expires = strings.TrimSpace(expires)
	if expires == "" {
		return apperr.New(apperr.KindInvalidArgument, "expires is required")
	}
	expiresAt, err := strconv.ParseInt(expires, 10, 64)
	if err != nil {
		return apperr.New(apperr.KindInvalidArgument, "invalid expires")
	}
	if expiresAt <= s.now().Unix() {
		return apperr.New(apperr.KindInvalidArgument, "object url expired")
	}
	expected := s.signature(strings.ToUpper(strings.TrimSpace(method)), objectKey, expires)
	if !hmac.Equal([]byte(expected), []byte(strings.TrimSpace(signature))) {
		return apperr.New(apperr.KindInvalidArgument, "invalid object signature")
	}
	return nil
}

func (s *Signer) SignDownloadToken(claims DownloadTokenClaims, ttl time.Duration) (string, time.Time, error) {
	if claims.DataStreamID == uuid.Nil {
		return "", time.Time{}, apperr.New(apperr.KindInvalidArgument, "data stream id is required")
	}
	if claims.DeviceID == uuid.Nil {
		return "", time.Time{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}
	if strings.TrimSpace(claims.ObjectKey) == "" {
		return "", time.Time{}, apperr.New(apperr.KindInvalidArgument, "object key is required")
	}
	if ttl <= 0 {
		return "", time.Time{}, apperr.New(apperr.KindInvalidArgument, "download token ttl must be greater than 0")
	}
	if err := s.validate(); err != nil {
		return "", time.Time{}, err
	}

	expiresAt := s.now().Add(ttl).UTC()
	claims.ExpiresAt = expiresAt.Unix()
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", time.Time{}, apperr.Wrap(apperr.KindInternal, "marshal download token", err)
	}
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	signature := s.hmac(encodedPayload)
	return encodedPayload + "." + signature, expiresAt, nil
}

func (s *Signer) VerifyDownloadToken(token string) (DownloadTokenClaims, error) {
	if err := s.validate(); err != nil {
		return DownloadTokenClaims{}, err
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return DownloadTokenClaims{}, apperr.New(apperr.KindInvalidArgument, "invalid download token")
	}
	expected := s.hmac(parts[0])
	if !hmac.Equal([]byte(expected), []byte(parts[1])) {
		return DownloadTokenClaims{}, apperr.New(apperr.KindInvalidArgument, "invalid download token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return DownloadTokenClaims{}, apperr.New(apperr.KindInvalidArgument, "invalid download token")
	}
	var claims DownloadTokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return DownloadTokenClaims{}, apperr.New(apperr.KindInvalidArgument, "invalid download token")
	}
	if claims.ExpiresAt <= s.now().Unix() {
		return DownloadTokenClaims{}, apperr.New(apperr.KindInvalidArgument, "download token expired")
	}
	return claims, nil
}

func (s *Signer) signature(method string, objectKey string, expires string) string {
	return s.hmac(method + "\n" + strings.TrimSpace(s.cfg.Bucket) + "\n" + objectKey + "\n" + expires)
}

func (s *Signer) hmac(value string) string {
	mac := hmac.New(sha256.New, []byte(s.secret))
	_, _ = mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}

func (s *Signer) validate() error {
	provider := normalizedProvider(s.cfg.Provider)
	if provider != "file" && provider != "local" && strings.TrimSpace(s.cfg.Endpoint) == "" {
		return apperr.New(apperr.KindInternal, "object store endpoint is required")
	}
	if strings.TrimSpace(s.cfg.Bucket) == "" {
		return apperr.New(apperr.KindInternal, "object store bucket is required")
	}
	if strings.TrimSpace(s.secret) == "" {
		return apperr.New(apperr.KindInternal, "object store signing secret is required")
	}
	return nil
}

func normalizedEndpoint(endpoint string) string {
	endpoint = strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if endpoint == "" || strings.Contains(endpoint, "://") {
		return endpoint
	}
	return "http://" + endpoint
}

func normalizedPublicURLPrefix(prefix string) string {
	return strings.TrimRight(strings.TrimSpace(prefix), "/=")
}

func isAbsoluteHTTPURL(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://")
}

func joinPublicObjectURL(prefix string, objectKey string) string {
	parts := make([]string, 0)
	for _, part := range strings.Split(strings.Trim(objectKey, "/"), "/") {
		if part == "" {
			continue
		}
		parts = append(parts, url.PathEscape(part))
	}
	if len(parts) == 0 {
		return prefix
	}
	return prefix + "/" + strings.Join(parts, "/")
}

func joinURLPath(bucket string, objectKey string) string {
	parts := []string{strings.Trim(strings.TrimSpace(bucket), "/")}
	for _, part := range strings.Split(strings.Trim(objectKey, "/"), "/") {
		if part == "" {
			continue
		}
		parts = append(parts, url.PathEscape(part))
	}
	return "/" + strings.Join(parts, "/")
}
