package objectstore

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	amzDateLayout    = "20060102T150405Z"
	shortDateLayout  = "20060102"
	unsignedPayload  = "UNSIGNED-PAYLOAD"
	defaultS3Region  = "us-east-1"
	s3SigningService = "s3"
)

func presignGetObjectURL(endpoint string, bucket string, objectKey string, accessKey string, secretKey string, region string, now time.Time, ttl time.Duration) (string, error) {
	u, err := url.Parse(normalizedEndpoint(endpoint))
	if err != nil {
		return "", err
	}
	u.Path = joinURLPath(bucket, objectKey)

	expires := int64(ttl.Seconds())
	if expires < 1 {
		expires = 1
	}
	if expires > 604800 {
		expires = 604800
	}

	now = now.UTC()
	amzDate := now.Format(amzDateLayout)
	date := now.Format(shortDateLayout)
	region = normalizedRegion(region)
	scope := credentialScope(date, region)

	q := u.Query()
	q.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	q.Set("X-Amz-Credential", accessKey+"/"+scope)
	q.Set("X-Amz-Date", amzDate)
	q.Set("X-Amz-Expires", strconv.FormatInt(expires, 10))
	q.Set("X-Amz-SignedHeaders", "host")
	u.RawQuery = q.Encode()

	canonicalHeaders := "host:" + u.Host + "\n"
	canonicalRequest := strings.Join([]string{
		http.MethodGet,
		u.EscapedPath(),
		u.RawQuery,
		canonicalHeaders,
		"host",
		unsignedPayload,
	}, "\n")
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		sha256HexString(canonicalRequest),
	}, "\n")
	signature := s3Signature(secretKey, date, region, stringToSign)

	q.Set("X-Amz-Signature", signature)
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func credentialScope(date string, region string) string {
	return date + "/" + normalizedRegion(region) + "/" + s3SigningService + "/aws4_request"
}

func normalizedRegion(region string) string {
	region = strings.TrimSpace(region)
	if region == "" {
		return defaultS3Region
	}
	return region
}

func s3Signature(secretKey string, date string, region string, stringToSign string) string {
	kDate := hmacSHA256([]byte("AWS4"+secretKey), date)
	kRegion := hmacSHA256(kDate, normalizedRegion(region))
	kService := hmacSHA256(kRegion, s3SigningService)
	kSigning := hmacSHA256(kService, "aws4_request")
	return hex.EncodeToString(hmacSHA256(kSigning, stringToSign))
}

func hmacSHA256(key []byte, value string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}
