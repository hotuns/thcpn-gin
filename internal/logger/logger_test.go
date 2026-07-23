package logger

import "testing"

func TestSensitiveValuesAreRedactedOrMasked(t *testing.T) {
	if got := maskEmail("someone@example.com"); got != "so***@example.com" {
		t.Fatalf("unexpected email mask %q", got)
	}
	if got := maskPhone("13812345678"); got != "138****5678" {
		t.Fatalf("unexpected phone mask %q", got)
	}
	for _, key := range []string{"password", "authorization", "dsn_secret", "verification_code"} {
		if !sensitiveKey(key) {
			t.Fatalf("expected %q to be sensitive", key)
		}
	}
}
