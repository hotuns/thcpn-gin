package datastream

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func TestCreateRequiresCode(t *testing.T) {
	service := NewService(nil)

	_, err := service.Create(context.Background(), CreateInput{
		DeviceID:    uuid.New(),
		Name:        "Air temperature",
		Type:        "telemetry",
		ActorUserID: uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestDataStreamTypeValidation(t *testing.T) {
	for _, value := range []string{"telemetry", "image", "video", "audio", "event", "log"} {
		if !isValidDataStreamType(value) {
			t.Fatalf("expected %q to be valid", value)
		}
	}
	if isValidDataStreamType("sql") {
		t.Fatal("sql should not be a valid data stream type")
	}
}

func TestDataStreamStatusValidation(t *testing.T) {
	for _, value := range []string{"active", "disabled", "archived"} {
		if !isValidDataStreamStatus(value) {
			t.Fatalf("expected %q to be valid", value)
		}
	}
	if isValidDataStreamStatus("retired") {
		t.Fatal("retired should not be a valid data stream status")
	}
}
