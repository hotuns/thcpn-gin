package datasource

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/datasource/sources/lorawanv2"
	"thcpn-gin/internal/datasource/sources/thcpn"
	"thcpn-gin/internal/observation"
)

// NewRuntime registers query capabilities once; protocol-specific grouping stays in each source.
func NewRuntime(resolver platform.SecretResolver, db ...*pgxpool.Pool) *platform.Runtime {
	r := platform.NewRuntime(resolver)
	if len(db) > 0 && db[0] != nil {
		r.Window = observation.Service{DB: db[0]}.StreamWindow
	}
	t := &thcpn.Runtime{Runtime: r}
	l := &lorawanv2.Runtime{Runtime: r}
	r.TelemetryReaders = map[string]func(context.Context, platform.DataSource, platform.TelemetryQuery) (platform.TelemetryResult, error){platform.AdapterTHCPNLegacy: t.QueryThcpnLegacyMySQLTelemetry, platform.AdapterLoRaWANV2: l.QueryLoRaWANV2Telemetry}
	r.BatchReaders = map[string]func(context.Context, platform.DataSource, platform.TelemetryBatchQuery) (platform.TelemetryBatchResult, error){platform.AdapterTHCPNLegacy: t.QueryBatch, platform.AdapterLoRaWANV2: l.QueryBatch}
	r.MediaReaders = map[string]func(context.Context, platform.DataSource, platform.MediaQuery) (platform.MediaResult, error){platform.AdapterTHCPNLegacy: t.QueryThcpnLegacyMySQLMedia}
	return r
}
