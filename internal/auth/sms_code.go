package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"time"

	"github.com/redis/go-redis/v9"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

type SMSCodeStore struct {
	store *verificationCodeStore
}

type EmailCodeStore struct {
	store *verificationCodeStore
}

type codeStoreConfig struct {
	CodeTTLSeconds    int
	CooldownSeconds   int
	DailyLimit        int
	MaxVerifyAttempts int
}

type verificationCodeStore struct {
	redis     *redis.Client
	secret    string
	cfg       codeStoreConfig
	namespace string
	label     string
}

type verificationCodeRecord struct {
	Subject  string `json:"subject"`
	CodeHash string `json:"code_hash"`
	Attempts int    `json:"attempts"`
}

func NewSMSCodeStore(redisClient *redis.Client, secret string, cfg config.SMSConfig) *SMSCodeStore {
	return &SMSCodeStore{store: newVerificationCodeStore(redisClient, secret, codeStoreConfig{
		CodeTTLSeconds:    cfg.CodeTTLSeconds,
		CooldownSeconds:   cfg.CooldownSeconds,
		DailyLimit:        cfg.DailyLimit,
		MaxVerifyAttempts: cfg.MaxVerifyAttempts,
	}, "sms", "sms")}
}

func NewEmailCodeStore(redisClient *redis.Client, secret string, cfg config.EmailConfig) *EmailCodeStore {
	return &EmailCodeStore{store: newVerificationCodeStore(redisClient, secret, codeStoreConfig{
		CodeTTLSeconds:    cfg.CodeTTLSeconds,
		CooldownSeconds:   cfg.CooldownSeconds,
		DailyLimit:        cfg.DailyLimit,
		MaxVerifyAttempts: cfg.MaxVerifyAttempts,
	}, "email", "email")}
}

func (s *SMSCodeStore) Issue(ctx context.Context, phone string) (string, error) {
	return s.store.Issue(ctx, phone)
}

func (s *SMSCodeStore) Verify(ctx context.Context, phone string, code string) error {
	return s.store.Verify(ctx, phone, code)
}

func (s *SMSCodeStore) ClearIssue(ctx context.Context, phone string) error {
	return s.store.ClearIssue(ctx, phone)
}

func (s *EmailCodeStore) Issue(ctx context.Context, email string) (string, error) {
	return s.store.Issue(ctx, email)
}

func (s *EmailCodeStore) Verify(ctx context.Context, email string, code string) error {
	return s.store.Verify(ctx, email, code)
}

func (s *EmailCodeStore) ClearIssue(ctx context.Context, email string) error {
	return s.store.ClearIssue(ctx, email)
}

func newVerificationCodeStore(redisClient *redis.Client, secret string, cfg codeStoreConfig, namespace string, label string) *verificationCodeStore {
	return &verificationCodeStore{redis: redisClient, secret: secret, cfg: cfg, namespace: namespace, label: label}
}

func (s *verificationCodeStore) Issue(ctx context.Context, subject string) (string, error) {
	if s.redis == nil {
		return "", apperr.New(apperr.KindInternal, "redis is not configured")
	}

	subjectHash := hashSubject(subject)
	cooldownKey := s.key("cooldown", subjectHash)
	ok, err := s.redis.SetNX(ctx, cooldownKey, "1", time.Duration(s.cfg.CooldownSeconds)*time.Second).Result()
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "check "+s.label+" cooldown", err)
	}
	if !ok {
		return "", apperr.New(apperr.KindRateLimited, s.label+" code requested too frequently")
	}

	dailyKey := fmt.Sprintf("auth:%s:daily:%s:%s", s.namespace, subjectHash, time.Now().Format("20060102"))
	count, err := s.redis.Incr(ctx, dailyKey).Result()
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "increment "+s.label+" daily limit", err)
	}
	if count == 1 {
		_ = s.redis.Expire(ctx, dailyKey, 24*time.Hour).Err()
	}
	if count > int64(s.cfg.DailyLimit) {
		return "", apperr.New(apperr.KindRateLimited, s.label+" daily limit exceeded")
	}

	code, err := generateVerificationCode()
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "generate "+s.label+" code", err)
	}

	record := verificationCodeRecord{
		Subject:  subject,
		CodeHash: hashCode(s.secret, subject, code),
		Attempts: 0,
	}
	data, err := json.Marshal(record)
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "encode "+s.label+" code record", err)
	}

	codeKey := s.key("code", subjectHash)
	if err := s.redis.Set(ctx, codeKey, data, time.Duration(s.cfg.CodeTTLSeconds)*time.Second).Err(); err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "store "+s.label+" code", err)
	}

	return code, nil
}

func (s *verificationCodeStore) Verify(ctx context.Context, subject string, code string) error {
	if s.redis == nil {
		return apperr.New(apperr.KindInternal, "redis is not configured")
	}

	codeKey := s.key("code", hashSubject(subject))
	raw, err := s.redis.Get(ctx, codeKey).Result()
	if err == redis.Nil {
		return apperr.New(apperr.KindUnauthorized, s.label+" code is invalid or expired")
	}
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "get "+s.label+" code", err)
	}

	var record verificationCodeRecord
	if err := json.Unmarshal([]byte(raw), &record); err != nil {
		_ = s.redis.Del(ctx, codeKey).Err()
		return apperr.Wrap(apperr.KindInternal, "decode "+s.label+" code record", err)
	}
	if record.Attempts >= s.cfg.MaxVerifyAttempts {
		_ = s.redis.Del(ctx, codeKey).Err()
		return apperr.New(apperr.KindUnauthorized, s.label+" code is invalid or expired")
	}

	if !hmac.Equal([]byte(record.CodeHash), []byte(hashCode(s.secret, subject, code))) {
		record.Attempts++
		if record.Attempts >= s.cfg.MaxVerifyAttempts {
			_ = s.redis.Del(ctx, codeKey).Err()
			return apperr.New(apperr.KindUnauthorized, s.label+" code is invalid or expired")
		}
		data, _ := json.Marshal(record)
		ttl := s.redis.TTL(ctx, codeKey).Val()
		if ttl > 0 {
			_ = s.redis.Set(ctx, codeKey, data, ttl).Err()
		}
		return apperr.New(apperr.KindUnauthorized, s.label+" code is invalid or expired")
	}

	if err := s.redis.Del(ctx, codeKey).Err(); err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete "+s.label+" code", err)
	}
	return nil
}

func (s *verificationCodeStore) ClearIssue(ctx context.Context, subject string) error {
	if s.redis == nil {
		return nil
	}
	subjectHash := hashSubject(subject)
	if err := s.redis.Del(ctx, s.key("code", subjectHash), s.key("cooldown", subjectHash)).Err(); err != nil {
		return apperr.Wrap(apperr.KindInternal, "clear "+s.label+" issue", err)
	}
	return nil
}

func (s *verificationCodeStore) key(kind string, subjectHash string) string {
	return fmt.Sprintf("auth:%s:%s:%s", s.namespace, kind, subjectHash)
}

func generateVerificationCode() (string, error) {
	max := big.NewInt(1000000)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func generateSMSCode() (string, error) {
	return generateVerificationCode()
}

func hashPhone(phone string) string {
	return hashSubject(phone)
}

func hashSubject(subject string) string {
	sum := sha256.Sum256([]byte(subject))
	return hex.EncodeToString(sum[:])
}

func hashCode(secret string, subject string, code string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(subject))
	_, _ = mac.Write([]byte(":"))
	_, _ = mac.Write([]byte(code))
	return hex.EncodeToString(mac.Sum(nil))
}
