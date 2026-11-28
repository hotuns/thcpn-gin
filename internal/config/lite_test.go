package config

import (
	"testing"

	"github.com/google/uuid"
)

func TestDeploymentOnPremLiteConfig(t *testing.T) {
	t.Setenv("DEPLOYMENT_PROFILE", "onprem-lite")
	wsID := uuid.NewString()
	t.Setenv("DEPLOYMENT_WORKSPACE_ID", wsID)
	t.Setenv("BILLING_ENABLED", "true")
	t.Setenv("DEV_REGISTER_ENABLED", "true")

	cfg := Default()
	applyEnv(&cfg)
	if !cfg.Deployment.Lite() {
		t.Fatalf("expected Lite() to be true")
	}
	if cfg.Deployment.DefaultWorkspaceUUID().String() != wsID {
		t.Fatalf("unexpected workspace uuid: %s", cfg.Deployment.DefaultWorkspaceUUID())
	}
	if cfg.Billing.Enabled {
		t.Fatalf("expected billing to be forced disabled in lite mode")
	}
	if cfg.Auth.DevRegisterEnabled {
		t.Fatalf("expected dev registration to be forced disabled in lite mode")
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected valid lite config, got %v", err)
	}
}

func TestDeploymentConfigValidationErrors(t *testing.T) {
	cfg := Default()
	cfg.Deployment.Profile = "unknown-profile"
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected error for invalid deployment profile")
	}

	cfg = Default()
	cfg.Deployment.Profile = ProfileOnPremLite
	cfg.Deployment.WorkspaceID = "not-a-uuid"
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected error for invalid workspace_id")
	}
}
