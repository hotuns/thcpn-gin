package audit

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestParseLimit(t *testing.T) {
	if ParseLimit("") != 100 {
		t.Fatal("expected default limit")
	}
	if ParseLimit("0") != 100 {
		t.Fatal("expected non-positive limit to default")
	}
	if ParseLimit("999") != 500 {
		t.Fatal("expected limit to be capped")
	}
	if ParseLimit("25") != 25 {
		t.Fatal("expected explicit valid limit")
	}
}

func TestNormalizeRecordInputDefaultsActor(t *testing.T) {
	input := normalizeRecordInput(RecordInput{
		Action:       " action ",
		ResourceType: " workspace ",
		Result:       ResultSuccess,
	})
	if input.ActorType != ActorAnonymous {
		t.Fatalf("expected anonymous actor, got %q", input.ActorType)
	}
	if input.Action != "action" || input.ResourceType != "workspace" {
		t.Fatalf("expected fields to be trimmed: %#v", input)
	}
}

type systemAdministratorMarker struct{ id uuid.UUID }

func (systemAdministratorMarker) IsSystemAdministrator() bool            { return true }
func (actor systemAdministratorMarker) SystemAdministratorID() uuid.UUID { return actor.id }

func TestFromRequestOmitsSystemAdministratorUserForeignKey(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/", nil)
	adminID := uuid.New()
	c.Set("actor", systemAdministratorMarker{id: adminID})
	input := FromRequest(c, RecordInput{
		ActorType: ActorUser,
		ActorID:   UserActorID(uuid.New()),
		Action:    "device.log.preview",
		Result:    ResultSuccess,
	})

	if input.ActorType != ActorSystemAdmin {
		t.Fatalf("expected system actor, got %q", input.ActorType)
	}
	if input.ActorID != nil {
		t.Fatal("expected system administrator actor id to be omitted from users foreign key")
	}
	if input.ActorAdminID == nil || *input.ActorAdminID != adminID {
		t.Fatal("expected system administrator id to be retained")
	}
}

func TestFromRequestIncludesAdministratorOperationReason(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("PATCH", "/", nil)
	c.Set("admin_operation_reason", "修复异常权限范围")

	input := FromRequest(c, RecordInput{Action: "member.role_update", Result: ResultFailure, Reason: "member not found"})
	if input.Reason != "修复异常权限范围: member not found" {
		t.Fatalf("unexpected reason %q", input.Reason)
	}
}
