import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api, formatApiError, type Device } from "@thcpn/api";
import { Button, CheckboxInput, Input, Panel, SelectInput, Textarea } from "../../shared/ui";
import { calibrationPayload, firmwarePayload, text } from "./device-model";

type Mode = "calibration" | "firmware" | "transfer";

export function DeviceActionForm({
  device,
  mode,
  currentWorkspaceId,
  workspaces,
  onClose,
  onComplete,
}: {
  device: Device;
  mode: Mode;
  currentWorkspaceId: string;
  workspaces: Array<{ id: string; name: string }>;
  onClose: () => void;
  onComplete: (
    action: () => Promise<unknown>,
    message: string,
  ) => Promise<boolean>;
}) {
  const [calibrationType, setCalibrationType] = useState("zero_point");
  const [parameters, setParameters] = useState("{}");
  const [version, setVersion] = useState("");
  const [packageUri, setPackageUri] = useState("");
  const [checksum, setChecksum] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [targetWorkspaceId, setTargetWorkspaceId] = useState("");
  const [targetProjectId, setTargetProjectId] = useState("");
  const [targetSiteId, setTargetSiteId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const targetProjects = useQuery({
    queryKey: ["workspace", targetWorkspaceId, "projects", "transfer"],
    queryFn: () => api.projects.list(targetWorkspaceId),
    enabled: mode === "transfer" && Boolean(targetWorkspaceId),
  });
  const targetSites = useQuery({
    queryKey: [
      "workspace",
      targetWorkspaceId,
      "sites",
      targetProjectId,
      "transfer",
    ],
    queryFn: () =>
      api.sites.list(targetWorkspaceId, targetProjectId || undefined),
    enabled: mode === "transfer" && Boolean(targetWorkspaceId),
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "calibration")
        await onComplete(
          () =>
            api.devices.calibrate(
              device.id,
              calibrationPayload(calibrationType, parameters),
            ),
          "校准请求已创建",
        );
      if (mode === "firmware")
        await onComplete(
          () =>
            api.devices.firmwareUpgrade(
              device.id,
              firmwarePayload(version, packageUri, checksum, scheduledAt),
            ),
          "固件升级任务已创建",
        );
      if (mode === "transfer")
        await onComplete(
          () =>
            api.devices.transfer(device.id, {
              target_workspace_id: targetWorkspaceId,
              ...(targetProjectId ? { project_id: targetProjectId } : {}),
              ...(targetSiteId ? { site_id: targetSiteId } : {}),
              transfer_historical_datasets: false,
              confirm_dataset_policy: true,
            }),
          "设备已转移",
        );
    } catch (reason) {
      const item = formatApiError(reason);
      setError(
        `${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel className="section-gap device-editor">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            {mode === "calibration"
              ? "请求设备校准"
              : mode === "firmware"
                ? "安排固件升级"
                : "转移设备"}
          </h2>
          <div className="panel-kicker">
            {device.name} · SN {device.serial_no}
          </div>
        </div>
        <Button variant="secondary" onClick={onClose}>
          <X size={14} />
          关闭
        </Button>
      </div>
      <form onSubmit={submit}>
        <div className="device-form-grid">
          {mode === "calibration" ? (
            <>
              <label className="field">
                <span className="field-label">校准流程</span>
                <SelectInput
                  value={calibrationType}
                  onChange={(event) => setCalibrationType(event.target.value)}
                >
                  <option value="zero_point">零点校准</option>
                  <option value="span">量程校准</option>
                  <option value="factory_reset">恢复出厂校准</option>
                  <option value="custom">自定义流程</option>
                </SelectInput>
              </label>
              <label className="field field-wide">
                <span className="field-label">设备参数 JSON（可选）</span>
                <Textarea
                  value={parameters}
                  onChange={(event) => setParameters(event.target.value)}
                  spellCheck={false}
                />
              </label>
            </>
          ) : mode === "firmware" ? (
            <>
              <label className="field">
                <span className="field-label">目标版本</span>
                <Input
                  required
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  placeholder="例如 2.4.1"
                />
              </label>
              <label className="field">
                <span className="field-label">固件包 URI</span>
                <Input
                  value={packageUri}
                  onChange={(event) => setPackageUri(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Checksum</span>
                <Input
                  value={checksum}
                  onChange={(event) => setChecksum(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">计划执行时间</span>
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(event) => setScheduledAt(event.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span className="field-label">目标组织</span>
                <SelectInput
                  required
                  value={targetWorkspaceId}
                  onChange={(event) => {
                    setTargetWorkspaceId(event.target.value);
                    setTargetProjectId("");
                    setTargetSiteId("");
                  }}
                >
                  <option value="">选择组织</option>
                  {workspaces
                    .filter((item) => item.id !== currentWorkspaceId)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </SelectInput>
              </label>
              <label className="field">
                <span className="field-label">目标项目</span>
                <SelectInput
                  value={targetProjectId}
                  disabled={!targetWorkspaceId}
                  onChange={(event) => {
                    setTargetProjectId(event.target.value);
                    setTargetSiteId("");
                  }}
                >
                  <option value="">不设置</option>
                  {targetProjects.data?.items.map((item) => (
                    <option key={text(item.id)} value={text(item.id)}>
                      {text(item.name)}
                    </option>
                  ))}
                </SelectInput>
              </label>
              <label className="field">
                <span className="field-label">目标站点</span>
                <SelectInput
                  value={targetSiteId}
                  disabled={!targetProjectId}
                  onChange={(event) => setTargetSiteId(event.target.value)}
                >
                  <option value="">不设置</option>
                  {targetSites.data?.items.map((item) => (
                    <option key={text(item.id)} value={text(item.id)}>
                      {text(item.name)}
                    </option>
                  ))}
                </SelectInput>
              </label>
              <label className="transfer-confirm">
                <CheckboxInput
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  我确认历史数据集保留在原组织，当前版本不会迁移历史数据集。
                </span>
              </label>
            </>
          )}
        </div>
        {error && <div className="form-error device-form-error">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            variant={mode === "transfer" ? "danger" : "primary"}
            disabled={
              busy ||
              (mode === "firmware" && !version.trim()) ||
              (mode === "transfer" && (!targetWorkspaceId || !confirmed))
            }
          >
            {busy ? "提交中…" : mode === "transfer" ? "确认转移" : "提交"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
