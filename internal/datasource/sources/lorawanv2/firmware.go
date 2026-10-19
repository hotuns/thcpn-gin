package lorawanv2

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
)

func (s *Service) RegisterFirmware(ctx context.Context, input platform.SourceFirmwareInput) (int64, error) {
	sn, err := LoraWANV2PathSN(input.GatewaySN)
	if err != nil {
		return 0, err
	}
	payload, err := s.LoRaWANV2Request(ctx, input.DataSourceID, http.MethodPost, "/device/"+url.PathEscape(sn)+"/firmware", nil, map[string]any{"firmware_version": input.EncodedVersion, "url": input.PublicURL, "verify_value": input.VerifyValue})
	if err != nil {
		return 0, err
	}
	var response struct {
		ID int64 `json:"id"`
	}
	if json.Unmarshal(payload, &response) != nil || response.ID <= 0 {
		return 0, apperr.New(apperr.KindDataSource, "lorawan_v2 firmware response is missing id")
	}
	return response.ID, nil
}
