package datasource

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

const (
	thcpnAttributeTablePrefix = "device_attribute_"
	thcpnLogTablePrefix       = "device_log_"
	thcpnAttributeLookback    = 3
	maxTHCPNLogPageSize       = 200
	maxTHCPNLogRangeDays      = 366
)

var (
	thcpnAttributeTablePattern = regexp.MustCompile(`^device_attribute_[0-9]{6}$`)
	thcpnLogTablePattern       = regexp.MustCompile(`^device_log_[0-9]{6}$`)
)

type THCPNAttributeValue struct {
	RawValue    string    `json:"raw_value"`
	ParsedValue any       `json:"parsed_value,omitempty"`
	SampledAt   time.Time `json:"sampled_at"`
	SourceTable string    `json:"source_table"`
}

type THCPNLatestAttributesResponse struct {
	DeviceID         uuid.UUID                      `json:"device_id"`
	ExternalDeviceID int64                          `json:"external_device_id"`
	Attributes       map[string]THCPNAttributeValue `json:"attributes"`
	RefreshedAt      time.Time                      `json:"refreshed_at"`
}

type THCPNDeviceLog struct {
	ID        int64      `json:"id"`
	UUID      string     `json:"uuid"`
	Path      string     `json:"path"`
	FileName  string     `json:"file_name"`
	Date      time.Time  `json:"date"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt *time.Time `json:"updated_at,omitempty"`
}

type THCPNDeviceLogListInput struct {
	DeviceID uuid.UUID
	Start    time.Time
	End      time.Time
	Keyword  string
	Page     int
	PageSize int
}

type THCPNDeviceLogListResponse struct {
	Items    []THCPNDeviceLog `json:"items"`
	Total    int              `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"page_size"`
}

func (s *Service) LatestTHCPNDeviceAttributes(ctx context.Context, deviceID uuid.UUID) (THCPNLatestAttributesResponse, error) {
	db, ref, err := s.openTHCPNDevice(ctx, deviceID)
	if err != nil {
		return THCPNLatestAttributesResponse{}, err
	}
	defer db.Close()

	tables, err := existingTHCPNTables(ctx, db, thcpnAttributeTablePrefix)
	if err != nil {
		return THCPNLatestAttributesResponse{}, err
	}
	attributes := make(map[string]THCPNAttributeValue, 3)
	now := time.Now().UTC()
	for _, attribute := range []string{"battery", "signal", "ext_info"} {
		for offset := 0; offset < thcpnAttributeLookback; offset++ {
			month := now.AddDate(0, -offset, 0)
			table := monthTable(thcpnAttributeTablePrefix, month)
			if !thcpnAttributeTablePattern.MatchString(table) || !tables[table] {
				continue
			}
			value, found, err := queryLatestTHCPNAttribute(ctx, db, table, ref.ExternalDeviceID, attribute)
			if err != nil {
				return THCPNLatestAttributesResponse{}, err
			}
			if found {
				attributes[attribute] = value
				break
			}
		}
	}
	return THCPNLatestAttributesResponse{
		DeviceID:         deviceID,
		ExternalDeviceID: ref.ExternalDeviceID,
		Attributes:       attributes,
		RefreshedAt:      time.Now().UTC(),
	}, nil
}

func (s *Service) ListTHCPNDeviceLogs(ctx context.Context, input THCPNDeviceLogListInput) (THCPNDeviceLogListResponse, error) {
	if input.DeviceID == uuid.Nil {
		return THCPNDeviceLogListResponse{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}
	start, end, err := normalizeLogRange(input.Start, input.End)
	if err != nil {
		return THCPNDeviceLogListResponse{}, err
	}
	page := input.Page
	if page <= 0 {
		page = 1
	}
	pageSize := input.PageSize
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > maxTHCPNLogPageSize {
		pageSize = maxTHCPNLogPageSize
	}

	db, ref, err := s.openTHCPNDevice(ctx, input.DeviceID)
	if err != nil {
		return THCPNDeviceLogListResponse{}, err
	}
	defer db.Close()
	tables, err := existingTHCPNTables(ctx, db, thcpnLogTablePrefix)
	if err != nil {
		return THCPNDeviceLogListResponse{}, err
	}
	months := monthsBetween(start, end)
	selected := make([]string, 0, len(months))
	for _, month := range months {
		table := monthTable(thcpnLogTablePrefix, month)
		if thcpnLogTablePattern.MatchString(table) && tables[table] {
			selected = append(selected, table)
		}
	}
	if len(selected) == 0 {
		return THCPNDeviceLogListResponse{Items: []THCPNDeviceLog{}, Page: page, PageSize: pageSize}, nil
	}

	union, args := buildLogUnion(selected, ref.ExternalDeviceID, start, end, input.Keyword)
	var total int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM ("+union+") AS device_logs", args...).Scan(&total); err != nil {
		return THCPNDeviceLogListResponse{}, apperr.Wrap(apperr.KindDataSource, "count thcpn device logs", err)
	}
	offset := (page - 1) * pageSize
	queryArgs := append(append([]any{}, args...), pageSize, offset)
	rows, err := db.QueryContext(ctx, union+" ORDER BY log_date DESC, created_at DESC, id DESC LIMIT ? OFFSET ?", queryArgs...)
	if err != nil {
		return THCPNDeviceLogListResponse{}, apperr.Wrap(apperr.KindDataSource, "list thcpn device logs", err)
	}
	defer rows.Close()
	items := make([]THCPNDeviceLog, 0, pageSize)
	for rows.Next() {
		item, err := scanTHCPNDeviceLog(rows)
		if err != nil {
			return THCPNDeviceLogListResponse{}, apperr.Wrap(apperr.KindDataSource, "scan thcpn device log", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return THCPNDeviceLogListResponse{}, apperr.Wrap(apperr.KindDataSource, "read thcpn device logs", err)
	}
	return THCPNDeviceLogListResponse{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *Service) GetTHCPNDeviceLog(ctx context.Context, deviceID uuid.UUID, logUUID string) (THCPNDeviceLog, error) {
	if deviceID == uuid.Nil {
		return THCPNDeviceLog{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}
	logUUID = strings.TrimSpace(logUUID)
	if logUUID == "" {
		return THCPNDeviceLog{}, apperr.New(apperr.KindInvalidArgument, "log uuid is required")
	}
	db, ref, err := s.openTHCPNDevice(ctx, deviceID)
	if err != nil {
		return THCPNDeviceLog{}, err
	}
	defer db.Close()
	tables, err := existingTHCPNTables(ctx, db, thcpnLogTablePrefix)
	if err != nil {
		return THCPNDeviceLog{}, err
	}
	available := make([]string, 0, len(tables))
	for table := range tables {
		if thcpnLogTablePattern.MatchString(table) {
			available = append(available, table)
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(available)))
	for _, table := range available {
		rows, err := db.QueryContext(ctx, "SELECT id, device, path, date, created_at, updated_at, uuid FROM `"+table+"` WHERE device = ? AND uuid = ? AND deleted_at IS NULL LIMIT 1", ref.ExternalDeviceID, logUUID)
		if err != nil {
			return THCPNDeviceLog{}, apperr.Wrap(apperr.KindDataSource, "get thcpn device log", err)
		}
		if rows.Next() {
			item, scanErr := scanTHCPNDeviceLog(rows)
			rows.Close()
			if scanErr != nil {
				return THCPNDeviceLog{}, apperr.Wrap(apperr.KindDataSource, "scan thcpn device log", scanErr)
			}
			return item, nil
		}
		rows.Close()
	}
	return THCPNDeviceLog{}, apperr.New(apperr.KindNotFound, "thcpn device log not found")
}

func (s *Service) openTHCPNDevice(ctx context.Context, deviceID uuid.UUID) (*sql.DB, DeviceSourceRef, error) {
	if s == nil || s.db == nil {
		return nil, DeviceSourceRef{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	refRow, err := s.queries.GetActiveTHCPNDeviceSourceRefByDevice(ctx, deviceID)
	if err != nil {
		return nil, DeviceSourceRef{}, mapNotFoundOrInternal(err, "thcpn device source ref not found")
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, refRow.DataSourceID)
	if err != nil {
		return nil, DeviceSourceRef{}, err
	}
	db, err := NewRuntime(nil).openMySQL(ctx, dataSourceFromSQL(source))
	if err != nil {
		return nil, DeviceSourceRef{}, err
	}
	return db, deviceSourceRefFromSQL(refRow), nil
}

func queryLatestTHCPNAttribute(ctx context.Context, db *sql.DB, table string, deviceID int64, attribute string) (THCPNAttributeValue, bool, error) {
	var raw string
	var sampledAt time.Time
	var extra []byte
	err := db.QueryRowContext(ctx, "SELECT value, ts, extra FROM `"+table+"` WHERE device_id = ? AND attribute = ? AND deleted_at IS NULL ORDER BY ts DESC, id DESC LIMIT 1", deviceID, attribute).Scan(&raw, &sampledAt, &extra)
	if err != nil {
		if err == sql.ErrNoRows {
			return THCPNAttributeValue{}, false, nil
		}
		return THCPNAttributeValue{}, false, apperr.Wrap(apperr.KindDataSource, "query thcpn device attribute", err)
	}
	result := THCPNAttributeValue{RawValue: raw, SampledAt: sampledAt.UTC(), SourceTable: table}
	if attribute == "ext_info" {
		var parsed any
		if json.Unmarshal([]byte(raw), &parsed) == nil {
			result.ParsedValue = parsed
		} else if len(extra) > 0 {
			var envelope map[string]any
			if json.Unmarshal(extra, &envelope) == nil {
				result.ParsedValue = envelope[attribute]
			}
		}
	} else if number, err := strconv.ParseFloat(strings.TrimSpace(raw), 64); err == nil {
		result.ParsedValue = number
	}
	return result, true, nil
}

func existingTHCPNTables(ctx context.Context, db *sql.DB, prefix string) (map[string]bool, error) {
	rows, err := db.QueryContext(ctx, "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE ?", prefix+"%")
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "list thcpn monthly tables", err)
	}
	defer rows.Close()
	result := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "scan thcpn monthly table", err)
		}
		result[name] = true
	}
	if err := rows.Err(); err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read thcpn monthly tables", err)
	}
	return result, nil
}

func buildLogUnion(tables []string, deviceID int64, start, end time.Time, keyword string) (string, []any) {
	parts := make([]string, 0, len(tables))
	args := make([]any, 0, len(tables)*4)
	keyword = strings.TrimSpace(keyword)
	for _, table := range tables {
		where := "device = ? AND date >= ? AND date < ? AND deleted_at IS NULL"
		args = append(args, deviceID, start.Format("2006-01-02"), end.Format("2006-01-02"))
		if keyword != "" {
			where += " AND (path LIKE ? OR uuid LIKE ?)"
			like := "%" + keyword + "%"
			args = append(args, like, like)
		}
		parts = append(parts, "SELECT id, device, path, date AS log_date, created_at, updated_at, uuid FROM `"+table+"` WHERE "+where)
	}
	return strings.Join(parts, " UNION ALL "), args
}

func scanTHCPNDeviceLog(scanner interface{ Scan(...any) error }) (THCPNDeviceLog, error) {
	var item THCPNDeviceLog
	var device int64
	var date time.Time
	var updated sql.NullTime
	if err := scanner.Scan(&item.ID, &device, &item.Path, &date, &item.CreatedAt, &updated, &item.UUID); err != nil {
		return THCPNDeviceLog{}, err
	}
	item.Date = date.UTC()
	item.CreatedAt = item.CreatedAt.UTC()
	if updated.Valid {
		value := updated.Time.UTC()
		item.UpdatedAt = &value
	}
	item.FileName = path.Base(item.Path)
	return item, nil
}

func normalizeLogRange(start, end time.Time) (time.Time, time.Time, error) {
	if start.IsZero() {
		start = time.Now().UTC().AddDate(0, 0, -30)
	}
	if end.IsZero() {
		end = time.Now().UTC()
	}
	start = time.Date(start.UTC().Year(), start.UTC().Month(), start.UTC().Day(), 0, 0, 0, 0, time.UTC)
	end = time.Date(end.UTC().Year(), end.UTC().Month(), end.UTC().Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, 1)
	if !start.Before(end) {
		return time.Time{}, time.Time{}, apperr.New(apperr.KindInvalidArgument, "log start must be before end")
	}
	if end.Sub(start) > maxTHCPNLogRangeDays*24*time.Hour {
		return time.Time{}, time.Time{}, apperr.New(apperr.KindInvalidArgument, "log date range cannot exceed 366 days")
	}
	return start, end, nil
}

func monthsBetween(start, end time.Time) []time.Time {
	current := time.Date(start.UTC().Year(), start.UTC().Month(), 1, 0, 0, 0, 0, time.UTC)
	last := time.Date(end.UTC().Year(), end.UTC().Month(), 1, 0, 0, 0, 0, time.UTC)
	months := make([]time.Time, 0, 12)
	for !current.After(last) {
		months = append(months, current)
		current = current.AddDate(0, 1, 0)
	}
	return months
}

func monthTable(prefix string, month time.Time) string {
	return fmt.Sprintf("%s%04d%02d", prefix, month.UTC().Year(), month.UTC().Month())
}
