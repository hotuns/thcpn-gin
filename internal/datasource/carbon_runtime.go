package datasource

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"thcpn-gin/internal/apperr"
)

var carbonLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

type CarbonOverview struct {
	DeviceID       uuid.UUID          `json:"device_id"`
	ExternalID     int64              `json:"external_device_id"`
	NodesCount     int                `json:"nodes_count"`
	Nodes          []CarbonNodeStatus `json:"nodes"`
	Status         string             `json:"status"`
	LatestSampleAt *time.Time         `json:"latest_sample_at,omitempty"`
	LatestFluxAt   *time.Time         `json:"latest_flux_at,omitempty"`
	RefreshedAt    time.Time          `json:"refreshed_at"`
	Runtime        *CarbonRuntimeInfo `json:"runtime,omitempty"`
}

type CarbonRuntimeInfo struct {
	Battery string `json:"battery,omitempty"`
	Signal  string `json:"signal,omitempty"`
	Network string `json:"network,omitempty"`
}

type CarbonNodeStatus struct {
	NodeID         int        `json:"node_id"`
	Status         string     `json:"status"`
	LatestSampleAt *time.Time `json:"latest_sample_at,omitempty"`
	LatestFluxAt   *time.Time `json:"latest_flux_at,omitempty"`
}

type CarbonFluxPoint struct {
	NodeID   int       `json:"node_id"`
	Period   string    `json:"period"`
	PeriodAt time.Time `json:"period_at"`
	Field    string    `json:"field"`
	NEE      *float64  `json:"nee,omitempty"`
	ER       *float64  `json:"er,omitempty"`
	GPP      *float64  `json:"gpp,omitempty"`
}

type CarbonFluxResponse struct {
	DeviceID uuid.UUID         `json:"device_id"`
	NodeID   int               `json:"node_id"`
	Field    string            `json:"field"`
	Start    time.Time         `json:"start"`
	End      time.Time         `json:"end"`
	Points   []CarbonFluxPoint `json:"points"`
}

type CarbonPeriodSummary struct {
	NodeID     int       `json:"node_id"`
	Period     string    `json:"period"`
	PeriodAt   time.Time `json:"period_at"`
	Fields     []string  `json:"fields"`
	FluxFields []string  `json:"flux_fields"`
}

type CarbonSensorSample struct {
	TS          time.Time `json:"ts"`
	CO2         *float64  `json:"co2,omitempty"`
	Temperature *float64  `json:"temperature,omitempty"`
	Humidity    *float64  `json:"humidity,omitempty"`
	TempL       *float64  `json:"temp_l,omitempty"`
	HumiL       *float64  `json:"humi_l,omitempty"`
	TempB       *float64  `json:"temp_b,omitempty"`
	HumiB       *float64  `json:"humi_b,omitempty"`
	STemp       *float64  `json:"stemp,omitempty"`
	SHumi       *float64  `json:"shumi,omitempty"`
}

type CarbonRawPhase struct {
	Room     string               `json:"room"`
	Field    string               `json:"field"`
	StartAt  time.Time            `json:"start_at"`
	EndAt    time.Time            `json:"end_at"`
	Samples  int                  `json:"samples"`
	Complete bool                 `json:"complete"`
	Points   []CarbonSensorSample `json:"points"`
}

type CarbonFluxFieldResult struct {
	Field string   `json:"field"`
	NEE   *float64 `json:"nee,omitempty"`
	ER    *float64 `json:"er,omitempty"`
	GPP   *float64 `json:"gpp,omitempty"`
}

type CarbonPeriodDetail struct {
	DeviceID   uuid.UUID              `json:"device_id"`
	ExternalID int64                  `json:"external_device_id"`
	NodeID     int                    `json:"node_id"`
	Period     string                 `json:"period"`
	PeriodAt   time.Time              `json:"period_at"`
	Field      string                 `json:"field"`
	Flux       *CarbonFluxFieldResult `json:"flux,omitempty"`
	Phases     []CarbonRawPhase       `json:"phases"`
	Warnings   []string               `json:"warnings,omitempty"`
}

