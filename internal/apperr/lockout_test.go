package apperr

import (
	"testing"
	"time"
)

func TestAccountLockedRetryDetails(t *testing.T) {
	now := time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
	err := AccountLocked(now.Add(61*time.Second+time.Millisecond), now)
	if KindOf(err) != KindRateLimited || DetailsOf(err)["retry_after_seconds"] != 62 || DetailsOf(err)["reason"] != "ACCOUNT_LOCKED" {
		t.Fatalf("unexpected retry context: %#v", DetailsOf(err))
	}
}
