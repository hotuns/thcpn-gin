import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { TrendingUp } from "lucide-react";
import { api, formatApiError } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, PageHeader, Panel, StateView } from "@thcpn/ui";
import {
  CameraLive,
  DeviceMedia,
  isCameraDevice,
} from "./device-media";
import { DataQuickNavigator } from "./data-quick-navigator";
import {
  DeviceQueryActions,
  querySelectedTelemetry,
} from "./device-query-actions";
import { TelemetryCharts } from "./telemetry-charts";
import { TelemetryTable } from "./telemetry-table";

const dateTimeLocal = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const formatTime = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(value))
    : "—";
function WorkspaceMissing() {
  return (
    <Panel>
      <StateView
        type="empty"
        title="请选择 Workspace"
        description="当前页面需要一个 Workspace 上下文才能读取业务数据。"
      />
    </Panel>
  );
}

export function DeviceDataPage({
  deviceId: fixedDeviceId,
  embedded = false,
}: { deviceId?: string; embedded?: boolean } = {}) {
  const { currentId } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const [deviceId, setDeviceId] = useState(fixedDeviceId ?? "");
  const [startTime, setStartTime] = useState(() =>
    dateTimeLocal(new Date(Date.now() - 24 * 60 * 60 * 1000)),
  );
  const [endTime, setEndTime] = useState(() => dateTimeLocal(new Date()));
  const [limit, setLimit] = useState(500);
  const [selectedStreamIds, setSelectedStreamIds] = useState<string[]>([]);
  const [appliedStartTime, setAppliedStartTime] = useState(startTime);
  const [appliedEndTime, setAppliedEndTime] = useState(endTime);
  const [appliedLimit, setAppliedLimit] = useState(limit);
  const [appliedStreamIds, setAppliedStreamIds] = useState<string[]>([]);
  const [selectionReadyForDevice, setSelectionReadyForDevice] = useState("");
  const devicesQuery = useQuery({
    queryKey: workspaceQueryKey(currentId, "devices"),
    queryFn: () => api.devices.list(currentId!),
    enabled: Boolean(currentId),
  });
  const devices = devicesQuery.data?.items ?? [];
  const selectedDevice = devices.find((item) => item.id === deviceId);
  useEffect(() => {
    if (fixedDeviceId) {
      if (deviceId !== fixedDeviceId) setDeviceId(fixedDeviceId);
      return;
    }
    const requested = searchParams.get("device");
    if (
      requested &&
      devices.some((item) => item.id === requested) &&
      requested !== deviceId
    )
      setDeviceId(requested);
    else if (devices.length && !devices.some((item) => item.id === deviceId))
      setDeviceId(devices[0].id);
  }, [deviceId, devices, fixedDeviceId, searchParams]);
  const streamsQuery = useQuery({
    queryKey: workspaceQueryKey(currentId, "device", deviceId, "streams"),
    queryFn: () => api.dataStreams.list(deviceId),
    enabled: Boolean(
      deviceId && selectedDevice && !isCameraDevice(selectedDevice),
    ),
  });
  useEffect(() => {
    setSelectedStreamIds([]);
    setAppliedStreamIds([]);
    setSelectionReadyForDevice("");
  }, [deviceId]);
  useEffect(() => {
    if (!deviceId || !streamsQuery.isSuccess || selectionReadyForDevice === deviceId)
      return;
    const defaults = streamsQuery.data.items
        .filter((item) => item.type === "telemetry" && item.status === "active")
        .map((item) => item.id);
    setSelectedStreamIds(defaults);
    setAppliedStreamIds(defaults);
    setSelectionReadyForDevice(deviceId);
  }, [deviceId, selectionReadyForDevice, streamsQuery.data, streamsQuery.isSuccess]);
  const telemetryQuery = useQuery({
    queryKey: workspaceQueryKey(
      currentId,
      "device",
      deviceId,
      "telemetry",
      appliedStreamIds.slice().sort().join(",") || "all",
      appliedStartTime,
      appliedEndTime,
      String(appliedLimit),
    ),
    queryFn: () =>
      querySelectedTelemetry(deviceId, appliedStreamIds, {
        startTime: new Date(appliedStartTime).toISOString(),
        endTime: new Date(appliedEndTime).toISOString(),
        limit: appliedLimit,
      }),
    enabled: Boolean(
      deviceId &&
      selectedDevice &&
      !isCameraDevice(selectedDevice) &&
      selectionReadyForDevice === deviceId &&
      appliedStartTime &&
      appliedEndTime,
    ),
  });
  const points = useMemo(
    () =>
      (telemetryQuery.data?.series ?? [])
        .flatMap((series) =>
          series.points.map((point) => ({ ...point, series })),
        )
        .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)),
    [telemetryQuery.data],
  );
  const imageStreams = useMemo(
    () =>
      (streamsQuery.data?.items ?? []).filter(
        (item) => item.type === "image" && item.status === "active",
      ),
    [streamsQuery.data],
  );
  const setRange = (hours: number) => {
    const end = new Date();
    setEndTime(dateTimeLocal(end));
    setStartTime(
      dateTimeLocal(new Date(end.getTime() - hours * 60 * 60 * 1000)),
    );
  };
  const search = () => {
    setAppliedStartTime(startTime);
    setAppliedEndTime(endTime);
    setAppliedLimit(limit);
    setAppliedStreamIds(selectedStreamIds);
  };
  const queryDirty =
    startTime !== appliedStartTime ||
    endTime !== appliedEndTime ||
    limit !== appliedLimit ||
    selectedStreamIds.slice().sort().join(",") !==
      appliedStreamIds.slice().sort().join(",");
  const querying = telemetryQuery.isFetching || streamsQuery.isFetching;
  if (!currentId)
    return (
      <>
        {!embedded && (
          <PageHeader
            eyebrow="Workspace / telemetry"
            title="设备数据"
            description="按设备和时间范围查询遥测数据。"
          />
        )}
        <WorkspaceMissing />
      </>
    );
  if (selectedDevice && isCameraDevice(selectedDevice))
    return (
      <>
        {!embedded && (
          <PageHeader
            eyebrow="Workspace / camera"
            title={selectedDevice.name}
            description="海康相机实时视频。播放凭证为短期会话，仅在当前页面使用。"
          />
        )}
        {!embedded && (
          <Panel>
            <div className="camera-only-selector">
              <label className="field">
                <span className="field-label">相机</span>
                <select
                  value={deviceId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setDeviceId(nextId);
                    setSearchParams(nextId ? { device: nextId } : {});
                  }}
                >
                  {devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name} · {device.serial_no}
                    </option>
                  ))}
                </select>
              </label>
              <div className="camera-identity">
                <Badge tone="info">海康视频</Badge>
                <span className="mono">{selectedDevice.serial_no}</span>
              </div>
            </div>
          </Panel>
        )}
        <CameraLive device={selectedDevice} />
      </>
    );
  return (
    <>
      {!embedded && (
        <PageHeader
          eyebrow="Workspace / telemetry"
          title="设备数据"
          description="查看设备遥测趋势、明细和采集图片。"
        />
      )}
      {devicesQuery.isLoading ? (
        <Panel className="section-gap">
          <StateView
            type="loading"
            title="正在加载设备"
            description="正在准备可查询的设备列表。"
          />
        </Panel>
      ) : devicesQuery.error ? (
        <Panel className="section-gap">
          <StateView
            type="error"
            title="设备加载失败"
            description={formatApiError(devicesQuery.error).message}
          />
        </Panel>
      ) : !devices.length ? (
        <Panel className="section-gap">
          <StateView
            type="empty"
            title="没有可查询设备"
            description="当前 Workspace 尚未分配设备。"
          />
        </Panel>
      ) : (
        <div className="device-data-layout">
          <div className="device-data-content">
          {selectedDevice && (
            <div id="data-section-metrics" className="data-page-anchor">
              <DeviceQueryActions
                streams={streamsQuery.data?.items ?? []}
                selected={selectedStreamIds}
                onSelectedChange={setSelectedStreamIds}
                startTime={startTime}
                endTime={endTime}
                limit={limit}
                onStartTimeChange={setStartTime}
                onEndTimeChange={setEndTime}
                onLimitChange={setLimit}
                onRangeChange={setRange}
                onSearch={search}
                dirty={queryDirty}
                searching={querying}
              />
            </div>
          )}
          <div id="data-section-trend" className="data-page-anchor section-gap">
          <Panel>
            <div className="panel-header">
              <div>
                <h2 className="panel-title">遥测趋势</h2>
                <div className="panel-kicker">
                  各指标独立量程，共享所选时间范围
                </div>
              </div>
              <TrendingUp size={16} className="muted" />
            </div>
            {telemetryQuery.isLoading ? (
              <TelemetryLoading />
            ) : telemetryQuery.error ? (
              <StateView
                type="error"
                title="趋势加载失败"
                description={formatApiError(telemetryQuery.error).message}
                requestId={formatApiError(telemetryQuery.error).requestId}
              />
            ) : telemetryQuery.data?.series.some(
                (series) => series.points.length,
              ) ? (
              <TelemetryCharts
                series={telemetryQuery.data.series}
                startTime={appliedStartTime}
                endTime={appliedEndTime}
              />
            ) : (
              <StateView
                type="empty"
                title="没有可视化数据"
                description="当前时间范围内没有数值遥测点。"
              />
            )}
          </Panel>
          </div>
          <div id="data-section-detail" className="data-page-anchor section-gap">
          <Panel className="telemetry-detail-panel">
            <details>
              <summary>
                <div>
                  <h2 className="panel-title">遥测明细</h2>
                  <div className="panel-kicker">展开查看宽表数据</div>
                </div>
                <Badge tone="neutral">{points.length} 条</Badge>
              </summary>
              {points.length ? (
                <TelemetryTable points={points} formatTime={formatTime} />
              ) : (
                <StateView
                  type="empty"
                  title="暂无明细"
                  description="当前时间范围内没有遥测明细。"
                />
              )}
            </details>
          </Panel>
          </div>
          {selectedDevice && (
            <DeviceMedia
              workspaceId={currentId}
              device={selectedDevice}
              streams={streamsQuery.data?.items ?? []}
              startTime={appliedStartTime}
              endTime={appliedEndTime}
            />
          )}
          </div>
          <DataQuickNavigator imageStreams={imageStreams} />
        </div>
      )}
    </>
  );
}

function TelemetryLoading() {
  return (
    <div
      className="telemetry-loading"
      aria-label="正在生成遥测趋势"
      aria-busy="true"
    >
      <div className="telemetry-loading-head">
        <span />
        <span />
      </div>
      <div className="telemetry-loading-stats">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="telemetry-loading-chart">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="telemetry-loading-caption">正在读取并整理时间序列…</div>
    </div>
  );
}
