package inspection

import (
	"math"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/datasource/platform"
)

var beijing = time.FixedZone("Asia/Shanghai", 8*60*60)

const uploadGrace = 2 * time.Minute

type schedule []int

func parseSchedule(value string) schedule {
	mins, hours, ok := platform.ParseTwoFieldSchedule(value)
	if !ok {
		return nil
	}
	var slots schedule
	for _, h := range platform.ExpandWildcardHours(hours) {
		for _, m := range mins {
			slots = append(slots, h*60+m)
		}
	}
	return slots
}

// A batch can include observations taken after the upload preceding it.
func (s schedule) missedAfter(now time.Time, count int) time.Time {
	if len(s) == 0 {
		return time.Time{}
	}
	t := now.Add(-uploadGrace).In(beijing)
	day := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, beijing)
	for {
		for i := len(s) - 1; i >= 0; i-- {
			at := day.Add(time.Duration(s[i]) * time.Minute)
			if at.After(t) {
				continue
			}
			if count == 0 {
				return at
			}
			count--
		}
		day = day.AddDate(0, 0, -1)
	}
}

type Template struct {
	ID          uuid.UUID `json:"id"`
	Family      string    `json:"family"`
	DeviceType  string    `json:"device_type"`
	Code        string    `json:"metric_code"`
	Unit        string    `json:"unit"`
	Kind        string    `json:"kind"`
	Lower       *float64  `json:"lower_value"`
	Upper       *float64  `json:"upper_value"`
	Invalid     *float64  `json:"invalid_value"`
	Consecutive int       `json:"consecutive"`
	Enabled     bool      `json:"enabled"`
	Updated     time.Time `json:"updated_at"`
}

type counter struct {
	At         time.Time
	Since      time.Time
	Count      int
	SawNonzero bool
	Version    time.Time
}

func (c *counter) observe(at time.Time, abnormal bool) bool {
	if !at.After(c.At) {
		return false
	}
	c.At = at
	if abnormal {
		if c.Count == 0 {
			c.Since = at
		}
		c.Count++
	} else {
		c.Count = 0
		c.Since = time.Time{}
	}
	return true
}

func (t Template) check(c *counter, at time.Time, v float64) bool {
	if !at.After(c.At) || math.IsNaN(v) || math.IsInf(v, 0) {
		return false
	}
	bad := false
	switch t.Kind {
	case "range":
		bad = t.Lower != nil && v < *t.Lower || t.Upper != nil && v > *t.Upper
	case "invalid":
		bad = t.Invalid != nil && v == *t.Invalid
	case "zero":
		bad = v == 0 && c.SawNonzero
		c.SawNonzero = c.SawNonzero || v != 0
	}
	return c.observe(at, bad)
}

func orderedTimes[T any](points map[time.Time]T) []time.Time {
	times := make([]time.Time, 0, len(points))
	for at := range points {
		times = append(times, at)
	}
	sort.Slice(times, func(i, j int) bool { return times[i].Before(times[j]) })
	return times
}

func metricKey(code, unit string) string {
	return strings.ToLower(strings.TrimSpace(code)) + "\x00" + strings.TrimSpace(unit)
}
