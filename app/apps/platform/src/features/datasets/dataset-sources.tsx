import { isMeasurement, streamPurposeLabel } from "@thcpn/api";
import { useQuery } from "@tanstack/react-query";
import { api, type JsonRecord } from "@thcpn/api";
import { type SourceInput } from "./dataset-model";
import { sourceTypeLabel } from "./dataset-format";

export function DatasetSourceSummary({
  sources,
  devices,
  limit = 2,
}: {
  sources: SourceInput[];
  devices: JsonRecord[];
  limit?: number;
}) {
  const visible = sources.slice(0, limit);
  return (
    <div className="dataset-source-summary">
      {visible.map((source) => (
        <div key={`${source.source_type}-${source.source_id}`}>
          <SourceName source={source} devices={devices} />
          <small>{sourceTypeLabel(source.source_type)}</small>
        </div>
      ))}
      {sources.length > visible.length && (
        <span className="dataset-source-more">+ {sources.length - visible.length} 个</span>
      )}
    </div>
  );
}

export function SourceName({
  source,
  devices,
}: {
  source: SourceInput;
  devices: JsonRecord[];
}) {
  const stream = useQuery({
    queryKey: ["data-stream", source.source_id, "source-name"],
    queryFn: () => api.dataStreams.get(source.source_id),
    enabled: source.source_type === "data_stream",
    staleTime: 60_000,
  });
  const listedDevice = devices.find(
    (item) => String(item.id) === stream.data?.device_id,
  );
  const streamDevice = useQuery({
    queryKey: ["device", stream.data?.device_id, "dataset-source-name"],
    queryFn: () => api.devices.get(stream.data!.device_id),
    enabled: Boolean(
      source.source_type === "data_stream" &&
        stream.data?.device_id &&
        !listedDevice,
    ),
    staleTime: 60_000,
  });
  if (source.source_type === "device") {
    const device = devices.find((item) => String(item.id) === source.source_id);
    return (
      <span className="dataset-source-identity">
        {String(device?.name ?? device?.serial_no ?? "未知设备")}
      </span>
    );
  }
  if (source.source_type === "file")
    return <span className="dataset-source-identity">文件来源</span>;
  if (stream.isLoading)
    return <span className="dataset-source-identity">正在加载数据来源…</span>;
  if (!stream.data)
    return <span className="dataset-source-identity">未命名数据指标</span>;
  const device = listedDevice ?? streamDevice.data;
  const deviceName = String(
    device?.name ?? device?.serial_no ?? "未知设备",
  );
  const serialNumber = device?.serial_no ? String(device.serial_no) : "";
  return (
    <span className="dataset-source-identity">
      <strong>
        {deviceName}
        {serialNumber ? ` · ${serialNumber}` : ""}
      </strong>
      <small>
        {stream.data.computed ? "fx · " : ""}
        {stream.data.name}{!isMeasurement(stream.data) && ` · ${streamPurposeLabel(stream.data)}`} · {stream.data.code}
      </small>
    </span>
  );
}