type carbonDeviceSource struct {
	DataSourceID uuid.UUID
	ExternalID   int64
}

func (s *Service) CarbonOverview(ctx context.Context, deviceID uuid.UUID) (CarbonOverview, error) {
	sourceRef, db, err := s.openCarbonDeviceSource(ctx, deviceID)
	if err != nil {
		return CarbonOverview{}, err
	}
	defer db.Close()
	nodesCount, err := s.carbonNodesCount(ctx, deviceID)
	if err != nil {
		return CarbonOverview{}, err
	}
	now := time.Now().In(carbonLocation)
	windowStart := now.Add(-7 * 24 * time.Hour)
	months := carbonMonthNames(windowStart, now)
	dataTables, err := carbonExistingTables(ctx, db, "device_data_next", months)
	if err != nil {
		return CarbonOverview{}, err
	}
	fluxTables, err := carbonExistingTables(ctx, db, "carbon_flux", months)
	if err != nil {
		return CarbonOverview{}, err
	}
	latestSamples, err := carbonLatestNodeTimes(ctx, db, dataTables, sourceRef.ExternalID, windowStart, now)
	if err != nil {
		return CarbonOverview{}, err
	}
	latestFlux, err := carbonLatestNodeFluxTimes(ctx, db, fluxTables, sourceRef.ExternalID, windowStart, now)
	if err != nil {
		return CarbonOverview{}, err
	}
	information, err := readCarbonDeviceInformation(ctx, db, sourceRef.ExternalID)
	if err != nil {
		return CarbonOverview{}, err
	}
	nodes := make([]CarbonNodeStatus, 0, nodesCount)
	var overallSample, overallFlux *time.Time
	for nodeID := 1; nodeID <= nodesCount; nodeID++ {
		sample := latestSamples[nodeID]
		flux := latestFlux[nodeID]
		status := carbonNodeDataStatus(sample)
		nodes = append(nodes, CarbonNodeStatus{NodeID: nodeID, Status: status, LatestSampleAt: sample, LatestFluxAt: flux})
		overallSample = laterCarbonTime(overallSample, sample)
		overallFlux = laterCarbonTime(overallFlux, flux)
	}
	var runtime *CarbonRuntimeInfo
	if information != nil {
		runtime = &CarbonRuntimeInfo{Battery: information.Battery, Signal: information.Signal, Network: information.Network}
	}
	return CarbonOverview{DeviceID: deviceID, ExternalID: sourceRef.ExternalID, NodesCount: nodesCount, Nodes: nodes, Status: carbonOverallStatus(nodes), LatestSampleAt: overallSample, LatestFluxAt: overallFlux, RefreshedAt: now, Runtime: runtime}, nil
}

func carbonOverallStatus(nodes []CarbonNodeStatus) string {
	for _, node := range nodes {
		if node.Status == "has_data" {
			return "has_data"
		}
	}
	return "no_data"
}

func (s *Service) CarbonFlux(ctx context.Context, deviceID uuid.UUID, nodeID int, field string, start, end time.Time) (CarbonFluxResponse, error) {
	if nodeID <= 0 || strings.TrimSpace(field) == "" {
		return CarbonFluxResponse{}, apperr.New(apperr.KindInvalidArgument, "node_id and field are required")
	}
	if !end.After(start) {
		return CarbonFluxResponse{}, apperr.New(apperr.KindInvalidArgument, "end must be after start")
	}
	if err := s.validateDeviceHistory(ctx, deviceID, start); err != nil {
		return CarbonFluxResponse{}, err
	}
	ref, db, err := s.openCarbonDeviceSource(ctx, deviceID)
	if err != nil {
		return CarbonFluxResponse{}, err
	}
	defer db.Close()
	tables, err := carbonExistingTables(ctx, db, "carbon_flux", carbonMonthNames(start, end))
	if err != nil {
		return CarbonFluxResponse{}, err
	}
	points, err := queryCarbonFlux(ctx, db, tables, ref.ExternalID, nodeID, field, start, end)
	if err != nil {
		return CarbonFluxResponse{}, err
	}
	return CarbonFluxResponse{DeviceID: deviceID, NodeID: nodeID, Field: field, Start: start, End: end, Points: points}, nil
}

