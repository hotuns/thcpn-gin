package lorawanv2

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"net/http"
	"strings"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
)

func (s *Service) GatewayDeletionID(ctx context.Context, source uuid.UUID, sn string) (int64, error) {
	if strings.ContainsAny(sn, "/%?#") {
		return 0, apperr.New(apperr.KindInvalidArgument, "不支持此网关 SN")
	}
	raw, err := s.LoRaWANV2Request(ctx, source, http.MethodGet, "/device/"+sn, nil, nil)
	if err != nil {
		return 0, err
	}
	var gateway struct {
		ID int64  `json:"id"`
		SN string `json:"sn"`
	}
	if json.Unmarshal(raw, &gateway) != nil || gateway.ID <= 0 || gateway.SN != sn {
		return 0, apperr.New(apperr.KindDataSource, "源端未返回可验证的网关 ID，请先更新 LoRaWAN V2 服务")
	}
	return gateway.ID, nil
}

func (s *Service) DeleteUnusedSourceAsset(ctx context.Context, source uuid.UUID, sn string, id int64, node, execute bool) (platform.SourceDeletion, error) {
	path := "/device/" + sn
	if node {
		path = "/nodes/" + sn
	}
	method := http.MethodDelete
	if !execute {
		method = http.MethodPost
		path += "/deletion-check"
	}
	raw, err := s.LoRaWANV2Request(ctx, source, method, path, nil, map[string]int64{"expected_id": id})
	if err != nil {
		return platform.SourceDeletion{}, err
	}
	var result platform.SourceDeletion
	if json.Unmarshal(raw, &result) != nil || (result.State != "eligible" && result.State != "blocked" && result.State != "absent" && result.State != "deleted") {
		return platform.SourceDeletion{}, apperr.New(apperr.KindDataSource, "源端返回的删除结果无效")
	}
	return result, nil
}
