package processing

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"thcpn-gin/internal/apperr"
)

type Client struct {
	baseURL string
	http    *http.Client
}

type ProcessorManifest struct {
	Code        string          `json:"code"`
	Version     string          `json:"version"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Raw         json.RawMessage `json:"-"`
}

type ExecuteRequest struct {
	RequestID        string            `json:"request_id"`
	ProcessorCode    string            `json:"processor_code"`
	ProcessorVersion string            `json:"processor_version"`
	Inputs           json.RawMessage   `json:"inputs"`
	Parameters       json.RawMessage   `json:"parameters"`
	OutputUploads    map[string]string `json:"output_uploads"`
}

type ExecutionState struct {
	ExecutionID string          `json:"execution_id"`
	RequestID   string          `json:"request_id"`
	Status      string          `json:"status"`
	Outputs     json.RawMessage `json:"outputs"`
	Error       string          `json:"error"`
}

func NewClient(baseURL string) *Client {
	return &Client{baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"), http: &http.Client{Timeout: 30 * time.Second}}
}

func (c *Client) ResolveURL(value string) string {
	if strings.HasPrefix(value, "/") {
		return c.baseURL + value
	}
	return value
}

func (c *Client) Catalog(ctx context.Context) ([]ProcessorManifest, error) {
	var response struct {
		Items []json.RawMessage `json:"items"`
	}
	if err := c.do(ctx, http.MethodGet, "/v1/processors", nil, &response); err != nil {
		return nil, err
	}
	items := make([]ProcessorManifest, 0, len(response.Items))
	for _, raw := range response.Items {
		var item ProcessorManifest
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "decode processor manifest", err)
		}
		item.Raw = raw
		items = append(items, item)
	}
	return items, nil
}

func (c *Client) Submit(ctx context.Context, input ExecuteRequest) (ExecutionState, error) {
	var result ExecutionState
	if err := c.do(ctx, http.MethodPost, "/v1/executions", input, &result); err != nil {
		return ExecutionState{}, err
	}
	return result, nil
}

func (c *Client) Execution(ctx context.Context, id string) (ExecutionState, error) {
	var result ExecutionState
	if err := c.do(ctx, http.MethodGet, "/v1/executions/"+id, nil, &result); err != nil {
		return ExecutionState{}, err
	}
	return result, nil
}

func (c *Client) do(ctx context.Context, method, path string, input any, output any) error {
	var body *bytes.Reader
	if input == nil {
		body = bytes.NewReader(nil)
	} else {
		encoded, err := json.Marshal(input)
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "encode processor request", err)
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "create processor request", err)
	}
	req.Header.Set("Accept", "application/json")
	if input != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return apperr.Wrap(apperr.KindDataSource, "processor unavailable", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return apperr.New(apperr.KindDataSource, fmt.Sprintf("processor returned %s", resp.Status))
	}
	if err := json.NewDecoder(resp.Body).Decode(output); err != nil {
		return apperr.Wrap(apperr.KindInternal, "decode processor response", err)
	}
	return nil
}
