package lorawanv2

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
)

// ListPendingNodeDiscoveries limits the source query to the platform device's
// active gateway mapping. Callers cannot select a different source or gateway.
func (s *Service) ListPendingNodeDiscoveries(ctx context.Context, deviceID uuid.UUID, page, pageSize int) (json.RawMessage, error) {
	ref, err := s.LoRaWANV2GatewayForDevice(ctx, deviceID)
	if err != nil {
		return nil, err
	}
	query := LoraWANV2PageQuery(page, pageSize)
	query.Set("gateway_sn", ref.GatewaySN)
	query.Set("status", "pending")
	return s.LoRaWANV2Request(ctx, ref.DataSourceID, http.MethodGet, "/node-discoveries", query, nil)
}
