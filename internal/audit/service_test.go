package audit

import "testing"

func TestParseLimit(t *testing.T) {
	if ParseLimit("") != 100 {
		t.Fatal("expected default limit")
	}
	if ParseLimit("0") != 100 {
		t.Fatal("expected non-positive limit to default")
	}
	if ParseLimit("999") != 500 {
		t.Fatal("expected limit to be capped")
	}
	if ParseLimit("25") != 25 {
		t.Fatal("expected explicit valid limit")
	}
}

func TestNormalizeRecordInputDefaultsActor(t *testing.T) {
	input := normalizeRecordInput(RecordInput{
		Action:       " action ",
		ResourceType: " workspace ",
		Result:       ResultSuccess,
	})
	if input.ActorType != ActorAnonymous {
		t.Fatalf("expected anonymous actor, got %q", input.ActorType)
	}
	if input.Action != "action" || input.ResourceType != "workspace" {
		t.Fatalf("expected fields to be trimmed: %#v", input)
	}
}
