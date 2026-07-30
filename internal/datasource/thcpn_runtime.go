package datasource

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

const maxTHCPNRuntimeDevices = 200

type THCPNDeviceRuntimeFailure struct {
	DeviceID uuid.UUID `json:"device_id"`
	Error    string    `json:"error"`
}

type THCPNDeviceRuntimeBatchResponse struct {
	Items       []THCPNLatestAttributesResponse `json:"items"`
	Failures    []THCPNDeviceRuntimeFailure     `json:"failures"`
	RefreshedAt time.Time                       `json:"refreshed_at"`
}

// THCPNDeviceRuntime reads source-owned device fields without persisting them
// in the platform database. Failures are isolated by source/device.
func (s *Service) THCPNDeviceRuntime(ctx context.Context, deviceIDs []uuid.UUID) (THCPNDeviceRuntimeBatchResponse, error) {
	result := THCPNDeviceRuntimeBatchResponse{
		Items:       []THCPNLatestAttributesResponse{},
		Failures:    []THCPNDeviceRuntimeFailure{},
		RefreshedAt: time.Now().UTC(),
	}
	deviceIDs = uniqueUUIDs(deviceIDs)
	if len(deviceIDs) == 0 {
		return result, nil
	}
	if len(deviceIDs) > maxTHCPNRuntimeDevices {
		return result, apperr.New(apperr.KindInvalidArgument, "at most 200 device ids are allowed")
	}

	refs, err := s.runtimeRefs(ctx, deviceIDs)
	if err != nil {
		return result, err
	}
	seen := make(map[uuid.UUID]bool, len(refs))
	refsBySource := make(map[uuid.UUID][]thcpnLocationRef)
	for _, ref := range refs {
		seen[ref.DeviceID] = true
		refsBySource[ref.DataSourceID] = append(refsBySource[ref.DataSourceID], ref)
	}
	for _, deviceID := range deviceIDs {
		if !seen[deviceID] {
			result.Failures = append(result.Failures, THCPNDeviceRuntimeFailure{DeviceID: deviceID, Error: "active THCPN source reference not found"})
		}
	}

	for sourceID, sourceRefs := range refsBySource {
		source, err := s.loadTHCPNSyncDataSource(ctx, sourceID)
		if err != nil {
			appendRuntimeFailures(&result, sourceRefs, apperr.MessageOf(err))
			continue
		}
		db, err := NewRuntime(nil).openMySQL(ctx, dataSourceFromSQL(source))
		if err != nil {
			appendRuntimeFailures(&result, sourceRefs, apperr.MessageOf(err))
			continue
		}
		items, failures := readTHCPNRuntimeSource(ctx, db, sourceRefs, result.RefreshedAt)
		db.Close()
		result.Items = append(result.Items, items...)
		result.Failures = append(result.Failures, failures...)
	}
	return result, nil
}

func (s *Service) runtimeRefs(ctx context.Context, deviceIDs []uuid.UUID) ([]thcpnLocationRef, error) {
	rows, err := s.db.Query(ctx, `
SELECT device_id, data_source_id, external_device_id
FROM device_source_refs
WHERE status='active' AND adapter_code=$1 AND device_id=ANY($2::uuid[])`, AdapterTHCPNLegacy, deviceIDs)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list device runtime sources", err)
	}
	defer rows.Close()
	result := make([]thcpnLocationRef, 0, len(deviceIDs))
	for rows.Next() {
		var ref thcpnLocationRef
		if err := rows.Scan(&ref.DeviceID, &ref.DataSourceID, &ref.ExternalDeviceID); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan device runtime source", err)
		}
		result = append(result, ref)
	}
	if err := rows.Err(); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "read device runtime sources", err)
	}
	return result, nil
}

