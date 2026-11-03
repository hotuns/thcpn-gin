import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Button, PageHeader, Panel, StateView } from "../../shared/ui";
import { type ExportSystem } from "./export-model";
import { ExportSystemChooser } from "./export-form-layout";
import { StandardExportForm } from "./standard-export-form";
import { GroupExportForm } from "./group-export-form";
import { CarbonExportForm } from "./carbon-export-form";

export function ExportEditorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentId } = useWorkspace();
  const [params] = useSearchParams();
  const requestedSystem = params.get("system") as ExportSystem | null;
  const [system, setSystem] = useState<ExportSystem>(
    ["standard", "group", "carbon"].includes(requestedSystem ?? "")
      ? requestedSystem!
      : "standard",
  );
  const [feedback, setFeedback] = useState(location.state?.exportCreated ? "导出任务已创建" : "");
  const devices = useQuery({
    queryKey: workspaceQueryKey(currentId, "devices"),
    queryFn: () => api.devices.list(currentId!),
    enabled: Boolean(currentId),
  });
  const deviceMap = useQuery({
    queryKey: workspaceQueryKey(currentId, "device-map", "true"),
    queryFn: () => api.devices.map(currentId!, true),
    enabled: Boolean(currentId),
  });
  const tagsByDevice = useMemo(
    () => new Map((deviceMap.data?.items ?? []).map((item) => [item.device_id, item.environment.research_tags])),
    [deviceMap.data?.items],
  );
  const exportDevices = useMemo(
    () => (devices.data?.items ?? []).map((item) => ({ ...item, research_tags: tagsByDevice.get(item.id) ?? [] })),
    [devices.data?.items, tagsByDevice],
  );
  const runCreate = async (payload: JsonRecord) => {
    setFeedback("");
    try {
      await api.exports.create(payload);
      setFeedback("导出任务已创建");
      navigate("/exports", { replace: true, state: { exportCreated: true } });
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
          eyebrow="组织 / 数据导出"
          title="数据导出"
          description="请选择组织后创建导出。"
        />
        <Panel>
          <StateView type="empty" title="请选择组织" description="" />
        </Panel>
      </>
    );

  return (
    <div className="export-page dataset-editor-page export-editor-page">
      <PageHeader
        eyebrow="组织 / 数据导出"
        title="新建导出"
        description="标准站、组网站和碳汇站使用各自的创建流程，任务统一在这里生成和下载。"
        actions={
          <div className="header-actions">
            <Button variant="secondary" onClick={() => navigate("/exports")}>返回导出列表</Button>
          </div>
        }
      />
      {feedback && <div className="command-note section-gap">{feedback}</div>}
        <div className="export-create-shell section-gap">
          {system === "standard" ? (
            <StandardExportForm
              devices={exportDevices}
              chooser={<ExportSystemChooser selected={system} onSelect={setSystem} />}
              params={params}
              onClose={() => navigate("/exports")}
              onCreate={runCreate}
              feedback={feedback}
            />
          ) : system === "group" ? (
            <GroupExportForm
              devices={exportDevices}
              tagsByDevice={tagsByDevice}
              chooser={<ExportSystemChooser selected={system} onSelect={setSystem} />}
              params={params}
              onClose={() => navigate("/exports")}
              onCreate={runCreate}
              feedback={feedback}
            />
          ) : (
            <CarbonExportForm
              devices={exportDevices}
              chooser={<ExportSystemChooser selected={system} onSelect={setSystem} />}
              params={params}
              onClose={() => navigate("/exports")}
              onCreate={runCreate}
              feedback={feedback}
            />
          )}
        </div>
    </div>
  );
}
