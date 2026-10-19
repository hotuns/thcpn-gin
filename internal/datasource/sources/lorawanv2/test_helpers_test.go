package lorawanv2

import (
	"context"
	"thcpn-gin/internal/datasource/platform"

	"github.com/jackc/pgx/v5/pgxpool"
)

func newTestService(db *pgxpool.Pool) *Service {
	p := platform.NewService(db)
	p.TemplateValidators = map[string]platform.TemplateValidator{"lorawan_v2": ValidateTemplate}
	p.Catalog.Families["lorawan_v2"] = "http_api"
	p.Catalog.Adapters[platform.AdapterLoRaWANV2] = BindingDefinition()
	return New(p)
}
func newTestRuntime(resolver platform.SecretResolver) *platform.Runtime {
	r := platform.NewRuntime(resolver)
	l := &Runtime{Runtime: r}
	r.TelemetryReaders = map[string]func(context.Context, platform.DataSource, platform.TelemetryQuery) (platform.TelemetryResult, error){platform.AdapterLoRaWANV2: l.QueryLoRaWANV2Telemetry}
	r.BatchReaders = map[string]func(context.Context, platform.DataSource, platform.TelemetryBatchQuery) (platform.TelemetryBatchResult, error){platform.AdapterLoRaWANV2: l.QueryBatch}
	return r
}

type staticResolver string

func (s staticResolver) Resolve(context.Context, string) (string, error) { return string(s), nil }
