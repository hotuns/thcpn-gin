package platformlog

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/httpx"
)

type Handler struct {
	store *Store
	audit *audit.Service
}

func NewHandler(store *Store, audits ...*audit.Service) *Handler {
	var service *audit.Service
	if len(audits) > 0 {
		service = audits[0]
	}
	return &Handler{store: store, audit: service}
}

func (h *Handler) List(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	query, ok := parseQuery(c)
	if !ok {
		return
	}
	result, err := h.store.List(c.Request.Context(), query)
	if err != nil {
		h.record(c, "platform_log.list", audit.ResultFailure, err.Error())
		httpx.WriteAppError(c, apperr.Wrap(apperr.KindInternal, "list platform logs", err))
		return
	}
	h.record(c, "platform_log.list", audit.ResultSuccess, fmt.Sprintf("total=%d", result.Total))
	c.JSON(http.StatusOK, result)
}
func (h *Handler) Get(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	id, err := strconv.ParseInt(c.Param("log_id"), 10, 64)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid log id"))
		return
	}
	entry, err := h.store.Get(c.Request.Context(), id)
	if err != nil {
		h.record(c, "platform_log.view", audit.ResultFailure, err.Error())
		httpx.WriteAppError(c, apperr.Wrap(apperr.KindNotFound, "platform log not found", err))
		return
	}
	h.record(c, "platform_log.view", audit.ResultSuccess, strconv.FormatInt(id, 10))
	c.JSON(http.StatusOK, entry)
}
func (h *Handler) Policy(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	c.JSON(http.StatusOK, h.store.Policy())
}
func (h *Handler) Rebuild(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	if err := h.store.Rebuild(c.Request.Context()); err != nil {
		h.record(c, "platform_log.index.rebuild", audit.ResultFailure, err.Error())
		httpx.WriteAppError(c, apperr.Wrap(apperr.KindInternal, "rebuild platform log index", err))
		return
	}
	h.record(c, "platform_log.index.rebuild", audit.ResultSuccess, "")
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
func (h *Handler) Export(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	q, ok := parseQuery(c)
	if !ok {
		return
	}
	c.Header("Content-Type", "application/x-ndjson")
	c.Header("Content-Disposition", `attachment; filename="platform-logs.ndjson"`)
	encoder := json.NewEncoder(c.Writer)
	exported := 0
	for page := 1; exported < 100000; page++ {
		q.Page = page
		q.PageSize = 500
		result, err := h.store.List(c.Request.Context(), q)
		if err != nil {
			return
		}
		for _, entry := range result.Items {
			if exported >= 100000 {
				break
			}
			_ = encoder.Encode(entry)
			exported++
		}
		if len(result.Items) < 500 {
			break
		}
	}
	h.record(c, "platform_log.export", audit.ResultSuccess, fmt.Sprintf("rows=%d", exported))
}
func (h *Handler) Files(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	items, err := h.store.Files()
	if err != nil {
		httpx.WriteAppError(c, apperr.Wrap(apperr.KindInternal, "list platform log files", err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": len(items)})
}
func (h *Handler) DownloadFile(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	path, err := h.store.FilePath(c.Param("file_name"))
	if err != nil {
		httpx.WriteAppError(c, apperr.Wrap(apperr.KindNotFound, "platform log file not found", err))
		return
	}
	h.record(c, "platform_log.file.download", audit.ResultSuccess, c.Param("file_name"))
	c.FileAttachment(path, c.Param("file_name"))
}

func (h *Handler) ready(c *gin.Context) bool {
	if h.store == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "platform log store is not configured"))
		return false
	}
	return true
}
func parseQuery(c *gin.Context) (Query, bool) {
	start, _ := time.Parse(time.RFC3339, c.Query("start"))
	end, _ := time.Parse(time.RFC3339, c.Query("end"))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "100"))
	status, _ := strconv.Atoi(c.Query("status"))
	if !start.IsZero() && !end.IsZero() && end.Sub(start) > 30*24*time.Hour {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "log query range cannot exceed 30 days"))
		return Query{}, false
	}
	return Query{Start: start, End: end, Level: c.Query("level"), Service: c.Query("service"), ActorID: c.Query("actor_id"), WorkspaceID: c.Query("workspace_id"), RequestID: c.Query("request_id"), Path: c.Query("path"), Keyword: strings.TrimSpace(c.Query("keyword")), Status: status, Page: page, PageSize: size}, true
}
func (h *Handler) record(c *gin.Context, action, result, reason string) {
	if h.audit == nil {
		return
	}
	_, _ = h.audit.Record(c.Request.Context(), audit.FromRequest(c, audit.RecordInput{ActorType: audit.ActorSystemAdmin, Action: action, ResourceType: "platform_log", Result: result, Reason: reason}))
}
