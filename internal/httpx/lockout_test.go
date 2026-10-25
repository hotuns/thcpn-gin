package httpx

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"testing"
	"thcpn-gin/internal/apperr"
	"time"
)

func TestLockoutResponseIncludesRetryInformation(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	now := time.Now()
	WriteAppError(c, apperr.AccountLocked(now.Add(90*time.Second), now))
	var result ErrorEnvelope
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if w.Code != 429 || w.Header().Get("Retry-After") != "90" || result.Error.Details["reason"] != "ACCOUNT_LOCKED" {
		t.Fatalf("unexpected response: %s", w.Body.String())
	}
}
func TestInternalFailureDoesNotExposeDiagnostics(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	WriteAppError(c, apperr.New(apperr.KindInternal, "database host secret.internal:5432 failed"))
	var result ErrorEnvelope
	_ = json.Unmarshal(w.Body.Bytes(), &result)
	if result.Error.Message != "service temporarily unavailable" {
		t.Fatalf("unsafe response: %s", w.Body.String())
	}
}
