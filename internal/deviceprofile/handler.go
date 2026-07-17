package deviceprofile

import (
	"bytes"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/permission"
)

type Handler struct {
	service *Service
	checker *permission.Checker
	audit   *audit.Service
}
type updateProfileRequest struct {
	Description  *string  `json:"description"`
	LocationText *string  `json:"location_text"`
	Latitude     *float64 `json:"latitude"`
	Longitude    *float64 `json:"longitude"`
}
type updateImageRequest struct {
	Caption *string `json:"caption"`
	IsCover *bool   `json:"is_cover"`
}
type reorderImagesRequest struct {
	ImageIDs []string `json:"image_ids"`
}

func NewHandler(service *Service, checker *permission.Checker, auditService *audit.Service) *Handler {
	return &Handler{service: service, checker: checker, audit: auditService}
}

func (h *Handler) Get(c *gin.Context) {
	deviceID, actor, ok := h.authorize(c, "device.view")
	if !ok {
		return
	}
	result, err := h.service.Get(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	configure, checkErr := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, "device.configure", permission.ResourceRef{Type: "device", ID: deviceID})
	if checkErr != nil {
		httpx.WriteAppError(c, checkErr)
		return
	}
	result.CanConfigure = configure.Allowed
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Update(c *gin.Context) {
	deviceID, actor, ok := h.authorize(c, "device.configure")
	if !ok {
		return
	}
	var req updateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.Update(c.Request.Context(), UpdateProfileInput{DeviceID: deviceID, Description: req.Description, LocationText: req.LocationText, Latitude: req.Latitude, Longitude: req.Longitude, ActorUserID: actor.UserID})
	if err != nil {
		h.record(c, actor.UserID, deviceID, "device.profile.update", audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, actor.UserID, deviceID, "device.profile.update", audit.ResultSuccess, "") {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Upload(c *gin.Context) {
	deviceID, actor, ok := h.authorize(c, "device.configure")
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, int64(MaxImages*MaxImageSize)+1024*1024)
	if err := c.Request.ParseMultipartForm(int64(MaxImages * MaxImageSize)); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid multipart upload"))
		return
	}
	files := c.Request.MultipartForm.File["files"]
	if len(files) == 0 {
		files = c.Request.MultipartForm.File["file"]
	}
	if len(files) == 0 || len(files) > MaxImages {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "upload between 1 and 12 images"))
		return
	}
	inputs := make([]UploadImageInput, 0, len(files))
	for _, header := range files {
		file, err := header.Open()
		if err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "open uploaded image"))
			return
		}
		data, err := io.ReadAll(io.LimitReader(file, MaxImageSize+1))
		_ = file.Close()
		if err != nil || len(data) > MaxImageSize {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "image exceeds 10 MB"))
			return
		}
		contentType := http.DetectContentType(data)
		if contentType == "image/jpg" {
			contentType = "image/jpeg"
		}
		inputs = append(inputs, UploadImageInput{Filename: header.Filename, ContentType: contentType, Data: bytes.Clone(data)})
	}
	result, err := h.service.Upload(c.Request.Context(), deviceID, actor.UserID, inputs)
	if err != nil {
		h.record(c, actor.UserID, deviceID, "device.profile_image.upload", audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, actor.UserID, deviceID, "device.profile_image.upload", audit.ResultSuccess, "") {
		return
	}
	c.JSON(http.StatusCreated, gin.H{"items": result})
}

func (h *Handler) UpdateImage(c *gin.Context) {
	deviceID, actor, ok := h.authorize(c, "device.configure")
	if !ok {
		return
	}
	imageID, err := uuid.Parse(c.Param("image_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid image_id"))
		return
	}
	var req updateImageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.UpdateImage(c.Request.Context(), UpdateImageInput{DeviceID: deviceID, ImageID: imageID, Caption: req.Caption, IsCover: req.IsCover})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, actor.UserID, deviceID, "device.profile_image.update", audit.ResultSuccess, "") {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Reorder(c *gin.Context) {
	deviceID, actor, ok := h.authorize(c, "device.configure")
	if !ok {
		return
	}
	var req reorderImagesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	ids := make([]uuid.UUID, 0, len(req.ImageIDs))
	for _, value := range req.ImageIDs {
		id, err := uuid.Parse(value)
		if err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid image id"))
			return
		}
		ids = append(ids, id)
	}
	result, err := h.service.Reorder(c.Request.Context(), deviceID, ids)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, actor.UserID, deviceID, "device.profile_image.reorder", audit.ResultSuccess, "") {
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": result})
}

func (h *Handler) DeleteImage(c *gin.Context) {
	deviceID, actor, ok := h.authorize(c, "device.configure")
	if !ok {
		return
	}
	imageID, err := uuid.Parse(c.Param("image_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid image_id"))
		return
	}
	if err := h.service.DeleteImage(c.Request.Context(), deviceID, imageID); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, actor.UserID, deviceID, "device.profile_image.delete", audit.ResultSuccess, "") {
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) authorize(c *gin.Context, action string) (uuid.UUID, auth.Actor, bool) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return uuid.Nil, auth.Actor{}, false
	}
	deviceID, err := uuid.Parse(c.Param("device_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid device_id"))
		return uuid.Nil, auth.Actor{}, false
	}
	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, action, permission.ResourceRef{Type: "device", ID: deviceID})
	if err != nil {
		httpx.WriteAppError(c, err)
		return uuid.Nil, auth.Actor{}, false
	}
	if !decision.Allowed {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return uuid.Nil, auth.Actor{}, false
	}
	return deviceID, actor, true
}

func (h *Handler) record(c *gin.Context, actorID, deviceID uuid.UUID, action, result, reason string) bool {
	if h.audit == nil {
		return true
	}
	input := audit.RecordInput{ActorType: audit.ActorUser, ActorID: audit.UserActorID(actorID), Action: action, ResourceType: "device", ResourceID: audit.ResourceID(deviceID), Result: result}
	if strings.TrimSpace(reason) != "" {
		input.Reason = reason
	}
	if _, err := h.audit.Record(c.Request.Context(), audit.FromRequest(c, input)); err != nil {
		httpx.WriteAppError(c, err)
		return false
	}
	return true
}
