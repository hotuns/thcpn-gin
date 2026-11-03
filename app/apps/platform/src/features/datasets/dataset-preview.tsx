import { policyLimit } from "../../shared/config/system-policy";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Database } from "lucide-react";
import { api, formatApiError, type Dataset, type JsonRecord, type TelemetrySeries } from "@thcpn/api";
import { Badge, Panel, StateView } from "../../shared/ui";
import { TelemetryCharts } from "../../shared/telemetry/telemetry-charts";
import { TelemetryTable } from "../../shared/telemetry/telemetry-table";
import { datasetTypeLabel, datasetStatusLabel, sourceTypeLabel, displayTime } from "./dataset-format";
import { SourceName } from "./dataset-sources";

export function DatasetPreview({
  dataset,
  devices,
  projectName,
}: {
  dataset: Dataset;
  devices: JsonRecord[];
  projectName?: unknown;
}) {
  const datasetStartMs = Date.parse(dataset.time_start);
  const datasetEndMs = Date.parse(dataset.time_end);
  const validDatasetRange = Number.isFinite(datasetStartMs) && Number.isFinite(datasetEndMs) && datasetStartMs < datasetEndMs;
  const queryStart = validDatasetRange
    ? new Date(datasetStartMs).toISOString()
    : "";
  const queryEnd = validDatasetRange
    ? new Date(datasetEndMs).toISOString()
    : "";
  const previewable = ["telemetry", "mixed"].includes(dataset.data_type);
  const query = useQuery({
    queryKey: ["dataset", dataset.id, "preview", queryStart, queryEnd],
    queryFn: () =>
      api.telemetry.dataset(dataset.id, {
        startTime: queryStart,
        endTime: queryEnd,
        limit: Math.min(500,policyLimit("query_points",5000)),
      }),
    enabled: previewable && validDatasetRange,
  });
  const series = ((query.data as any)?.series ?? []) as TelemetrySeries[];
  const points = series
    .flatMap((item) => item.points.map((point) => ({ ...point, series: item })))
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return (
    <Panel className="section-gap dataset-page-panel dataset-preview">
      <div className="panel-header">
        <div>
          <div className="dataset-panel-heading">
            <h2 className="panel-title">数据预览</h2>
            <span className="dataset-panel-context">已保存范围</span>
          </div>

        </div>
      </div>
      <div className="dataset-preview-meta">
        <div className="dataset-preview-summary">
          <span>
            <small>数据类型</small>
            <strong>{datasetTypeLabel(dataset.data_type)}</strong>
          </span>
          <span>
            <small>数据来源</small>
            <strong>{dataset.sources.length} 项</strong>
          </span>
          <span>
            <small>所属项目</small>
            <strong>{String(projectName ?? "未关联项目")}</strong>
          </span>
          <span>
            <small>数据范围</small>
            <strong className="dataset-preview-time-range">
              {displayTime(dataset.time_start)} 至 {displayTime(dataset.time_end)}
            </strong>
          </span>
          <span>
            <small>当前状态</small>
            <Badge
              tone={
                dataset.status === "locked" || dataset.status === "published"
                  ? "success"
                  : "neutral"
              }
            >
              {datasetStatusLabel(dataset.status)}
            </Badge>
          </span>
        </div>
        <details className="dataset-source-details" open>
          <summary>
            <span>
              <Database size={14} aria-hidden="true" />
              查看数据来源
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div className="dataset-source-list">
            {dataset.sources.map((source) => (
              <div
                key={`${source.source_type}-${source.source_id}`}
                title={source.source_id}
              >
                <Database size={13} aria-hidden="true" />
                <SourceName source={source} devices={devices} />
                <small>{sourceTypeLabel(source.source_type)}</small>
              </div>
            ))}
          </div>
        </details>
      </div>
      {!previewable ? (
        <StateView
          type="empty"
          title="当前数据集没有设备数据预览"
          description="此页面已展示数据集定义和来源；在线图表目前用于设备数据和混合类型数据集。"
        />
      ) : !validDatasetRange ? (
        <StateView
          type="error"
          title="时间范围无效"
          description="数据集保存的开始时间必须早于结束时间，请进入编辑修正。"
        />
      ) : query.isFetching ? (
        <StateView
          type="loading"
          title="正在生成预览"
          description="正在读取并整理数据集数据。"
        />
      ) : query.error ? (
        <StateView
          type="error"
          title="预览失败"
          description={formatApiError(query.error).message}
          requestId={formatApiError(query.error).requestId}
        />
      ) : series.some((item) => item.points.length) ? (
        <>
          <TelemetryCharts
            series={series}
            startTime={queryStart}
            endTime={queryEnd}
          />
          <div className="panel-header dataset-detail-header">
            <div>
              <h3 className="panel-title">数据明细</h3>

            </div>
            <Badge tone="neutral">{points.length} 条</Badge>
          </div>
          <TelemetryTable points={points} formatTime={displayTime} />
        </>
      ) : (
        <StateView
          type="empty"
          title="没有设备数据"
          description="数据集可能只包含媒体来源，或所选时间内没有记录。"
        />
      )}
    </Panel>
  );
}
