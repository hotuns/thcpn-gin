package platform

import (
	"context"

	"github.com/google/uuid"
)

type SyncQueue interface {
	EnqueueSourceSync(context.Context, uuid.UUID) error
}
type SyncProgressKey struct{}

func ReportSyncProgress(ctx context.Context, result any) {
	if report, ok := ctx.Value(SyncProgressKey{}).(func(any)); ok {
		report(result)
	}
}
