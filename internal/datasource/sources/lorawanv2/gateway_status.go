package lorawanv2

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"net/http"
	"net/url"
	"thcpn-gin/internal/apperr"
	"time"
)

type GatewayActivity struct {
	GatewaySN       string     `json:"gateway_sn"`
	LastReceivedAt  *time.Time `json:"last_received_at"`
	LastCollectedAt *time.Time `json:"last_collected_at"`
}
type GatewayConnection struct {
	GatewayActivity
	State     string    `json:"state"`
	CheckedAt time.Time `json:"checked_at"`
	Provider  string    `json:"provider"`
	ClientID  string    `json:"client_id"`
}

func (s *Service) gatewayStatusPayload(ctx context.Context, id uuid.UUID, kind string) (json.RawMessage, error) {
	ref, err := s.LoRaWANV2GatewayForDevice(ctx, id)
	if err != nil {
		return nil, err
	}
	return s.LoRaWANV2Request(ctx, ref.DataSourceID, http.MethodGet, "/device/"+url.PathEscape(ref.GatewaySN)+"/"+kind, nil, nil)
}
func (s *Service) ReadGatewayConnection(ctx context.Context, id uuid.UUID) (GatewayConnection, error) {
	var result GatewayConnection
	payload, err := s.gatewayStatusPayload(ctx, id, "connection")
	if err != nil {
		return result, err
	}
	if json.Unmarshal(payload, &result) != nil || result.GatewaySN == "" || result.CheckedAt.IsZero() || (result.State != "online" && result.State != "offline" && result.State != "unknown") {
		return GatewayConnection{}, apperr.New(apperr.KindDataSource, "invalid gateway connection response")
	}
	return result, nil
}
func (s *Service) ReadGatewayActivity(ctx context.Context, id uuid.UUID) (GatewayActivity, error) {
	var result GatewayActivity
	payload, err := s.gatewayStatusPayload(ctx, id, "activity")
	if err != nil {
		return result, err
	}
	if json.Unmarshal(payload, &result) != nil || result.GatewaySN == "" {
		return GatewayActivity{}, apperr.New(apperr.KindDataSource, "invalid gateway activity response")
	}
	return result, nil
}
