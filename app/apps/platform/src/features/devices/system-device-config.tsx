import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, configFieldsFromDetail, deviceLifecycleLabel, deviceLifecycleOptions, deviceStatusLabel, deviceStatusOptions, formatApiError, parseDeviceConfig, type Device, type JsonRecord, type DeviceConfigFields } from "@thcpn/api";
import { Badge, Button, CheckboxInput, Input, Panel, SelectInput, StateView, Textarea } from "../../shared/ui";
import { text, isCameraDevice } from "./device-model";

export function SystemDeviceConfig({
  device,
  workspaces,
  run,
}: {
  device: Device;
  workspaces: Array<{ id: string; name: string }>;
  run: (
    action: () => Promise<unknown>,
    message: string,
    leavesWorkspace?: boolean,
  ) => Promise<boolean>;
}) {
  const lifecycle = useQuery({
    queryKey: ["admin", "device", device.id, "lifecycle"],
    queryFn: () => api.admin.lifecycle(device.id),
  });
  const config = useQuery({
    queryKey: ["admin", "device", device.id, "config"],
    queryFn: () => api.admin.deviceConfig(device.id),
  });
  const metadata = useQuery({
    queryKey: ["admin", "metadata", "capabilities"],
    queryFn: api.admin.metadata,
  });
  const [assetName, setAssetName] = useState(device.name);
  const [assetStatus, setAssetStatus] = useState(device.status);
  const [lifecycleStatus, setLifecycleStatus] = useState(
    device.lifecycle_status,
  );
  const [lifecycleNote, setLifecycleNote] = useState("");
  const [capabilities, setCapabilities] = useState<string[]>(
    device.capabilities,
  );
  const [targetWorkspaceId, setTargetWorkspaceId] = useState(
    device.workspace_id ?? "",
  );
  const [fields, setFields] = useState<DeviceConfigFields>({
    data_json: "[]",
    image_json: "[]",
    control_json: "{}",
    expected_config_id: 0,
  });
  const [localError, setLocalError] = useState("");
  useEffect(() => {
    if (config.data) setFields(configFieldsFromDetail(config.data));
  }, [config.data]);
  const submitConfig = async () => {
    setLocalError("");
    try {
      const payload = parseDeviceConfig(fields);
      if (!window.confirm("确认写入 THCPN 外部设备库并刷新平台数据流？"))
        return;
      await run(
        () => api.admin.updateDeviceConfig(device.id, payload),
        "THCPN 配置已应用",
      );
      await config.refetch();
    } catch (error) {
      setLocalError(formatApiError(error).message);
    }
  };
  const capabilityItems = metadata.data?.items ?? [];
  return (
    <Panel className="section-gap system-device-config">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">系统配置</h2>

        </div>
        <Badge tone="info">SYSTEM ADMIN</Badge>
      </div>
      <div className="system-config-grid">
        <section>
          <h3>资产资料</h3>
          <label className="field">
            <span className="field-label">名称</span>
            <Input
              value={assetName}
              onChange={(e) => setAssetName(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">状态</span>
            <SelectInput
              value={assetStatus}
              onChange={(e) =>
                setAssetStatus(e.target.value as Device["status"])
              }
            >
              {deviceStatusOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {deviceStatusLabel(item.value)}
                </option>
              ))}
            </SelectInput>
          </label>
          <Button
            onClick={() =>
              void run(
                () =>
                  api.admin.updateDevice(device.id, {
                    name: assetName.trim(),
                    status: assetStatus,
                  }),
                "资产资料已更新",
              )
            }
          >
            保存资产资料
          </Button>
        </section>
        <section>
          <h3>生命周期</h3>
          <label className="field">
            <span className="field-label">新状态</span>
            <SelectInput
              value={lifecycleStatus}
              onChange={(e) =>
                setLifecycleStatus(e.target.value as Device["lifecycle_status"])
              }
            >
              {deviceLifecycleOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {deviceLifecycleLabel(item.value)}
                </option>
              ))}
            </SelectInput>
          </label>
          <label className="field">
            <span className="field-label">说明</span>
            <Input
              value={lifecycleNote}
              onChange={(e) => setLifecycleNote(e.target.value)}
            />
          </label>
          <Button
            disabled={lifecycle.isLoading}
            onClick={() =>
              void run(
                () =>
                  api.admin.updateLifecycle(device.id, {
                    lifecycle_status: lifecycleStatus,
                    note: lifecycleNote.trim(),
                  }),
                "生命周期已更新",
              )
            }
          >
            更新生命周期
          </Button>
        </section>
        <section>
          <h3>最终能力</h3>
          <div className="system-capabilities">
            {capabilityItems.map((item) => {
              const code = text(item.code, "");
              return (
                <label key={code}>
                  <CheckboxInput
                    checked={capabilities.includes(code)}
                    disabled={item.status !== "active"}
                    onChange={() =>
                      setCapabilities((current) =>
                        current.includes(code)
                          ? current.filter((value) => value !== code)
                          : [...current, code],
                      )
                    }
                  />
                  <span>
                    {text(item.name, code)}
                    <small>{code}</small>
                  </span>
                </label>
              );
            })}
          </div>
          <Button
            disabled={metadata.isLoading}
            onClick={() =>
              void run(
                () => api.admin.updateCapabilities(device.id, { capabilities }),
                "设备能力已更新",
              )
            }
          >
            保存能力
          </Button>
        </section>
        <section>
          <h3>组织分配</h3>
          <label className="field">
            <span className="field-label">目标组织</span>
            <SelectInput
              value={targetWorkspaceId}
              onChange={(e) => setTargetWorkspaceId(e.target.value)}
            >
              <option value="">未分配</option>
              {workspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectInput>
          </label>
          <Button
            variant="secondary"
            disabled={!targetWorkspaceId}
            onClick={() =>
              void run(
                () =>
                  api.admin.assignDevice(device.id, {
                    target_workspace_id: targetWorkspaceId,
                    assign_children: false,
                  }),
                "设备分配已更新",
                targetWorkspaceId !== device.workspace_id,
              )
            }
          >
            更新分配
          </Button>
        </section>
      </div>
      <section className="thcpn-config-editor">
        <h3>THCPN 高级配置</h3>
        <div className="form-error config-warning">
          保存会创建新的外部配置版本，并重新生成设备数据通道。
        </div>
        <label className="field">
          <span className="field-label">数据通道 · data_json</span>
          <Textarea
            value={fields.data_json}
            onChange={(e) =>
              setFields((current) => ({
                ...current,
                data_json: e.target.value,
              }))
            }
          />
        </label>
        <label className="field">
          <span className="field-label">图片通道 · image_json</span>
          <Textarea
            value={fields.image_json}
            onChange={(e) =>
              setFields((current) => ({
                ...current,
                image_json: e.target.value,
              }))
            }
          />
        </label>
        <label className="field">
          <span className="field-label">控制配置 · control_json</span>
          <Textarea
            value={fields.control_json}
            onChange={(e) =>
              setFields((current) => ({
                ...current,
                control_json: e.target.value,
              }))
            }
          />
        </label>
        {localError && <div className="form-error">{localError}</div>}
        <Button
          variant="danger"
          disabled={config.isLoading}
          onClick={() => void submitConfig()}
        >
          应用 THCPN 配置
        </Button>
      </section>
      {isCameraDevice(device) && (
        <SystemCameraBinding device={device} run={run} />
      )}
    </Panel>
  );
}

