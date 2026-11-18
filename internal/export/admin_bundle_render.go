package export

import (
	"archive/zip"
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"path"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func (p *Processor) renderAdminBundleZIP(ctx context.Context, job Job, output io.Writer) error {
	if job.RequestedByAdmin == nil || *job.RequestedByAdmin == uuid.Nil {
		return apperr.New(apperr.KindPermissionDenied, "只有后台管理员可导出设备批量压缩包")
	}
	cfg, err := parseAdminBundleConfig(job.RequestConfig)
	if err != nil {
		return err
	}
	archive := zip.NewWriter(output)
	usedPaths := make(map[string]int, len(cfg.Parts))
	manifest := [][]string{{"asset_no", "device_name", "file"}}
	for i, part := range cfg.Parts {
		asset, err := p.devices.GetAsset(ctx, cfg.DeviceIDs[i])
		if err != nil {
			return apperr.Wrap(apperr.KindOf(err), fmt.Sprintf("第 %d 台设备导出失败：%s", i+1, apperr.MessageOf(err)), err)
		}
		label := safeArchiveSegment(asset.AssetNo)
		if label == "" {
			label = fmt.Sprintf("device-%d", i+1)
		}
		extension, method := adminBundleEntryFormat(part.ExportType)
		filename := uniqueArchivePath(path.Join(label, label+"."+extension), usedPaths)
		entry, err := archive.CreateHeader(&zip.FileHeader{Name: filename, Method: method})
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "无法创建导出文件："+filename, err)
		}
		// The child uses the task's context and progress counters. Archive parts
		// write directly to this entry, avoiding a second temporary file.
		child := job
		child.ResourceType, child.ResourceID = part.ResourceType, part.ResourceID
		child.ExportType, child.RequestConfig = part.ExportType, part.RequestConfig
		rendered, err := p.render(ctx, child, entry)
		if err != nil {
			return apperr.Wrap(apperr.KindOf(err), fmt.Sprintf("设备 %s 导出失败：%s", label, apperr.MessageOf(err)), err)
		}
		if len(rendered.Body) > 0 {
			if _, err := entry.Write(rendered.Body); err != nil {
				return apperr.Wrap(apperr.KindInternal, "无法写入导出文件："+filename, err)
			}
		}
		manifest = append(manifest, []string{asset.AssetNo, asset.Name, filename})
	}
	file, err := archive.Create("devices.csv")
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "无法创建设备清单", err)
	}
	if err := csv.NewWriter(file).WriteAll(manifest); err != nil {
		return apperr.Wrap(apperr.KindInternal, "无法写入设备清单", err)
	}
	if err := archive.Close(); err != nil {
		return apperr.Wrap(apperr.KindInternal, "无法完成设备批量压缩包", err)
	}
	return nil
}

func adminBundleEntryFormat(exportType string) (string, uint16) {
	switch exportType {
	case "telemetry_excel":
		return "xlsx", zip.Store
	case "telemetry_csv":
		return "csv", zip.Deflate
	default:
		return "zip", zip.Store
	}
}
