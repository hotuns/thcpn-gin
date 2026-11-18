import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import { api, formatApiError } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { PageHeader, Panel, StateView } from "../../shared/ui";
import { useEditorNavigation } from "../../app/platform-navigation";
import { type DatasetPrefill, localTime, datasetDetailPath } from "./dataset-model";
import { DatasetForm } from "./dataset-form";

export function DatasetEditorPage() {
  const { currentId } = useWorkspace();
  const { datasetId = "" } = useParams();
  const [searchParams] = useSearchParams();
  return <DatasetEditor key={`${currentId}:${datasetId}:${searchParams}`} currentId={currentId} datasetId={datasetId} searchParams={searchParams} />;
}

function DatasetEditor({ currentId, datasetId, searchParams }: { currentId: string | null; datasetId: string; searchParams: URLSearchParams }) {
  const client = useQueryClient();
  const creating = !datasetId;
  const [formBusy, setFormBusy] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const { cancel, complete } = useEditorNavigation(formDirty, formBusy);
  const prefill = useMemo<DatasetPrefill | undefined>(() => {
    if (!creating) return undefined;
    const sources = (searchParams.get("sources") ?? "")
      .split(",")
      .map((sourceId) => sourceId.trim())
      .filter(Boolean)
      .slice(0, 32)
      .map((sourceId) => ({
        source_type: "data_stream" as const,
        source_id: sourceId,
      }));
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    return {
      name: searchParams.get("name") ?? "",
      startTime:
        start && Number.isFinite(Date.parse(start))
          ? localTime(start)
          : localTime(new Date(Date.now() - 86_400_000)),
      endTime:
        end && Number.isFinite(Date.parse(end))
          ? localTime(end)
          : localTime(new Date()),
      sources,
    };
  }, [creating, searchParams]);
  const dataset = useQuery({
    queryKey: workspaceQueryKey(currentId, "dataset", datasetId),
    queryFn: () => api.datasets.get(datasetId),
    enabled: Boolean(currentId && datasetId),
  });
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
  const [feedback, setFeedback] = useState("");
  if (!currentId)
    return (
      <>
        <PageHeader title={creating ? "创建数据集" : "编辑数据集"} />
        <Panel>
          <StateView type="empty" title="请选择组织" description="请先选择组织，再管理数据集。" />
        </Panel>
      </>
    );
  if (!creating && dataset.isLoading)
    return (
      <>
        <PageHeader title="编辑数据集" />
        <Panel>
          <StateView type="loading" title="正在加载数据集" description="正在读取数据集定义和数据来源。" />
        </Panel>
      </>
    );
  if (!creating && (dataset.error || !dataset.data))
    return (
      <>
        <PageHeader title="编辑数据集" />
        <Panel>
          <StateView
            type="error"
            title="数据集加载失败"
            description={formatApiError(dataset.error).message}
            requestId={formatApiError(dataset.error).requestId}
          />
        </Panel>
      </>
    );
  return (
    <>
      <PageHeader
        eyebrow="组织 / 数据集"
        title={creating ? "创建数据集" : dataset.data?.name ?? "编辑数据集"}
        description={creating ? "定义数据来源、时间范围和数据类型。" : "修改数据集定义；预览页面只展示已保存的范围。"}
      />
      {feedback && <div className="command-note section-gap">{feedback}</div>}
      <DatasetForm
        key={dataset.data?.id ?? (searchParams.toString() || "create")}
        workspaceId={currentId}
        dataset={dataset.data ?? null}
        prefill={prefill}
        projects={projects.data?.items ?? []}
        devices={devices.data?.items ?? []}
        busy={formBusy}
        feedback={feedback}
        onBusyChange={setFormBusy}
        onDirtyChange={setFormDirty}
        onCancel={cancel}
        onSaved={async (action, message) => {
          setFeedback("");
          try {
            const saved = await action();
            client.setQueryData(workspaceQueryKey(currentId, "dataset", saved.id), saved);
            void client.invalidateQueries({ queryKey: workspaceQueryKey(currentId, "datasets") });
            complete(datasetDetailPath(saved.id));
            return true;
          } catch (error) {
            const item = formatApiError(error);
            setFeedback(
              `${message}失败：${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
            );
            return false;
          }
        }}
      />
    </>
  );
}
