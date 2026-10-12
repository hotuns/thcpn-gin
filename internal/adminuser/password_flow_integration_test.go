package adminuser

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/config"
)

// Opt-in: creates only a uniquely named fixture and removes its data afterwards.
func TestTemporaryPasswordLoginIntegration(t *testing.T) {
	dsn := os.Getenv("AUTH_FLOW_TEST_DSN")
	if dsn == "" {
		t.Skip("AUTH_FLOW_TEST_DSN is required")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal("connect test database failed")
	}
	defer db.Close()
	cfg := config.Default()
	admin := NewService(db, cfg.Auth.Password)
	login := auth.NewService(db, auth.NewTokenManager("integration-only-token-secret-not-for-production", time.Hour), nil, nil, nil, nil, cfg.Auth, cfg.SMS, cfg.Email)
	suffix := uuid.NewString()
	email := "auth-flow-" + suffix + "@example.invalid"
	phone := "199" + time.Now().Format("150405") + "99"
	user, temporary, err := admin.Create(ctx, CreateInput{Name: "Auth flow fixture " + suffix, Email: email, Phone: phone})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	defer func() {
		if _, err := db.Exec(ctx, "DELETE FROM workspaces WHERE owner_user_id=$1", user.ID); err != nil {
			t.Errorf("fixture workspace cleanup: %v", err)
		}
		if _, err := db.Exec(ctx, "DELETE FROM users WHERE id=$1", user.ID); err != nil {
			t.Errorf("fixture user cleanup: %v", err)
		}
	}()
	t.Log("admin create returned a generated temporary password (value omitted)")
	var result auth.LoginResult
	for _, identifier := range []string{email, phone} {
		result, err = login.LoginWithPassword(ctx, auth.PasswordLoginInput{Identifier: identifier, Password: temporary})
		if err != nil {
			t.Fatalf("temporary password login: %v", err)
		}
		if !result.PasswordChangeRequired || result.PasswordChangeToken == "" || result.AccessToken != "" {
			t.Fatal("expected restricted first-password flow without access token")
		}
	}
	t.Log("generated temporary password accepted by both email and phone; password change required")
	replacement := "Integration-NewPassword-789!"
	completed, err := login.CompleteInitialPassword(ctx, auth.CompleteInitialPasswordInput{Token: result.PasswordChangeToken, Password: replacement})
	if err != nil || completed.AccessToken == "" {
		t.Fatalf("complete initial password: %v", err)
	}
	if _, err = login.LoginWithPassword(ctx, auth.PasswordLoginInput{Identifier: phone, Password: temporary}); err == nil {
		t.Fatal("old temporary password accepted after change")
	}
	result, err = login.LoginWithPassword(ctx, auth.PasswordLoginInput{Identifier: phone, Password: replacement})
	if err != nil || result.AccessToken == "" {
		t.Fatalf("new password login: %v", err)
	}
	t.Log("first password change succeeds; old password rejected; new password accepted")
	reset, err := admin.TemporaryPassword(ctx, user.ID)
	if err != nil {
		t.Fatalf("reset: %v", err)
	}
	result, err = login.LoginWithPassword(ctx, auth.PasswordLoginInput{Identifier: phone, Password: reset})
	if err != nil || !result.PasswordChangeRequired {
		t.Fatalf("reset temporary password login: %v", err)
	}
	t.Log("admin reset password accepted and requires another password change")
	if os.Getenv("AUTH_FLOW_TEST_LOCAL_HTTP") == "1" {
		post := func(path string, payload any) auth.LoginResult {
			t.Helper()
			body, _ := json.Marshal(payload)
			client := http.Client{Timeout: 10 * time.Second}
			response, err := client.Post("http://127.0.0.1:8080/api/v1/auth/"+path, "application/json", bytes.NewReader(body))
			if err != nil {
				t.Fatal("local HTTP request failed")
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusOK {
				t.Fatalf("local HTTP %s returned %d", path, response.StatusCode)
			}
			var value auth.LoginResult
			if err := json.NewDecoder(response.Body).Decode(&value); err != nil {
				t.Fatal("invalid HTTP login response")
			}
			return value
		}
		result = post("password/login", map[string]string{"identifier": phone, "password": reset})
		if !result.PasswordChangeRequired || result.PasswordChangeToken == "" {
			t.Fatal("HTTP login did not request initial password change")
		}
		result = post("password/complete-initial", map[string]string{"password_change_token": result.PasswordChangeToken, "password": replacement})
		if result.AccessToken == "" {
			t.Fatal("HTTP password completion did not issue session")
		}
		result = post("password/login", map[string]string{"identifier": phone, "password": replacement})
		if result.AccessToken == "" {
			t.Fatal("HTTP new password login did not issue session")
		}
		t.Log("running local HTTP API: temporary login, initial password completion and subsequent login all passed")
	}
}
