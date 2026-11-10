package inspection

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/telemetry"
)

type Service struct {
	DB        *pgxpool.Pool
	Sources   *datasource.Service
	Telemetry *telemetry.Service
}

const carbonFluxUnit = "μg CO₂·m⁻²·s⁻¹"

const eligible = `WITH eligible AS (
 SELECT DISTINCT ON (d.id) d.id,d.name,d.asset_no,src.source_family AS family,d.device_type,
   GREATEST(d.created_at, own.starts_at, parent.starts_at) AS starts_at
 FROM devices d
 JOIN device_source_refs ref ON ref.device_id=d.id AND ref.status='active'
 JOIN data_sources src ON src.id=ref.data_source_id AND src.source_family IN ('thcpn','carbon')
 LEFT JOIN device_relations rel ON rel.child_device_id=d.id AND rel.status='active'
 LEFT JOIN devices p ON p.id=rel.parent_device_id
 LEFT JOIN device_observation_starts own ON own.device_id=d.id AND own.node_index=0
 LEFT JOIN device_observation_starts parent ON parent.device_id=p.id AND parent.node_index=0
 WHERE d.status='active' AND d.device_type<>'camera'
   AND (d.lifecycle_status='online' OR (d.lifecycle_status='inbound' AND p.lifecycle_status='online' AND p.status='active') OR
        (d.lifecycle_status='inbound' AND own.starts_at IS NOT NULL))
   AND GREATEST(d.created_at, own.starts_at, parent.starts_at)<=now()
 ORDER BY d.id, ref.updated_at DESC, ref.id
)`

type progress struct {
	Start         time.Time
	Window        time.Time
	ProfileAt     time.Time
	ProfileError  string
	DecodedLatest time.Time
	Upload        string
	Latest        map[int]time.Time
	Counters      map[string]counter
}

type target struct {
	ID         uuid.UUID
	Family     string
	DeviceType string
	Start      time.Time
	Progress   progress
}

type finding struct {
	Key, Kind, Metric, Detail string
	Node                      *int
	Since, At                 time.Time
	Active                    bool
}

func (s *Service) ProcessAvailable(ctx context.Context, limit int) (int, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	rows, err := s.DB.Query(ctx, eligible+`
 SELECT e.id,e.family,e.device_type,e.starts_at,COALESCE(st.progress,'{}') FROM eligible e
 LEFT JOIN device_inspection_state st ON st.device_id=e.id
 WHERE st.next_check_at IS NULL OR st.next_check_at<=now()
 ORDER BY st.next_check_at NULLS FIRST,e.id LIMIT $1`, limit)
	if err != nil {
		return 0, err
	}
	var targets []target
	for rows.Next() {
		var t target
		var raw []byte
		if err = rows.Scan(&t.ID, &t.Family, &t.DeviceType, &t.Start, &raw); err != nil {
			rows.Close()
			return 0, err
		}
		if err = json.Unmarshal(raw, &t.Progress); err != nil {
			rows.Close()
			return 0, err
		}
		targets = append(targets, t)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return 0, err
	}
	if len(targets) == 0 {
		return 0, nil
	}
	templates, err := s.Templates(ctx)
	if err != nil {
		return 0, err
	}
	jobs := make(chan target, len(targets))
	results := make(chan error, len(targets))
	for _, t := range targets {
		jobs <- t
	}
	close(jobs)
	var workers sync.WaitGroup
	for range min(4, len(targets)) {
		workers.Go(func() {
			for t := range jobs {
				if ctx.Err() != nil {
					return
				}
				if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) < 5*time.Second {
					return
				}
				results <- s.inspect(ctx, t, templates, time.Now().UTC())
			}
		})
	}
	workers.Wait()
	close(results)
	processed := 0
	var firstErr error
	for err := range results {
		if err == nil {
			processed++
		} else if firstErr == nil {
			firstErr = err
		}
	}
	return processed, firstErr
}

