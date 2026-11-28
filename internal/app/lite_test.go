package app

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestLiteGate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	called := false
	okHandler := func(c *gin.Context) {
		called = true
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}

	rLite := gin.New()
	rLite.POST("/blocked", liteGate(true, okHandler))
	rec := httptest.NewRecorder()
	rLite.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/blocked", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 in lite mode, got %d", rec.Code)
	}
	if called {
		t.Fatalf("expected underlying handler not to be called in lite mode")
	}

	rFull := gin.New()
	rFull.POST("/allowed", liteGate(false, okHandler))
	rec2 := httptest.NewRecorder()
	rFull.ServeHTTP(rec2, httptest.NewRequest(http.MethodPost, "/allowed", nil))
	if rec2.Code != http.StatusOK || !called {
		t.Fatalf("expected 200 in standard mode, got %d", rec2.Code)
	}
}
