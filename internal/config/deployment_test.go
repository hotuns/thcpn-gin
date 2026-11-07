package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNormalizePublicBaseURL(t *testing.T) {
	for _, test := range []struct{ input, want string }{
		{"", ""}, {"  ", ""},
		{"https://ieswatch.com/", "https://ieswatch.com"},
		{" https://WWW.IESWATCH.COM ", "https://www.ieswatch.com"},
		{"http://localhost:5173/", "http://localhost:5173"},
		{"http://192.168.1.20:8080", "http://192.168.1.20:8080"},
		{"http://[::1]:5173/", "http://[::1]:5173"},
	} {
		got, err := NormalizePublicBaseURL(test.input)
		if err != nil || got != test.want {
			t.Fatalf("normalize %q = %q, %v; want %q", test.input, got, err, test.want)
		}
	}
	for _, input := range []string{
		"ieswatch.com", "//ieswatch.com", "ftp://ieswatch.com", "https://", "https:///",
		"https://user:password@ieswatch.com", "https://ieswatch.com/admin", "https://ieswatch.com//",
		"https://ieswatch.com/?key=value", "https://ieswatch.com?", "https://ieswatch.com#", "https://ieswatch.com/#section",
		"https://ieswatch.com/%2F", "http://localhost:0", "http://localhost:65536", "http://localhost:port", "http://localhost:",
	} {
		if _, err := NormalizePublicBaseURL(input); err == nil {
			t.Errorf("accepted invalid public address %q", input)
		}
	}
}

func TestNormalizePublicBaseURLLengthLimit(t *testing.T) {
	boundary := "https://" + strings.Repeat("a", 2040)
	if _, err := NormalizePublicBaseURL(boundary); err != nil {
		t.Fatalf("2048-character public URL rejected: %v", err)
	}
	if _, err := NormalizePublicBaseURL(boundary + "a"); err == nil {
		t.Fatal("public URL longer than 2048 characters accepted")
	}
}

func TestLoadDeploymentPublicBaseURL(t *testing.T) {
	file := filepath.Join(t.TempDir(), "deployment.yaml")
	if err := os.WriteFile(file, []byte("deployment:\n  public_base_url: https://configured.example/\n"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CONFIG_FILE", file)
	envFile := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(envFile, nil, 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ENV_FILE", envFile)
	t.Setenv("PLATFORM_PUBLIC_URL", "")
	cfg, err := Load()
	if err != nil || cfg.Deployment.PublicBaseURL != "https://configured.example" {
		t.Fatalf("yaml public address: %q, %v", cfg.Deployment.PublicBaseURL, err)
	}
	t.Setenv("PLATFORM_PUBLIC_URL", "https://ieswatch.com/")
	cfg, err = Load()
	if err != nil || cfg.Deployment.PublicBaseURL != "https://ieswatch.com" {
		t.Fatalf("environment public address: %q, %v", cfg.Deployment.PublicBaseURL, err)
	}
	t.Setenv("PLATFORM_PUBLIC_URL", "https://ieswatch.com/admin")
	if _, err = Load(); err == nil {
		t.Fatal("startup accepted a path as the public origin")
	}
}
