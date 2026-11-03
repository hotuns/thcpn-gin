import "./datasets-mobile.css";
import "../../shared/data/mobile-data.css";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Download, Eye, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api, formatApiError } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, IconButton, Input, PageHeader, Panel, SelectInput, StateView, Table } from "../../shared/ui";
import { datasetDetailPath, datasetEditPath } from "./dataset-model";
import { datasetTypeLabel, datasetStatusLabel, displayTime } from "./dataset-format";
import { DatasetSourceSummary } from "./dataset-sources";

export function DatasetsPage() {
  const { currentId } = useWorkspace();
  const navigate = useNavigate();
  const [projectFilter, setProjectFilter] = useState("");
  const [keyword, setKeyword] = useState("");
  const [feedback, setFeedback] = useState("");
  const projects = useQuery({
    queryKey: workspaceQueryKey(currentId, "projects"),
    queryFn: () => api.projects.list(currentId!),
    enabled: Boolean(currentId),
  });
  const devices = useQuery({
    queryKey: workspaceQueryKey(currentId, "devices"),
    queryFn: () => api.devices.list(currentId!),
    enabled: Boolean(currentId),
  });
  const query = useQuery({
    queryKey: workspaceQueryKey(currentId, "datasets", projectFilter || "all"),
    queryFn: () => api.datasets.list(currentId!, projectFilter || undefined),
    enabled: Boolean(currentId),
  });
  const rows = useMemo(
    () =>
      (query.data?.items ?? []).filter((item) =>
        `${item.name} ${item.description ?? ""} ${item.id}`
          .toLowerCase()
          .includes(keyword.toLowerCase()),
      ),
    [keyword, query.data],
  );
  const run = async (action: () => Promise<unknown>, message: string) => {
    setFeedback("");
    try {
      await action();
      setFeedback(message);
      await query.refetch();
      return true;
    } catch (error) {
      const item = formatApiError(error);
      setFeedback(
        `${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
      );
      return false;
    }
  };
  if (!currentId)
    return (
      <>
        <PageHeader
          eyebrow="组织 / 数据集"
          title="数据集"
          description="管理可复用的数据查询定义。"
        />
        <Panel>
          <StateView
            type="empty"
            title="请选择组织"
            description="请先选择组织，再查看数据集。"
          />
        </Panel>
      </>
    );
  return (
    <>
      <PageHeader
        eyebrow="组织 / 数据集"
        title="数据集"
        description="将设备或数据流、时间范围和数据类型保存为可预览、分享与导出的查询定义。"
        actions={
          <div className="header-actions">
            <Button variant="secondary" onClick={() => void query.refetch()}>
              <RefreshCw size={14} />
              刷新
            </Button>
            <Button data-onboarding="dataset-create" onClick={() => navigate("/datasets/new")}>
              <Plus size={14} />
              创建数据集
            </Button>
          </div>
        }
      />
      <Panel data-onboarding="dataset-list">
        <div className="dataset-toolbar">
          <div className="filter-input">
            <Input
              aria-label="搜索数据集"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索名称、描述或 ID"
            />
          </div>
          <SelectInput
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
          >
            <option value="">全部项目</option>
            {projects.data?.items.map((item) => (
              <option key={String(item.id)} value={String(item.id)}>
                {String(item.name)}
              </option>
            ))}
          </SelectInput>
          <Badge tone="info">{rows.length} 个</Badge>
        </div>
        {feedback && (
          <div className="command-note dataset-feedback">{feedback}</div>
        )}
        {query.isLoading ? (
          <StateView
            type="loading"
            title="正在加载数据集"
            description="正在读取数据集定义。"
          />
        ) : query.error ? (
          <StateView
            type="error"
            title="数据集加载失败"
            description={formatApiError(query.error).message}
            requestId={formatApiError(query.error).requestId}
          />
        ) : rows.length ? (
          <div className="table-wrap mobile-data-list">
            <Table className="data-table mobile-summary-table">
              <thead>
                <tr>
                  <th>数据集</th>
                  <th>类型</th>
                  <th>时间范围</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((dataset) => (
                  <tr key={dataset.id}>
                    <td data-label="数据集" className="mobile-cell-title">
                      <button
                        type="button"
                        className="dataset-title-link"
                        onClick={() => navigate(datasetDetailPath(dataset.id))}
                      >
                        {dataset.name}
                      </button>
                      <div className="cell-sub">
                        {dataset.description || "暂无描述"}
                      </div>
                      <div className="cell-sub">
                        项目：{String(projects.data?.items.find((item) => item.id === dataset.project_id)?.name ?? "未关联项目")}
                      </div>
                      <div className="cell-sub mono">{dataset.id}</div>
                    </td>
                    <td data-label="类型">
                      <Badge tone="info">{datasetTypeLabel(dataset.data_type)}</Badge>
                    </td>
                    <td data-label="时间范围" className="mobile-cell-wide">
                      {displayTime(dataset.time_start)}
                      <div className="cell-sub">
                        至 {displayTime(dataset.time_end)}
                      </div>
                    </td>
                    <td data-label="来源" className="mobile-cell-wide">
                      <DatasetSourceSummary
                        sources={dataset.sources}
                        devices={devices.data?.items ?? []}
                      />
                    </td>
                    <td data-label="状态" className="mobile-cell-status">
                      <Badge
                        tone={
                          dataset.status === "published"
                            ? "success"
                            : dataset.status === "locked"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {datasetStatusLabel(dataset.status)}
                      </Badge>
                    </td>
                    <td data-label="操作" className="mobile-cell-actions">
                      <div className="table-actions">
                        <Button
                          variant="secondary"
                          onClick={() =>
                            navigate(datasetDetailPath(dataset.id))
                          }
                        >
                          <Eye size={13} />
                          查看详情
                        </Button>
                        <IconButton
                          label="编辑数据集"
                          onClick={() => navigate(datasetEditPath(dataset.id))}
                        >
                          <Pencil size={13} />
                        </IconButton>
                        <IconButton
                          label="导出数据集"
                          onClick={() =>
                            (async () => {
                              const created = await run(
                                () =>
                                  api.datasets.export(dataset.id, {
                                    export_type: "dataset_zip",
                                  }),
                                "导出任务已创建",
                              );
                              if (created) navigate("/exports");
                            })()
                          }
                        >
                          <Download size={13} />
                        </IconButton>
                        <IconButton
                          label="删除数据集"
                          className="dataset-delete-action"
                          onClick={() =>
                            window.confirm(
                              `确认删除数据集“${dataset.name}”？`,
                            ) &&
                            void run(
                              () => api.datasets.remove(dataset.id),
                              "数据集已删除",
                            )
                          }
                        >
                          <Trash2 size={13} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          <StateView
            type="empty"
            title="暂无数据集"
            description={
              keyword || projectFilter
                ? "请调整筛选条件。"
                : "创建数据集后，可以复用查询范围并发起异步导出。"
            }
          />
        )}
      </Panel>
    </>
  );
}
