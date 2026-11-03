import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatApiError, type Device } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Button, Panel, StateView } from "../../shared/ui";
import { RecentDeviceImages } from "./device-media";
import { TelemetryCharts } from "../../shared/telemetry/telemetry-charts";
import { GatewayOverview } from "./gateway-overview";
import { CarbonDeviceOverview } from "./carbon-device-page";
import { isCameraDevice } from "./device-model";

export function DeviceOverview(props: { device: Device; workspaceId: string; onOpenData: () => void }) {
  if (props.device.device_type === "gateway") return <GatewayOverview device={props.device} workspaceId={props.workspaceId}/>;
  if (props.device.device_type === "carbon_sink") return <CarbonDeviceOverview device={props.device}/>;
  return <StandardDeviceOverview {...props}/>;
}

function StandardDeviceOverview({
  device,
  workspaceId,
  onOpenData,
}: {
  device: Device;
  workspaceId: string;
  onOpenData: () => void;
}) {
  const recentRange = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 2 * 24 * 60 * 60 * 1000);
    return { startTime: start.toISOString(), endTime: end.toISOString() };
  }, [device.id]);
  const camera = isCameraDevice(device);
  const hasTelemetry =
    !camera && device.features?.includes("telemetry");
  const hasImages =
    !camera && device.features?.includes("media");
  const telemetry = useQuery({
    queryKey: workspaceQueryKey(
      workspaceId,
      "device",
      device.id,
      "overview",
      "telemetry",
      recentRange.startTime,
      recentRange.endTime,
    ),
    queryFn: () =>
      api.telemetry.device(device.id, recentRange),
    enabled: hasTelemetry,
  });
  const recentSeries = (telemetry.data?.series ?? [])
    .filter((series) => series.points.length);
  return (
    <>
      {(hasTelemetry || hasImages) && (
        <div
          className={`device-overview-signals section-gap ${hasTelemetry && hasImages ? "split" : "single"}`}
        >
          {hasTelemetry && (
            <Panel className="overview-telemetry">
              <div className="panel-header compact-panel-header">
                <div>
                  <h2 className="panel-title">最近数据</h2>

                </div>
                <Button variant="secondary" onClick={onOpenData}>
                  查看全部
                </Button>
              </div>
              {telemetry.isFetching ? (
                <StateView
                  type="loading"
                  title="正在加载最近数据"
                  description="正在整理设备最近的数据趋势。"
                />
              ) : telemetry.error ? (
                <StateView
                  type="error"
                  title="最近数据加载失败"
                  description={formatApiError(telemetry.error).message}
                  requestId={formatApiError(telemetry.error).requestId}
                />
              ) : recentSeries.length ? (
                <TelemetryCharts
                  compact
                  displayMode="separate"
                  series={recentSeries}
                  startTime={recentRange.startTime}
                  endTime={recentRange.endTime}
                />
              ) : (
                <StateView
                  type="empty"
                  title="最近没有设备数据"
                  description="最近两天内没有可显示的数值指标。"
                />
              )}
            </Panel>
          )}
          {hasImages && (
            <RecentDeviceImages
              workspaceId={workspaceId}
              device={device}
              endTime={recentRange.endTime}
              startTime={new Date(
                Date.parse(recentRange.endTime) - 7 * 7 * 24 * 60 * 60 * 1000,
              ).toISOString()}
              onOpenData={onOpenData}
            />
          )}
        </div>
      )}
    </>
  );
}