func (s *Service) CarbonPeriods(ctx context.Context, deviceID uuid.UUID, nodeID int, start, end time.Time) ([]CarbonPeriodSummary, error) {
	if err := s.validateDeviceHistory(ctx, deviceID, start); err != nil {
		return nil, err
	}
	if nodeID <= 0 || !end.After(start) {
		return nil, apperr.New(apperr.KindInvalidArgument, "node_id and valid time range are required")
	}
	ref, db, err := s.openCarbonDeviceSource(ctx, deviceID)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	dataTables, err := carbonExistingTables(ctx, db, "device_data_next", carbonMonthNames(start, end))
	if err != nil {
		return nil, err
	}
	fluxTables, err := carbonExistingTables(ctx, db, "carbon_flux", carbonMonthNames(start, end))
	if err != nil {
		return nil, err
	}
	periods, err := queryCarbonPeriodSummaries(ctx, db, dataTables, ref.ExternalID, nodeID, start, end)
	if err != nil {
		return nil, err
	}
	fluxFields, err := queryCarbonFluxFields(ctx, db, fluxTables, ref.ExternalID, nodeID, start, end)
	if err != nil {
		return nil, err
	}
	for i := range periods {
		periods[i].FluxFields = fluxFields[periods[i].Period]
	}
	return periods, nil
}

func (s *Service) CarbonPeriod(ctx context.Context, deviceID uuid.UUID, nodeID int, field, period string) (CarbonPeriodDetail, error) {
	if nodeID <= 0 || strings.TrimSpace(field) == "" || strings.TrimSpace(period) == "" {
		return CarbonPeriodDetail{}, apperr.New(apperr.KindInvalidArgument, "node_id, field and period are required")
	}
	ref, db, err := s.openCarbonDeviceSource(ctx, deviceID)
	if err != nil {
		return CarbonPeriodDetail{}, err
	}
	defer db.Close()
	periodAt, err := queryCarbonPeriodAt(ctx, db, ref.ExternalID, nodeID, field, period)
	if err != nil {
		return CarbonPeriodDetail{}, err
	}
	if err := s.validateDeviceHistory(ctx, deviceID, periodAt); err != nil {
		return CarbonPeriodDetail{}, err
	}
	months := carbonMonthNames(periodAt.AddDate(0, -1, 0), periodAt.AddDate(0, 1, 0))
	dataTables, err := carbonExistingTables(ctx, db, "device_data_next", months)
	if err != nil {
		return CarbonPeriodDetail{}, err
	}
	fluxTables, err := carbonExistingTables(ctx, db, "carbon_flux", months)
	if err != nil {
		return CarbonPeriodDetail{}, err
	}
	phases, err := queryCarbonRawPhases(ctx, db, dataTables, ref.ExternalID, nodeID, field, period)
	if err != nil {
		return CarbonPeriodDetail{}, err
	}
	flux, err := queryCarbonFluxField(ctx, db, fluxTables, ref.ExternalID, nodeID, field, period)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return CarbonPeriodDetail{}, err
	}
	warnings := make([]string, 0)
	if len(phases) < 2 {
		warnings = append(warnings, "原始采样缺少 light 或 black 阶段")
	}
	return CarbonPeriodDetail{DeviceID: deviceID, ExternalID: ref.ExternalID, NodeID: nodeID, Period: period, PeriodAt: periodAt, Field: field, Flux: flux, Phases: phases, Warnings: warnings}, nil
}

