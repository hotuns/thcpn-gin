package platform

import "github.com/google/uuid"

type SourceFirmwareInput struct {
	GatewaySN        string
	EncodedVersion   uint32
	DataSourceID     uuid.UUID
	SourceFamily     string
	ExternalDeviceID int64
	Version          string
	BuildID          *int64
	ObjectKey        string
	PublicURL        string
	VerifyValue      string
}
