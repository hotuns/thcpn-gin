package platform

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type RuntimeAttribute struct {
	RawValue    string    `json:"raw_value"`
	ParsedValue any       `json:"parsed_value,omitempty"`
	SampledAt   time.Time `json:"sampled_at"`
	SourceTable string    `json:"source_table"`
}
type RuntimeDevice struct {
	Latitude  *float64
	Longitude *float64
	Status    *string
	UpdatedAt *time.Time
}
type DeviceRuntimeItem struct {
	DeviceID     uuid.UUID
	SourceDevice RuntimeDevice
	Attributes   map[string]RuntimeAttribute
}
type DeviceRuntimeFailure struct {
	DeviceID uuid.UUID
	Error    string
}
type DeviceRuntimeBatch struct {
	Items       []DeviceRuntimeItem
	Failures    []DeviceRuntimeFailure
	RefreshedAt time.Time
}
type RuntimeReader interface {
	ReadDeviceRuntime(context.Context, []uuid.UUID) (DeviceRuntimeBatch, error)
}

type DeviceLocation struct {
	Latitude  *float64
	Longitude *float64
	AltitudeM *float64
}
type LiveLocationReader interface {
	ReadLiveLocations(context.Context, []uuid.UUID) (map[uuid.UUID]DeviceLocation, error)
}
