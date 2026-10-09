package datasource

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"thcpn-gin/internal/device"
	"thcpn-gin/internal/httpx"
)

// NodeRuntime is independent of sensor metric mappings: diagnostics belong to
// the node itself, and a changed sensor configuration must not hide them.
type NodeRuntime struct {
	Key       string     `json:"key"`
	SampledAt *time.Time `json:"sampled_at,omitempty"`
	Battery   *float64   `json:"battery,omitempty"`
	RSSI      *float64   `json:"rssi,omitempty"`
	SNR       *float64   `json:"snr,omitempty"`
	Error     string     `json:"error,omitempty"`
}

func (h *Handler) NodeRuntime(c *gin.Context) {
	id, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if !h.authorize(c, "device", id, "device.view") {
		return
	}
	nodes, err := device.NewService(h.service.db).ListGatewayNodes(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	// Check child-device grants before accessing their source-owned attributes.
	for _, node := range nodes {
		if node.Target.DeviceID != nil && !h.authorize(c, "device", *node.Target.DeviceID, "device.view") {
			return
		}
	}
	result := make([]NodeRuntime, len(nodes))
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	now := time.Now().UTC()
	var wg sync.WaitGroup
	slots := make(chan struct{}, 4)
	for i, node := range nodes {
		wg.Add(1)
		go func(i int, node device.GatewayNode) {
			defer wg.Done()
			result[i].Key = node.Key
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
			case <-ctx.Done():
				result[i].Error = "读取超时"
				return
			}
			if node.Target.DeviceID != nil {
				batch, e := h.service.THCPNDeviceRuntime(ctx, []uuid.UUID{*node.Target.DeviceID})
				if e != nil || len(batch.Failures) > 0 {
					result[i].Error = "节点状态读取失败"
					return
				}
				for _, item := range batch.Items {
					for key, attr := range item.Attributes {
						if attr.SampledAt.Before(now.Add(-72*time.Hour)) || attr.SampledAt.After(now) {
							continue
						}
						value, e := strconv.ParseFloat(attr.RawValue, 64)
						if e != nil || math.IsNaN(value) || math.IsInf(value, 0) {
							continue
						}
						if key == "battery" {
							result[i].Battery = &value
						}
						if key == "signal" {
							result[i].RSSI = &value
						}
						if key == "battery" || key == "signal" {
							if result[i].SampledAt == nil || attr.SampledAt.After(*result[i].SampledAt) {
								ts := attr.SampledAt
								result[i].SampledAt = &ts
							}
						}
					}
				}
				return
			}
			ref, e := h.service.LoRaWANV2GatewayForDevice(ctx, id)
			if e != nil || node.Target.NodeIndex == nil {
				result[i].Error = "节点数据源不可用"
				return
			}
			q := url.Values{"page": {"1"}, "page_size": {"1"}, "start_at": {strconv.FormatInt(now.Add(-72*time.Hour).Unix(), 10)}, "end_at": {strconv.FormatInt(now.Unix(), 10)}}
			payload, e := h.service.LoRaWANV2Request(ctx, ref.DataSourceID, http.MethodGet, "/device/"+url.PathEscape(ref.GatewaySN)+"/node/"+strconv.Itoa(*node.Target.NodeIndex)+"/data", q, nil)
			if e != nil {
				result[i].Error = "节点状态读取失败"
				return
			}
			var data struct {
				Data []map[string]json.RawMessage `json:"data"`
			}
			if json.Unmarshal(payload, &data) != nil {
				result[i].Error = "节点状态格式错误"
				return
			}
			if len(data.Data) == 0 {
				return
			}
			result[i] = parseNodeRuntime(node.Key, data.Data[0])
		}(i, node)
	}
	wg.Wait()
	c.JSON(http.StatusOK, gin.H{"items": result, "refreshed_at": now})
}

func parseNodeRuntime(key string, row map[string]json.RawMessage) NodeRuntime {
	result := NodeRuntime{Key: key}
	if ts, err := loraWANV2Timestamp(row["ts"]); err == nil {
		result.SampledAt = &ts
	}
	for key, target := range map[string]**float64{"battery": &result.Battery, "rssi": &result.RSSI, "snr": &result.SNR} {
		raw := bytes.TrimSpace(row[key])
		if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
			continue
		}
		if value, ok := loraWANV2Number(raw); ok && !math.IsNaN(value) && !math.IsInf(value, 0) {
			*target = &value
		}
	}
	return result
}
