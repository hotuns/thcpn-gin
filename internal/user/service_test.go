package user

import (
	"context"
	"testing"

	"thcpn-gin/internal/apperr"
)

func TestRegisterRequiresPhoneOrEmail(t *testing.T) {
	service := NewService(nil)

	_, err := service.Register(context.Background(), RegisterInput{Name: "tester"})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestPersonalWorkspaceName(t *testing.T) {
	if got := personalWorkspaceName(""); got != "Personal Workspace" {
		t.Fatalf("expected default name, got %q", got)
	}
	if got := personalWorkspaceName("Alice"); got != "Alice Personal Workspace" {
		t.Fatalf("expected derived name, got %q", got)
	}
}
