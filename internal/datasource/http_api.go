package datasource

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"thcpn-gin/internal/apperr"
)

const maxHTTPAPIResponseBytes = 32 << 20

var httpAPIClient = &http.Client{Timeout: 30 * time.Second}

type httpAPIConfig struct {
	Method         string            `json:"method"`
	Path           string            `json:"path"`
	Headers        map[string]string `json:"headers"`
	DeviceKeyParam string            `json:"device_key_param"`
	StartTimeParam string            `json:"start_time_param"`
	EndTimeParam   string            `json:"end_time_param"`
	LimitParam     string            `json:"limit_param"`
	PageParam      string            `json:"page_param"`
	PageSizeParam  string            `json:"page_size_param"`
	MediaTypeParam string            `json:"media_type_param"`
}

func (r *Runtime) queryHTTPAPITelemetry(ctx context.Context, source DataSource, req TelemetryQuery) (TelemetryResult, error) {
	if err := validateHTTPTelemetryQuery(req); err != nil {
		return TelemetryResult{}, err
	}
	cfg, err := parseHTTPAPIConfig(req.Binding.QueryConfigJSON)
	if err != nil {
		return TelemetryResult{}, err
	}
	baseURL, err := r.resolver.Resolve(ctx, source.DsnSecretRef)
	if err != nil {
		return TelemetryResult{}, err
	}
	params := httpAPITelemetryParams(cfg, req)
	body, err := r.doHTTPAPIRequest(ctx, baseURL, cfg, params)
	if err != nil {
		return TelemetryResult{}, err
	}
	var result TelemetryResult
	if err := json.Unmarshal(body, &result); err != nil {
		return TelemetryResult{}, apperr.New(apperr.KindDataSource, "invalid http telemetry response")
	}
	for i := range result.Points {
		if result.Points[i].Quality == "" {
			result.Points[i].Quality = "valid"
		}
	}
	return result, nil
}

func (r *Runtime) queryHTTPAPIMedia(ctx context.Context, source DataSource, req MediaQuery) (MediaResult, error) {
	if err := validateMediaQuery(req); err != nil {
		return MediaResult{}, err
	}
	cfg, err := parseHTTPAPIConfig(req.Binding.QueryConfigJSON)
	if err != nil {
		return MediaResult{}, err
	}
	baseURL, err := r.resolver.Resolve(ctx, source.DsnSecretRef)
	if err != nil {
		return MediaResult{}, err
	}
	params := httpAPIMediaParams(cfg, req)
	body, err := r.doHTTPAPIRequest(ctx, baseURL, cfg, params)
	if err != nil {
		return MediaResult{}, err
	}
	var result MediaResult
	if err := json.Unmarshal(body, &result); err != nil {
		return MediaResult{}, apperr.New(apperr.KindDataSource, "invalid http media response")
	}
	if result.Total == 0 && len(result.Items) > 0 {
		result.Total = len(result.Items)
	}
	for i := range result.Items {
		if result.Items[i].MediaType == "" {
			result.Items[i].MediaType = req.MediaType
		}
	}
	return result, nil
}

func parseHTTPAPIConfig(raw json.RawMessage) (httpAPIConfig, error) {
	cfg := httpAPIConfig{Method: http.MethodGet}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return httpAPIConfig{}, apperr.New(apperr.KindInvalidArgument, "invalid http_api query_config")
		}
	}
	cfg.Method = strings.ToUpper(strings.TrimSpace(cfg.Method))
	if cfg.Method == "" {
		cfg.Method = http.MethodGet
	}
	switch cfg.Method {
	case http.MethodGet, http.MethodPost:
	default:
		return httpAPIConfig{}, apperr.New(apperr.KindInvalidArgument, "http_api method must be GET or POST")
	}
	path, err := cleanHTTPAPIPath(cfg.Path)
	if err != nil {
		return httpAPIConfig{}, err
	}
	cfg.Path = path
	return cfg, nil
}

