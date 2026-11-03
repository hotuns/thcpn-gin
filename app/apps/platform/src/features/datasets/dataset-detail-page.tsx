import "./datasets-mobile.css";
import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, GitCompareArrows, Pencil } from "lucide-react";
import { api, formatApiError } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Button, PageHeader, Panel, StateView } from "../../shared/ui";
import { dataComparisonPath } from "../../shared/data/data-workflow";
import { localTime, datasetEditPath } from "./dataset-model";
import { DatasetPreview } from "./dataset-preview";

export function DatasetDetailPage() {
  const { currentId } = useWorkspace();
  const { datasetId = "" } = useParams();
  const navigate = useNavigate();
  const [actionError, setActionError] = useState("");
  const dataset = useQuery({
    queryKey: workspaceQueryKey(currentId, "dataset", datasetId),
    queryFn: () => api.datasets.get(datasetId),
    enabled: Boolean(currentId && datasetId),
  });
  const devices = useQuery({
    queryKey: workspaceQueryKey(currentId, "devices"),
    queryFn: () => api.devices.list(currentId!),
    enabled: Boolean(currentId),
  });
  const projects = useQuery({
    queryKey: workspaceQueryKey(currentId, "projects"),
    queryFn: () => api.projects.list(currentId!),
    enabled: Boolean(currentId),
  });
  const comparableSources = (dataset.data?.sources ?? [])
    .filter((source) => source.source_type !== "file")
    .slice(0, 8);
  const comparisonSources = useQueries({
    queries: comparableSources.map((source) => ({
      queryKey: workspaceQueryKey(
        currentId,
        "dataset-comparison-source",
        source.source_type,
        source.source_id,
      ),
      queryFn: async () => {
        if (source.source_type === "data_stream") {
          return [await api.dataStreams.get(source.source_id)];
        }
        const response = await api.dataStreams.list(source.source_id);
        return response.items.filter(
          (stream) => stream.type === "telemetry" && stream.status === "active",
        );
      },
      enabled: Boolean(currentId && dataset.data),
      staleTime: 60_000,
    })),
  });
  const comparisonSeeds = comparisonSources
    .flatMap((query) => query.data ?? [])
    .map((stream) => ({
      deviceId: stream.device_id,
      streamId: stream.id,
    }))
    .filter(
      (seed, index, items) =>
        items.findIndex((item) => item.streamId === seed.streamId) === index,
    )
    .slice(0, 8);
  const comparisonLoading = comparisonSources.some(
    (query) => query.isLoading || query.isFetching,
  );
  const back = (
    <Button variant="secondary" onClick={() => navigate("/datasets")}>
      <ArrowLeft size={14} />
      返回数据集
    </Button>
  );
  if (!currentId)
    return (
      <>
        <PageHeader title="数据集详情" actions={back} />
        <Panel>
          <StateView type="empty" title="请选择组织" description="请先选择组织，再查看数据集详情。" />
        </Panel>
      </>
    );
  if (dataset.isLoading)
    return (
      <>
        <PageHeader title="数据集详情" actions={back} />
        <Panel>
          <StateView type="loading" title="正在加载数据集" description="正在读取数据集定义和数据来源。" />
        </Panel>
      </>
    );
  if (dataset.error || !dataset.data)
    return (
      <>
        <PageHeader title="数据集详情" actions={back} />
        <Panel>
          <StateView
            type="error"
            title="数据集加载失败"
            description={formatApiError(dataset.error).message}
            requestId={formatApiError(dataset.error).requestId}
            action={back}
          />
        </Panel>
      </>
    );
  return (
    <>
      <PageHeader
        eyebrow="组织 / 数据集"
        title={dataset.data.name}
        description={dataset.data.description || "数据集元信息、来源和数据预览"}
        actions={
          <div className="header-actions">
            {["telemetry", "mixed"].includes(dataset.data.data_type) && (
              <Button
                variant="secondary"
                disabled={comparisonLoading || !comparisonSeeds.length}
                onClick={() =>
                  navigate(
                    dataComparisonPath(
                      comparisonSeeds,
                      localTime(dataset.data.time_start),
                      localTime(dataset.data.time_end),
                    ),
                  )
                }
              >
                <GitCompareArrows size={14} />
                {comparisonLoading ? "准备对比…" : "在数据对比中打开"}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={async () => {
                setActionError("");
                try {
                  await api.datasets.export(dataset.data.id, {
                    export_type: "dataset_zip",
                  });
                  navigate("/exports");
                } catch (error) {
                  const item = formatApiError(error);
                  setActionError(
                    `创建导出任务失败：${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
                  );
                }
              }}
            >
              <Download size={14} />
              导出
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate(datasetEditPath(dataset.data.id))}
            >
              <Pencil size={14} />
              编辑
            </Button>
            {back}
          </div>
        }
      />
      {actionError && <div className="command-note section-gap">{actionError}</div>}
      <DatasetPreview
        key={dataset.data.id}
        dataset={dataset.data}
        devices={devices.data?.items ?? []}
        projectName={projects.data?.items.find((item) => item.id === dataset.data?.project_id)?.name}
      />
    </>
  );
}
