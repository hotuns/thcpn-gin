package processing

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/adminauth"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/httpx"
)

type planRequest struct {
	Code             string          `json:"code"`
	Name             string          `json:"name"`
	Description      string          `json:"description"`
	ProcessorCode    string          `json:"processor_code"`
	ProcessorVersion string          `json:"processor_version"`
	Parameters       json.RawMessage `json:"parameters"`
	Trigger          json.RawMessage `json:"trigger"`
	TargetTypes      json.RawMessage `json:"target_types"`
}

func (h *Handler) Plans(c *gin.Context) {
	items, err := h.service.ListPlans(c.Request.Context(), true)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
func (h *Handler) Plan(c *gin.Context) {
	id, ok := parseID(c.Param("plan_id"), "plan_id", c)
	if !ok {
		return
	}
	item, err := h.service.GetPlan(c.Request.Context(), id, true)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}
func (h *Handler) AdminPlans(c *gin.Context) {
	items, err := h.service.ListPlans(c.Request.Context(), false)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
func (h *Handler) AdminProcessors(c *gin.Context) { h.Processors(c) }
func (h *Handler) AdminCreatePlan(c *gin.Context) { h.adminSavePlan(c, uuid.Nil) }
func (h *Handler) AdminUpdatePlan(c *gin.Context) {
	id, ok := parseID(c.Param("plan_id"), "plan_id", c)
	if !ok {
		return
	}
	h.adminSavePlan(c, id)
}
func (h *Handler) adminSavePlan(c *gin.Context, id uuid.UUID) {
	actor, ok := adminauth.ActorFromContext(c)
	if !ok {
		return
	}
	var req planRequest
	if c.ShouldBindJSON(&req) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	input := PlanInput{Code: req.Code, Name: req.Name, Description: req.Description, ProcessorCode: req.ProcessorCode, ProcessorVersion: req.ProcessorVersion, Parameters: req.Parameters, Trigger: req.Trigger, TargetTypes: req.TargetTypes, ActorID: actor.UserID}
	var item Plan
	var err error
	action := "admin.processing_plan.create"
	if id == uuid.Nil {
		item, err = h.service.CreatePlan(c.Request.Context(), input)
	} else {
		action = "admin.processing_plan.update"
		item, err = h.service.UpdatePlan(c.Request.Context(), id, input)
	}
	if err != nil {
		h.recordPlan(c, action, id, audit.ResultFailure, err)
		httpx.WriteAppError(c, err)
		return
	}
	h.recordPlan(c, action, item.ID, audit.ResultSuccess, nil)
	c.JSON(http.StatusOK, item)
}
func (h *Handler) AdminPublishPlan(c *gin.Context) { h.adminPlanStatus(c, true) }
func (h *Handler) AdminDisablePlan(c *gin.Context) { h.adminPlanStatus(c, false) }
func (h *Handler) adminPlanStatus(c *gin.Context, publish bool) {
	id, ok := parseID(c.Param("plan_id"), "plan_id", c)
	if !ok {
		return
	}
	var item Plan
	var err error
	action := "admin.processing_plan.disable"
	if publish {
		action = "admin.processing_plan.publish"
		item, err = h.service.PublishPlan(c.Request.Context(), id)
	} else {
		item, err = h.service.DisablePlan(c.Request.Context(), id)
	}
	if err != nil {
		h.recordPlan(c, action, id, audit.ResultFailure, err)
		httpx.WriteAppError(c, err)
		return
	}
	h.recordPlan(c, action, id, audit.ResultSuccess, nil)
	c.JSON(http.StatusOK, item)
}
func (h *Handler) recordPlan(c *gin.Context, action string, id uuid.UUID, result string, cause error) {
	if h.audit == nil {
		return
	}
	reason := ""
	if cause != nil {
		reason = apperr.MessageOf(cause)
	}
	_, _ = h.audit.Record(c.Request.Context(), audit.FromRequest(c, audit.RecordInput{Action: action, ResourceType: "processing_plan", ResourceID: audit.ResourceID(id), Result: result, Reason: reason}))
}

type createFromPlanRequest struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	PlanID      uuid.UUID       `json:"plan_id"`
	TargetType  string          `json:"target_type"`
	TargetID    uuid.UUID       `json:"target_id"`
	StartAt     string          `json:"start_at"`
	Inputs      []TaskInput     `json:"inputs"`
	Interaction json.RawMessage `json:"interaction"`
}

func (h *Handler) CreateFromPlan(c *gin.Context) {
	workspaceID, actor, ok := h.authorize(c, "processing.manage")
	if !ok {
		return
	}
	if h.billing != nil && !actor.IsDemo {
		if err := h.billing.RequireProfessional(c.Request.Context(), workspaceID); err != nil {
			httpx.WriteAppError(c, err)
			return
		}
	}
	var req createFromPlanRequest
	if c.ShouldBindJSON(&req) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	startAt, err := parsePlanStart(req.StartAt)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	item, err := h.service.CreateTaskFromPlan(c.Request.Context(), workspaceID, actor.UserID, req.PlanID, req.Name, req.Description, req.TargetType, req.TargetID, startAt, req.Inputs, req.Interaction)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusCreated, item)
}
func parsePlanStart(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Now().UTC(), nil
	}
	result, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, apperr.New(apperr.KindInvalidArgument, "invalid start_at")
	}
	return result, nil
}

