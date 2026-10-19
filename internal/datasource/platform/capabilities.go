package platform

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type ConfigManager interface {
	GetDeviceConfig(context.Context, uuid.UUID) (DeviceConfigDetail, error)
	UpdateDeviceConfig(context.Context, UpdateDeviceConfigInput) (UpdateDeviceConfigResult, error)
}
type ConfigReconciler interface {
	ReconcileConfig(context.Context, uuid.UUID, uuid.UUID) (UpdateDeviceConfigResult, error)
}
type SamplingManager interface {
	GetSamplingProfile(context.Context, uuid.UUID) (SamplingProfileResponse, error)
	UpdateSamplingProfile(context.Context, SamplingProfileUpdateInput) (SamplingProfileResponse, error)
}

type NodeRuntimeReader interface {
	ReadNodeRuntime(context.Context, uuid.UUID, int, string, time.Time) (NodeRuntime, error)
}
