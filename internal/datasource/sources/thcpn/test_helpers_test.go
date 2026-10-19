package thcpn

import (
	"context"
	"thcpn-gin/internal/datasource/platform"

	"github.com/jackc/pgx/v5/pgxpool"
)

func newTestService(db *pgxpool.Pool) *Service {
	p := platform.NewService(db)
	p.TemplateProjectors = map[string]platform.TemplateProjector{"thcpn": ProjectTemplate}
	p.TemplateValidators = map[string]platform.TemplateValidator{"thcpn": func(map[string]any, map[string]bool) error { return nil }}
	p.Catalog.Families["thcpn"] = "mysql"
	p.Catalog.Adapters[platform.AdapterTHCPNLegacy] = BindingDefinition()
	return New(p)
}

func newTestRuntime(resolver platform.SecretResolver) *platform.Runtime {
	r := platform.NewRuntime(resolver)
	legacy := &Runtime{Runtime: r}
	r.TelemetryReaders = map[string]func(context.Context, platform.DataSource, platform.TelemetryQuery) (platform.TelemetryResult, error){platform.AdapterTHCPNLegacy: legacy.QueryThcpnLegacyMySQLTelemetry}
	r.MediaReaders = map[string]func(context.Context, platform.DataSource, platform.MediaQuery) (platform.MediaResult, error){platform.AdapterTHCPNLegacy: legacy.QueryThcpnLegacyMySQLMedia}
	r.BatchReaders = map[string]func(context.Context, platform.DataSource, platform.TelemetryBatchQuery) (platform.TelemetryBatchResult, error){platform.AdapterTHCPNLegacy: legacy.QueryBatch}
	return r
}