func (r *Runtime) doHTTPAPIRequest(ctx context.Context, baseURL string, cfg httpAPIConfig, params map[string]string) ([]byte, error) {
	endpoint, err := httpAPIEndpoint(baseURL, cfg.Path)
	if err != nil {
		return nil, err
	}

	var body io.Reader
	if cfg.Method == http.MethodGet {
		values := endpoint.Query()
		for key, value := range params {
			if key != "" && value != "" {
				values.Set(key, value)
			}
		}
		endpoint.RawQuery = values.Encode()
	} else {
		data, err := json.Marshal(params)
		if err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "marshal http_api request", err)
		}
		body = bytes.NewReader(data)
	}

	request, err := http.NewRequestWithContext(ctx, cfg.Method, endpoint.String(), body)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "create http_api request", err)
	}
	if cfg.Method == http.MethodPost {
		request.Header.Set("Content-Type", "application/json")
	}
	request.Header.Set("Accept", "application/json")
	for key, value := range cfg.Headers {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key != "" && value != "" {
			request.Header.Set(key, value)
		}
	}

	response, err := httpAPIClient.Do(request)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "query http_api data source", err)
	}
	defer response.Body.Close()

	responseBody, err := io.ReadAll(io.LimitReader(response.Body, maxHTTPAPIResponseBytes+1))
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read http_api response", err)
	}
	if len(responseBody) > maxHTTPAPIResponseBytes {
		return nil, apperr.New(apperr.KindDataSource, "http_api response is too large")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, apperr.New(apperr.KindDataSource, "http_api data source returned non-success status")
	}
	return responseBody, nil
}

func httpAPITelemetryParams(cfg httpAPIConfig, req TelemetryQuery) map[string]string {
	return map[string]string{
		paramName(cfg.DeviceKeyParam, req.Binding.DeviceKeyField): req.Binding.DeviceKeyValue,
		paramName(cfg.StartTimeParam, "start_time"):               req.Start.UTC().Format(time.RFC3339Nano),
		paramName(cfg.EndTimeParam, "end_time"):                   req.End.UTC().Format(time.RFC3339Nano),
		paramName(cfg.LimitParam, "limit"):                        strconv.Itoa(req.Limit),
		"table_name":                                              req.Binding.TableName,
		"time_field":                                              req.Binding.TimeField,
		"value_field":                                             req.Binding.ValueField,
	}
}

func httpAPIMediaParams(cfg httpAPIConfig, req MediaQuery) map[string]string {
	params := map[string]string{
		paramName(cfg.DeviceKeyParam, req.Binding.DeviceKeyField): req.Binding.DeviceKeyValue,
		paramName(cfg.StartTimeParam, "start_time"):               req.Start.UTC().Format(time.RFC3339Nano),
		paramName(cfg.EndTimeParam, "end_time"):                   req.End.UTC().Format(time.RFC3339Nano),
		paramName(cfg.PageParam, "page"):                          strconv.Itoa(req.Page),
		paramName(cfg.PageSizeParam, "page_size"):                 strconv.Itoa(req.PageSize),
		"table_name":  req.Binding.TableName,
		"time_field":  req.Binding.TimeField,
		"value_field": req.Binding.ValueField,
	}
	if strings.TrimSpace(req.MediaType) != "" {
		params[paramName(cfg.MediaTypeParam, "media_type")] = strings.TrimSpace(req.MediaType)
	}
	return params
}

func validateHTTPTelemetryQuery(req TelemetryQuery) error {
	switch req.Binding.PayloadType {
	case "columns", "json":
	default:
		return apperr.New(apperr.KindDataSource, "unsupported telemetry payload type")
	}
	if req.Limit <= 0 {
		return apperr.New(apperr.KindInvalidArgument, "limit must be greater than 0")
	}
	return nil
}

func httpAPIEndpoint(baseURL string, cfgPath string) (*url.URL, error) {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		return nil, apperr.New(apperr.KindDataSource, "http_api base url is not configured")
	}
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "parse http_api base url", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, apperr.New(apperr.KindDataSource, "http_api base url must use http or https")
	}
	if parsed.Host == "" {
		return nil, apperr.New(apperr.KindDataSource, "http_api base url host is required")
	}
	if cfgPath != "" {
		parsed.Path = strings.TrimRight(parsed.Path, "/") + "/" + strings.TrimLeft(cfgPath, "/")
	}
	return parsed, nil
}

func cleanHTTPAPIPath(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if strings.Contains(value, `\`) {
		return "", apperr.New(apperr.KindInvalidArgument, "http_api path must be a relative URL path")
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return "", apperr.New(apperr.KindInvalidArgument, "invalid http_api path")
	}
	if parsed.IsAbs() || parsed.Host != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", apperr.New(apperr.KindInvalidArgument, "http_api path must be a relative URL path")
	}
	if !strings.HasPrefix(value, "/") {
		value = "/" + value
	}
	for _, segment := range strings.Split(value, "/") {
		if segment == ".." {
			return "", apperr.New(apperr.KindInvalidArgument, "http_api path must not contain parent directory segments")
		}
	}
	return value, nil
}

func paramName(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value != "" {
		return value
	}
	return fallback
}
