package telemetry

import (
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func TestParseDataStreamIDs(t *testing.T) {
	first := uuid.New()
	second := uuid.New()
	ids, err := parseDataStreamIDs(first.String() + ", " + second.String() + "," + first.String())
	if err != nil {
		t.Fatalf("parse ids: %v", err)
	}
	if len(ids) != 2 || ids[0] != first || ids[1] != second {
		t.Fatalf("unexpected ids: %#v", ids)
	}
	if ids, err := parseDataStreamIDs(""); err != nil || ids != nil {
		t.Fatalf("expected omitted filter, got ids=%#v err=%v", ids, err)
	}
	if _, err := parseDataStreamIDs("not-a-uuid"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}
