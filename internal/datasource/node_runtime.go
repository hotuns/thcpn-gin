package datasource

import (
	"context"
	"math"
	"net/http"
	"strconv"
	"sync"
	platform "thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/device"
	"thcpn-gin/internal/httpx"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func (h *Handler) NodeRuntime(c *gin.Context) {
	id, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if !h.authorize(c, "device", id, "device.view") {
		return
	}
	nodes, err := device.NewService(h.service.DB).ListGatewayNodes(c.Request.Context(), id)
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
	result := make([]platform.NodeRuntime, len(nodes))
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
				batch, e := h.service.DeviceRuntime(ctx, []uuid.UUID{*node.Target.DeviceID})
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
			if node.Target.NodeIndex == nil {
				result[i].Error = "节点目标无效"
				return
			}
			module, err := h.service.moduleForDevice(ctx, id)
			if err != nil || module.NodeRuntime == nil {
				result[i].Error = "节点状态读取不可用"
				return
			}
			item, err := module.NodeRuntime.ReadNodeRuntime(ctx, id, *node.Target.NodeIndex, node.Key, now)
			if err != nil {
				result[i].Error = "节点状态读取失败"
				return
			}
			result[i] = item

		}(i, node)
	}
	wg.Wait()
	c.JSON(http.StatusOK, gin.H{"items": result, "refreshed_at": now})
}
