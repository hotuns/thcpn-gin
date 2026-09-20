package alerting

import "testing"

func TestThresholdStateUsesRecoveryHysteresis(t *testing.T) {
	lower, upper := 10.0, 20.0
	tests := []struct {
		name, mode                  string
		value                       float64
		wantViolation, wantRecovery bool
	}{
		{"above fires", "above", 21, true, false}, {"above boundary stays firing", "above", 19.5, false, false}, {"above safe", "above", 18, false, true},
		{"below fires", "below", 9, true, false}, {"below boundary stays firing", "below", 10.5, false, false}, {"below safe", "below", 12, false, true},
		{"outside fires", "outside", 21, true, false}, {"outside boundary stays firing", "outside", 19.5, false, false}, {"outside safe", "outside", 15, false, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			violating, recovered := thresholdState(tt.mode, tt.value, &lower, &upper, 2)
			if violating != tt.wantViolation || recovered != tt.wantRecovery {
				t.Fatalf("got (%v,%v), want (%v,%v)", violating, recovered, tt.wantViolation, tt.wantRecovery)
			}
		})
	}
}

func TestRetryDelayIsBounded(t *testing.T) {
	if got := retryDelay(1); got.String() != "1m0s" {
		t.Fatalf("first delay %s", got)
	}
	if got := retryDelay(99); got.String() != "6h0m0s" {
		t.Fatalf("bounded delay %s", got)
	}
}
