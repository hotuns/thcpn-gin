package datasource

import (
	"context"
	"database/sql"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

type THCPNLiveLocation struct {
	Latitude  *float64 `json:"latitude,omitempty"`
	Longitude *float64 `json:"longitude,omitempty"`
	AltitudeM *float64 `json:"altitude_m,omitempty"`
}

type thcpnLocationRef struct {
	DeviceID         uuid.UUID
	DataSourceID     uuid.UUID
	ExternalDeviceID int64
}

// LiveTHCPNDeviceLocations reads current coordinates directly from each
// device's source database. It does not update platform-owned tables.
func (s *Service) LiveTHCPNDeviceLocations(ctx context.Context, deviceIDs []uuid.UUID) (map[uuid.UUID]THCPNLiveLocation, error) {
	result := make(map[uuid.UUID]THCPNLiveLocation)
	if len(deviceIDs) == 0 {
		return result, nil
	}
	rows, err := s.db.Query(ctx, `
SELECT device_id, data_source_id, external_device_id
FROM device_source_refs
WHERE status='active' AND adapter_code=$1 AND device_id=ANY($2::uuid[])`,
		AdapterTHCPNLegacy, deviceIDs)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list device source locations", err)
	}
	refsBySource := make(map[uuid.UUID][]thcpnLocationRef)
	for rows.Next() {
		var ref thcpnLocationRef
		if err := rows.Scan(&ref.DeviceID, &ref.DataSourceID, &ref.ExternalDeviceID); err != nil {
			rows.Close()
			return nil, apperr.Wrap(apperr.KindInternal, "scan device source location", err)
		}
		refsBySource[ref.DataSourceID] = append(refsBySource[ref.DataSourceID], ref)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, apperr.Wrap(apperr.KindInternal, "read device source locations", err)
	}
	rows.Close()

	for sourceID, refs := range refsBySource {
		source, err := s.loadTHCPNSyncDataSource(ctx, sourceID)
		if err != nil {
			continue
		}
		db, err := NewRuntime(nil).openMySQL(ctx, dataSourceFromSQL(source))
		if err != nil {
			continue
		}
		err = readTHCPNLocations(ctx, db, refs, result)
		db.Close()
		if err != nil {
			continue
		}
	}
	return result, nil
}

func readTHCPNLocations(ctx context.Context, db *sql.DB, refs []thcpnLocationRef, result map[uuid.UUID]THCPNLiveLocation) error {
	const chunkSize = 500
	for start := 0; start < len(refs); start += chunkSize {
		end := start + chunkSize
		if end > len(refs) {
			end = len(refs)
		}
		chunk := refs[start:end]
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(chunk)), ",")
		args := make([]any, 0, len(chunk))
		platformIDs := make(map[int64]uuid.UUID, len(chunk))
		for _, ref := range chunk {
			args = append(args, ref.ExternalDeviceID)
			platformIDs[ref.ExternalDeviceID] = ref.DeviceID
		}
		rows, err := db.QueryContext(ctx, "SELECT id, CAST(lat AS CHAR), CAST(lon AS CHAR), CAST(alt AS CHAR) FROM devices WHERE deleted_at IS NULL AND id IN ("+placeholders+")", args...)
		if err != nil {
			return apperr.Wrap(apperr.KindDataSource, "read live thcpn device locations", err)
		}
		for rows.Next() {
			var externalID int64
			var latitude, longitude, altitude sql.NullString
			if err := rows.Scan(&externalID, &latitude, &longitude, &altitude); err != nil {
				rows.Close()
				return apperr.Wrap(apperr.KindDataSource, "scan live thcpn device location", err)
			}
			deviceID, ok := platformIDs[externalID]
			if !ok {
				continue
			}
			lat := parseSourceCoordinate(latitude, -90, 90)
			lon := parseSourceCoordinate(longitude, -180, 180)
			if lat == nil || lon == nil || (*lat == 0 && *lon == 0) {
				continue
			}
			result[deviceID] = THCPNLiveLocation{
				Latitude: lat, Longitude: lon, AltitudeM: parseSourceNumber(altitude),
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return apperr.Wrap(apperr.KindDataSource, "read live thcpn device locations", err)
		}
		rows.Close()
	}
	return nil
}

func parseSourceCoordinate(value sql.NullString, min, max float64) *float64 {
	result := parseSourceNumber(value)
	if result == nil || *result < min || *result > max {
		return nil
	}
	return result
}

func parseSourceNumber(value sql.NullString) *float64 {
	if !value.Valid {
		return nil
	}
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value.String), 64)
	if err != nil {
		return nil
	}
	return validFiniteNumber(sql.NullFloat64{Float64: parsed, Valid: true})
}
