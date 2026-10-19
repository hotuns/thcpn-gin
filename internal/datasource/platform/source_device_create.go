package platform

import (
	"crypto/md5"
	"fmt"

	"github.com/google/uuid"
)

const (
	CreatedSourceDeviceTHCPNStandard = "thcpn_standard"
	CreatedSourceDeviceTHCPNGateway  = "thcpn_gateway"
	CreatedSourceDeviceTHCPNNode     = "thcpn_node"
	CreatedSourceDeviceCarbon        = "carbon"
)

type CreateSourceDeviceInput struct {
	DataSourceID uuid.UUID
	SourceKind   string
	Name         string
	ICCID        string
	Version      string
	NodesCount   *int64
	ActorUserID  uuid.UUID
}
type CreatedSourceDevice struct {
	DataSourceID     uuid.UUID  `json:"data_source_id"`
	SourceDeviceID   int64      `json:"source_device_id"`
	SN               string     `json:"sn"`
	SourceKind       string     `json:"source_kind"`
	PlatformDeviceID *uuid.UUID `json:"platform_device_id,omitempty"`
	SyncError        string     `json:"sync_error,omitempty"`
}

func CreatedSourceDeviceSN(prefix string, id int64) string {
	return fmt.Sprintf("%x", md5.Sum([]byte(fmt.Sprintf("%s%d.Sonic513", prefix, id))))
}
