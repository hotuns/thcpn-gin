package objectstore

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/httpx"
)

type Handler struct {
	store  Store
	signer *Signer
}

func NewHandler(store Store, signer *Signer) *Handler {
	return &Handler{store: store, signer: signer}
}

func (h *Handler) Download(c *gin.Context) {
	if h.store == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "object store is not configured"))
		return
	}
	if h.signer == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "object store signer is not configured"))
		return
	}

	objectKey := c.Query("object_key")
	if err := h.signer.VerifyObjectURLSignature(http.MethodGet, objectKey, c.Query("expires"), c.Query("signature")); err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	result, err := h.store.Get(c.Request.Context(), objectKey)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	defer result.Body.Close()

	contentType := result.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.DataFromReader(http.StatusOK, -1, contentType, result.Body, nil)
}
