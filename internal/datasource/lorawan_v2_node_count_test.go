package datasource

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"thcpn-gin/internal/auth"
)

func TestNodeCountHandlerRejectsUsersAndInvalidTotals(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, test := range []struct {
		name, body string
		admin      bool
		status     int
	}{
		{"ordinary user", `{"node_count":3}`, false, 401},
		{"zero", `{"node_count":0}`, true, 400},
		{"too many", `{"node_count":255}`, true, 400},
		{"fraction", `{"node_count":3.5}`, true, 400},
		{"missing", `{}`, true, 400},
		{"malformed", `{`, true, 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest("PATCH", "/node-count", strings.NewReader(test.body))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Params = gin.Params{{Key: "device_id", Value: uuid.NewString()}}
			auth.SetActorContext(c, auth.Actor{UserID: uuid.New(), IsSystemAdmin: test.admin})
			NewHandler(nil, nil).AdminUpdateLoRaWANV2NodeCount(c)
			if recorder.Code != test.status {
				t.Fatalf("HTTP %d: %s", recorder.Code, recorder.Body.String())
			}
		})
	}
}
