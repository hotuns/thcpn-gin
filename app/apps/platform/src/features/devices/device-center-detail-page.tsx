import { LoRaWANDataView } from "./lorawan-data-view";
import "./device-mobile.css";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { BellRing } from "lucide-react";
import { api, deviceLifecycleLabel, deviceStatusLabel, formatApiError, type Device } from "@thcpn/api";
import { useAuth } from "@thcpn/auth";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, Panel, StateView, Tabs, TabsContent, TabsList, TabsTrigger } from "../../shared/ui";
import { CameraLive } from "./device-media";
import { DeviceDataPage } from "./device-data-page";
import { DeviceProfileTab } from "./device-profile";
import { DeviceSharingTab } from "./device-sharing";
import { CarbonDevicePage } from "./carbon-device-page";
import { DeviceCombobox } from "../../shared/data/device-combobox";
import { GatewayNodeData } from "./gateway-node-data";
import { DEVICE_LIST_GC_TIME, DEVICE_LIST_STALE_TIME, deviceListQueryKey } from "../../shared/data/device-list-cache";
import { isCameraDevice, deviceDetailTab, type DeviceTab, deviceModelLabel, deviceCategory } from "./device-model";
import { DeviceOverview } from "./device-overview";
import { DeviceProfileOperational } from "./device-profile-operational";
import { DeviceActivity } from "./device-activity";
import { DeviceConfig } from "./device-config";
import { platformEdition } from "../../app/edition";

function DeviceQuickSwitcher({
  device,
  devices,
  onSwitch,
}: {
  device: Device;
  devices: Device[];
  onSwitch: (deviceId: string) => void;
}) {
  return (
    <div className="device-quick-switch">
      <span>快捷切换设备</span>
      <DeviceCombobox devices={devices} value={device.id} onChange={onSwitch} variant="compact" includeNodes={false} ariaLabel="搜索并切换设备" />
    </div>
  );
}

