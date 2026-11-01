package datasource

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"net/http/httptest"
	"testing"
	"thcpn-gin/internal/auth"
)

func TestNodeInventoryAndCSVRequireAdministrator(t *testing.T) {
	h := NewHandler(nil, nil)
	cases := []struct {
		method, path string
		handler      gin.HandlerFunc
	}{{"GET", "/inventory", h.AdminLoRaWANNodeInventory}, {"POST", "/inventory", h.AdminLoRaWANNodeInventory}, {"GET", "/gateways", h.AdminLoRaWANNodeGateways}, {"POST", "/preview", h.AdminPreviewLoRaWANNodeCSV}}
	for _, item := range cases {
		for _, actor := range []auth.Actor{{}, {UserID: uuid.New()}} {
			router := gin.New()
			router.Use(func(c *gin.Context) { auth.SetActorContext(c, actor); c.Next() })
			router.Handle(item.method, item.path, item.handler)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(item.method, item.path, nil))
			if response.Code != 401 {
				t.Fatalf("ordinary user reached %s: %d", item.path, response.Code)
			}
		}
	}
}
