package lorawanv2

import (
	"encoding/json"
	"testing"
)

func TestTimestampSecondsAndMillisecondsNumericOrString(t *testing.T) {
	for _, raw := range []string{`1792397797`, `"1792397797"`, `1792397797000`, `"1792397797000"`, `"2026-10-19T16:16:37+08:00"`, `{"$date":{"$numberLong":"1792397797000"}}`} {
		got, err := loraWANV2Timestamp(json.RawMessage(raw))
		if err != nil || got.Unix() != 1792397797 {
			t.Errorf("%s => %s (%v), want epoch 1792397797", raw, got, err)
		}
	}
}
