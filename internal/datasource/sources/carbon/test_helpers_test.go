package carbon

import (
	"thcpn-gin/internal/datasource/platform"

	"github.com/jackc/pgx/v5/pgxpool"
)

func newTestService(db *pgxpool.Pool) *Service { p := platform.NewService(db); return New(p) }