func (s *Service) openCarbonDeviceSource(ctx context.Context, deviceID uuid.UUID) (carbonDeviceSource, *sql.DB, error) {
	if deviceID == uuid.Nil {
		return carbonDeviceSource{}, nil, apperr.New(apperr.KindInvalidArgument, "device_id is required")
	}
	var ref carbonDeviceSource
	err := s.db.QueryRow(ctx, `SELECT data_source_id, external_device_id FROM device_source_refs WHERE device_id=$1 AND adapter_code=$2 AND status='active'`, deviceID, AdapterCarbonSink).Scan(&ref.DataSourceID, &ref.ExternalID)
	if errors.Is(err, pgx.ErrNoRows) {
		return carbonDeviceSource{}, nil, apperr.New(apperr.KindNotFound, "carbon source reference not found")
	}
	if err != nil {
		return carbonDeviceSource{}, nil, apperr.Wrap(apperr.KindInternal, "read carbon source reference", err)
	}
	source, err := s.queries.GetDataSource(ctx, ref.DataSourceID)
	if err != nil {
		return carbonDeviceSource{}, nil, mapNotFoundOrInternal(err, "carbon data source not found")
	}
	db, err := NewRuntime(nil).openMySQLDatabase(ctx, dataSourceFromSQL(source), carbonDatabaseName)
	if err != nil {
		return carbonDeviceSource{}, nil, err
	}
	return ref, db, nil
}

func (s *Service) carbonNodesCount(ctx context.Context, deviceID uuid.UUID) (int, error) {
	var value float64
	err := s.db.QueryRow(ctx, `SELECT value_json::text::double precision FROM device_metadata WHERE device_id=$1 AND key='carbon_nodes_count'`, deviceID).Scan(&value)
	if errors.Is(err, pgx.ErrNoRows) {
		return 1, nil
	}
	if err != nil {
		return 0, apperr.Wrap(apperr.KindInternal, "read carbon nodes count", err)
	}
	if value < 0 || value > 10000 || math.Trunc(value) != value {
		return 0, apperr.New(apperr.KindInternal, "invalid carbon nodes count")
	}
	return int(value), nil
}

func carbonNodeDataStatus(last *time.Time) string {
	if last == nil {
		return "no_data"
	}
	return "has_data"
}

func laterCarbonTime(current, candidate *time.Time) *time.Time {
	if candidate == nil || (current != nil && !candidate.After(*current)) {
		return current
	}
	copy := *candidate
	return &copy
}

func carbonMonthNames(start, end time.Time) []string {
	location := carbonLocation
	start = start.In(location).AddDate(0, -1, 0)
	end = end.In(location).AddDate(0, 1, 0)
	first := time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, location)
	last := time.Date(end.Year(), end.Month(), 1, 0, 0, 0, 0, location)
	result := make([]string, 0, 4)
	for cursor := first; !cursor.After(last); cursor = cursor.AddDate(0, 1, 0) {
		result = append(result, cursor.Format("200601"))
	}
	return result
}

func carbonExistingTables(ctx context.Context, db *sql.DB, prefix string, months []string) ([]string, error) {
	if len(months) == 0 {
		return nil, nil
	}
	rows, err := db.QueryContext(ctx, `SELECT table_name FROM information_schema.tables WHERE table_schema=? AND table_name LIKE ?`, carbonDatabaseName, prefix+`_%`)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "list carbon shard tables", err)
	}
	defer rows.Close()
	wanted := make(map[string]struct{}, len(months))
	for _, month := range months {
		wanted[prefix+"_"+month] = struct{}{}
	}
	result := make([]string, 0, len(months))
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "scan carbon shard table", err)
		}
		if _, ok := wanted[table]; ok {
			result = append(result, table)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read carbon shard tables", err)
	}
	return result, nil
}

func carbonLatestNodeTimes(ctx context.Context, db *sql.DB, tables []string, deviceID int64, start, end time.Time) (map[int]*time.Time, error) {
	result := make(map[int]*time.Time)
	for _, table := range tables {
		rows, err := db.QueryContext(ctx, "SELECT node_id, MAX(ts) FROM `"+table+"` WHERE device_id=? AND ts>=? AND ts<=? AND deleted_at IS NULL AND type='data' GROUP BY node_id", deviceID, start, end)
		if err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "read carbon latest node samples", err)
		}
		for rows.Next() {
			var nodeID int
			var ts time.Time
			if err := rows.Scan(&nodeID, &ts); err != nil {
				rows.Close()
				return nil, apperr.Wrap(apperr.KindDataSource, "scan carbon latest node sample", err)
			}
			value := carbonWallTime(ts)
			result[nodeID] = laterCarbonTime(result[nodeID], &value)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, apperr.Wrap(apperr.KindDataSource, "read carbon latest node samples", err)
		}
		rows.Close()
	}
	return result, nil
}

