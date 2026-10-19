package platform

import (
	"slices"
	"strings"
	"thcpn-gin/internal/apperr"
)

type AdapterDefinition struct {
	Code            string
	SourceTypes     []string
	PayloadTypes    []string
	OptionalMapping bool
}
type Catalog struct {
	Families map[string]string
	Adapters map[string]AdapterDefinition
}

func NewCatalog() *Catalog {
	return &Catalog{Families: map[string]string{}, Adapters: map[string]AdapterDefinition{
		AdapterGenericColumns: {Code: AdapterGenericColumns, SourceTypes: []string{"postgres", "mysql", "clickhouse"}, PayloadTypes: []string{"columns"}},
		AdapterGenericMedia:   {Code: AdapterGenericMedia, SourceTypes: []string{"postgres", "mysql", "clickhouse"}, PayloadTypes: []string{"media"}},
		AdapterHTTPAPI:        {Code: AdapterHTTPAPI, SourceTypes: []string{"http_api"}, PayloadTypes: []string{"columns", "json", "media"}, OptionalMapping: true},
	}}
}
func (c *Catalog) ValidateAdapterSource(code, sourceType string) error {
	d, ok := c.Adapters[strings.TrimSpace(code)]
	if !ok {
		return apperr.New(apperr.KindInvalidArgument, "invalid adapter_code")
	}
	if !slices.Contains(d.SourceTypes, strings.TrimSpace(sourceType)) {
		return apperr.New(apperr.KindInvalidArgument, "adapter is incompatible with data source type")
	}
	return nil
}
func (c *Catalog) NormalizeSourceFamily(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	v := strings.TrimSpace(*value)
	if v == "" {
		return nil, nil
	}
	if _, ok := c.Families[v]; !ok {
		return nil, apperr.New(apperr.KindInvalidArgument, "invalid source_family")
	}
	return &v, nil
}
func (c *Catalog) ValidateSourceType(family *string, sourceType string) error {
	if family == nil {
		return nil
	}
	want, ok := c.Families[*family]
	if !ok || want != sourceType {
		return apperr.New(apperr.KindInvalidArgument, "source family is incompatible with data source type")
	}
	return nil
}
func (d AdapterDefinition) ValidatePayload(payload string) error {
	if !slices.Contains(d.PayloadTypes, payload) {
		return apperr.New(apperr.KindInvalidArgument, "adapter does not support this payload_type")
	}
	return nil
}