func (s *Service) CreateTaskFromPlan(ctx context.Context, workspaceID, actorID, planID uuid.UUID, name, description, targetType string, targetID uuid.UUID, startAt time.Time, inputs []TaskInput, interaction json.RawMessage) (Task, error) {
	plan, err := s.GetPlan(ctx, planID, true)
	if err != nil {
		return Task{}, err
	}
	var targetTypes []string
	if json.Unmarshal(plan.TargetTypes, &targetTypes) != nil {
		return Task{}, apperr.New(apperr.KindInternal, "invalid processing plan target types")
	}
	allowed := false
	for _, item := range targetTypes {
		if item == targetType {
			allowed = true
		}
	}
	if !allowed {
		return Task{}, apperr.New(apperr.KindInvalidArgument, "processing plan does not support target type")
	}
	config := map[string]any{}
	_ = json.Unmarshal(plan.Parameters, &config)
	if len(interaction) > 0 {
		var ui map[string]any
		if json.Unmarshal(interaction, &ui) != nil {
			return Task{}, apperr.New(apperr.KindInvalidArgument, "invalid processing interaction")
		}
		config["interaction"] = ui
	}
	if err := validatePlanInteraction(plan.Manifest, config, inputs); err != nil {
		return Task{}, err
	}
	encoded, _ := json.Marshal(config)
	snapshot, _ := json.Marshal(plan)
	version := plan.PublishedVersion
	return s.CreateTask(ctx, CreateInput{WorkspaceID: workspaceID, Name: name, Description: description, TargetType: targetType, TargetID: targetID, ProcessorCode: plan.ProcessorCode, ProcessorVersion: plan.ProcessorVersion, PlanID: &plan.ID, PlanVersion: version, PlanSnapshot: snapshot, Config: encoded, Trigger: plan.Trigger, StartAt: startAt, Inputs: inputs, ActorID: actorID})
}
func validatePlanInteraction(manifest json.RawMessage, config map[string]any, inputs []TaskInput) error {
	var contract struct {
		UI struct {
			AnalysisROI struct {
				Required bool `json:"required"`
			} `json:"analysis_roi"`
		} `json:"ui"`
		Inputs []struct {
			Code string `json:"code"`
			UI   struct {
				CalibrationBoard struct {
					Required bool `json:"required"`
				} `json:"calibration_board"`
			} `json:"ui"`
		} `json:"inputs"`
	}
	if json.Unmarshal(manifest, &contract) != nil {
		return apperr.New(apperr.KindInternal, "invalid processor manifest")
	}
	interaction, _ := config["interaction"].(map[string]any)
	if contract.UI.AnalysisROI.Required && !validRect(interaction["roi"]) {
		return apperr.New(apperr.KindInvalidArgument, "analysis ROI is required")
	}
	byCode := map[string]TaskInput{}
	for _, item := range inputs {
		byCode[item.SlotCode] = item
	}
	for _, slot := range contract.Inputs {
		if _, ok := byCode[slot.Code]; !ok {
			return apperr.New(apperr.KindInvalidArgument, "processing input is missing")
		}
		if slot.UI.CalibrationBoard.Required {
			var metadata map[string]any
			_ = json.Unmarshal(byCode[slot.Code].Config, &metadata)
			if !validRect(metadata["calibration_board"]) {
				return apperr.New(apperr.KindInvalidArgument, "calibration board is required")
			}
		}
	}
	return nil
}
func validRect(value any) bool {
	item, ok := value.(map[string]any)
	if !ok {
		return false
	}
	x, xok := item["x"].(float64)
	y, yok := item["y"].(float64)
	w, wok := item["width"].(float64)
	h, hok := item["height"].(float64)
	return xok && yok && wok && hok && x >= 0 && y >= 0 && w >= .005 && h >= .005 && x+w <= 1 && y+h <= 1
}
