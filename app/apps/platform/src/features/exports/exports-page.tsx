import "./exports-mobile.css";
import "../../shared/data/mobile-data.css";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Check, FileArchive, Plus, RefreshCw, X } from "lucide-react";
import { api, formatApiError, type ExportJob, type JsonRecord } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Button, PageHeader, Panel, SelectInput, StateView, Table } from "../../shared/ui";
import { useLocale } from "@thcpn/i18n";
import { resolveExportTargets } from "./export-targets";
import { type ExportSystem } from "./export-model";
import { displayTime, exportResourceLabel, ExportProgress, ExportRowActions, ExportStatus, ExportDetail } from "./export-job";

export function ExportsPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { currentId } = useWorkspace();
  const [params] = useSearchParams();
  const requestedSystem = params.get("system") as ExportSystem | null;
  const [mine, setMine] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [feedback, setFeedback] = useState(location.state?.exportCreated ? "导出任务已创建" : "");
  const [downloading, setDownloading] = useState("");
  const [retrying,setRetrying]=useState("");
  const [detailId, setDetailId] = useState("");
  const query = useQuery({
    queryKey: workspaceQueryKey(
      currentId,
      "exports",
      mine ? "mine" : "workspace",
    ),
    queryFn: () => api.exports.list(currentId!, mine, 500),
    enabled: Boolean(currentId),
    refetchInterval: 15_000,
  });
  const devices = useQuery({
    queryKey: workspaceQueryKey(currentId, "devices"),
    queryFn: () => api.devices.list(currentId!),
    enabled: Boolean(currentId),
  });
  const jobs = useMemo(
    () =>
      (query.data?.items ?? []).filter(
        (item) => !statusFilter || item.status === statusFilter,
      ),
    [query.data, statusFilter],
  );
  const retry = async (job:ExportJob) => {
    if (retrying) return;
    setRetrying(job.id);
    try {
      await api.exports.create({resource_type:job.resource_type,resource_id:job.resource_id,export_type:job.export_type,request_config:job.request_config ?? {}});
      await query.refetch();
    } catch(error) {setFeedback(formatApiError(error).message);} finally {setRetrying("");}
  };
  const download = async (job: ExportJob) => {
    setDownloading(job.id);
    setFeedback("");
    try {
      const result = await api.exports.download(job.id);
      const url = String(result.url ?? "");
      if (!url) throw new Error("服务端未返回下载地址");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.rel = "noopener";
      anchor.click();
    } catch (error) {
      setFeedback(formatApiError(error).message);
    } finally {
      setDownloading("");
    }
  };
  if (requestedSystem && ["standard", "group", "carbon"].includes(requestedSystem)) return <Navigate to={`/exports/new?${params.toString()}`} replace />;
  if (!currentId)
    return (
      <>
        <PageHeader
          eyebrow="组织 / 数据导出"
          title="数据导出"
          description="请选择组织后创建导出。"
        />
        <Panel>
          <StateView type="empty" title="请选择组织" description="" />
        </Panel>
      </>
    );
  const all = query.data?.items ?? [];
  const active = all.filter((item) =>
    ["pending", "running"].includes(item.status),
  ).length;
  return (
    <div className="export-page">
      <PageHeader
        eyebrow="组织 / 数据导出"
        title="数据导出"
        description="标准站、组网站和碳汇站使用各自的创建流程，任务统一在这里生成和下载。"
        actions={
          <div className="header-actions">
            <Button variant="secondary" onClick={() => void query.refetch()}>
              <RefreshCw size={14} />
              刷新
            </Button>
            <Button data-onboarding="export-create" onClick={() => navigate("/exports/new")}>
              <Plus size={14} />
              新建导出
            </Button>
          </div>
        }
      />
      <div className="export-summary" data-onboarding="export-summary">
        <div>
          <span className="export-summary-icon">
            <FileArchive size={16} />
          </span>
          <span>
            <small>全部任务</small>
            <strong>{all.length}</strong>
          </span>
        </div>
        <div>
          <span className="export-summary-icon is-running">
            <RefreshCw size={16} />
          </span>
          <span>
            <small>处理中</small>
            <strong>{active}</strong>
          </span>
        </div>
        <div>
          <span className="export-summary-icon is-success">
            <Check size={16} />
          </span>
          <span>
            <small>已完成</small>
            <strong>
              {all.filter((item) => item.status === "success").length}
            </strong>
          </span>
        </div>
        <div>
          <span className="export-summary-icon is-failed">
            <X size={16} />
          </span>
          <span>
            <small>失败</small>
            <strong>
              {all.filter((item) => item.status === "failed").length}
            </strong>
          </span>
        </div>
      </div>
      {feedback && <div className="command-note section-gap">{feedback}</div>}
      <Panel className="section-gap export-list-panel" data-onboarding="export-list">
        <div className="export-toolbar">
          <div>
            <div className="export-view-switch">
              <button
                className={mine ? "active" : ""}
                onClick={() => setMine(true)}
              >
                我的导出
              </button>
              <button
                className={!mine ? "active" : ""}
                onClick={() => setMine(false)}
              >
                组织全部
              </button>
            </div>
            <span className="export-list-count">共 {jobs.length} 个任务</span>
          </div>
          <div className="export-toolbar-filter">
            <span>任务状态</span>
            <SelectInput
              className="is-compact"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">全部状态</option>
              {["pending", "running", "success", "failed", "expired"].map(
                (item) => (
                  <option key={item} value={item}>
                    {item === "pending"
                      ? "排队中"
                      : item === "running"
                        ? "处理中"
                        : item === "success"
                          ? "已完成"
                          : item === "failed"
                            ? "失败"
                            : "已过期"}
                  </option>
                ),
              )}
            </SelectInput>
          </div>
        </div>
        {query.isLoading ? (
          <StateView type="loading" title="正在加载导出任务" description="" />
        ) : query.error ? (
          <StateView
            type="error"
            title="导出任务加载失败"
            description={formatApiError(query.error).message}
          />
        ) : jobs.length ? (
          <div className="table-wrap mobile-data-list">
            <Table className="data-table mobile-summary-table export-jobs-table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>设备体系</th>
                  <th>目标</th>
                  <th>时间范围</th>
                  <th>状态</th>
                  <th>创建 / 过期</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const expanded = detailId === job.id;
                  const config = (job.request_config ?? {}) as JsonRecord;
                  const targets = resolveExportTargets(job, devices.data?.items ?? []);
                  return (
                    <Fragment key={job.id}>
                      <tr>
                        <td data-label="任务" className="mobile-cell-title mono">{job.id.slice(0, 12)}</td>
                        <td data-label="设备体系">{exportResourceLabel(job)}</td>
                        <td data-label="目标" className="mobile-cell-wide export-target-cell">
                          {targets.station && <><strong>{targets.station.name}</strong><div className="cell-sub mono">{targets.station.description}</div></>}
                          <div className="cell-sub">{targets.countLabel}</div>
                          {targets.items.slice(0, 2).map(target => <div className="export-target-preview" key={target.key}><span>{target.name}</span>{!targets.station && <div className="cell-sub mono">{target.description}</div>}</div>)}
                          {targets.items.length > 2 && <div className="cell-sub">{t("exportEditor.moreTargets", { count: targets.items.length - 2 })}</div>}
                        </td>
                        <td data-label="时间范围" className="mobile-cell-wide">
                          {displayTime(String(config.start_time ?? ""))}
                          <div className="cell-sub">
                            至 {displayTime(String(config.end_time ?? ""))}
                          </div>
                        </td>
                        <td data-label="状态" className="mobile-cell-status">
                          <ExportStatus status={job.status} />
                          {job.status === "running" && <ExportProgress job={job} />}
                        </td>
                        <td data-label="创建 / 过期" className="mobile-cell-wide">
                          {displayTime(job.created_at)}
                          <div className="cell-sub">
                            过期：{displayTime(job.expires_at)}
                          </div>
                        </td>
                        <td data-label="操作" className="mobile-cell-actions">
                          <ExportRowActions job={job} expanded={expanded} downloading={downloading === job.id} retrying={!!retrying} onToggle={()=>setDetailId(expanded ? "" : job.id)} onDownload={()=>void download(job)} onRetry={()=>void retry(job)} />
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="export-detail-row">
                          <td colSpan={7} id={`export-detail-${job.id}`}>
                            <ExportDetail job={job} devices={devices.data?.items ?? []} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </Table>
          </div>
        ) : (
          <StateView
            type="empty"
            title="暂无导出任务"
            description="创建任务后会显示在这里。"
          />
        )}
      </Panel>
    </div>
  );
}
