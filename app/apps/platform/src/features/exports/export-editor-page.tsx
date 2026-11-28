import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { PageHeader, Panel, StateView, useConfirm } from "../../shared/ui";
import { useEditorNavigation } from "../../app/platform-navigation";
import { exportCreatedState, type ExportSystem } from "./export-model";
import { ExportSystemChooser } from "./export-form-layout";
import { StandardExportForm } from "./standard-export-form";
import { GroupExportForm } from "./group-export-form";
import { CarbonExportForm } from "./carbon-export-form";

export function ExportEditorPage() {
  const { currentId } = useWorkspace();
  const [params] = useSearchParams();
  return <ExportEditor key={`${currentId}:${params}`} currentId={currentId} params={params} />;
}

function ExportEditor({ currentId, params }: { currentId: string | null; params: URLSearchParams }) {
  const client = useQueryClient();
  const confirm = useConfirm();
  const requestedSystem = params.get("system");
  const initialSystem = requestedSystem === "group" || requestedSystem === "carbon" ? requestedSystem : "standard";
  const [system, setSystem] = useState<ExportSystem>(initialSystem);
  const [formDirty, setFormDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const { cancel, complete } = useEditorNavigation(formDirty || system !== initialSystem, busy);
  const devices = useQuery({
    queryKey: workspaceQueryKey(currentId, "devices"),
    queryFn: () => api.devices.list(currentId!),
    enabled: Boolean(currentId),
  });
  const exportDevices = devices.data?.items ?? [];
  const tagsByDevice = useMemo(
    () => new Map((devices.data?.items ?? []).map(item => [item.id, item.tags ?? []])),
    [devices.data?.items],
  );
  const runCreate = async (payload: JsonRecord) => {
    if (!currentId || busy) return false;
    setBusy(true);
    setFeedback("");
    try {
      const job = await api.exports.create(payload);
      void client.invalidateQueries({ queryKey: workspaceQueryKey(currentId, "exports") });
      complete("/exports", exportCreatedState(currentId, job.id));
      return true;
    } catch (error) {
      const item = formatApiError(error);
      setFeedback(
        `${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
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

  const chooseSystem = async (next: ExportSystem) => {
    if (busy || next === system) return;
    if (formDirty && !(await confirm({ title: "切换导出类型", description: "切换导出类型会清空已填条件，确定切换吗？", confirmLabel: "切换" }))) return;
    setFormDirty(false);
    setFeedback("");
    setSystem(next);
  };
  const formProps = {
    devices: exportDevices,
    chooser: <ExportSystemChooser selected={system} onSelect={chooseSystem} />,
    params,
    busy,
    onClose: cancel,
    onCreate: runCreate,
    onDirtyChange: setFormDirty,
    feedback,
  };

  return (
    <div className="export-page dataset-editor-page export-editor-page">
      <PageHeader
        eyebrow="组织 / 数据导出"
        title="新建导出"
        description="标准站、组网站和碳汇站使用各自的创建流程，任务统一在这里生成和下载。"
      />
      <div className="export-create-shell section-gap">
        {system === "standard" ? <StandardExportForm {...formProps} /> :
          system === "group" ? <GroupExportForm {...formProps} tagsByDevice={tagsByDevice} /> :
            <CarbonExportForm {...formProps} />}
      </div>
    </div>
  );
}