func (s *Service) inspect(ctx context.Context, t target, templates []Template, now time.Time) error {
	matched := make([]Template, 0, len(templates))
	for _, rule := range templates {
		if rule.Enabled && rule.Family == t.Family && (rule.DeviceType == "all" || rule.DeviceType == t.DeviceType) {
			matched = append(matched, rule)
		}
	}
	templates = matched
	p := t.Progress
	if !p.Start.Equal(t.Start) {
		p = progress{Start: t.Start}
	}
	if p.Latest == nil {
		p.Latest = make(map[int]time.Time)
	}
	if p.Counters == nil {
		p.Counters = make(map[string]counter)
	}
	readCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	var checks []finding
	if p.ProfileAt.IsZero() || now.Sub(p.ProfileAt) >= time.Hour {
		cfg, err := s.Sources.GetDeviceConfig(readCtx, t.ID)
		p.ProfileError = ""
		p.Upload = ""
		if err != nil {
			if apperr.KindOf(err) != apperr.KindNotFound {
				p.ProfileError = "采样计划读取失败"
			}
		} else {
			var control struct {
				Upload string `json:"data_upload_invl"`
			}
			if json.Unmarshal(cfg.LatestConfig.ControlJSON, &control) == nil {
				p.Upload = control.Upload
			}
		}
		p.ProfileAt = now
	}
	issue := p.ProfileError
	slots := parseSchedule(p.Upload)
	lateBoundary := slots.missedAfter(now, 3)
	from := now.Add(-36 * time.Hour)
	if !p.Window.IsZero() {
		// Read an overlap for data uploaded in batches; counters consume each timestamp once.
		overlap := 2 * time.Hour
		if earlier := slots.missedAfter(now, 1); !earlier.IsZero() {
			overlap = max(overlap, now.Sub(earlier))
		}
		from = maxTime(from, p.Window.Add(-overlap))
	}
	from = maxTime(from, t.Start)
	end := now.Add(-uploadGrace)
	if end.After(from) {
		if t.Family == "carbon" {
			nodes, err := s.Sources.Carbon.InspectionSampleTimes(readCtx, t.ID, from, now)
			if err != nil {
				issue = joinIssue(issue, "碳汇采样读取失败")
			} else {
				for index, sample := range nodes {
					if sample.Start.After(p.Latest[index]) {
						delete(p.Latest, index)
					}
					p.Latest[index] = maxTime(p.Latest[index], sample.At)
					if !lateBoundary.IsZero() {
						checks = append(checks, lateFinding(index, p.Latest[index], lateBoundary, maxTime(t.Start, sample.Start), now))
					}
				}
				p.Window = end
			}
			for _, rule := range templates {
				if rule.Enabled && rule.Family == "carbon" {
					flux, err := s.Sources.Carbon.InspectionFlux(readCtx, t.ID, from, end)
					if err != nil {
						issue = joinIssue(issue, "碳汇通量读取失败")
					} else {
						type fluxKey struct {
							node        int
							field, code string
						}
						groups := make(map[fluxKey]map[time.Time]float64)
						for _, sample := range flux {
							for _, value := range []struct {
								code string
								v    *float64
							}{{"nee", sample.NEE}, {"er", sample.ER}, {"gpp", sample.GPP}} {
								if value.v == nil {
									continue
								}
								key := fluxKey{sample.NodeID, sample.Field, value.code}
								if groups[key] == nil {
									groups[key] = make(map[time.Time]float64)
								}
								groups[key][sample.PeriodAt.UTC()] = *value.v
							}
						}
						for key, points := range groups {
							found := checkTemplates(&p, templates, "carbon", key.code, carbonFluxUnit, key.field+" 地块 · "+strings.ToUpper(key.code), fmt.Sprintf("%d:%s:%s", key.node, key.field, key.code), points)
							for i := range found {
								index := key.node
								found[i].Node = &index
							}
							checks = append(checks, found...)
						}
					}
					break
				}
			}
		} else {
			streams, err := s.readStreams(readCtx, t.ID, from, end)
			if err != nil {
				issue = joinIssue(issue, "采样数据读取失败")
			} else if len(streams) > 0 {
				var dataOK bool
				checks, dataOK = inspectStreams(&p, t.Family, streams, templates)
				if dataOK {
					p.Window = end
				} else {
					issue = joinIssue(issue, "部分采样数据读取不完整")
				}
			}
			rawOK := true
			if p.DecodedLatest.Before(p.Window.Add(-5*time.Minute)) || !p.Latest[0].After(lateBoundary) {
				at, rawErr := s.Sources.THCPN.InspectionSampleTime(readCtx, t.ID, t.DeviceType, from, end)
				if rawErr != nil {
					issue = joinIssue(issue, "原始上报读取失败")
					rawOK = false
				} else {
					p.Latest[0] = maxTime(p.Latest[0], at)
					if len(streams) > 0 && at.After(p.DecodedLatest) {
						issue = joinIssue(issue, "有原始上报，最新记录没有可用指标值")
					}
				}
			}
			if rawOK && !lateBoundary.IsZero() {
				switch {
				case t.DeviceType == "gateway" && len(streams) == 0 && p.Latest[0].IsZero():
					issue = joinIssue(issue, "网关没有独立采样记录，所属节点分别巡检")
				default:
					checks = append(checks, lateFinding(0, p.Latest[0], lateBoundary, t.Start, now))
				}
			}
			runtime, err := s.runtimeChecks(readCtx, t, templates, &p, now)
			if err != nil {
				issue = joinIssue(issue, "电压或信号读取失败")
			} else {
				checks = append(checks, runtime...)
			}
		}
	}
	every := 15 * time.Minute
	if len(slots) > 0 {
		gap := 1440
		for i, minute := range slots {
			next := slots[(i+1)%len(slots)]
			if next <= minute {
				next += 1440
			}
			gap = min(gap, next-minute)
		}
		every = time.Duration(max(5, min(30, gap/2))) * time.Minute
	}
	return s.persist(ctx, t.ID, p, checks, now, every, len(slots) > 0, issue)
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
func joinIssue(a, b string) string {
	if a == "" {
		return b
	}
	return a + "；" + b
}

func lateFinding(index int, last, boundary, start, now time.Time) finding {
	item := finding{Key: fmt.Sprintf("late:%d", index), Kind: "late", Metric: "采集数据", Since: now, At: now}
	if index > 0 {
		item.Node = &index
	}
	item.Active = start.Before(boundary) && !last.After(boundary)
	item.Detail = "按上传计划已连续错过 3 个上报窗口"
	if !last.IsZero() {
		item.Detail += "；最后采样 " + last.In(beijing).Format("01-02 15:04")
	}
	return item
}

func (s *Service) readStreams(ctx context.Context, id uuid.UUID, start, end time.Time) ([]telemetry.Series, error) {
	rows, err := s.DB.Query(ctx, `SELECT DISTINCT ds.id FROM data_streams ds JOIN data_stream_bindings b ON b.data_stream_id=ds.id
 WHERE ds.device_id=$1 AND ds.type='telemetry' AND ds.status='active' AND ds.purpose='measurement'
 AND b.status='active' AND b.adapter_code='thcpn_legacy_mysql'
 AND NOT EXISTS(SELECT 1 FROM computed_data_streams c WHERE c.data_stream_id=ds.id)`, id)
	if err != nil {
		return nil, err
	}
	ids, err := readUUIDs(rows)
	if err != nil || len(ids) == 0 {
		return nil, err
	}
	result, err := s.Telemetry.QueryInternal(ctx, telemetry.QueryInput{DeviceID: &id, DataStreamIDs: ids, StartTime: start, EndTime: end, Limit: 3000})
	return result.Series, err
}

func inspectStreams(p *progress, family string, streams []telemetry.Series, templates []Template) ([]finding, bool) {
	values := make(map[uuid.UUID]map[time.Time]float64)
	times := make(map[time.Time]bool)
	allOK := true
	for _, stream := range streams {
		if stream.Error != "" || !stream.Complete || stream.Sampled {
			allOK = false
			continue
		}
		points := make(map[time.Time]float64)
		values[stream.DataStreamID] = points
		for _, point := range stream.Points {
			if math.IsNaN(point.Value) || math.IsInf(point.Value, 0) {
				continue
			}
			at := point.Timestamp.UTC()
			points[at] = point.Value
			times[at] = true
			p.Latest[0] = maxTime(p.Latest[0], at)
			p.DecodedLatest = maxTime(p.DecodedLatest, at)
		}
	}
	var checks []finding
	ordered := orderedTimes(times)
	for _, stream := range streams {
		points, ok := values[stream.DataStreamID]
		if !ok {
			continue
		}
		unit := ""
		if stream.Unit != nil {
			unit = *stream.Unit
		}
		if allOK && len(streams) > 1 {
			key := "missing:" + stream.DataStreamID.String()
			c := p.Counters[key]
			for _, at := range ordered {
				_, found := points[at]
				wasActive := c.Count >= 3
				if c.observe(at, !found) && (wasActive || c.Count >= 3) {
					checks = recordFinding(checks, finding{Key: key, Kind: "missing", Metric: stream.Name, Detail: fmt.Sprintf("同设备有采样记录，但该指标连续 %d 条没有可用值", c.Count), Since: c.Since, At: c.At, Active: c.Count >= 3})
				}
			}
			p.Counters[key] = c
		}
		checks = append(checks, checkTemplates(p, templates, family, stream.Code, unit, stream.Name, stream.DataStreamID.String(), points)...)
	}
	return checks, allOK
}

func checkTemplates(p *progress, templates []Template, family, code, unit, name, identity string, points map[time.Time]float64) []finding {
	var checks []finding
	for _, t := range templates {
		if !t.Enabled || family != t.Family || metricKey(code, unit) != metricKey(t.Code, t.Unit) {
			continue
		}
		key := t.Kind + ":" + t.ID.String() + ":" + identity
		c := p.Counters[key]
		if !c.Version.Equal(t.Updated) {
			c = counter{Version: t.Updated}
		}
		for _, at := range orderedTimes(points) {
			first := c.At.IsZero()
			wasActive := c.Count >= t.Consecutive
			v := points[at]
			if !t.check(&c, at, v) || (!wasActive && c.Count < t.Consecutive && !(first && c.Count == 0)) {
				continue
			}
			detail := strings.TrimSpace(fmt.Sprintf("连续 %d 条异常；最近值 %g %s", c.Count, v, unit))
			if t.Lower != nil {
				detail += fmt.Sprintf("；下限 %g", *t.Lower)
			}
			if t.Upper != nil {
				detail += fmt.Sprintf("；上限 %g", *t.Upper)
			}
			if t.Invalid != nil {
				detail += fmt.Sprintf("；无效值 %g", *t.Invalid)
			}
			checks = recordFinding(checks, finding{Key: key, Kind: t.Kind, Metric: name, Detail: detail, Since: c.Since, At: c.At, Active: c.Count >= t.Consecutive})
		}
		p.Counters[key] = c
	}
	return checks
}

func recordFinding(items []finding, f finding) []finding {
	if n := len(items); n > 0 && items[n-1].Key == f.Key && items[n-1].Active == f.Active {
		items[n-1] = f
		return items
	}
	return append(items, f)
}

func (s *Service) runtimeChecks(ctx context.Context, t target, templates []Template, p *progress, now time.Time) ([]finding, error) {
	needs := false
	for _, rule := range templates {
		needs = needs || rule.Enabled && rule.Family == "thcpn" && (rule.Code == "device_battery" || rule.Code == "device_signal")
	}
	if !needs {
		return nil, nil
	}
	result, err := s.Sources.THCPN.THCPNDeviceRuntime(ctx, []uuid.UUID{t.ID})
	if err != nil {
		return nil, err
	}
	if len(result.Items) != 1 || len(result.Failures) > 0 {
		return nil, fmt.Errorf("runtime attributes unavailable")
	}
	var checks []finding
	for _, item := range []struct{ code, unit, name string }{{"battery", "V", "设备电压"}, {"signal", "", "设备信号"}} {
		attr, ok := result.Items[0].Attributes[item.code]
		if !ok || attr.SampledAt.Before(t.Start) || attr.SampledAt.After(now) {
			continue
		}
		v, err := strconv.ParseFloat(strings.TrimSpace(attr.RawValue), 64)
		if err != nil {
			v, ok = attr.ParsedValue.(float64)
			if !ok {
				continue
			}
		}
		checks = append(checks, checkTemplates(p, templates, "thcpn", "device_"+item.code, item.unit, item.name, "runtime:"+item.code, map[time.Time]float64{attr.SampledAt.UTC(): v})...)
	}
	return checks, nil
}

func (s *Service) persist(ctx context.Context, id uuid.UUID, p progress, checks []finding, now time.Time, every time.Duration, scheduleKnown bool, issue string) error {
	body, err := json.Marshal(p)
	if err != nil {
		return err
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var latest *time.Time
	for _, v := range p.Latest {
		if latest == nil || v.After(*latest) {
			a := v
			latest = &a
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO device_inspection_state(device_id,next_check_at,checked_at,latest_sample_at,schedule_known,error,progress)
 VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(device_id) DO UPDATE SET next_check_at=EXCLUDED.next_check_at,checked_at=EXCLUDED.checked_at,
 latest_sample_at=EXCLUDED.latest_sample_at,schedule_known=EXCLUDED.schedule_known,error=EXCLUDED.error,progress=EXCLUDED.progress`, id, now.Add(every), now, latest, scheduleKnown, issue, body)
	if err != nil {
		return err
	}
	for _, f := range checks {
		if f.Active {
			_, err = tx.Exec(ctx, `INSERT INTO device_inspection_events(device_id,event_key,kind,metric,node_index,detail,started_at,last_seen_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(device_id,event_key) WHERE resolved_at IS NULL
 DO UPDATE SET last_seen_at=GREATEST(device_inspection_events.last_seen_at,EXCLUDED.last_seen_at),detail=EXCLUDED.detail`, id, f.Key, f.Kind, f.Metric, f.Node, f.Detail, f.Since, f.At)
		} else {
			_, err = tx.Exec(ctx, `UPDATE device_inspection_events SET resolved_at=GREATEST(started_at,$3) WHERE device_id=$1 AND event_key=$2 AND resolved_at IS NULL AND last_seen_at<$3`, id, f.Key, f.At)
		}
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func readUUIDs(rows interface {
	Next() bool
	Scan(...any) error
	Err() error
	Close()
}) ([]uuid.UUID, error) {
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
