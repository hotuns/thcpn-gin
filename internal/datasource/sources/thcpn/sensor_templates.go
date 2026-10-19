package thcpn

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"thcpn-gin/internal/apperr"
	platform "thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Service) ImportSensorTemplates(ctx context.Context, dataSourceID, actorID uuid.UUID) (platform.SensorTemplateImportResult, error) {
	source, err := s.loadTHCPNSyncDataSource(ctx, dataSourceID)
	if err != nil {
		return platform.SensorTemplateImportResult{}, err
	}
	sourceDB, err := s.Runtime.OpenMySQL(ctx, platform.DataSourceFromSQL(source))
	if err != nil {
		return platform.SensorTemplateImportResult{}, err
	}
	rows, err := sourceDB.QueryContext(ctx, `SELECT sensor_type, description, port, port_num, sensor, port_nums, params
FROM sensors WHERE deleted_at IS NULL ORDER BY sensor_type, id`)
	if err != nil {
		return platform.SensorTemplateImportResult{}, apperr.Wrap(apperr.KindDataSource, "list source sensor templates", err)
	}
	defer rows.Close()

	result := platform.SensorTemplateImportResult{}
	for rows.Next() {
		var sensorType string
		var description, port, driver, portNumsRaw, paramsRaw sql.NullString
		var portNum sql.NullInt64
		if err := rows.Scan(&sensorType, &description, &port, &portNum, &driver, &portNumsRaw, &paramsRaw); err != nil {
			return result, apperr.Wrap(apperr.KindDataSource, "scan source sensor template", err)
		}
		portNums := []int{}
		params := map[string]any{}
		if (portNumsRaw.Valid && platform.DecodeFlexibleJSON(portNumsRaw.String, &portNums) != nil) ||
			(paramsRaw.Valid && platform.DecodeFlexibleJSON(paramsRaw.String, &params) != nil) {
			result.Invalid++
			continue
		}
		portNumsJSON, _ := json.Marshal(portNums)
		paramsJSON, _ := json.Marshal(params)
		metricsJSON, _ := json.Marshal(platform.MetricMapsFromParams(params))
		var insertedID int64
		insertErr := s.DB.QueryRow(ctx, `INSERT INTO sensor_templates
(sensor_type, description, port, port_num, driver, port_nums, params, metrics, status, created_by, updated_by)
SELECT $1, NULLIF($2, ''), NULLIF($3, ''), $4, NULLIF($5, ''), $6, $7, $8, 'active', $9, $9
WHERE NOT EXISTS (
  SELECT 1 FROM sensor_templates
  WHERE sensor_type = $1 AND port IS NOT DISTINCT FROM NULLIF($3, '')
    AND driver IS NOT DISTINCT FROM NULLIF($5, '') AND params = $7::jsonb
    AND EXISTS (SELECT 1 FROM sensor_template_variants v WHERE v.template_id=sensor_templates.id AND v.source_family='thcpn')
) RETURNING id`, strings.TrimSpace(sensorType), platform.NullableString(description), platform.NullableString(port), portNum.Int64, platform.NullableString(driver), string(portNumsJSON), string(paramsJSON), string(metricsJSON), platform.NullableUUID(actorID)).Scan(&insertedID)
		if insertErr != nil && !errors.Is(insertErr, pgx.ErrNoRows) {
			return result, apperr.Wrap(apperr.KindInternal, "import sensor template", insertErr)
		}
		if errors.Is(insertErr, pgx.ErrNoRows) {
			result.Skipped++
		} else {
			input := platform.SensorTemplateWriteInput{Port: platform.NullableString(port), PortNum: portNum.Int64, Driver: platform.NullableString(driver), PortNums: portNums, Params: params}
			input.Variants = SourceTemplateVariant(input)
			if err := platform.UpsertSensorTemplateVariants(ctx, s.DB, insertedID, input); err != nil {
				return result, err
			}
			result.Imported++
		}
	}
	if err := rows.Err(); err != nil {
		return result, apperr.Wrap(apperr.KindDataSource, "read source sensor templates", err)
	}
	return result, nil
}
