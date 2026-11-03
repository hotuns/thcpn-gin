import { ChevronDown, Download, RefreshCw } from "lucide-react";
import { type ExportJob, type JsonRecord } from "@thcpn/api";
import { Badge, Button } from "../../shared/ui";
import { useLocale } from "@thcpn/i18n";
import { resolveExportTargets } from "./export-targets";
import { canDownloadExport } from "./export-model";

export const displayTime = (input?: string) =>
  input
    ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(input))
    : "—";

export const exportResourceLabel = (
  job: Pick<ExportJob, "export_type" | "resource_type">,
) =>
  String(job.export_type) === "group_site_zip"
    ? "组网站"
    : String(job.export_type) === "standard_station_zip"
      ? "标准站"
      : String(job.export_type) === "carbon_station_zip"
        ? "碳汇站"
        : job.resource_type === "dataset"
          ? "数据集"
          : "数据导出";

const exportDownloadLabel = () => "下载 ZIP";

export function ExportProgress({job}:{job:ExportJob}) {
  const {t}=useLocale();
  const progress=job.progress;
  if (!progress?.stage) return null;
  return <div className="cell-sub" role="status">{t(progress.stage === "uploading" ? "exportEditor.uploadingProgress" : "exportEditor.packingProgress", {count:progress.packed_images ?? 0, size: `${((progress.packed_bytes ?? 0)/1048576).toFixed(1)} MB`})}</div>;
}

function RetryExportButton({busy,onRetry}:{busy:boolean;onRetry:()=>void}){
  const {t}=useLocale();return <Button variant="secondary" disabled={busy} onClick={onRetry}><RefreshCw size={13}/>{t("exportEditor.retry")}</Button>;
}

export function ExportRowActions({job,expanded,downloading,retrying,onToggle,onDownload,onRetry}:{job:ExportJob;expanded:boolean;downloading:boolean;retrying:boolean;onToggle:()=>void;onDownload:()=>void;onRetry:()=>void}) {
  const available=canDownloadExport(job);
  const unavailable=["pending","running"].includes(job.status) ? "正在生成" : job.status === "success" ? "文件已过期" : "不可下载";
  return <div className="table-actions export-row-actions">
    <Button variant="secondary" aria-expanded={expanded} aria-controls={`export-detail-${job.id}`} onClick={onToggle}><ChevronDown size={13}/>{expanded ? "收起" : "详情"}</Button>
    <Button variant="secondary" disabled={!available || downloading} onClick={onDownload}><Download size={13}/>{available ? downloading ? "准备中…" : exportDownloadLabel() : unavailable}</Button>
    {job.status === "failed" && <RetryExportButton busy={retrying} onRetry={onRetry}/>}
  </div>;
}

export function ExportStatus({ status }: { status: string }) {
  const tone =
    status === "success"
      ? "success"
      : status === "failed"
        ? "danger"
        : ["pending", "running"].includes(status)
          ? "warning"
          : "neutral";
  const label =
    status === "pending"
      ? "排队中"
      : status === "running"
        ? "处理中"
        : status === "success"
          ? "已完成"
          : status === "failed"
            ? "失败"
            : "已过期";
  return <Badge tone={tone}>{label}</Badge>;
}

export function ExportDetail({ job, devices }: { job: ExportJob; devices: JsonRecord[] }) {
  const { t } = useLocale();
  const targets = resolveExportTargets(job, devices);
  return (
    <div className="export-detail">
      <div className="export-detail-grid">
        <div>
          <span>设备体系</span>
          <strong>{exportResourceLabel(job)}</strong>
        </div>
        <div>
          <span>目标</span>
          <strong>{targets.countLabel}</strong>
        </div>
        <div>
          <span>创建时间</span>
          <strong>{displayTime(job.created_at)}</strong>
        </div>
        <div>
          <span>完成时间</span>
          <strong>{displayTime(job.finished_at)}</strong>
        </div>
        <div>
          <span>过期时间</span>
          <strong>{displayTime(job.expires_at)}</strong>
        </div>
      </div>
      <section className="export-target-details">
        <h3>导出目标{targets.station ? ` · ${targets.station.name}（${targets.station.description}）` : ""}</h3>
        <ul>{targets.items.map(target => <li key={target.key}><strong>{target.name}</strong><span className="cell-sub mono">{target.description}</span></li>)}</ul>
        {targets.fields.length > 0 && <p className="cell-sub">{t("exportEditor.plotNames", { names: targets.fields.join("、") })}</p>}
      </section>
      {job.error_message && (
        <div className="form-error">{job.error_message}</div>
      )}
      <div className="export-config">
        <h3>ZIP 基础内容</h3>
        <div>
          <span>清单</span>
          <strong>manifest.csv</strong>
        </div>
        <div>
          <span>生成情况</span>
          <strong>generation-report.csv</strong>
        </div>
        <div>
          <span>说明</span>
          <strong>README.txt</strong>
        </div>
      </div>
    </div>
  );
}
