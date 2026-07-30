package computedstream

import (
	"reflect"
	"testing"
)

func TestExpressionDependenciesAndEvaluation(t *testing.T) {
	expression, err := Compile("stream.change / 1000 + meta.initial_diameter")
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	if !reflect.DeepEqual(expression.StreamCodes(), []string{"change"}) {
		t.Fatalf("unexpected stream codes: %#v", expression.StreamCodes())
	}
	if !reflect.DeepEqual(expression.MetadataKeys(), []string{"initial_diameter"}) {
		t.Fatalf("unexpected metadata keys: %#v", expression.MetadataKeys())
	}
	value, err := expression.Evaluate(map[string]float64{"change": 2500}, map[string]float64{"initial_diameter": 320})
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if value != 322.5 {
		t.Fatalf("unexpected value: %v", value)
	}
}

func TestExpressionFunctionsAndConditions(t *testing.T) {
	expression, err := Compile("if(stream.value > meta.maximum, meta.maximum, round(abs(stream.value)))")
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	value, err := expression.Evaluate(map[string]float64{"value": -4.6}, map[string]float64{"maximum": 10})
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if value != 5 {
		t.Fatalf("unexpected value: %v", value)
	}
}

func TestExpressionRejectsUnsafeSyntax(t *testing.T) {
	for _, formula := range []string{
		`danger("x")`,
		`stream.value % 2`,
		`other.value + 1`,
	} {
		if _, err := Compile(formula); err == nil {
			t.Fatalf("expected %q to be rejected", formula)
		}
	}
}

func TestExpressionReportsMissingAndInvalidValues(t *testing.T) {
	expression, err := Compile("stream.value / meta.divisor")
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	if _, err := expression.Evaluate(nil, map[string]float64{"divisor": 1}); err == nil {
		t.Fatal("expected missing stream error")
	}
	if _, err := expression.Evaluate(map[string]float64{"value": 1}, map[string]float64{"divisor": 0}); err == nil {
		t.Fatal("expected division by zero error")
	}
}
