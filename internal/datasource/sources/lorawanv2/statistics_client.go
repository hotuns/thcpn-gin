package lorawanv2

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"thcpn-gin/internal/datasource/platform"
)

type nodeObservationStatistics struct {
	GatewaySN   string     `json:"gateway_sn"`
	NodeIndex   int        `json:"node_index"`
	Timezone    string     `json:"timezone"`
	GeneratedAt *time.Time `json:"generated_at"`
	AsOf        *time.Time `json:"as_of"`
	CountUnit   string     `json:"count_unit"`
	Complete    bool       `json:"complete"`
	Records     *struct {
		Total   *int64     `json:"total"`
		FirstAt *time.Time `json:"first_at"`
		LastAt  *time.Time `json:"last_at"`
		Daily   []struct {
			Date  string `json:"date"`
			Count *int64 `json:"count"`
		} `json:"daily"`
	} `json:"records"`
	Images *struct {
		Supported *bool           `json:"supported"`
		Total     *int64          `json:"total"`
		Daily     json.RawMessage `json:"daily"`
	} `json:"images"`
}

func (c *LoraWANV2Client) observationStatistics(ctx context.Context, sn string, node int, cutoff *time.Time, start, end time.Time) (platform.ObservationStatistics, error) {
	fail := func() (platform.ObservationStatistics, error) {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	if node < 1 || node > 254 || !start.Before(end) {
		return fail()
	}
	// The upstream contract accepts whole Unix seconds. Never round a formal
	// cutoff down and include pre-observation samples, or up and silently omit them.
	if cutoff != nil && cutoff.Nanosecond() != 0 {
		return fail()
	}
	query := url.Values{
		"start_at": {strconv.FormatInt(start.Unix(), 10)},
		"end_at":   {strconv.FormatInt(end.Unix(), 10)},
		"timezone": {"Asia/Shanghai"},
	}
	if cutoff != nil {
		query.Set("observation_start_at", strconv.FormatInt(cutoff.Unix(), 10))
	}
	path := "/device/" + url.PathEscape(sn) + "/node/" + strconv.Itoa(node) + "/statistics"
	payload, err := c.Request(ctx, http.MethodGet, path, query, nil)
	if err != nil {
		return fail()
	}
	var response nodeObservationStatistics
	if json.Unmarshal(payload, &response) != nil || response.GatewaySN != sn || response.NodeIndex != node || response.Timezone != "Asia/Shanghai" || response.CountUnit != "sample_record" || !response.Complete || response.GeneratedAt == nil || response.AsOf == nil || response.Records == nil || response.Records.Total == nil || *response.Records.Total < 0 {
		return fail()
	}
	if response.Images == nil || response.Images.Supported == nil || *response.Images.Supported || response.Images.Total != nil || string(response.Images.Daily) != "null" {
		return fail()
	}
	end = time.Unix(end.Unix(), 0)
	start = time.Unix(start.Unix(), 0)
	if response.AsOf.After(end) || response.AsOf.After(*response.GeneratedAt) {
		return fail()
	}
	records := response.Records
	if *records.Total == 0 {
		if records.FirstAt != nil || records.LastAt != nil {
			return fail()
		}
	} else if records.FirstAt == nil || records.LastAt == nil || records.FirstAt.After(*records.LastAt) || !records.LastAt.Before(*response.AsOf) || (cutoff != nil && records.FirstAt.Before(*cutoff)) {
		return fail()
	}
	result := platform.NewRecordStatistics("", start, end).Result()
	if len(records.Daily) != len(result.Days) {
		return fail()
	}
	var sum int64
	for i, day := range records.Daily {
		if day.Date != result.Days[i].Date || day.Count == nil || *day.Count < 0 || *day.Count > math.MaxInt64-sum {
			return fail()
		}
		sum += *day.Count
		result.Days[i].Records = day.Count
	}
	if sum > *records.Total || (records.FirstAt != nil && !records.FirstAt.Before(start) && sum != *records.Total) {
		return fail()
	}
	result.TotalRecords = records.Total
	result.FirstObservedAt, result.LastObservedAt = records.FirstAt, records.LastAt
	// Images are unsupported. A node's last sample and sensor wait_time do not
	// establish a gateway-wide capture/upload cadence; health stays unknown.
	return result, nil
}