export function DeviceCenterDetailPage() {
  const { deviceId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { currentId, workspaces } = useWorkspace();
  const { user } = useAuth();
  const detail = useQuery({
    queryKey: ["device", deviceId, "detail"],
    queryFn: () => api.devices.get(deviceId),
    enabled: Boolean(deviceId),
  });
  const detailWorkspaceId = detail.data?.workspace_id ?? currentId;
  const workspaceDevices = useQuery({
    queryKey: deviceListQueryKey(detailWorkspaceId),
    queryFn: () => api.devices.list(detailWorkspaceId!),
    enabled: Boolean(detailWorkspaceId),
    staleTime: DEVICE_LIST_STALE_TIME,
    gcTime: DEVICE_LIST_GC_TIME,
  });
  const projects = useQuery({
    queryKey: workspaceQueryKey(detailWorkspaceId, "projects"),
    queryFn: () => api.projects.list(detailWorkspaceId!),
    enabled: Boolean(detailWorkspaceId),
  });
  const sites = useQuery({
    queryKey: workspaceQueryKey(detailWorkspaceId, "sites", "device-detail"),
    queryFn: () => api.sites.list(detailWorkspaceId!),
    enabled: Boolean(detailWorkspaceId),
  });
  const [feedback, setFeedback] = useState("");
  if (detail.isLoading)
    return (
      <Panel>
        <StateView
          type="loading"
          title="正在加载设备"
          description="正在读取设备详情。"
        />
      </Panel>
    );
  if (detail.error || !detail.data)
    return (
      <Panel>
        <StateView
          type="error"
          title="设备不可用"
          description={
            detail.error
              ? formatApiError(detail.error).message
              : "设备不存在、已转移或当前账号无权访问。"
          }
          requestId={
            detail.error ? formatApiError(detail.error).requestId : undefined
          }
        />
      </Panel>
    );
  const device = detail.data;
  if (!detailWorkspaceId)
    return (
      <Panel>
        <StateView
          type="error"
          title="设备缺少组织信息"
          description="当前设备没有可用的组织分配或共享授权。"
        />
      </Panel>
    );
  const carbonDevice = device.device_type === "carbon_sink";
  const camera = isCameraDevice(device);
  const tab = deviceDetailTab(params.get("tab"), camera, carbonDevice);
  if (params.get("tab") !== tab)
    return (
      <Navigate
        replace
        to={`/devices/${encodeURIComponent(device.id)}?${new URLSearchParams({ ...Object.fromEntries(params), tab })}`}
      />
    );
  const workspaceDeviceItems = workspaceDevices.data?.items ?? [];
  const quickSwitchDevices = workspaceDeviceItems.some(
    (item) => item.id === device.id,
  )
    ? workspaceDeviceItems
    : [device, ...workspaceDeviceItems];
  const switchDevice = (nextDeviceId: string) => {
    const nextDevice = quickSwitchDevices.find((item) => item.id === nextDeviceId);
    let nextTab = tab;
    if (nextDevice) {
      const nextCamera = isCameraDevice(nextDevice);
      const nextCarbon = nextDevice.device_type === "carbon_sink";
      nextTab = deviceDetailTab(nextTab, nextCamera, nextCarbon);
      if (!nextCamera && tab === "video") nextTab = "data";
    }
    navigate(
      `/devices/${encodeURIComponent(nextDeviceId)}?tab=${encodeURIComponent(nextTab)}`,
    );
  };
  const run = async (
    action: () => Promise<unknown>,
    message: string,
    leavesWorkspace = false,
  ) => {
    setFeedback("");
    try {
      await action();
      if (leavesWorkspace) {
        navigate("/devices", { replace: true, state: { message } });
        return true;
      }
      setFeedback(message);
      await detail.refetch();
      return true;
    } catch (error) {
      const item = formatApiError(error);
      setFeedback(
        `${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
      );
      return false;
    }
  };
  const tabs = ((
    camera
      ? [
          { id: "video", label: "实时视频" },
          { id: "profile", label: "资料" },
          { id: "activity", label: "记录" },
        ]
      : [
          { id: "overview" as DeviceTab, label: "概览" },
          { id: "data", label: "数据" },
          { id: "profile", label: "资料" },
          { id: "config", label: "配置" },
          { id: "sharing", label: "分享" },
          { id: "activity", label: "记录" },
        ]
  ) as Array<{ id: DeviceTab; label: string }>).filter((item) =>
    platformEdition.allowedDeviceTabs.has(item.id),
  );
  const selectTab = (nextTab: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set("tab", nextTab);
    return next;
  });
  return (
    <>
      <div className="device-detail-heading">
        <div className="device-detail-title">
          <h1>{device.name}</h1>
          <div className="device-detail-meta">
            <span>
              资产编号 {device.asset_no || "—"} · {deviceModelLabel(device)}
            </span>
            <Badge
              tone={device.lifecycle_status === "online" ? "success" : "warning"}
            >
              {deviceLifecycleLabel(device.lifecycle_status)}
            </Badge>
            <span>{deviceStatusLabel(device.status)}</span>
          </div>
        </div>
        <div className="device-detail-actions">
          {quickSwitchDevices.length > 1 && (
            <DeviceQuickSwitcher
              device={device}
              devices={quickSwitchDevices}
              onSwitch={switchDevice}
            />
          )}
          {platformEdition.showAlerts && (
            <Link to={`/alerts?new=1&device=${device.id}`}>
              <Button variant="secondary"><BellRing size={14}/>创建预警</Button>
            </Link>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={selectTab} activationMode="manual">
        <DeviceDetailTabs tabs={tabs} activeTab={tab} />
        {feedback && (
          <div className="command-note device-feedback">{feedback}</div>
        )}
        <TabsContent className="device-detail-tab-content" key={tab} value={tab}>
          {carbonDevice && tab === "data" ? (
            <CarbonDevicePage device={device} />
          ) : tab === "overview" ? (
            <DeviceOverview
              device={device}
              workspaceId={detailWorkspaceId}
              onOpenData={() => selectTab("data")}
            />
          ) : tab === "data" && deviceCategory(device) === "gateway" ? (
            device.source_family === "lorawan_v2" ? <LoRaWANDataView gateway={device} workspaceId={detailWorkspaceId}/> : <GatewayNodeData gateway={device} workspaceId={detailWorkspaceId} />
          ) : tab === "data" ? (
            <DeviceDataPage deviceId={device.id} embedded />
          ) : tab === "video" ? (
            <CameraLive device={device} />
          ) : tab === "profile" ? (
            <DeviceProfileTab
              workspaceId={detailWorkspaceId}
              device={device}
              projects={projects.data?.items ?? []}
              sites={sites.data?.items ?? []}
              operational={<DeviceProfileOperational workspaceId={detailWorkspaceId} device={device} />}
            />
          ) : tab === "sharing" ? (
            <DeviceSharingTab workspaceId={detailWorkspaceId} device={device} />
          ) : tab === "activity" ? (
            <DeviceActivity device={device} workspaceId={detailWorkspaceId} />
          ) : (
            <DeviceConfig
              device={device}
              currentWorkspaceId={detailWorkspaceId}
              workspaces={workspaces.map((item) => ({
                id: item.id,
                name: item.name,
              }))}
              systemAdmin={false}
              run={run}
            />
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

function DeviceDetailTabs({ tabs, activeTab }: { tabs: Array<{ id: DeviceTab; label: string }>; activeTab: DeviceTab }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const selected = list?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    if (list && selected && list.scrollWidth > list.clientWidth) {
      list.scrollLeft = selected.offsetLeft - (list.clientWidth - selected.offsetWidth) / 2;
    }
  }, [activeTab, tabs.length]);
  return (
    <TabsList ref={listRef} variant="underline" className="device-detail-tabs" aria-label="设备详情" data-onboarding="device-tabs">
      {tabs.map((item) => <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>)}
    </TabsList>
  );
}
