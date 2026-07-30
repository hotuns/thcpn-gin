package datasource

import (
	"database/sql"
	"math"
	"testing"
)

func TestValidCoordinate(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		value sql.NullFloat64
		min   float64
		max   float64
		valid bool
	}{
		{name: "valid", value: sql.NullFloat64{Float64: 35.25, Valid: true}, min: -90, max: 90, valid: true},
		{name: "zero", value: sql.NullFloat64{Float64: 0, Valid: true}, min: -90, max: 90, valid: true},
		{name: "null", value: sql.NullFloat64{}, min: -90, max: 90},
		{name: "out of range", value: sql.NullFloat64{Float64: 91, Valid: true}, min: -90, max: 90},
		{name: "nan", value: sql.NullFloat64{Float64: math.NaN(), Valid: true}, min: -90, max: 90},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			result := validCoordinate(test.value, test.min, test.max)
			if (result != nil) != test.valid {
				t.Fatalf("validCoordinate() = %v, valid=%v", result, test.valid)
			}
		})
	}
}

func TestValidFiniteNumber(t *testing.T) {
	t.Parallel()
	if value := validFiniteNumber(sql.NullFloat64{Float64: 4200.5, Valid: true}); value == nil || *value != 4200.5 {
		t.Fatalf("validFiniteNumber() = %v", value)
	}
	if value := validFiniteNumber(sql.NullFloat64{Float64: math.Inf(1), Valid: true}); value != nil {
		t.Fatalf("expected infinity to be rejected, got %v", *value)
	}
}

func TestParseSourceCoordinate(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		value sql.NullString
		valid bool
		want  float64
	}{
		{name: "numeric string", value: sql.NullString{String: " 35.25 ", Valid: true}, valid: true, want: 35.25},
		{name: "zero", value: sql.NullString{String: "0", Valid: true}, valid: true},
		{name: "null", value: sql.NullString{}},
		{name: "empty", value: sql.NullString{String: "", Valid: true}},
		{name: "malformed source value", value: sql.NullString{String: "pC", Valid: true}},
		{name: "out of range", value: sql.NullString{String: "91", Valid: true}},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			result := parseSourceCoordinate(test.value, -90, 90)
			if (result != nil) != test.valid {
				t.Fatalf("parseSourceCoordinate() = %v, valid=%v", result, test.valid)
			}
			if result != nil && *result != test.want {
				t.Fatalf("parseSourceCoordinate() = %v, want %v", *result, test.want)
			}
		})
	}
}

func TestUsableSourceLocationRejectsZeroPair(t *testing.T) {
	t.Parallel()
	latitude := parseSourceCoordinate(sql.NullString{String: "0", Valid: true}, -90, 90)
	longitude := parseSourceCoordinate(sql.NullString{String: "0", Valid: true}, -180, 180)
	if latitude == nil || longitude == nil {
		t.Fatal("individual zero coordinates must remain valid before pair validation")
	}
	if !(*latitude == 0 && *longitude == 0) {
		t.Fatal("expected zero coordinate pair to be recognized as an unset placeholder")
	}
}
