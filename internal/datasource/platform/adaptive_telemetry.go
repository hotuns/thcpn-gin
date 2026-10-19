package platform

import (
	"sort"
	"time"
)

type telemetryBucket struct {
	Min TelemetryPoint
	Max TelemetryPoint
	Set bool
}
type AdaptiveTelemetryCollector struct {
	start       time.Time
	end         time.Time
	rawLimit    int
	rawPoints   []TelemetryPoint
	buckets     []telemetryBucket
	SourceCount int
	firstPoint  *TelemetryPoint
	lastPoint   *TelemetryPoint
}

func NewAdaptiveTelemetryCollector(start time.Time, end time.Time, rawLimit int, targetPoints int) *AdaptiveTelemetryCollector {
	if rawLimit <= 0 {
		rawLimit = 1
	}
	if targetPoints < 2 {
		targetPoints = 2
	}
	bucketCount := targetPoints / 2
	return &AdaptiveTelemetryCollector{
		start:     start,
		end:       end,
		rawLimit:  rawLimit,
		rawPoints: make([]TelemetryPoint, 0, rawLimit),
		buckets:   make([]telemetryBucket, bucketCount),
	}
}
func (c *AdaptiveTelemetryCollector) Add(point TelemetryPoint) {
	c.SourceCount++
	if c.firstPoint == nil {
		first := point
		c.firstPoint = &first
	}
	last := point
	c.lastPoint = &last
	if c.SourceCount <= c.rawLimit {
		c.rawPoints = append(c.rawPoints, point)
	} else if c.rawPoints != nil {
		c.rawPoints = nil
	}

	bucketIndex := 0
	duration := c.end.Sub(c.start)
	if duration > 0 && len(c.buckets) > 1 {
		position := float64(point.Timestamp.Sub(c.start)) / float64(duration)
		bucketIndex = int(position * float64(len(c.buckets)))
		if bucketIndex < 0 {
			bucketIndex = 0
		}
		if bucketIndex >= len(c.buckets) {
			bucketIndex = len(c.buckets) - 1
		}
	}
	bucket := &c.buckets[bucketIndex]
	if !bucket.Set {
		bucket.Min = point
		bucket.Max = point
		bucket.Set = true
		return
	}
	if point.Value < bucket.Min.Value {
		bucket.Min = point
	}
	if point.Value > bucket.Max.Value {
		bucket.Max = point
	}
}
func (c *AdaptiveTelemetryCollector) Result() ([]TelemetryPoint, bool) {
	if c.SourceCount <= c.rawLimit {
		sort.SliceStable(c.rawPoints, func(i, j int) bool {
			return c.rawPoints[i].Timestamp.Before(c.rawPoints[j].Timestamp)
		})
		return c.rawPoints, false
	}
	points := make([]TelemetryPoint, 0, len(c.buckets)*2)
	if c.firstPoint != nil {
		points = append(points, *c.firstPoint)
	}
	for _, bucket := range c.buckets {
		if !bucket.Set {
			continue
		}
		points = append(points, bucket.Min)
		if bucket.Max.Timestamp != bucket.Min.Timestamp || bucket.Max.Value != bucket.Min.Value {
			points = append(points, bucket.Max)
		}
	}
	if c.lastPoint != nil {
		points = append(points, *c.lastPoint)
	}
	sort.SliceStable(points, func(i, j int) bool {
		return points[i].Timestamp.Before(points[j].Timestamp)
	})
	deduped := points[:0]
	for _, point := range points {
		if len(deduped) > 0 {
			previous := deduped[len(deduped)-1]
			if previous.Timestamp.Equal(point.Timestamp) && previous.Value == point.Value {
				continue
			}
		}
		deduped = append(deduped, point)
	}
	return deduped, true
}