function SystemCameraBinding({
  device,
  run,
}: {
  device: Device;
  run: (action: () => Promise<unknown>, message: string) => Promise<boolean>;
}) {
  const query = useQuery({
    queryKey: ["admin", "camera", device.id],
    queryFn: () => api.admin.camera(device.id),
  });
  const [deviceSerial, setDeviceSerial] = useState("");
  const [channelNo, setChannelNo] = useState(1);
  const [quality, setQuality] = useState("hd");
  const [status, setStatus] = useState("active");
  const [encrypted, setEncrypted] = useState(false);
  const [secretRef, setSecretRef] = useState("");
  useEffect(() => {
    const binding = query.data?.binding as JsonRecord | undefined;
    if (!binding) return;
    setDeviceSerial(text(binding.device_serial, ""));
    setChannelNo(Number(binding.channel_no) || 1);
    setQuality(text(binding.default_quality, "hd"));
    setStatus(text(binding.status, "active"));
    setEncrypted(Boolean(binding.is_encrypted));
    setSecretRef(text(binding.validate_code_secret_ref, ""));
  }, [query.data]);
  return (
    <section className="thcpn-config-editor camera-binding-editor">
      <h3>视频站视频绑定</h3>
      {query.isLoading ? (
        <StateView
          type="loading"
          title="正在加载视频站视频绑定"
          description="正在读取视频通道配置。"
        />
      ) : query.error ? (
        <StateView
          type="error"
          title="视频站视频绑定加载失败"
          description={formatApiError(query.error).message}
        />
      ) : (
        <>
          <div className="device-form-grid">
            <label className="field">
              <span className="field-label">设备序列号</span>
              <Input
                value={deviceSerial}
                onChange={(e) => setDeviceSerial(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">通道号</span>
              <Input
                type="number"
                min="1"
                value={channelNo}
                onChange={(e) => setChannelNo(Number(e.target.value) || 1)}
              />
            </label>
            <label className="field">
              <span className="field-label">默认清晰度</span>
              <SelectInput
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
              >
                {["fluent", "standard", "hd", "ultra_hd"].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </SelectInput>
            </label>
            <label className="field">
              <span className="field-label">状态</span>
              <SelectInput
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="active">active</option>
                <option value="disabled">disabled</option>
              </SelectInput>
            </label>
            <label className="field">
              <span className="field-label">设备加密</span>
              <SelectInput
                value={String(encrypted)}
                onChange={(e) => setEncrypted(e.target.value === "true")}
              >
                <option value="false">未加密</option>
                <option value="true">已加密</option>
              </SelectInput>
            </label>
            <label className="field">
              <span className="field-label">验证码 Secret 引用</span>
              <Input
                value={secretRef}
                onChange={(e) => setSecretRef(e.target.value)}
              />
            </label>
          </div>
          <Button
            disabled={!deviceSerial.trim()}
            onClick={() =>
              void run(
                () =>
                  api.admin.updateCamera(device.id, {
                    device_serial: deviceSerial.trim(),
                    channel_no: channelNo,
                    default_quality: quality,
                    status,
                    is_encrypted: encrypted,
                    validate_code_secret_ref: secretRef.trim(),
                  }),
                "视频站视频绑定已更新",
              )
            }
          >
            保存视频站视频绑定
          </Button>
        </>
      )}
    </section>
  );
}
