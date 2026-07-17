package deviceprofile

import (
	"testing"
)

func TestAllowedProfileImageTypes(t *testing.T) {
	for _, contentType := range []string{"image/jpeg", "image/png", "image/webp"} {
		if !allowedContentType(contentType) {
			t.Fatalf("expected %s to be accepted", contentType)
		}
	}
	if allowedContentType("image/gif") {
		t.Fatal("expected GIF to be rejected")
	}
}

func TestCleanOptional(t *testing.T) {
	empty := "  "
	if cleanOptional(&empty) != nil {
		t.Fatal("expected blank values to be cleared")
	}
	value := "  安装在温室北侧  "
	cleaned := cleanOptional(&value)
	if cleaned == nil || *cleaned != "安装在温室北侧" {
		t.Fatalf("unexpected cleaned value: %#v", cleaned)
	}
}
