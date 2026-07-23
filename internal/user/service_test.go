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
	if got := personalWorkspaceName(""); got != "用户的工作区" {
		t.Fatalf("expected default name, got %q", got)
	}
	if got := personalWorkspaceName("Alice"); got != "Alice的工作区" {
		t.Fatalf("expected derived name, got %q", got)
	}
}
