package platform

import (
	"time"
)

// NodeRuntime is independent of sensor metric mappings: diagnostics belong to
// the node itself, and a changed sensor configuration must not hide them.
type NodeRuntime struct {
	Key       string     `json:"key"`
	SampledAt *time.Time `json:"sampled_at,omitempty"`
	Battery   *float64   `json:"battery,omitempty"`
	RSSI      *float64   `json:"rssi,omitempty"`
	SNR       *float64   `json:"snr,omitempty"`
	Error     string     `json:"error,omitempty"`
}
