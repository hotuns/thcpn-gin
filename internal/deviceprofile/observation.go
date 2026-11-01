package deviceprofile

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"net/http"
	"strconv"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/observation"
	"time"
)

func (h *Handler) ObservationStarts(c *gin.Context) {
	id, actor, ok := h.authorize(c, "device.view")
	if !ok {
		return
	}
	starts, history, err := (observation.Service{DB: h.service.db}).List(c.Request.Context(), id, actor.IsSystemAdmin)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	node, _ := strconv.Atoi(c.DefaultQuery("node_index", "0"))
	effective, e := (observation.Service{DB: h.service.db}).DeviceStart(c.Request.Context(), id, node)
	if e != nil {
		httpx.WriteAppError(c, e)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": starts, "history": history, "effective_start_at": effective})
}
func (h *Handler) SaveObservationStart(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok || !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "administrator required"))
		return
	}
	id, _, ok := h.authorize(c, "device.configure")
	if !ok {
		return
	}
	var input struct {
		NodeIndex int             `json:"node_index"`
		StartsAt  json.RawMessage `json:"starts_at"`
		Reason    string          `json:"reason"`
	}
	if c.ShouldBindJSON(&input) != nil || len(input.StartsAt) == 0 {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid observation start"))
		return
	}
	var startsAt *time.Time
	if json.Unmarshal(input.StartsAt, &startsAt) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid starts_at"))
		return
	}
	if err := (observation.Service{DB: h.service.db}).Set(c.Request.Context(), id, actor.UserID, input.NodeIndex, startsAt, input.Reason); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, actor.UserID, id, "device.observation_start.update", audit.ResultSuccess, input.Reason) {
		return
	}
	h.ObservationStarts(c)
}
