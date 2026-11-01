package datasource

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"net/http/httptest"
	"testing"
	"thcpn-gin/internal/auth"
)

func TestPhysicalNodeManagementRequiresAdministrator(t *testing.T) {
	for _, actor := range []auth.Actor{{}, {UserID: uuid.New()}} {
		router := gin.New()
		router.Use(func(c *gin.Context) { auth.SetActorContext(c, actor); c.Next() })
		router.POST("/devices/:device_id/physical-nodes", NewHandler(nil, nil).AdminLoRaWANPhysicalNodes)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("POST", "/devices/"+uuid.NewString()+"/physical-nodes", nil))
		if response.Code != 401 {
			t.Fatalf("ordinary account reached node inventory: %d", response.Code)
		}
	}
}
