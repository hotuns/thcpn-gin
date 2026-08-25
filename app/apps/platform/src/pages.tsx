import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Database, Download, GitCompareArrows } from "lucide-react";
import { api, formatApiError, type TelemetrySeries } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, PageHeader, Panel, StateView } from "@thcpn/ui";
import {
  CameraLive,
  DeviceMedia,
  isCameraDevice,
} from "./device-media";
import { DataQuickNavigator, scrollToDataSection } from "./data-quick-navigator";
import {
  DeviceQueryActions,
  querySelectedTelemetry,
  querySelectedTelemetryRaw,
} from "./device-query-actions";
import { TelemetryCharts } from "./telemetry-charts";
import { TelemetryTable } from "./telemetry-table";
import { dataComparisonPath, datasetCreatePath } from "./data-workflow";

const dateTimeLocal = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const formatTime = (value?: string) =>
  value
    ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
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
        title="请选择工作区"
        description="请先选择工作区，才能读取业务数据。"
      />
    </Panel>
  );
}

export function DeviceDataPage({
  deviceId: fixedDeviceId,
  embedded = false,
}: { deviceId?: string; embedded?: boolean } = {}) {
  const { currentId } = useWorkspace();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [deviceId, setDeviceId] = useState(fixedDeviceId ?? "");
  const [startTime, setStartTime] = useState(() =>
    dateTimeLocal(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
  );
  const [endTime, setEndTime] = useState(() => dateTimeLocal(new Date()));
  const [selectedStreamIds, setSelectedStreamIds] = useState<string[]>([]);
  const [selectedImageStreamIds, setSelectedImageStreamIds] = useState<string[]>([]);
  const [appliedStartTime, setAppliedStartTime] = useState(startTime);
  const [appliedEndTime, setAppliedEndTime] = useState(endTime);
  const [appliedStreamIds, setAppliedStreamIds] = useState<string[]>([]);
  const [appliedImageStreamIds, setAppliedImageStreamIds] = useState<string[]>([]);
  const [selectionReadyForDevice, setSelectionReadyForDevice] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailPages, setDetailPages] = useState<TelemetrySeries[][]>([]);
  const [detailLoadingMore, setDetailLoadingMore] = useState(false);
  const [detailLoadMoreError, setDetailLoadMoreError] = useState("");
  const devicesQuery = useQuery({
    queryKey: workspaceQueryKey(currentId, "devices"),
    queryFn: () => api.devices.list(currentId!),
    enabled: Boolean(currentId),
  });
  const fixedDeviceQuery = useQuery({
    queryKey: ["device", fixedDeviceId, "data-page"],
    queryFn: () => api.devices.get(fixedDeviceId!),
    enabled: Boolean(fixedDeviceId),
  });
  const workspaceDevices = devicesQuery.data?.items ?? [];
  const devices = fixedDeviceQuery.data && !workspaceDevices.some((item) => item.id === fixedDeviceQuery.data?.id)
    ? [fixedDeviceQuery.data, ...workspaceDevices]
    : workspaceDevices;
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
    setSelectedImageStreamIds([]);
    setAppliedStreamIds([]);
    setAppliedImageStreamIds([]);
    setSelectionReadyForDevice("");
    setDetailOpen(false);
    setDetailPages([]);
    setDetailLoadMoreError("");
  }, [deviceId]);
  useEffect(() => {
    if (!deviceId || !streamsQuery.isSuccess || selectionReadyForDevice === deviceId)
      return;
    const defaults = streamsQuery.data.items
        .filter((item) => item.type === "telemetry" && item.status === "active")
        .map((item) => item.id);
    const imageDefaults = streamsQuery.data.items
      .filter((item) => item.type === "image" && item.status === "active")
      .map((item) => item.id);
    setSelectedStreamIds(defaults);
    setSelectedImageStreamIds(imageDefaults);
    setAppliedStreamIds(defaults);
    setAppliedImageStreamIds(imageDefaults);
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
    ),
    queryFn: () =>
      querySelectedTelemetry(deviceId, appliedStreamIds, {
        startTime: new Date(appliedStartTime).toISOString(),
        endTime: new Date(appliedEndTime).toISOString(),
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
  const detailTelemetryQuery = useQuery({
    queryKey: workspaceQueryKey(
      currentId,
      "device",
      deviceId,
      "telemetry-raw",
      appliedStreamIds.slice().sort().join(",") || "all",
      appliedStartTime,
      appliedEndTime,
      "500",
    ),
    queryFn: () =>
      querySelectedTelemetryRaw(deviceId, appliedStreamIds, {
        startTime: new Date(appliedStartTime).toISOString(),
        endTime: new Date(appliedEndTime).toISOString(),
      }),
    enabled: Boolean(
      detailOpen &&
      deviceId &&
      selectedDevice &&
      !isCameraDevice(selectedDevice) &&
      selectionReadyForDevice === deviceId &&
      appliedStartTime &&
      appliedEndTime,
    ),
  });
  useEffect(() => {
    setDetailPages([]);
    setDetailLoadMoreError("");
  }, [appliedEndTime, appliedStartTime, appliedStreamIds]);
  const detailSeries = useMemo(() => {
    const merged = new Map<string, TelemetrySeries>();
    const pages = [detailTelemetryQuery.data?.series ?? [], ...detailPages];
    pages.forEach((page) => {
      page.forEach((series) => {
        const current = merged.get(series.data_stream_id);
        if (!current) {
          merged.set(series.data_stream_id, { ...series, points: [...series.points] });
          return;
        }
        const points = [...current.points, ...series.points]
          .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
          .filter(
            (point, index, items) =>
              index === 0 ||
              point.ts !== items[index - 1].ts ||
              point.value !== items[index - 1].value,
          );
        merged.set(series.data_stream_id, {
          ...current,
          ...series,
          points,
          source_count: points.length,
          returned_count: points.length,
        });
      });
    });
    return [...merged.values()];
  }, [detailPages, detailTelemetryQuery.data]);
  const points = useMemo(
    () =>
      detailSeries
        .flatMap((series) =>
          series.points.map((point) => ({ ...point, series })),
        )
        .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)),
    [detailSeries],
  );
  const detailMayHaveMore = detailSeries.some(
    (series) => !series.complete,
  );
  const loadMoreDetails = async () => {
    const pending = detailSeries.filter(
      (series) => !series.complete && series.points.length,
    );
    if (!pending.length || detailLoadingMore) return;
    setDetailLoadingMore(true);
    setDetailLoadMoreError("");
    try {
      const nextSeries: TelemetrySeries[] = [];
      for (let index = 0; index < pending.length; index += 4) {
        const batch = pending.slice(index, index + 4);
        const responses = await Promise.all(
          batch.map((series) => {
            const cursor = series.points.at(-1)!.ts;
            return api.telemetry.dataStream(series.data_stream_id, {
              startTime: cursor,
              endTime: new Date(appliedEndTime).toISOString(),
              limit: 500,
            });
          }),
        );
        responses.forEach((response, responseIndex) => {
          const current = batch[responseIndex];
          const cursor = current.points.at(-1)!.ts;
          if (!response.series.length) {
            nextSeries.push({ ...current, points: [], returned_count: 0, complete: true });
            return;
          }
          response.series.forEach((series) => {
            const freshPoints = series.points.filter(
              (point) => Date.parse(point.ts) > Date.parse(cursor),
            );
            nextSeries.push({
              ...series,
              points: freshPoints,
              returned_count: freshPoints.length,
              complete: series.complete || freshPoints.length === 0,
            });
          });
        });
      }
      setDetailPages((current) => [...current, nextSeries]);
    } catch (error) {
      setDetailLoadMoreError(formatApiError(error).message);
    } finally {
      setDetailLoadingMore(false);
    }
  };
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
    setAppliedStreamIds(selectedStreamIds);
    setAppliedImageStreamIds(selectedImageStreamIds);
    window.requestAnimationFrame(() => scrollToDataSection("data-section-trend"));
  };
  const reorderSelectedStreams = (nextIds: string[]) => {
    setSelectedStreamIds(nextIds);
    setAppliedStreamIds((current) => {
      const applied = new Set(current);
      return nextIds.filter((id) => applied.has(id));
    });
  };
  const queryDirty =
    startTime !== appliedStartTime ||
    endTime !== appliedEndTime ||
    selectedStreamIds.slice().sort().join(",") !==
      appliedStreamIds.slice().sort().join(",") ||
    selectedImageStreamIds.slice().sort().join(",") !==
      appliedImageStreamIds.slice().sort().join(",");
  const querying = telemetryQuery.isFetching || streamsQuery.isFetching;
  if (!currentId)
    return (
      <>
        {!embedded && (
          <PageHeader
            eyebrow="工作区 / 遥测"
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
            eyebrow="工作区 / 监控站"
            title={selectedDevice.name}
            description="监控站实时视频。播放凭证为短期会话，仅在当前页面使用。"
          />
        )}
        {!embedded && (
          <Panel>
            <div className="camera-only-selector">
              <label className="field">
                <span className="field-label">监控站</span>
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
                      {device.name} · SN {device.serial_no}
                    </option>
                  ))}
                </select>
              </label>
              <div className="camera-identity">
                <Badge tone="info">海康视频</Badge>
                <span className="mono">SN {selectedDevice.serial_no}</span>
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
          eyebrow="工作区 / 遥测"
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
            description="当前工作区尚未分配设备。"
          />
        </Panel>
      ) : (
        <>
        <div className="device-data-layout">
          <div className="device-data-content">
          {selectedDevice && (
            <div id="data-section-metrics" className="data-page-anchor">
              <DeviceQueryActions
                streams={streamsQuery.data?.items ?? []}
                selected={selectedStreamIds}
                onSelectedChange={setSelectedStreamIds}
                onSelectedOrderChange={reorderSelectedStreams}
                selectedImages={selectedImageStreamIds}
                onSelectedImagesChange={setSelectedImageStreamIds}
                startTime={startTime}
                endTime={endTime}
                onStartTimeChange={setStartTime}
                onEndTimeChange={setEndTime}
                onRangeChange={setRange}
                onSearch={search}
                dirty={queryDirty}
                searching={querying}
                loading={streamsQuery.isLoading}
                error={streamsQuery.error}
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
              <div className="header-actions data-workflow-actions">
                {selectedDevice && !isCameraDevice(selectedDevice) && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const type = selectedDevice.device_type;
                      const exportParams = new URLSearchParams({
                        system: type === "standalone" ? "standard" : "group",
                        start: new Date(appliedStartTime).toISOString(),
                        end: new Date(appliedEndTime).toISOString(),
                      });
                      if (type === "standalone") exportParams.set("devices", selectedDevice.id);
                      else {
                        exportParams.set("gateway", String((selectedDevice as unknown as Record<string, unknown>).parent_device_id ?? selectedDevice.id));
                        if (type === "gateway_node") exportParams.set("devices", selectedDevice.id);
                      }
                      navigate(`/exports?${exportParams}`);
                    }}
                  >
                    <Download size={14} />
                    数据导出
                  </Button>
                )}
                <Button
                  variant="secondary"
                  disabled={!deviceId || !appliedStreamIds.length}
                  onClick={() =>
                    navigate(
                      dataComparisonPath(
                        appliedStreamIds.map((streamId) => ({
                          deviceId,
                          streamId,
                        })),
                        appliedStartTime,
                        appliedEndTime,
                      ),
                    )
                  }
                >
                  <GitCompareArrows size={14} />
                  {appliedStreamIds.length > 8
                    ? "加入对比（前 8 项）"
                    : "加入对比"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={!appliedStreamIds.length}
                  onClick={() =>
                    navigate(
                      datasetCreatePath({
                        sourceIds: appliedStreamIds,
                        startTime: appliedStartTime,
                        endTime: appliedEndTime,
                        name: `${selectedDevice?.name ?? "设备"}遥测数据`,
                      }),
                    )
                  }
                >
                  <Database size={14} />
                  保存为数据集
                </Button>
              </div>
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
                series={[...telemetryQuery.data.series].sort(
                  (left, right) =>
                    appliedStreamIds.indexOf(left.data_stream_id) -
                    appliedStreamIds.indexOf(right.data_stream_id),
                )}
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
            <details
              open={detailOpen}
              onToggle={(event) => setDetailOpen(event.currentTarget.open)}
            >
              <summary>
                <div>
                  <h2 className="panel-title">遥测明细</h2>
                  <div className="panel-kicker">展开后加载原始宽表数据</div>
                </div>
                <Badge tone="neutral">
                  {detailOpen ? `${points.length} 条` : "按需加载"}
                </Badge>
              </summary>
              {detailTelemetryQuery.isLoading ? (
                <StateView type="loading" title="正在加载遥测明细" description="正在读取原始数据点。" />
              ) : detailTelemetryQuery.error ? (
                <StateView
                  type="error"
                  title="明细加载失败"
                  description={formatApiError(detailTelemetryQuery.error).message}
                  requestId={formatApiError(detailTelemetryQuery.error).requestId}
                />
              ) : points.length ? (
                <>
                  {detailMayHaveMore && (
                    <div className="telemetry-detail-notice">
                      原始明细按每个指标 500 条分批加载；完整趋势已在上方图表展示。
                    </div>
                  )}
                  <TelemetryTable points={points} formatTime={formatTime} />
                  {(detailMayHaveMore || detailLoadMoreError) && (
                    <div className="telemetry-detail-more">
                      {detailLoadMoreError && (
                        <span className="form-error">{detailLoadMoreError}</span>
                      )}
                      {detailMayHaveMore && (
                        <Button
                          variant="secondary"
                          disabled={detailLoadingMore}
                          onClick={loadMoreDetails}
                        >
                          {detailLoadingMore ? "加载中…" : "加载更多明细"}
                        </Button>
                      )}
                    </div>
                  )}
                </>
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
              imageStreamIds={appliedImageStreamIds}
              startTime={appliedStartTime}
              endTime={appliedEndTime}
            />
          )}
          </div>
          <DataQuickNavigator
            imageStreams={(streamsQuery.data?.items ?? []).filter(
              (stream) =>
                stream.type === "image" &&
                stream.status === "active" &&
                appliedImageStreamIds.includes(stream.id),
            )}
          />
        </div>
        </>
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