func readTHCPNRuntimeSource(ctx context.Context, db *sql.DB, refs []thcpnLocationRef, refreshedAt time.Time) ([]THCPNLatestAttributesResponse, []THCPNDeviceRuntimeFailure) {
	devices, err := readTHCPNRuntimeDevices(ctx, db, refs)
	if err != nil {
		failures := make([]THCPNDeviceRuntimeFailure, 0, len(refs))
		for _, ref := range refs {
			failures = append(failures, THCPNDeviceRuntimeFailure{DeviceID: ref.DeviceID, Error: apperr.MessageOf(err)})
		}
		return nil, failures
	}
	attributes, attributeErr := readTHCPNRuntimeAttributes(ctx, db, refs)
	items := make([]THCPNLatestAttributesResponse, 0, len(refs))
	failures := make([]THCPNDeviceRuntimeFailure, 0)
	for _, ref := range refs {
		sourceDevice, ok := devices[ref.ExternalDeviceID]
		if !ok {
			failures = append(failures, THCPNDeviceRuntimeFailure{DeviceID: ref.DeviceID, Error: "source device not found"})
			continue
		}
		itemAttributes := attributes[ref.ExternalDeviceID]
		if itemAttributes == nil {
			itemAttributes = map[string]THCPNAttributeValue{}
		}
		items = append(items, THCPNLatestAttributesResponse{
			DeviceID: ref.DeviceID, ExternalDeviceID: ref.ExternalDeviceID,
			SourceDevice: sourceDevice, Attributes: itemAttributes, RefreshedAt: refreshedAt,
		})
	}
	if attributeErr != nil {
		for _, ref := range refs {
			failures = append(failures, THCPNDeviceRuntimeFailure{DeviceID: ref.DeviceID, Error: "latest attributes: " + apperr.MessageOf(attributeErr)})
		}
	}
	return items, failures
}

func readTHCPNRuntimeDevices(ctx context.Context, db *sql.DB, refs []thcpnLocationRef) (map[int64]THCPNExternalDeviceMetadata, error) {
	placeholders, args := runtimePlaceholders(refs)
	query := `SELECT id, COALESCE(name, ''), CAST(iccid AS CHAR), CAST(version AS CHAR), CAST(status AS CHAR),
CAST(device_type AS CHAR), active, CAST(sn AS CHAR), CAST(uuid AS CHAR), CAST(current_device_version AS CHAR),
lat, lon, alt, created_at, updated_at FROM devices WHERE deleted_at IS NULL AND id IN (` + placeholders + `)`
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read thcpn device runtime", err)
	}
	defer rows.Close()
	result := make(map[int64]THCPNExternalDeviceMetadata, len(refs))
	for rows.Next() {
		item, err := scanTHCPNRuntimeDevice(rows)
		if err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "scan thcpn device runtime", err)
		}
		result[item.ID] = item
	}
	if err := rows.Err(); err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read thcpn device runtime", err)
	}
	return result, nil
}

func scanTHCPNRuntimeDevice(scanner interface{ Scan(...any) error }) (THCPNExternalDeviceMetadata, error) {
	var item THCPNExternalDeviceMetadata
	var iccid, version, status, deviceType, sn, externalUUID, currentVersion sql.NullString
	var active sql.NullInt64
	var lat, lon, alt sql.NullFloat64
	var createdAt, updatedAt sql.NullTime
	err := scanner.Scan(&item.ID, &item.Name, &iccid, &version, &status, &deviceType, &active, &sn, &externalUUID, &currentVersion, &lat, &lon, &alt, &createdAt, &updatedAt)
	if err != nil {
		return item, err
	}
	item.ICCID, item.Version, item.Status, item.DeviceType = nullStringPtr(iccid), nullStringPtr(version), nullStringPtr(status), nullStringPtr(deviceType)
	item.Active, item.SN, item.UUID = nullInt64Ptr(active), nullStringPtr(sn), nullStringPtr(externalUUID)
	item.CurrentDeviceVersion = nullStringPtr(currentVersion)
	item.Latitude, item.Longitude, item.AltitudeM = validCoordinate(lat, -90, 90), validCoordinate(lon, -180, 180), validFiniteNumber(alt)
	item.CreatedAt, item.UpdatedAt = nullTimePtr(createdAt), nullTimePtr(updatedAt)
	return item, nil
}

