package export

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/systemsettings"
)

// Apply the content limit when a user creates a job. Existing jobs and admin exports keep their original scope.
func (s *Service) validateUserExportRange(ctx context.Context, resource ResolvedResource, raw []byte) error {
	imageDays := systemsettings.Int(ctx, "export_image_days", 31)
	dataDays := systemsettings.Int(ctx, "export_data_days", 365)
	var start, end time.Time
	var images bool
	if resource.ExportType == "dataset_zip" {
		ds, err := s.queries.GetDataset(ctx, resource.ResourceID)
		if err != nil {
			return mapNotFoundOrInternal(err, "dataset not found")
		}
		start, end = pgTimeValue(ds.TimeStart), pgTimeValue(ds.TimeEnd)
		if end.Sub(start) > time.Duration(min(imageDays, dataDays))*24*time.Hour {
			sources, err := s.queries.ListDatasetSources(ctx, ds.ID)
			if err != nil {
				return apperr.Wrap(apperr.KindInternal, "list dataset sources", err)
			}
			for _, source := range sources {
				if source.SourceType == "device" {
					images = true
					break
				}
				if source.SourceType == "data_stream" {
					stream, err := s.queries.GetDataStream(ctx, source.SourceID)
					if err != nil {
						return mapNotFoundOrInternal(err, "data stream source not found")
					}
					if isMediaStreamType(stream.Type) {
						images = true
						break
					}
				}
			}
		}
	} else {
		var cfg batchExportConfig
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return apperr.New(apperr.KindInvalidArgument, "导出时间范围无效")
		}
		start, end = cfg.StartTime, cfg.EndTime
		images = resource.ExportType == "media_zip" || ((resource.ExportType == "standard_station_zip" || resource.ExportType == "group_site_zip") && cfg.IncludeImages)
	}
	if start.IsZero() || end.IsZero() || !end.After(start) {
		return apperr.New(apperr.KindInvalidArgument, "请选择有效的导出开始和结束时间")
	}
	if images && end.Sub(start) > time.Duration(imageDays)*24*time.Hour {
		return apperr.New(apperr.KindInvalidArgument, fmt.Sprintf("含图片的导出最多支持 %d 天，请缩短时间范围或仅导出数据。", imageDays))
	}
	if !images && end.Sub(start) > time.Duration(dataDays)*24*time.Hour {
		return apperr.New(apperr.KindInvalidArgument, fmt.Sprintf("不含图片的导出最多支持 %d 天，请缩短时间范围。", dataDays))
	}
	return nil
}
