package datasource

import (
	"context"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/datasource/sources/carbon"
	"thcpn-gin/internal/datasource/sources/lorawanv2"
	"thcpn-gin/internal/datasource/sources/thcpn"
	"thcpn-gin/internal/objectstore"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service composes platform orchestration and independent source modules.
type Service struct {
	modules  map[string]sourceModule
	creators map[string]deviceCreator
	*platform.Service
	THCPN   *thcpn.Service
	Carbon  *carbon.Service
	LoRaWAN *lorawanv2.Service
}

func NewService(db *pgxpool.Pool, stores ...objectstore.Store) *Service {
	p := platform.NewService(db, stores...)
	p.Runtime = NewRuntime(nil)
	s := &Service{Service: p, THCPN: thcpn.New(p), Carbon: carbon.New(p), LoRaWAN: lorawanv2.New(p)}
	s.registerModules()
	p.TemplateValidators = templateValidators()
	p.TemplateProjectors = map[string]platform.TemplateProjector{platform.SourceFamilyTHCPN: thcpn.ProjectTemplate}
	p.SensorTargetResolver = func(ctx context.Context, id uuid.UUID) (string, *string, error) {
		module, err := s.moduleForDevice(ctx, id)
		if err != nil {
			return "", nil, err
		}
		if module.TemplateTarget == nil {
			return "", nil, unsupportedCapability()
		}
		return module.TemplateTarget(ctx, id)

	}
	return s
}
func templateValidators() map[string]platform.TemplateValidator {
	return map[string]platform.TemplateValidator{
		platform.SourceFamilyTHCPN:     func(map[string]any, map[string]bool) error { return nil },
		platform.SourceFamilyLoRaWANV2: lorawanv2.ValidateTemplate,
	}
}
