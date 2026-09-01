package loginvisual

import (
	"bytes"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/httpx"
)

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service: service} }
func (h *Handler) List(c *gin.Context) {
	items, err := h.service.List(c.Request.Context())
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
func (h *Handler) Upload(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "image file is required"))
		return
	}
	opened, err := file.Open()
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid image file"))
		return
	}
	defer opened.Close()
	data, err := io.ReadAll(io.LimitReader(opened, 10<<20+1))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid image file"))
		return
	}
	contentType := http.DetectContentType(data)
	item, err := h.service.Upload(c.Request.Context(), UploadInput{Filename: file.Filename, ContentType: contentType, Data: bytes.Clone(data)})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusCreated, item)
}
func (h *Handler) Open(c *gin.Context) {
	id, err := uuid.Parse(c.Param("visual_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid visual_id"))
		return
	}
	result, err := h.service.Open(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	defer result.Body.Close()
	c.Header("Cache-Control", "public, max-age=3600")
	c.DataFromReader(http.StatusOK, -1, result.ContentType, result.Body, nil)
}
func (h *Handler) Delete(c *gin.Context) {
	id, err := uuid.Parse(c.Param("visual_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid visual_id"))
		return
	}
	if err := h.service.Delete(c.Request.Context(), id); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
