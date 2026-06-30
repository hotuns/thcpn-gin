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
	redis  *redis.Client
	secret string
	cfg    config.SMSConfig
}

type smsCodeRecord struct {
	Phone    string `json:"phone"`
	CodeHash string `json:"code_hash"`
	Attempts int    `json:"attempts"`
}

func NewSMSCodeStore(redisClient *redis.Client, secret string, cfg config.SMSConfig) *SMSCodeStore {
	return &SMSCodeStore{redis: redisClient, secret: secret, cfg: cfg}
}

func (s *SMSCodeStore) Issue(ctx context.Context, phone string) (string, error) {
	if s.redis == nil {
		return "", apperr.New(apperr.KindInternal, "redis is not configured")
	}

	phoneHash := hashPhone(phone)
	cooldownKey := "auth:sms:cooldown:" + phoneHash
	ok, err := s.redis.SetNX(ctx, cooldownKey, "1", time.Duration(s.cfg.CooldownSeconds)*time.Second).Result()
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "check sms cooldown", err)
	}
	if !ok {
		return "", apperr.New(apperr.KindRateLimited, "sms code requested too frequently")
	}

	dailyKey := fmt.Sprintf("auth:sms:daily:%s:%s", phoneHash, time.Now().Format("20060102"))
	count, err := s.redis.Incr(ctx, dailyKey).Result()
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "increment sms daily limit", err)
	}
	if count == 1 {
		_ = s.redis.Expire(ctx, dailyKey, 24*time.Hour).Err()
	}
	if count > int64(s.cfg.DailyLimit) {
		return "", apperr.New(apperr.KindRateLimited, "sms daily limit exceeded")
	}

	code, err := generateSMSCode()
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "generate sms code", err)
	}

	record := smsCodeRecord{
		Phone:    phone,
		CodeHash: hashCode(s.secret, phone, code),
		Attempts: 0,
	}
	data, err := json.Marshal(record)
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "encode sms code record", err)
	}

	codeKey := "auth:sms:code:" + phoneHash
	if err := s.redis.Set(ctx, codeKey, data, time.Duration(s.cfg.CodeTTLSeconds)*time.Second).Err(); err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "store sms code", err)
	}

	return code, nil
}

func (s *SMSCodeStore) Verify(ctx context.Context, phone string, code string) error {
	if s.redis == nil {
		return apperr.New(apperr.KindInternal, "redis is not configured")
	}

	codeKey := "auth:sms:code:" + hashPhone(phone)
	raw, err := s.redis.Get(ctx, codeKey).Result()
	if err == redis.Nil {
		return apperr.New(apperr.KindUnauthorized, "sms code is invalid or expired")
	}
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "get sms code", err)
	}

	var record smsCodeRecord
	if err := json.Unmarshal([]byte(raw), &record); err != nil {
		_ = s.redis.Del(ctx, codeKey).Err()
		return apperr.Wrap(apperr.KindInternal, "decode sms code record", err)
	}
	if record.Attempts >= s.cfg.MaxVerifyAttempts {
		_ = s.redis.Del(ctx, codeKey).Err()
		return apperr.New(apperr.KindUnauthorized, "sms code is invalid or expired")
	}

	if !hmac.Equal([]byte(record.CodeHash), []byte(hashCode(s.secret, phone, code))) {
		record.Attempts++
		if record.Attempts >= s.cfg.MaxVerifyAttempts {
			_ = s.redis.Del(ctx, codeKey).Err()
			return apperr.New(apperr.KindUnauthorized, "sms code is invalid or expired")
		}
		data, _ := json.Marshal(record)
		ttl := s.redis.TTL(ctx, codeKey).Val()
		if ttl > 0 {
			_ = s.redis.Set(ctx, codeKey, data, ttl).Err()
		}
		return apperr.New(apperr.KindUnauthorized, "sms code is invalid or expired")
	}

	if err := s.redis.Del(ctx, codeKey).Err(); err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete sms code", err)
	}
	return nil
}

func (s *SMSCodeStore) ClearIssue(ctx context.Context, phone string) error {
	if s.redis == nil {
		return nil
	}
	phoneHash := hashPhone(phone)
	if err := s.redis.Del(ctx, "auth:sms:code:"+phoneHash, "auth:sms:cooldown:"+phoneHash).Err(); err != nil {
		return apperr.Wrap(apperr.KindInternal, "clear sms issue", err)
	}
	return nil
}

func generateSMSCode() (string, error) {
	max := big.NewInt(1000000)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func hashPhone(phone string) string {
	sum := sha256.Sum256([]byte(phone))
	return hex.EncodeToString(sum[:])
}

func hashCode(secret string, phone string, code string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(phone))
	_, _ = mac.Write([]byte(":"))
	_, _ = mac.Write([]byte(code))
	return hex.EncodeToString(mac.Sum(nil))
}
