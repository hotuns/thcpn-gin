import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api, formatApiError } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Button, PageHeader, Panel, StateView } from "../../shared/ui";
import { type DatasetPrefill, localTime, datasetDetailPath } from "./dataset-model";
import { DatasetForm } from "./dataset-form";

export function DatasetEditorPage() {
  const { currentId } = useWorkspace();
  const { datasetId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const creating = !datasetId;
  const [formBusy, setFormBusy] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
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
  const returnPath = datasetId ? datasetDetailPath(datasetId) : "/datasets";
  const requestBack = () => {
    if (formDirty && !window.confirm("当前数据集有未保存修改，确定离开吗？")) return;
    navigate(returnPath);
  };
  const back = (
    <Button variant="secondary" onClick={requestBack}>
      <ArrowLeft size={14} />
      {datasetId ? "返回详情" : "返回数据集"}
    </Button>
  );
  if (!currentId)
    return (
      <>
        <PageHeader title={creating ? "创建数据集" : "编辑数据集"} actions={back} />
        <Panel>
          <StateView type="empty" title="请选择组织" description="请先选择组织，再管理数据集。" />
        </Panel>
      </>
    );
  if (!creating && dataset.isLoading)
    return (
      <>
        <PageHeader title="编辑数据集" actions={back} />
        <Panel>
          <StateView type="loading" title="正在加载数据集" description="正在读取数据集定义和数据来源。" />
        </Panel>
      </>
    );
  if (!creating && (dataset.error || !dataset.data))
    return (
      <>
        <PageHeader title="编辑数据集" actions={back} />
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
        title={creating ? "创建数据集" : dataset.data?.name ?? "编辑数据集"}
        description={creating ? "定义数据来源、时间范围和数据类型。" : "修改数据集定义；预览页面只展示已保存的范围。"}
        actions={creating ? back : <div className="header-actions">
          <Button className="dataset-desktop-save" type="submit" form="dataset-form" disabled={formBusy}>
            {formBusy ? "保存中…" : "保存数据集"}
          </Button>
          {back}
        </div>}
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
        onSaved={async (action, message) => {
          setFeedback("");
          try {
            const saved = await action();
            navigate(datasetDetailPath(saved.id), { replace: true });
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