func carbonLatestNodeFluxTimes(ctx context.Context, db *sql.DB, tables []string, deviceID int64, start, end time.Time) (map[int]*time.Time, error) {
	result := make(map[int]*time.Time)
	for _, table := range tables {
		rows, err := db.QueryContext(ctx, "SELECT node_id, MAX(period_at) FROM `"+table+"` WHERE device_id=? AND period_at>=? AND period_at<=? AND deleted_at IS NULL GROUP BY node_id", deviceID, start, end)
		if err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "read carbon latest flux", err)
		}
		for rows.Next() {
			var nodeID int
			var at time.Time
			if err := rows.Scan(&nodeID, &at); err != nil {
				rows.Close()
				return nil, apperr.Wrap(apperr.KindDataSource, "scan carbon latest flux", err)
			}
			value := carbonWallTime(at)
			result[nodeID] = laterCarbonTime(result[nodeID], &value)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, apperr.Wrap(apperr.KindDataSource, "read carbon latest flux", err)
		}
		rows.Close()
	}
	return result, nil
}

func queryCarbonFlux(ctx context.Context, db *sql.DB, tables []string, deviceID int64, nodeID int, field string, start, end time.Time) ([]CarbonFluxPoint, error) {
	if len(tables) == 0 {
		return []CarbonFluxPoint{}, nil
	}
	parts := make([]string, 0, len(tables))
	args := make([]any, 0, len(tables)*4)
	for _, table := range tables {
		parts = append(parts, "SELECT node_id, period, period_at, data FROM `"+table+"` WHERE device_id=? AND node_id=? AND period_at>=? AND period_at<=? AND deleted_at IS NULL")
		args = append(args, deviceID, nodeID, start, end)
	}
	rows, err := db.QueryContext(ctx, strings.Join(parts, " UNION ALL ")+" ORDER BY period_at, period", args...)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "query carbon flux", err)
	}
	defer rows.Close()
	result := make([]CarbonFluxPoint, 0)
	seen := make(map[string]struct{})
	for rows.Next() {
		var point CarbonFluxPoint
		var at time.Time
		var raw []byte
		if err := rows.Scan(&point.NodeID, &point.Period, &at, &raw); err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "scan carbon flux", err)
		}
		point.PeriodAt = carbonWallTime(at)
		items, err := decodeCarbonFlux(raw)
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			if !strings.EqualFold(strings.TrimSpace(item.Field), strings.TrimSpace(field)) {
				continue
			}
			key := point.Period + ":" + strings.ToUpper(strings.TrimSpace(item.Field))
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			point.Field, point.NEE, point.ER, point.GPP = item.Field, item.NEE, item.ER, item.GPP
			result = append(result, point)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read carbon flux", err)
	}
	return result, nil
}

type carbonFluxJSONItem struct {
	Field string   `json:"field"`
	NEE   *float64 `json:"nee"`
	ER    *float64 `json:"er"`
	GPP   *float64 `json:"gpp"`
}

func decodeCarbonFlux(raw []byte) ([]carbonFluxJSONItem, error) {
	var items []carbonFluxJSONItem
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "decode carbon flux data", err)
	}
	return items, nil
}

