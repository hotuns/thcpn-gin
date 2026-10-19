package lorawanv2

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
	"time"

	"github.com/google/uuid"
)

func (s *Service) ReadNodeRuntime(ctx context.Context, id uuid.UUID, index int, key string, now time.Time) (platform.NodeRuntime, error) {
	result := platform.NodeRuntime{Key: key}
	ref, err := s.LoRaWANV2GatewayForDevice(ctx, id)
	if err != nil {
		return result, err
	}
	var count int
	if err := s.DB.QueryRow(ctx, `SELECT COALESCE((SELECT value_json::text::int FROM device_metadata WHERE device_id=$1 AND key='lorawan_v2_nodes_count'),0)`, id).Scan(&count); err != nil {
		return result, err
	}
	if index < 1 || index > count {
		return result, apperr.New(apperr.KindInvalidArgument, "node_index is outside gateway node range")
	}
	q := url.Values{"page": {"1"}, "page_size": {"1"}, "start_at": {strconv.FormatInt(now.Add(-72*time.Hour).Unix(), 10)}, "end_at": {strconv.FormatInt(now.Unix(), 10)}}
	payload, err := s.LoRaWANV2Request(ctx, ref.DataSourceID, http.MethodGet, "/device/"+url.PathEscape(ref.GatewaySN)+"/node/"+strconv.Itoa(index)+"/data", q, nil)
	if err != nil {
		return result, err
	}
	var data struct {
		Data []map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(payload, &data); err != nil {
		return result, apperr.Wrap(apperr.KindDataSource, "invalid node runtime response", err)
	}
	if len(data.Data) == 0 {
		return result, nil
	}
	return ParseNodeRuntime(key, data.Data[0]), nil
}
