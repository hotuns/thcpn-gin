import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { api, type Device } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, Panel } from "../../shared/ui";
import { SamplingProfilePanel } from "./sampling-profile";
import { ComputedStreamsPanel, DeviceMetadataPanel } from "./device-computed-data";
import { SystemDeviceConfig } from "./system-device-config";

export function DeviceConfig({
  device,
  currentWorkspaceId,
  workspaces,
  systemAdmin,
  run,
}: {
  device: Device;
  currentWorkspaceId: string;
  workspaces: Array<{ id: string; name: string }>;
  systemAdmin: boolean;
  run: (
    action: () => Promise<unknown>,
    message: string,
    leavesWorkspace?: boolean,
  ) => Promise<boolean>;
}) {
  const streams = useQuery({ queryKey: workspaceQueryKey(currentWorkspaceId, "device", device.id, "streams", "config"), queryFn: () => api.dataStreams.list(device.id) });
  const context = useQuery({ queryKey: workspaceQueryKey(currentWorkspaceId, "device", device.id, "context"), queryFn: () => api.devices.context(device.id) });
  return (
    <div className="device-config-workspace">
      <div className="device-config-heading"><div><h2>数据配置</h2><p>管理设备业务参数、计算公式与采样方式</p></div><Badge tone="neutral">{streams.data?.items.length ?? 0} 个数据流</Badge></div>
      <div className="device-config-data-grid">
        <ComputedStreamsPanel workspaceId={currentWorkspaceId} deviceId={device.id} streams={streams.data?.items ?? []} />
        <DeviceMetadataPanel workspaceId={currentWorkspaceId} deviceId={device.id} canConfigure={Boolean(context.data?.actions.configure)} />
      </div>
      {device.features?.includes("sampling") && <SamplingProfilePanel deviceId={device.id} workspaceId={currentWorkspaceId} carbon={device.device_type === "carbon_sink"} />}
      {systemAdmin && (
        <SystemDeviceConfig device={device} workspaces={workspaces} run={run} />
      )}
      <Panel className="section-gap danger-zone">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">危险操作</h2>

          </div>
          <Button
            variant="danger"
            onClick={() =>
              window.confirm(`确认解绑“${device.name}”？`) &&
              void run(() => api.devices.unbind(device.id), "设备已解绑", true)
            }
          >
            <Trash2 size={14} />
            解绑设备
          </Button>
        </div>
      </Panel>
    </div>
  );
}
