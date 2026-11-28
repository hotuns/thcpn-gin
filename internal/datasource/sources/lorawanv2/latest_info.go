package lorawanv2

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
)

// Latest information is independent of the history query window. Keep the
// upstream record (including BSON dates and ICCID leading zeros) unchanged.
func (s *Service) ReadLatestGatewayInfo(ctx context.Context, id uuid.UUID) (json.RawMessage, error) {
	ref, err := s.LoRaWANV2GatewayForDevice(ctx, id)
	if err != nil {
		return nil, err
	}
	payload, err := s.LoRaWANV2Request(ctx, ref.DataSourceID, http.MethodGet, "/device/"+url.PathEscape(ref.GatewaySN)+"/info", nil, nil)
	if err != nil {
		return nil, err
	}
	var record map[string]json.RawMessage
	if err := json.Unmarshal(payload, &record); err != nil {
		return nil, apperr.New(apperr.KindDataSource, "invalid latest gateway information")
	}
	return payload, nil
}

// Add platform history identities without changing the source record fields.
func (s *Service) ReadGatewayStatusInfo(ctx context.Context, id uuid.UUID) (json.RawMessage, error) {
	raw, err := s.ReadLatestGatewayInfo(ctx, id)
	if err != nil {
		return nil, err
	}
	var record map[string]json.RawMessage
	if err := json.Unmarshal(raw, &record); err != nil {
		return nil, err
	}
	if record == nil {
		return raw, nil
	}
	rows, err := s.Queries.ListLoRaWANV2GatewayStatusStreams(ctx, sqlc.ListLoRaWANV2GatewayStatusStreamsParams{DeviceID: id})
	if err != nil {
		return nil, err
	}
	ids := map[string]uuid.UUID{}
	for _, row := range rows {
		ids[row.Metric] = row.ID
	}
	record["history_stream_ids"], _ = json.Marshal(ids)
	return json.Marshal(record)
}

// Battery and CSQ are known protocol fields. The presence of a recent report
// is not required to register their history, and disabled bindings stay disabled.
func missingGatewayStatusSpecs(ctx context.Context, q *sqlc.Queries, ref LoRaWANV2GatewayRef) ([]loraWANV2StreamSpec, error) {
	existing, err := q.ListLoRaWANV2GatewayStatusStreams(ctx, sqlc.ListLoRaWANV2GatewayStatusStreamsParams{
		DeviceID: ref.DeviceID, IncludeInactive: true,
	})
	if err != nil {
		return nil, err
	}
	registered := make(map[string]bool, len(existing))
	for _, stream := range existing {
		registered[stream.Metric] = true
	}
	var specs []loraWANV2StreamSpec
	for _, metric := range []string{"battery", "cell"} {
		if !registered[metric] {
			specs = append(specs, loraWANV2MetricSpec(ref.GatewaySN, nil, metric, loraWANV2GatewayMetricUnits[metric], ""))
		}
	}
	return specs, nil
}
