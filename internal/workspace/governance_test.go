package workspace

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
)

func TestNormalizeGovernancePage(t *testing.T) {
	page, pageSize := normalizePage(0, 0)
	if page != 1 || pageSize != 20 {
		t.Fatalf("normalizePage(0, 0) = %d, %d", page, pageSize)
	}
	page, pageSize = normalizePage(3, 500)
	if page != 3 || pageSize != 100 {
		t.Fatalf("normalizePage(3, 500) = %d, %d", page, pageSize)
	}
}

func TestRequireAdminReason(t *testing.T) {
	tests := []struct {
		name    string
		reason  string
		aborted bool
	}{
		{name: "missing", aborted: true},
		{name: "too short", reason: "短", aborted: true},
		{name: "valid", reason: "修复异常权限范围", aborted: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest("PATCH", "/", nil)
			c.Request.Header.Set("X-Admin-Reason", test.reason)
			auth.SetActorContext(c, auth.Actor{UserID: uuid.New(), IsSystemAdmin: true})
			NewHandler(nil).RequireAdminReason()(c)
			if c.IsAborted() != test.aborted {
				t.Fatalf("aborted = %v, want %v", c.IsAborted(), test.aborted)
			}
			if !test.aborted {
				reason, _ := c.Get("admin_operation_reason")
				if reason != test.reason {
					t.Fatalf("reason = %q, want %q", reason, test.reason)
				}
			}
		})
	}
}

func TestAdminStatusRejectsUnknownValueBeforeDatabase(t *testing.T) {
	service := &Service{}
	_, err := service.AdminUpdateStatus(context.Background(), uuid.New(), "archived")
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}
