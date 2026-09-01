package notification

import (
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func TestNotificationWriteValidation(t *testing.T) {
	service := NewService(nil)
	if _, err := service.CreateAnnouncement(t.Context(), uuid.New(), AnnouncementInput{}); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected announcement validation error, got %v", err)
	}
	if err := service.SetAnnouncementStatus(t.Context(), uuid.New(), "invalid"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected status validation error, got %v", err)
	}
	if _, err := service.Send(t.Context(), SendInput{}); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected content validation error, got %v", err)
	}
	userID, workspaceID := uuid.New(), uuid.New()
	if _, err := service.Send(t.Context(), SendInput{UserID: &userID, WorkspaceID: &workspaceID, Title: "title", Content: "content"}); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected audience validation error, got %v", err)
	}
}
