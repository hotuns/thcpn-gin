package project

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func TestCreateRequiresProjectName(t *testing.T) {
	service := NewService(nil)

	_, err := service.Create(context.Background(), CreateInput{
		WorkspaceID: uuid.New(),
		ActorUserID: uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestProjectStatusValidation(t *testing.T) {
	for _, status := range []string{"active", "archived"} {
		if !isValidProjectStatus(status) {
			t.Fatalf("expected %q to be valid", status)
		}
	}
	if isValidProjectStatus("disabled") {
		t.Fatal("disabled should not be a valid project status")
	}
}