func readTHCPNRuntimeAttributes(ctx context.Context, db *sql.DB, refs []thcpnLocationRef) (map[int64]map[string]THCPNAttributeValue, error) {
	result := make(map[int64]map[string]THCPNAttributeValue, len(refs))
	tables, err := existingTHCPNTables(ctx, db, thcpnAttributeTablePrefix)
	if err != nil {
		return result, err
	}
	unresolved := make(map[string]map[int64]bool, 3)
	for _, key := range []string{"battery", "signal", "ext_info"} {
		unresolved[key] = make(map[int64]bool, len(refs))
		for _, ref := range refs {
			unresolved[key][ref.ExternalDeviceID] = true
		}
	}
	now := time.Now().UTC()
	for offset := 0; offset < thcpnAttributeLookback; offset++ {
		table := monthTable(thcpnAttributeTablePrefix, now.AddDate(0, -offset, 0))
		if !thcpnAttributeTablePattern.MatchString(table) || !tables[table] {
			continue
		}
		if err := queryTHCPNRuntimeAttributes(ctx, db, table, refs, unresolved, result); err != nil {
			return result, err
		}
	}
	return result, nil
}

func queryTHCPNRuntimeAttributes(ctx context.Context, db *sql.DB, table string, refs []thcpnLocationRef, unresolved map[string]map[int64]bool, result map[int64]map[string]THCPNAttributeValue) error {
	placeholders, args := runtimePlaceholders(refs)
	query := fmt.Sprintf(`SELECT a.device_id, a.attribute, a.value, a.ts, a.extra
FROM %[1]s a
JOIN (SELECT device_id, attribute, MAX(ts) AS max_ts FROM %[1]s
WHERE deleted_at IS NULL AND device_id IN (%[2]s) AND attribute IN ('battery','signal','ext_info')
GROUP BY device_id, attribute) latest
ON latest.device_id=a.device_id AND latest.attribute=a.attribute AND latest.max_ts=a.ts
WHERE a.deleted_at IS NULL ORDER BY a.device_id, a.attribute, a.id DESC`, "`"+table+"`", placeholders)
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return apperr.Wrap(apperr.KindDataSource, "query latest thcpn attributes", err)
	}
	defer rows.Close()
	for rows.Next() {
		var externalID int64
		var key, raw string
		var sampledAt time.Time
		var extra []byte
		if err := rows.Scan(&externalID, &key, &raw, &sampledAt, &extra); err != nil {
			return apperr.Wrap(apperr.KindDataSource, "scan latest thcpn attributes", err)
		}
		if !unresolved[key][externalID] {
			continue
		}
		value := THCPNAttributeValue{RawValue: raw, SampledAt: sampledAt.UTC(), SourceTable: table}
		if key == "ext_info" {
			var parsed any
			if json.Unmarshal([]byte(raw), &parsed) == nil {
				value.ParsedValue = parsed
			} else if len(extra) > 0 {
				var envelope map[string]any
				if json.Unmarshal(extra, &envelope) == nil {
					value.ParsedValue = envelope[key]
				}
			}
		} else if number, err := strconv.ParseFloat(strings.TrimSpace(raw), 64); err == nil {
			value.ParsedValue = number
		}
		if result[externalID] == nil {
			result[externalID] = map[string]THCPNAttributeValue{}
		}
		result[externalID][key] = value
		delete(unresolved[key], externalID)
	}
	return rows.Err()
}

func runtimePlaceholders(refs []thcpnLocationRef) (string, []any) {
	args := make([]any, 0, len(refs))
	for _, ref := range refs {
		args = append(args, ref.ExternalDeviceID)
	}
	return strings.TrimSuffix(strings.Repeat("?,", len(args)), ","), args
}

func uniqueUUIDs(input []uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]bool, len(input))
	result := make([]uuid.UUID, 0, len(input))
	for _, id := range input {
		if id == uuid.Nil || seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	return result
}

func appendRuntimeFailures(result *THCPNDeviceRuntimeBatchResponse, refs []thcpnLocationRef, message string) {
	for _, ref := range refs {
		result.Failures = append(result.Failures, THCPNDeviceRuntimeFailure{DeviceID: ref.DeviceID, Error: message})
	}
}
