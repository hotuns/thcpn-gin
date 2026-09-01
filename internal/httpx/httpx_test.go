package httpx

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"thcpn-gin/internal/apperr"
)

func TestRequestIDAndAppErrorResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(RequestID(), Metrics(), AccessLog(nil))
	router.GET("/resource", func(c *gin.Context) {
		WriteAppError(c, apperr.New(apperr.KindNotFound, "resource not found"))
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/resource", nil)
	request.Header.Set(HeaderRequestID, "request-123")
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNotFound || recorder.Header().Get(HeaderRequestID) != "request-123" {
		t.Fatalf("unexpected response status/header: %d %q", recorder.Code, recorder.Header().Get(HeaderRequestID))
	}
	var body ErrorEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Error.Code != string(apperr.KindNotFound) || body.Error.Message != "resource not found" || body.Error.RequestID != "request-123" {
		t.Fatalf("unexpected error body: %#v", body)
	}
}

func TestWriteAppErrorHidesPlainError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	WriteAppError(context, errors.New("secret database detail"))
	if recorder.Code != http.StatusInternalServerError || recorder.Body.String() != `{"error":{"code":"INTERNAL","message":"internal error"}}` {
		t.Fatalf("unexpected internal error response: %d %s", recorder.Code, recorder.Body.String())
	}
}
