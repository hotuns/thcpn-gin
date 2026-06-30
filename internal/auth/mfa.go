package auth

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"math"
	"net/url"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
)

const (
	totpIssuer      = "THCPN"
	totpDigits      = 6
	totpPeriod      = 30
	totpWindow      = 1
	totpSecretBytes = 20
)

type MFAStatusInput struct {
	UserID uuid.UUID
}

type MFAStatusResult struct {
	TOTPEnabled   bool       `json:"totp_enabled"`
	TOTPEnabledAt *time.Time `json:"totp_enabled_at,omitempty"`
}

type TOTPSetupInput struct {
	UserID uuid.UUID
}

type TOTPSetupResult struct {
	Secret     string `json:"secret"`
	OtpauthURI string `json:"otpauth_uri"`
}

type TOTPEnableInput struct {
	UserID uuid.UUID
	Code   string
}

type TOTPDisableInput struct {
	UserID uuid.UUID
	Code   string
}

func (s *Service) MFAStatus(ctx context.Context, input MFAStatusInput) (MFAStatusResult, error) {
	if input.UserID == uuid.Nil {
		return MFAStatusResult{}, apperr.New(apperr.KindInvalidArgument, "user id is required")
	}
	row, err := s.queries.GetUserTOTP(ctx, input.UserID)
	if err != nil {
		if errorsIsNoRows(err) {
			return MFAStatusResult{}, nil
		}
		return MFAStatusResult{}, apperr.Wrap(apperr.KindInternal, "get mfa status", err)
	}
	return mfaStatusFromSQL(row), nil
}

func (s *Service) SetupTOTP(ctx context.Context, input TOTPSetupInput) (TOTPSetupResult, error) {
	if input.UserID == uuid.Nil {
		return TOTPSetupResult{}, apperr.New(apperr.KindInvalidArgument, "user id is required")
	}
	userModel, err := s.queries.GetActiveUser(ctx, input.UserID)
	if err != nil {
		if errorsIsNoRows(err) {
			return TOTPSetupResult{}, apperr.New(apperr.KindUnauthorized, "user is not active")
		}
		return TOTPSetupResult{}, apperr.Wrap(apperr.KindInternal, "get totp setup user", err)
	}
	if _, err := s.queries.GetEnabledUserTOTP(ctx, input.UserID); err == nil {
		return TOTPSetupResult{}, apperr.New(apperr.KindConflict, "totp mfa is already enabled")
	} else if !errorsIsNoRows(err) {
		return TOTPSetupResult{}, apperr.Wrap(apperr.KindInternal, "get enabled totp", err)
	}
	secret, err := generateTOTPSecret()
	if err != nil {
		return TOTPSetupResult{}, apperr.Wrap(apperr.KindInternal, "generate totp secret", err)
	}
	ciphertext, nonce, err := s.encryptMFASecret(secret)
	if err != nil {
		return TOTPSetupResult{}, err
	}
	if _, err := s.queries.UpsertUserTOTPSetup(ctx, sqlc.UpsertUserTOTPSetupParams{
		UserID:           input.UserID,
		SecretCiphertext: ciphertext,
		SecretNonce:      nonce,
	}); err != nil {
		return TOTPSetupResult{}, apperr.Wrap(apperr.KindInternal, "store totp setup", err)
	}
	return TOTPSetupResult{
		Secret:     secret,
		OtpauthURI: totpAuthURI(secret, userMFAIdentifier(userModel)),
	}, nil
}

func (s *Service) EnableTOTP(ctx context.Context, input TOTPEnableInput) (MFAStatusResult, error) {
	if input.UserID == uuid.Nil {
		return MFAStatusResult{}, apperr.New(apperr.KindInvalidArgument, "user id is required")
	}
	row, err := s.queries.GetUserTOTP(ctx, input.UserID)
	if err != nil {
		if errorsIsNoRows(err) {
			return MFAStatusResult{}, apperr.New(apperr.KindNotFound, "totp setup not found")
		}
		return MFAStatusResult{}, apperr.Wrap(apperr.KindInternal, "get totp setup", err)
	}
	secret, err := s.decryptMFASecret(row)
	if err != nil {
		return MFAStatusResult{}, err
	}
	step, ok, err := verifyTOTPCode(secret, input.Code, s.now(), int64Value(row.LastUsedStep))
	if err != nil {
		return MFAStatusResult{}, err
	}
	if !ok {
		return MFAStatusResult{}, apperr.New(apperr.KindUnauthorized, "invalid mfa code")
	}
	updated, err := s.queries.EnableUserTOTP(ctx, sqlc.EnableUserTOTPParams{
		UserID:       input.UserID,
		LastUsedStep: pgInt8(step),
	})
	if err != nil {
		return MFAStatusResult{}, apperr.Wrap(apperr.KindInternal, "enable totp", err)
	}
	return mfaStatusFromSQL(updated), nil
}

func (s *Service) DisableTOTP(ctx context.Context, input TOTPDisableInput) error {
	if input.UserID == uuid.Nil {
		return apperr.New(apperr.KindInvalidArgument, "user id is required")
	}
	row, err := s.queries.GetEnabledUserTOTP(ctx, input.UserID)
	if err != nil {
		if errorsIsNoRows(err) {
			return apperr.New(apperr.KindNotFound, "totp mfa is not enabled")
		}
		return apperr.Wrap(apperr.KindInternal, "get enabled totp", err)
	}
	secret, err := s.decryptMFASecret(row)
	if err != nil {
		return err
	}
	_, ok, err := verifyTOTPCode(secret, input.Code, s.now(), int64Value(row.LastUsedStep))
	if err != nil {
		return err
	}
	if !ok {
		return apperr.New(apperr.KindUnauthorized, "invalid mfa code")
	}
	rows, err := s.queries.DeleteUserTOTP(ctx, input.UserID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "disable totp", err)
	}
	if rows == 0 {
		return apperr.New(apperr.KindNotFound, "totp mfa is not enabled")
	}
	return nil
}