func queryCarbonFluxFields(ctx context.Context, db *sql.DB, tables []string, deviceID int64, nodeID int, start, end time.Time) (map[string][]string, error) {
	result := make(map[string][]string)
	if len(tables) == 0 {
		return result, nil
	}
	parts := make([]string, 0, len(tables))
	args := make([]any, 0, len(tables)*4)
	for _, table := range tables {
		parts = append(parts, "SELECT period, data FROM `"+table+"` WHERE device_id=? AND node_id=? AND period_at>=? AND period_at<=? AND deleted_at IS NULL")
		args = append(args, deviceID, nodeID, start, end)
	}
	rows, err := db.QueryContext(ctx, strings.Join(parts, " UNION ALL "), args...)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "query carbon flux fields", err)
	}
	defer rows.Close()
	seen := make(map[string]map[string]struct{})
	for rows.Next() {
		var period string
		var raw []byte
		if err := rows.Scan(&period, &raw); err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "scan carbon flux fields", err)
		}
		items, err := decodeCarbonFlux(raw)
		if err != nil {
			return nil, err
		}
		if seen[period] == nil {
			seen[period] = make(map[string]struct{})
		}
		for _, item := range items {
			field := strings.TrimSpace(item.Field)
			if field == "" {
				continue
			}
			if _, ok := seen[period][field]; ok {
				continue
			}
			seen[period][field] = struct{}{}
			result[period] = append(result[period], field)
		}
	}
	return result, rows.Err()
}

func queryCarbonPeriodSummaries(ctx context.Context, db *sql.DB, tables []string, deviceID int64, nodeID int, start, end time.Time) ([]CarbonPeriodSummary, error) {
	result := make([]CarbonPeriodSummary, 0)
	if len(tables) == 0 {
		return result, nil
	}
	parts := make([]string, 0, len(tables))
	args := make([]any, 0, len(tables)*4)
	for _, table := range tables {
		parts = append(parts, "SELECT period, period_at, field FROM `"+table+"` WHERE device_id=? AND node_id=? AND period_at>=? AND period_at<=? AND deleted_at IS NULL AND type='data'")
		args = append(args, deviceID, nodeID, start, end)
	}
	rows, err := db.QueryContext(ctx, strings.Join(parts, " UNION ALL ")+" ORDER BY period_at DESC, period", args...)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "query carbon periods", err)
	}
	defer rows.Close()
	byPeriod := make(map[string]*CarbonPeriodSummary)
	fieldSeen := make(map[string]map[string]struct{})
	for rows.Next() {
		var period, field string
		var at time.Time
		if err := rows.Scan(&period, &at, &field); err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "scan carbon period", err)
		}
		item := byPeriod[period]
		if item == nil {
			value := CarbonPeriodSummary{NodeID: nodeID, Period: period, PeriodAt: carbonWallTime(at), Fields: []string{}}
			byPeriod[period] = &value
			fieldSeen[period] = make(map[string]struct{})
			item = &value
			result = append(result, value)
		}
		field = strings.TrimSpace(field)
		if field != "" {
			if _, ok := fieldSeen[period][field]; !ok {
				item.Fields = append(item.Fields, field)
				fieldSeen[period][field] = struct{}{}
			}
		}
	}
	for i := range result {
		if item := byPeriod[result[i].Period]; item != nil {
			result[i] = *item
		}
	}
	return result, rows.Err()
}

func queryCarbonPeriodAt(ctx context.Context, db *sql.DB, deviceID int64, nodeID int, field, period string) (time.Time, error) {
	months := carbonMonthNames(time.Now().In(carbonLocation).AddDate(0, -18, 0), time.Now().In(carbonLocation).AddDate(0, 1, 0))
	tables, err := carbonExistingTables(ctx, db, "device_data_next", months)
	if err != nil {
		return time.Time{}, err
	}
	for _, table := range tables {
		var at time.Time
		err := db.QueryRowContext(ctx, "SELECT period_at FROM `"+table+"` WHERE device_id=? AND node_id=? AND field=? AND period=? AND deleted_at IS NULL ORDER BY ts LIMIT 1", deviceID, nodeID, field, period).Scan(&at)
		if err == nil {
			return carbonWallTime(at), nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return time.Time{}, apperr.Wrap(apperr.KindDataSource, "read carbon period time", err)
		}
	}
	return time.Time{}, apperr.New(apperr.KindNotFound, "carbon period not found")
}

