package httpx

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"thcpn-gin/internal/apperr"
)

func TestLimitDetailsSurviveHTTPResponse(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		reason string
	}{
		{"configured query", apperr.LimitExceeded("query_days", 14, 15, "days"), 400, "LIMIT_EXCEEDED"},
		{"plan restriction", apperr.PlanHistoryLimit("base_history_days", 21), 403, "LIMIT_EXCEEDED"},
		{"verification rate", apperr.VerificationLimit("sms", "daily", 9), 429, "VERIFICATION_LIMIT"},
		{"password policy", apperr.PasswordLength(10, 72), 400, "PASSWORD_LENGTH"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			WriteAppError(c, tc.err)
			var body ErrorEnvelope
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if w.Code != tc.status || body.Error.Details["reason"] != tc.reason {
				t.Fatalf("lost actionable error: HTTP %d %s", w.Code, w.Body.String())
			}
			if tc.name == "configured query" && body.Error.Details["maximum"] != float64(14) {
				t.Fatalf("lost configured maximum: %s", w.Body.String())
			}
		})
	}
}
