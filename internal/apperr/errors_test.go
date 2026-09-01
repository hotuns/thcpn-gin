package apperr

import (
	"errors"
	"testing"
)

func TestErrorClassificationAndMessages(t *testing.T) {
	cause := errors.New("database unavailable")
	err := Wrap(KindNotFound, "device not found", cause)
	if KindOf(err) != KindNotFound || MessageOf(err) != "device not found" {
		t.Fatalf("unexpected app error: kind=%q message=%q", KindOf(err), MessageOf(err))
	}
	if !errors.Is(err, cause) {
		t.Fatal("wrapped cause should be discoverable")
	}
	if KindOf(cause) != KindInternal || MessageOf(cause) != "internal error" {
		t.Fatal("plain errors must not expose internal details")
	}
	if KindOf(nil) != "" || MessageOf(nil) != "" {
		t.Fatal("nil error should have empty classification and message")
	}
}
