package export

import (
	"context"
	"fmt"
	"path"

	"github.com/google/uuid"
)

func (p *Processor) exportObjectKey(ctx context.Context, job Job, extension string) (string, error) {
	label := "dataset"
	if job.ResourceType != "dataset" {
		id, deviceCount := job.ResourceID, 1
		switch job.ResourceType {
		case "data_stream", "media":
			stream, err := p.queries.GetDataStream(ctx, id)
			if err != nil {
				return "", mapNotFoundOrInternal(err, "export data stream not found")
			}
			id = stream.DeviceID
		case "device_batch":
			cfg, err := parseBatchExportConfig(job.RequestConfig)
			if err != nil {
				return "", err
			}
			if job.ExportType == "group_site_zip" {
				id, err = uuid.Parse(cfg.GatewayID)
				if err != nil {
					return "", err
				}
			} else {
				deviceCount = len(cfg.DeviceIDs)
			}
		}
		asset, err := p.devices.GetAsset(ctx, id)
		if err != nil {
			return "", err
		}
		label = safeArchiveSegment(asset.AssetNo)
		if label == "" {
			label = "device"
		}
		if deviceCount > 1 {
			label += fmt.Sprintf("_%d-devices", deviceCount)
		}
	}
	filename := label + "_" + job.CreatedAt.In(exportLocation).Format("20060102-150405") + "." + extension
	if job.RequestedByAdmin != nil {
		return path.Join("exports", "admin", job.RequestedByAdmin.String(), job.ID.String(), filename), nil
	}
	return path.Join("exports", job.WorkspaceID.String(), job.ID.String(), filename), nil
}