func (s *Service) verifyLoginMFA(ctx context.Context, userID uuid.UUID, code string) error {
	row, err := s.queries.GetEnabledUserTOTP(ctx, userID)
	if err != nil {
		if errorsIsNoRows(err) {
			return nil
		}
		return apperr.Wrap(apperr.KindInternal, "get login mfa", err)
	}
	secret, err := s.decryptMFASecret(row)
	if err != nil {
		return err
	}
	step, ok, err := verifyTOTPCode(secret, code, s.now(), int64Value(row.LastUsedStep))
	if err != nil {
		return err
	}
	if !ok {
		return apperr.New(apperr.KindUnauthorized, "invalid or missing mfa code")
	}
	rows, err := s.queries.UpdateUserTOTPLastUsedStep(ctx, sqlc.UpdateUserTOTPLastUsedStepParams{
		UserID:       userID,
		LastUsedStep: pgInt8(step),
	})
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "record mfa step", err)
	}
	if rows == 0 {
		return apperr.New(apperr.KindUnauthorized, "mfa code has already been used")
	}
	return nil
}

func (s *Service) encryptMFASecret(secret string) ([]byte, []byte, error) {
	block, err := aes.NewCipher(mfaEncryptionKey(s.authCfg.JWTSecret))
	if err != nil {
		return nil, nil, apperr.Wrap(apperr.KindInternal, "create mfa cipher", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, apperr.Wrap(apperr.KindInternal, "create mfa gcm", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, nil, apperr.Wrap(apperr.KindInternal, "generate mfa nonce", err)
	}
	return gcm.Seal(nil, nonce, []byte(secret), nil), nonce, nil
}

func (s *Service) decryptMFASecret(row sqlc.UserMfaTotp) (string, error) {
	block, err := aes.NewCipher(mfaEncryptionKey(s.authCfg.JWTSecret))
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "create mfa cipher", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "create mfa gcm", err)
	}
	plaintext, err := gcm.Open(nil, row.SecretNonce, row.SecretCiphertext, nil)
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "decrypt mfa secret", err)
	}
	return string(plaintext), nil
}

func generateTOTPSecret() (string, error) {
	raw := make([]byte, totpSecretBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw), nil
}

func verifyTOTPCode(secret string, code string, now time.Time, lastUsedStep *int64) (int64, bool, error) {
	code = strings.TrimSpace(code)
	if len(code) != totpDigits {
		return 0, false, nil
	}
	for _, r := range code {
		if !unicode.IsDigit(r) {
			return 0, false, nil
		}
	}

	current := now.Unix() / totpPeriod
	for offset := -totpWindow; offset <= totpWindow; offset++ {
		step := current + int64(offset)
		if step < 0 {
			continue
		}
		if lastUsedStep != nil && step <= *lastUsedStep {
			continue
		}
		expected, err := totpCodeAtStep(secret, step)
		if err != nil {
			return 0, false, err
		}
		if hmac.Equal([]byte(expected), []byte(code)) {
			return step, true, nil
		}
	}
	return 0, false, nil
}

func totpCodeAtStep(secret string, step int64) (string, error) {
	secret = strings.ToUpper(strings.TrimSpace(strings.ReplaceAll(secret, " ", "")))
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	if err != nil {
		return "", apperr.Wrap(apperr.KindInvalidArgument, "invalid totp secret", err)
	}

	var counter [8]byte
	binary.BigEndian.PutUint64(counter[:], uint64(step))
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(counter[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := (uint32(sum[offset])&0x7f)<<24 |
		(uint32(sum[offset+1])&0xff)<<16 |
		(uint32(sum[offset+2])&0xff)<<8 |
		(uint32(sum[offset+3]) & 0xff)
	modulo := uint32(math.Pow10(totpDigits))
	return fmt.Sprintf("%0*d", totpDigits, value%modulo), nil
}

func totpAuthURI(secret string, identifier string) string {
	label := strings.TrimSpace(identifier)
	if label == "" {
		label = "user"
	}
	u := url.URL{
		Scheme: "otpauth",
		Host:   "totp",
		Path:   "/" + totpIssuer + ":" + label,
	}
	q := u.Query()
	q.Set("secret", secret)
	q.Set("issuer", totpIssuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", fmt.Sprintf("%d", totpDigits))
	q.Set("period", fmt.Sprintf("%d", totpPeriod))
	u.RawQuery = q.Encode()
	return u.String()
}

func userMFAIdentifier(userModel sqlc.User) string {
	if userModel.Email != nil && strings.TrimSpace(*userModel.Email) != "" {
		return *userModel.Email
	}
	if userModel.Phone != nil && strings.TrimSpace(*userModel.Phone) != "" {
		return *userModel.Phone
	}
	if strings.TrimSpace(userModel.Name) != "" {
		return userModel.Name
	}
	return userModel.ID.String()
}

func mfaEncryptionKey(secret string) []byte {
	sum := sha256.Sum256([]byte(secret + ":mfa_totp"))
	return sum[:]
}

func mfaStatusFromSQL(row sqlc.UserMfaTotp) MFAStatusResult {
	return MFAStatusResult{
		TOTPEnabled:   row.EnabledAt.Valid,
		TOTPEnabledAt: pgTimePtr(row.EnabledAt),
	}
}

func int64Value(value pgtype.Int8) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}

func pgInt8(value int64) pgtype.Int8 {
	return pgtype.Int8{Int64: value, Valid: true}
}

func errorsIsNoRows(err error) bool {
	return err == pgx.ErrNoRows
}
