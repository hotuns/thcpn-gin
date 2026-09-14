package datasource

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
)

const (
	loraWANV2MaxPageSize      = 50
	loraWANV2MaxResponseBytes = 32 << 20
	loraWANV2ProductID        = "lorawan_v2_gateway"
)

type loraWANV2Secret struct {
	BaseURL  string `json:"base_url"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type loraWANV2Client struct {
	baseURL  *url.URL
	username string
	password string
	client   *http.Client
}

type loraWANV2Envelope struct {
	Success      bool            `json:"success"`
	ErrorCode    string          `json:"error_code"`
	ErrorMessage string          `json:"error_message"`
	Payload      json.RawMessage `json:"payload"`
}

type loraWANV2Pagination struct {
	CurrentPage int `json:"current_page"`
	PageSize    int `json:"page_size"`
	TotalPage   int `json:"total_page"`
	TotalCount  int `json:"total_count"`
}

type LoRaWANV2Gateway struct {
	SN        string     `json:"sn"`
	NodeCount int        `json:"node_count"`
	CreatedAt *time.Time `json:"created_at,omitempty"`
	UpdatedAt *time.Time `json:"updated_at,omitempty"`
}

type LoRaWANV2GatewayRef struct {
	DeviceID     uuid.UUID `json:"device_id"`
	DataSourceID uuid.UUID `json:"data_source_id"`
	GatewaySN    string    `json:"gateway_sn"`
	Status       string    `json:"status"`
	SyncedAt     time.Time `json:"synced_at"`
}

type LoRaWANV2GatewaySyncResult struct {
	Device      SyncedDevice        `json:"device"`
	SourceRef   LoRaWANV2GatewayRef `json:"source_ref"`
	Gateway     LoRaWANV2Gateway    `json:"gateway"`
	DataStreams []SyncedDataStream  `json:"data_streams"`
	Bindings    []DataStreamBinding `json:"bindings"`
}

type LoRaWANV2SyncFailure struct {
	GatewaySN string `json:"gateway_sn"`
	Error     string `json:"error"`
}

type LoRaWANV2AllGatewaysSyncResult struct {
	DataSourceID uuid.UUID              `json:"data_source_id"`
	Total        int                    `json:"total"`
	Synced       int                    `json:"synced"`
	Created      int                    `json:"created"`
	Updated      int                    `json:"updated"`
	Failed       int                    `json:"failed"`
	Failures     []LoRaWANV2SyncFailure `json:"failures,omitempty"`
}

type LoRaWANV2CreateGatewayResult struct {
	Gateway   LoRaWANV2Gateway            `json:"gateway"`
	Sync      *LoRaWANV2GatewaySyncResult `json:"sync,omitempty"`
	SyncError string                      `json:"sync_error,omitempty"`
}

type SyncLoRaWANV2GatewayInput struct {
	DataSourceID uuid.UUID
	GatewaySN    string
	ActorUserID  uuid.UUID
}

type SyncAllLoRaWANV2GatewaysInput struct {
	DataSourceID uuid.UUID
	ActorUserID  uuid.UUID
}

type loraWANV2TelemetryConfig struct {
	GatewaySN string `json:"gateway_sn"`
	NodeIndex *int   `json:"node_index,omitempty"`
	Metric    string `json:"metric"`
}

type loraWANV2Record struct {
	Timestamp time.Time
	Values    map[string]json.RawMessage
}

type loraWANV2StreamSpec struct {
	Code          string
	Name          string
	Unit          string
	AdapterConfig json.RawMessage
}

func newLoRaWANV2Client(ctx context.Context, resolver SecretResolver, source DataSource) (*loraWANV2Client, error) {
	if source.Type != "http_api" {
		return nil, apperr.New(apperr.KindDataSource, "lorawan_v2 requires http_api data source type")
	}
	if resolver == nil {
		resolver = EnvSecretResolver{}
	}
	raw, err := resolver.Resolve(ctx, source.DsnSecretRef)
	if err != nil {
		return nil, err
	}
	var secret loraWANV2Secret
	if err := json.Unmarshal([]byte(raw), &secret); err != nil {
		return nil, apperr.New(apperr.KindDataSource, "invalid lorawan_v2 secret")
	}
	endpoint, err := url.Parse(strings.TrimSpace(secret.BaseURL))
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https") {
		return nil, apperr.New(apperr.KindDataSource, "invalid lorawan_v2 base_url")
	}
	if strings.TrimSpace(secret.Username) == "" || secret.Password == "" {
		return nil, apperr.New(apperr.KindDataSource, "lorawan_v2 basic authentication is not configured")
	}
	endpoint.RawQuery, endpoint.Fragment = "", ""
	return &loraWANV2Client{baseURL: endpoint, username: secret.Username, password: secret.Password, client: httpAPIClient}, nil
}

func (c *loraWANV2Client) request(ctx context.Context, method, requestPath string, query url.Values, body any) (json.RawMessage, error) {
	endpoint := *c.baseURL
	endpoint.Path = strings.TrimRight(c.baseURL.Path, "/") + "/" + strings.TrimLeft(requestPath, "/")
	endpoint.RawQuery = query.Encode()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "marshal lorawan_v2 request", err)
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint.String(), reader)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "create lorawan_v2 request", err)
	}
	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	response, err := c.client.Do(req)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "request lorawan_v2", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, loraWANV2MaxResponseBytes+1))
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read lorawan_v2 response", err)
	}
	if len(raw) > loraWANV2MaxResponseBytes {
		return nil, apperr.New(apperr.KindDataSource, "lorawan_v2 response is too large")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, apperr.New(apperr.KindDataSource, "lorawan_v2 returned non-success status")
	}
	var envelope loraWANV2Envelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, apperr.New(apperr.KindDataSource, "invalid lorawan_v2 response")
	}
	if !envelope.Success {
		return nil, apperr.New(apperr.KindDataSource, "lorawan_v2 request failed")
	}
	return append(json.RawMessage(nil), envelope.Payload...), nil
}

func (c *loraWANV2Client) listGateways(ctx context.Context, page, pageSize int) ([]LoRaWANV2Gateway, loraWANV2Pagination, error) {
	payload, err := c.request(ctx, http.MethodGet, "/devices", loraWANV2PageQuery(page, pageSize), nil)
	if err != nil {
		return nil, loraWANV2Pagination{}, err
	}
	var result struct {
		Data       []LoRaWANV2Gateway  `json:"data"`
		Pagination loraWANV2Pagination `json:"pagination"`
	}
	if err := json.Unmarshal(payload, &result); err != nil {
		return nil, loraWANV2Pagination{}, apperr.New(apperr.KindDataSource, "invalid lorawan_v2 gateway list")
	}
	return result.Data, result.Pagination, nil
}

func (c *loraWANV2Client) getGateway(ctx context.Context, sn string) (LoRaWANV2Gateway, error) {
	payload, err := c.request(ctx, http.MethodGet, "/device/"+url.PathEscape(sn), url.Values{}, nil)
	if err != nil {
		return LoRaWANV2Gateway{}, err
	}
	var item LoRaWANV2Gateway
	if err := json.Unmarshal(payload, &item); err != nil {
		return item, apperr.New(apperr.KindDataSource, "invalid lorawan_v2 gateway")
	}
	return item, nil
}

func (c *loraWANV2Client) listRecords(ctx context.Context, cfg loraWANV2TelemetryConfig, start, end time.Time, limit int) ([]loraWANV2Record, bool, error) {
	if limit <= 0 {
		return nil, false, apperr.New(apperr.KindInvalidArgument, "limit must be greater than 0")
	}
	path := "/device/" + url.PathEscape(cfg.GatewaySN) + "/infos"
	if cfg.NodeIndex != nil {
		path = "/device/" + url.PathEscape(cfg.GatewaySN) + "/node/" + strconv.Itoa(*cfg.NodeIndex) + "/data"
	}
	records := make([]loraWANV2Record, 0, limit)
	page, complete := 1, false
	for len(records) < limit {
		query := loraWANV2PageQuery(page, loraWANV2MaxPageSize)
		query.Set("start_at", strconv.FormatInt(start.UTC().Unix(), 10))
		query.Set("end_at", strconv.FormatInt(end.UTC().Unix(), 10))
		payload, err := c.request(ctx, http.MethodGet, path, query, nil)
		if err != nil {
			return nil, false, err
		}
		var result struct {
			Data       []map[string]json.RawMessage `json:"data"`
			Pagination loraWANV2Pagination          `json:"pagination"`
		}
		if err := json.Unmarshal(payload, &result); err != nil {
			return nil, false, apperr.New(apperr.KindDataSource, "invalid lorawan_v2 data response")
		}
		for _, raw := range result.Data {
			ts, err := loraWANV2Timestamp(raw["ts"])
			if err != nil {
				continue
			}
			records = append(records, loraWANV2Record{Timestamp: ts, Values: raw})
			if len(records) >= limit {
				break
			}
		}
		if len(result.Data) < loraWANV2MaxPageSize || (result.Pagination.TotalPage > 0 && page >= result.Pagination.TotalPage) {
			complete = true
			break
		}
		page++
	}
	sort.SliceStable(records, func(i, j int) bool { return records[i].Timestamp.Before(records[j].Timestamp) })
	return records, complete, nil
}

func loraWANV2PageQuery(page, pageSize int) url.Values {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 10
	}
	if pageSize > loraWANV2MaxPageSize {
		pageSize = loraWANV2MaxPageSize
	}
	return url.Values{"page": {strconv.Itoa(page)}, "page_size": {strconv.Itoa(pageSize)}}
}

func loraWANV2Timestamp(raw json.RawMessage) (time.Time, error) {
	if len(raw) == 0 {
		return time.Time{}, errors.New("missing timestamp")
	}
	var number json.Number
	if json.Unmarshal(raw, &number) == nil {
		if value, err := number.Int64(); err == nil {
			if value > 100000000000 {
				return time.UnixMilli(value).UTC(), nil
			}
			return time.Unix(value, 0).UTC(), nil
		}
	}
	var value string
	if json.Unmarshal(raw, &value) == nil {
		if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
			return parsed.UTC(), nil
		}
		if millis, err := strconv.ParseInt(value, 10, 64); err == nil {
			return time.UnixMilli(millis).UTC(), nil
		}
	}
	var mongo struct {
		Date struct {
			NumberLong string `json:"$numberLong"`
		} `json:"$date"`
	}
	if json.Unmarshal(raw, &mongo) == nil && mongo.Date.NumberLong != "" {
		if millis, err := strconv.ParseInt(mongo.Date.NumberLong, 10, 64); err == nil {
			return time.UnixMilli(millis).UTC(), nil
		}
	}
	return time.Time{}, errors.New("invalid timestamp")
}

func loraWANV2Number(raw json.RawMessage) (float64, bool) {
	var value float64
	if json.Unmarshal(raw, &value) == nil && !math.IsNaN(value) && !math.IsInf(value, 0) {
		return value, true
	}
	return 0, false
}

func (s *Service) loadLoRaWANV2DataSource(ctx context.Context, id uuid.UUID) (sqlc.DataSource, error) {
	if id == uuid.Nil {
		return sqlc.DataSource{}, apperr.New(apperr.KindInvalidArgument, "data source id is required")
	}
	source, err := s.queries.GetDataSource(ctx, id)
	if err != nil {
		return sqlc.DataSource{}, mapNotFoundOrInternal(err, "data source not found")
	}
	if source.Type != "http_api" || source.SourceFamily == nil || *source.SourceFamily != sourceFamilyLoRaWANV2 {
		return sqlc.DataSource{}, apperr.New(apperr.KindInvalidArgument, "lorawan_v2 http_api data source is required")
	}
	if source.Status != "active" {
		return sqlc.DataSource{}, apperr.New(apperr.KindDataSource, "data source is not active")
	}
	return source, nil
}

func (s *Service) LoRaWANV2Health(ctx context.Context, dataSourceID uuid.UUID) (json.RawMessage, error) {
	source, err := s.loadLoRaWANV2DataSource(ctx, dataSourceID)
	if err != nil {
		return nil, err
	}
	client, err := newLoRaWANV2Client(ctx, NewRuntime(nil).resolver, dataSourceFromSQL(source))
	if err != nil {
		return nil, err
	}
	ping, err := client.request(ctx, http.MethodGet, "/ping", url.Values{}, nil)
	if err != nil {
		return nil, err
	}
	_, _, err = client.listGateways(ctx, 1, 1)
	if err != nil {
		return nil, err
	}
	return ping, nil
}

func (s *Service) LoRaWANV2Request(ctx context.Context, dataSourceID uuid.UUID, method, requestPath string, query url.Values, body any) (json.RawMessage, error) {
	source, err := s.loadLoRaWANV2DataSource(ctx, dataSourceID)
	if err != nil {
		return nil, err
	}
	client, err := newLoRaWANV2Client(ctx, NewRuntime(nil).resolver, dataSourceFromSQL(source))
	if err != nil {
		return nil, err
	}
	return client.request(ctx, method, requestPath, query, body)
}

func (s *Service) ListLoRaWANV2Gateways(ctx context.Context, dataSourceID uuid.UUID, page, pageSize int) (json.RawMessage, error) {
	return s.LoRaWANV2Request(ctx, dataSourceID, http.MethodGet, "/devices", loraWANV2PageQuery(page, pageSize), nil)
}

func (s *Service) CreateLoRaWANV2Gateway(ctx context.Context, dataSourceID uuid.UUID, sn string, nodeCount int, actorID uuid.UUID) (LoRaWANV2CreateGatewayResult, error) {
	if actorID == uuid.Nil || strings.TrimSpace(sn) == "" || nodeCount < 1 || nodeCount > 254 {
		return LoRaWANV2CreateGatewayResult{}, apperr.New(apperr.KindInvalidArgument, "gateway sn, node_count and actor are required")
	}
	payload, err := s.LoRaWANV2Request(ctx, dataSourceID, http.MethodPost, "/device", url.Values{}, map[string]any{"sn": strings.TrimSpace(sn), "node_count": nodeCount})
	if err != nil {
		return LoRaWANV2CreateGatewayResult{}, err
	}
	var gateway LoRaWANV2Gateway
	if err := json.Unmarshal(payload, &gateway); err != nil {
		return LoRaWANV2CreateGatewayResult{}, apperr.New(apperr.KindDataSource, "invalid created lorawan_v2 gateway")
	}
	result := LoRaWANV2CreateGatewayResult{Gateway: gateway}
	synced, syncErr := s.SyncLoRaWANV2Gateway(ctx, SyncLoRaWANV2GatewayInput{DataSourceID: dataSourceID, GatewaySN: gateway.SN, ActorUserID: actorID})
	if syncErr != nil {
		result.SyncError = apperr.MessageOf(syncErr)
		return result, nil
	}
	result.Sync = &synced
	return result, nil
}

func (s *Service) SyncLoRaWANV2Gateway(ctx context.Context, input SyncLoRaWANV2GatewayInput) (LoRaWANV2GatewaySyncResult, error) {
	if input.DataSourceID == uuid.Nil || input.ActorUserID == uuid.Nil || strings.TrimSpace(input.GatewaySN) == "" {
		return LoRaWANV2GatewaySyncResult{}, apperr.New(apperr.KindInvalidArgument, "data source, gateway sn and actor are required")
	}
	source, err := s.loadLoRaWANV2DataSource(ctx, input.DataSourceID)
	if err != nil {
		return LoRaWANV2GatewaySyncResult{}, err
	}
	client, err := newLoRaWANV2Client(ctx, NewRuntime(nil).resolver, dataSourceFromSQL(source))
	if err != nil {
		return LoRaWANV2GatewaySyncResult{}, err
	}
	gateway, err := client.getGateway(ctx, strings.TrimSpace(input.GatewaySN))
	if err != nil {
		return LoRaWANV2GatewaySyncResult{}, err
	}
	return s.syncLoRaWANV2Gateway(ctx, source, client, gateway, input.ActorUserID)
}

func (s *Service) SyncAllLoRaWANV2Gateways(ctx context.Context, input SyncAllLoRaWANV2GatewaysInput) (LoRaWANV2AllGatewaysSyncResult, error) {
	result := LoRaWANV2AllGatewaysSyncResult{DataSourceID: input.DataSourceID, Failures: []LoRaWANV2SyncFailure{}}
	if input.DataSourceID == uuid.Nil || input.ActorUserID == uuid.Nil {
		return result, apperr.New(apperr.KindInvalidArgument, "data source and actor are required")
	}
	source, err := s.loadLoRaWANV2DataSource(ctx, input.DataSourceID)
	if err != nil {
		return result, err
	}
	client, err := newLoRaWANV2Client(ctx, NewRuntime(nil).resolver, dataSourceFromSQL(source))
	if err != nil {
		return result, err
	}
	for page := 1; ; page++ {
		gateways, pagination, err := client.listGateways(ctx, page, loraWANV2MaxPageSize)
		if err != nil {
			return result, err
		}
		result.Total += len(gateways)
		for _, gateway := range gateways {
			var existing uuid.UUID
			lookupErr := s.db.QueryRow(ctx, `SELECT device_id FROM lorawan_v2_device_refs WHERE data_source_id=$1 AND gateway_sn=$2`, source.ID, gateway.SN).Scan(&existing)
			_, syncErr := s.syncLoRaWANV2Gateway(ctx, source, client, gateway, input.ActorUserID)
			if syncErr != nil {
				result.Failed++
				result.Failures = append(result.Failures, LoRaWANV2SyncFailure{GatewaySN: gateway.SN, Error: apperr.MessageOf(syncErr)})
				continue
			}
			result.Synced++
			if lookupErr == nil {
				result.Updated++
			} else if errors.Is(lookupErr, pgx.ErrNoRows) {
				result.Created++
			} else {
				result.Failed++
				result.Failures = append(result.Failures, LoRaWANV2SyncFailure{GatewaySN: gateway.SN, Error: apperr.MessageOf(lookupErr)})
			}
		}
		if len(gateways) < loraWANV2MaxPageSize || (pagination.TotalPage > 0 && page >= pagination.TotalPage) {
			break
		}
	}
	return result, nil
}

func (s *Service) syncLoRaWANV2Gateway(ctx context.Context, source sqlc.DataSource, client *loraWANV2Client, gateway LoRaWANV2Gateway, actorID uuid.UUID) (LoRaWANV2GatewaySyncResult, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return LoRaWANV2GatewaySyncResult{}, apperr.Wrap(apperr.KindInternal, "begin lorawan_v2 gateway sync", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()
	q := s.queries.WithTx(tx)
	var ref LoRaWANV2GatewayRef
	lookupErr := tx.QueryRow(ctx, `SELECT device_id, data_source_id, gateway_sn, status, synced_at FROM lorawan_v2_device_refs WHERE data_source_id=$1 AND gateway_sn=$2`, source.ID, gateway.SN).Scan(&ref.DeviceID, &ref.DataSourceID, &ref.GatewaySN, &ref.Status, &ref.SyncedAt)
	name := "LoRa 网关 " + gateway.SN
	var device sqlc.Device
	if lookupErr == nil {
		device, err = q.GetDevice(ctx, ref.DeviceID)
		if err == nil {
			device, err = q.UpdateDevice(ctx, sqlc.UpdateDeviceParams{ID: device.ID, ProductID: optionalString(loraWANV2ProductID), Name: name, Status: device.Status})
		}
		if err != nil {
			return LoRaWANV2GatewaySyncResult{}, mapWriteError(err, "update lorawan_v2 gateway")
		}
	} else if errors.Is(lookupErr, pgx.ErrNoRows) {
		device, err = q.CreateDevice(ctx, sqlc.CreateDeviceParams{ProductID: optionalString(loraWANV2ProductID), Name: name})
		if err != nil {
			return LoRaWANV2GatewaySyncResult{}, mapWriteError(err, "create lorawan_v2 gateway")
		}
	} else {
		return LoRaWANV2GatewaySyncResult{}, apperr.Wrap(apperr.KindInternal, "lookup lorawan_v2 gateway reference", lookupErr)
	}
	device, err = q.UpdateDeviceType(ctx, sqlc.UpdateDeviceTypeParams{ID: device.ID, DeviceType: "gateway"})
	if err != nil {
		return LoRaWANV2GatewaySyncResult{}, mapWriteError(err, "set lorawan_v2 gateway type")
	}
	if err := q.UpsertLoRaWANV2Metadata(ctx, sqlc.UpsertLoRaWANV2MetadataParams{DeviceID: device.ID, Key: "lorawan_v2_nodes_count", Name: "LoRa 节点数", ValueType: "number", Column5: []byte(strconv.Itoa(gateway.NodeCount)), CreatedBy: actorID}); err != nil {
		return LoRaWANV2GatewaySyncResult{}, mapWriteError(err, "upsert lorawan_v2 node count")
	}
	if _, err := tx.Exec(ctx, `INSERT INTO lorawan_v2_device_refs (device_id, data_source_id, gateway_sn, status, synced_at) VALUES ($1,$2,$3,'active',now()) ON CONFLICT (data_source_id, gateway_sn) DO UPDATE SET device_id=EXCLUDED.device_id,status='active',synced_at=now(),updated_at=now()`, device.ID, source.ID, gateway.SN); err != nil {
		return LoRaWANV2GatewaySyncResult{}, apperr.Wrap(apperr.KindInternal, "upsert lorawan_v2 gateway reference", err)
	}
	if err := tx.QueryRow(ctx, `SELECT device_id, data_source_id, gateway_sn, status, synced_at FROM lorawan_v2_device_refs WHERE data_source_id=$1 AND gateway_sn=$2`, source.ID, gateway.SN).Scan(&ref.DeviceID, &ref.DataSourceID, &ref.GatewaySN, &ref.Status, &ref.SyncedAt); err != nil {
		return LoRaWANV2GatewaySyncResult{}, apperr.Wrap(apperr.KindInternal, "read lorawan_v2 gateway reference", err)
	}
	specs, err := loraWANV2DiscoverStreams(ctx, client, gateway)
	if err != nil {
		return LoRaWANV2GatewaySyncResult{}, err
	}
	streams := make([]SyncedDataStream, 0, len(specs))
	bindings := make([]DataStreamBinding, 0, len(specs))
	for _, spec := range specs {
		stream, err := q.UpsertDataStreamFromSync(ctx, sqlc.UpsertDataStreamFromSyncParams{DeviceID: device.ID, Code: spec.Code, Name: spec.Name, Type: "telemetry", Unit: optionalString(spec.Unit), CreatedBy: actorID})
		if err != nil {
			return LoRaWANV2GatewaySyncResult{}, mapWriteError(err, "upsert lorawan_v2 stream")
		}
		binding, err := upsertLoRaWANV2DataStreamBinding(ctx, q, source.ID, stream.ID, spec.AdapterConfig, actorID)
		if err != nil {
			return LoRaWANV2GatewaySyncResult{}, err
		}
		streams = append(streams, syncedDataStreamFromSQL(stream))
		bindings = append(bindings, binding)
	}
	if err := tx.Commit(ctx); err != nil {
		return LoRaWANV2GatewaySyncResult{}, apperr.Wrap(apperr.KindInternal, "commit lorawan_v2 gateway sync", err)
	}
	committed = true
	return LoRaWANV2GatewaySyncResult{Device: syncedDeviceFromSQL(device, nil), SourceRef: ref, Gateway: gateway, DataStreams: streams, Bindings: bindings}, nil
}

func loraWANV2DiscoverStreams(ctx context.Context, client *loraWANV2Client, gateway LoRaWANV2Gateway) ([]loraWANV2StreamSpec, error) {
	seen := map[string]loraWANV2StreamSpec{}
	end, start := time.Now().UTC(), time.Now().UTC().AddDate(0, 0, -3)
	collect := func(nodeIndex *int) error {
		units := map[string]string{}
		if nodeIndex != nil {
			units = loraWANV2NodeMetricUnits(ctx, client, gateway.SN, *nodeIndex)
		}
		records, _, err := client.listRecords(ctx, loraWANV2TelemetryConfig{GatewaySN: gateway.SN, NodeIndex: nodeIndex}, start, end, 1)
		if err != nil {
			if nodeIndex != nil {
				return nil
			}
			return err
		}
		if len(records) == 0 {
			return nil
		}
		for key, raw := range records[0].Values {
			if key == "ts" || key == "meta" {
				continue
			}
			if _, ok := loraWANV2Number(raw); !ok {
				continue
			}
			prefix, name := "gateway", "网关"
			if nodeIndex != nil {
				prefix, name = "node_"+strconv.Itoa(*nodeIndex), "节点 "+strconv.Itoa(*nodeIndex)
			}
			code := loraWANV2StreamCode(prefix, key)
			cfg, _ := json.Marshal(loraWANV2TelemetryConfig{GatewaySN: gateway.SN, NodeIndex: nodeIndex, Metric: key})
			seen[code] = loraWANV2StreamSpec{Code: code, Name: name + " · " + key, Unit: units[key], AdapterConfig: cfg}
		}
		return nil
	}
	if err := collect(nil); err != nil {
		return nil, err
	}
	for node := 1; node <= gateway.NodeCount; node++ {
		index := node
		if err := collect(&index); err != nil {
			return nil, err
		}
	}
	result := make([]loraWANV2StreamSpec, 0, len(seen))
	for _, spec := range seen {
		result = append(result, spec)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Code < result[j].Code })
	return result, nil
}

func loraWANV2NodeMetricUnits(ctx context.Context, client *loraWANV2Client, gatewaySN string, nodeIndex int) map[string]string {
	result := map[string]string{}
	payload, err := client.request(ctx, http.MethodGet, "/device/"+url.PathEscape(gatewaySN)+"/node/"+strconv.Itoa(nodeIndex)+"/sensor_config/latest", url.Values{}, nil)
	if err != nil {
		return result
	}
	var config struct {
		Content any `json:"content"`
	}
	if json.Unmarshal(payload, &config) != nil {
		return result
	}
	var scan func(any)
	scan = func(value any) {
		items, ok := value.([]any)
		if !ok {
			return
		}
		if len(items) >= 3 {
			key, keyOK := items[0].(string)
			unit, unitOK := items[2].(string)
			if keyOK && unitOK && strings.TrimSpace(key) != "" {
				result[key] = strings.TrimSpace(unit)
			}
		}
		for _, item := range items {
			scan(item)
		}
	}
	scan(config.Content)
	return result
}

func loraWANV2StreamCode(prefix, metric string) string {
	metric = strings.ToLower(strings.TrimSpace(metric))
	var builder strings.Builder
	for _, char := range metric {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
			builder.WriteRune(char)
		} else {
			builder.WriteByte('_')
		}
	}
	value := strings.Trim(builder.String(), "_")
	if value == "" {
		value = "metric"
	}
	return "lora_" + prefix + "_" + value
}

func upsertLoRaWANV2DataStreamBinding(ctx context.Context, q *sqlc.Queries, sourceID, streamID uuid.UUID, cfg json.RawMessage, actorID uuid.UUID) (DataStreamBinding, error) {
	input := CreateDataStreamBindingInput{DataStreamID: streamID, DataSourceID: sourceID, AdapterCode: AdapterLoRaWANV2, PayloadType: "json", AdapterConfigJSON: cfg, ActorUserID: actorID}
	normalized, err := normalizeBinding(input, "active")
	if err != nil {
		return DataStreamBinding{}, err
	}
	current, err := q.GetActiveDataStreamBinding(ctx, streamID)
	if err == nil {
		updated, err := q.UpdateDataStreamBinding(ctx, sqlc.UpdateDataStreamBindingParams{ID: current.ID, DataSourceID: sourceID, AdapterCode: normalized.AdapterCode, DatabaseName: normalized.DatabaseName, SchemaName: normalized.SchemaName, TableName: normalized.TableName, DeviceKeyField: normalized.DeviceKeyField, DeviceKeyValue: normalized.DeviceKeyValue, TimeField: normalized.TimeField, ValueField: normalized.ValueField, PayloadType: normalized.PayloadType, AdapterConfigJson: normalized.AdapterConfigJSON, Status: normalized.Status})
		if err != nil {
			return DataStreamBinding{}, mapWriteError(err, "update lorawan_v2 data stream binding")
		}
		return bindingFromUpdateRow(updated), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return DataStreamBinding{}, apperr.Wrap(apperr.KindInternal, "lookup lorawan_v2 data stream binding", err)
	}
	created, err := q.CreateDataStreamBinding(ctx, sqlc.CreateDataStreamBindingParams{DataStreamID: streamID, DataSourceID: sourceID, AdapterCode: normalized.AdapterCode, DatabaseName: normalized.DatabaseName, SchemaName: normalized.SchemaName, TableName: normalized.TableName, DeviceKeyField: normalized.DeviceKeyField, DeviceKeyValue: normalized.DeviceKeyValue, TimeField: normalized.TimeField, ValueField: normalized.ValueField, PayloadType: normalized.PayloadType, AdapterConfigJson: normalized.AdapterConfigJSON, CreatedBy: actorID, CreatedByType: "system_admin"})
	if err != nil {
		return DataStreamBinding{}, mapWriteError(err, "create lorawan_v2 data stream binding")
	}
	return bindingFromCreateRow(created), nil
}

func parseLoRaWANV2TelemetryConfig(raw json.RawMessage) (loraWANV2TelemetryConfig, error) {
	var cfg loraWANV2TelemetryConfig
	if err := json.Unmarshal(raw, &cfg); err != nil || strings.TrimSpace(cfg.GatewaySN) == "" || strings.TrimSpace(cfg.Metric) == "" {
		return cfg, apperr.New(apperr.KindDataSource, "invalid lorawan_v2 adapter_config")
	}
	if cfg.NodeIndex != nil && *cfg.NodeIndex < 1 {
		return cfg, apperr.New(apperr.KindDataSource, "invalid lorawan_v2 node_index")
	}
	return cfg, nil
}

func (r *Runtime) queryLoRaWANV2Telemetry(ctx context.Context, source DataSource, req TelemetryQuery) (TelemetryResult, error) {
	if req.Limit <= 0 {
		return TelemetryResult{}, apperr.New(apperr.KindInvalidArgument, "limit must be greater than 0")
	}
	if req.Binding.PayloadType != "json" {
		return TelemetryResult{}, apperr.New(apperr.KindDataSource, "lorawan_v2 requires json telemetry payload")
	}
	cfg, err := parseLoRaWANV2TelemetryConfig(req.Binding.AdapterConfigJSON)
	if err != nil {
		return TelemetryResult{}, err
	}
	client, err := newLoRaWANV2Client(ctx, r.resolver, source)
	if err != nil {
		return TelemetryResult{}, err
	}
	records, complete, err := client.listRecords(ctx, cfg, req.Start, req.End, req.Limit)
	if err != nil {
		return TelemetryResult{}, err
	}
	points := loraWANV2Points(records, cfg.Metric)
	return TelemetryResult{Points: points, SourceCount: len(points), Complete: complete}, nil
}

func (r *Runtime) queryLoRaWANV2TelemetryBatch(ctx context.Context, source DataSource, req TelemetryBatchQuery, bindings []DataStreamBinding, result *TelemetryBatchResult) error {
	if len(bindings) == 0 {
		return nil
	}
	client, err := newLoRaWANV2Client(ctx, r.resolver, source)
	if err != nil {
		return err
	}
	groups := map[string][]struct {
		binding DataStreamBinding
		config  loraWANV2TelemetryConfig
	}{}
	for _, binding := range bindings {
		cfg, err := parseLoRaWANV2TelemetryConfig(binding.AdapterConfigJSON)
		if err != nil {
			return err
		}
		key := cfg.GatewaySN + "/gateway"
		if cfg.NodeIndex != nil {
			key = cfg.GatewaySN + "/node/" + strconv.Itoa(*cfg.NodeIndex)
		}
		groups[key] = append(groups[key], struct {
			binding DataStreamBinding
			config  loraWANV2TelemetryConfig
		}{binding, cfg})
	}
	for _, group := range groups {
		records, complete, err := client.listRecords(ctx, group[0].config, req.Start, req.End, req.Limit)
		if err != nil {
			return err
		}
		result.SourceScans++
		result.RowsRead += len(records)
		for _, item := range group {
			points := loraWANV2Points(records, item.config.Metric)
			result.Series[item.binding.DataStreamID] = TelemetryResult{Points: points, SourceCount: len(points), Complete: complete}
		}
	}
	return nil
}

func loraWANV2Points(records []loraWANV2Record, metric string) []TelemetryPoint {
	points := make([]TelemetryPoint, 0, len(records))
	for _, record := range records {
		if value, ok := loraWANV2Number(record.Values[metric]); ok {
			points = append(points, TelemetryPoint{Timestamp: record.Timestamp, Value: value, Quality: "valid"})
		}
	}
	return points
}

func (s *Service) LoRaWANV2GatewayForDevice(ctx context.Context, deviceID uuid.UUID) (LoRaWANV2GatewayRef, error) {
	var ref LoRaWANV2GatewayRef
	err := s.db.QueryRow(ctx, `SELECT device_id, data_source_id, gateway_sn, status, synced_at FROM lorawan_v2_device_refs WHERE device_id=$1 AND status='active' ORDER BY synced_at DESC LIMIT 1`, deviceID).Scan(&ref.DeviceID, &ref.DataSourceID, &ref.GatewaySN, &ref.Status, &ref.SyncedAt)
	if err != nil {
		return ref, mapNotFoundOrInternal(err, "lorawan_v2 device reference not found")
	}
	return ref, nil
}

func loraWANV2PathSN(sn string) (string, error) {
	sn = strings.TrimSpace(sn)
	if sn == "" || strings.ContainsAny(sn, "/\\") {
		return "", apperr.New(apperr.KindInvalidArgument, "gateway sn is required")
	}
	return sn, nil
}