func queryCarbonRawPhases(ctx context.Context, db *sql.DB, tables []string, deviceID int64, nodeID int, field, period string) ([]CarbonRawPhase, error) {
	result := make(map[string]*CarbonRawPhase)
	for _, table := range tables {
		rows, err := db.QueryContext(ctx, "SELECT room, ts, data FROM `"+table+"` WHERE device_id=? AND node_id=? AND field=? AND period=? AND deleted_at IS NULL AND type='data' ORDER BY ts", deviceID, nodeID, field, period)
		if err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "query carbon raw phase", err)
		}
		for rows.Next() {
			var room string
			var ts time.Time
			var raw []byte
			if err := rows.Scan(&room, &ts, &raw); err != nil {
				rows.Close()
				return nil, apperr.Wrap(apperr.KindDataSource, "scan carbon raw sample", err)
			}
			sample := decodeCarbonSample(raw, carbonWallTime(ts), room)
			phase := result[room]
			if phase == nil {
				phase = &CarbonRawPhase{Room: room, Field: field, StartAt: sample.TS, EndAt: sample.TS, Points: []CarbonSensorSample{}}
				result[room] = phase
			}
			phase.Points = append(phase.Points, sample)
			if sample.TS.Before(phase.StartAt) {
				phase.StartAt = sample.TS
			}
			if sample.TS.After(phase.EndAt) {
				phase.EndAt = sample.TS
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, apperr.Wrap(apperr.KindDataSource, "read carbon raw phase", err)
		}
		rows.Close()
	}
	resultList := make([]CarbonRawPhase, 0, len(result))
	for _, phase := range result {
		phase.Samples = len(phase.Points)
		phase.Complete = phase.Samples > 0
		resultList = append(resultList, *phase)
	}
	if light := result["light"]; light == nil {
		resultList = append(resultList, CarbonRawPhase{Room: "light", Field: field, Points: []CarbonSensorSample{}, Complete: false})
	}
	if black := result["black"]; black == nil {
		resultList = append(resultList, CarbonRawPhase{Room: "black", Field: field, Points: []CarbonSensorSample{}, Complete: false})
	}
	if len(resultList) > 1 && resultList[0].Room == "black" {
		resultList[0], resultList[1] = resultList[1], resultList[0]
	}
	return resultList, nil
}

func queryCarbonFluxField(ctx context.Context, db *sql.DB, tables []string, deviceID int64, nodeID int, field, period string) (*CarbonFluxFieldResult, error) {
	for _, table := range tables {
		var raw []byte
		err := db.QueryRowContext(ctx, "SELECT data FROM `"+table+"` WHERE device_id=? AND node_id=? AND period=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1", deviceID, nodeID, period).Scan(&raw)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "read carbon period flux", err)
		}
		items, err := decodeCarbonFlux(raw)
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			if strings.EqualFold(strings.TrimSpace(item.Field), strings.TrimSpace(field)) {
				return &CarbonFluxFieldResult{Field: item.Field, NEE: item.NEE, ER: item.ER, GPP: item.GPP}, nil
			}
		}
	}
	return nil, sql.ErrNoRows
}

type carbonDataItem struct {
	Key  string `json:"key"`
	Data any    `json:"data"`
}

func decodeCarbonSample(raw []byte, ts time.Time, room string) CarbonSensorSample {
	var items []carbonDataItem
	_ = json.Unmarshal(raw, &items)
	values := make(map[string]*float64, len(items))
	for _, item := range items {
		if value, ok := carbonNumber(item.Data); ok {
			values[item.Key] = &value
		}
	}
	point := CarbonSensorSample{TS: ts, CO2: values["CO2"], TempL: values["tempL"], HumiL: values["humiL"], TempB: values["tempB"], HumiB: values["humiB"], STemp: values["stemp"], SHumi: values["shumi"]}
	if room == "black" {
		point.Temperature = point.TempB
		point.Humidity = point.HumiB
	} else {
		point.Temperature = point.TempL
		point.Humidity = point.HumiL
	}
	return point
}

func carbonNumber(value any) (float64, bool) {
	switch value := value.(type) {
	case float64:
		return value, !math.IsNaN(value) && !math.IsInf(value, 0)
	case float32:
		return float64(value), true
	case int:
		return float64(value), true
	case json.Number:
		parsed, err := value.Float64()
		return parsed, err == nil
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func carbonWallTime(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), value.Day(), value.Hour(), value.Minute(), value.Second(), value.Nanosecond(), carbonLocation)
}
