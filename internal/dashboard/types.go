package dashboard

import (
	"time"

	"github.com/google/uuid"
)

// Count distinguishes an empty observation set from a source we cannot count.
// Partial values are sums of known sources, never estimates for missing sources.
type Count struct {
	Value          *int64 `json:"value"`
	Complete       bool   `json:"complete"`
	CoveredDevices int    `json:"covered_devices"`
	TotalDevices   int    `json:"total_devices"`
}

type Day struct {
	Date            string `json:"date"`
	Records         *int64 `json:"records"`
	Images          *int64 `json:"images"`
	RecordsComplete bool   `json:"records_complete"`
	ImagesComplete  bool   `json:"images_complete"`
}

type RecordSummary struct {
	Total           Count      `json:"total"`
	Today           Count      `json:"today"`
	FirstObservedAt *time.Time `json:"first_observed_at"`
}

type ImageSummary struct {
	Total Count `json:"total"`
	Today Count `json:"today"`
}

type DeviceSummary struct {
	Total     int `json:"total"`
	Reporting int `json:"reporting"`
	Delayed   int `json:"delayed"`
	NoData    int `json:"no_data"`
	Unknown   int `json:"unknown"`
	Inactive  int `json:"inactive"`
}

type Attention struct {
	ID               string     `json:"id"`
	DeviceID         uuid.UUID  `json:"device_id"`
	Name             string     `json:"name"`
	Kind             string     `json:"kind"`
	LastObservedAt   *time.Time `json:"last_observed_at"`
	ThresholdSeconds *int64     `json:"threshold_seconds"`
}

type Overview struct {
	GeneratedAt            time.Time     `json:"generated_at"`
	StatisticsUpdatedAt    *time.Time    `json:"statistics_updated_at"`
	Timezone               string        `json:"timezone"`
	Days                   int           `json:"days"`
	RefreshIntervalSeconds int           `json:"refresh_interval_seconds"`
	Records                RecordSummary `json:"records"`
	Images                 ImageSummary  `json:"images"`
	Trend                  []Day         `json:"trend"`
	Devices                DeviceSummary `json:"devices"`
	Attention              []Attention   `json:"attention"`
	ActiveAlerts           *int64        `json:"active_alerts"`
}

var observationLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

func dayStart(at time.Time) time.Time {
	local := at.In(observationLocation)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, observationLocation)
}
