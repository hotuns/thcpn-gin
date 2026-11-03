import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, X } from "lucide-react";
import { api, deviceCapabilityLabel, deviceLifecycleLabel, deviceStatusLabel, formatApiError } from "@thcpn/api";
import { Badge, Button, Panel, StateView } from "../../shared/ui";
import { text } from "./device-model";

export function DeviceDetail({
  deviceId,
  onClose,
  onData,
}: {
  deviceId: string;
  onClose: () => void;
  onData: () => void;
}) {
  const [streamId, setStreamId] = useState("");
  const detail = useQuery({
    queryKey: ["device", deviceId, "detail"],
    queryFn: () => api.devices.get(deviceId),
  });
  const streams = useQuery({
    queryKey: ["device", deviceId, "streams", "detail"],
    queryFn: () => api.dataStreams.list(deviceId),
  });
  const stream = useQuery({
    queryKey: ["data-stream", streamId, "detail"],
    queryFn: () => api.dataStreams.get(streamId),
    enabled: Boolean(streamId),
  });
  if (detail.isLoading)
    return (
      <Panel className="section-gap">
        <StateView
          type="loading"
          title="正在加载设备详情"
          description="正在读取设备与数据流。"
        />
      </Panel>
    );
  if (detail.error)
    return (
      <Panel className="section-gap">
        <StateView
          type="error"
          title="设备详情加载失败"
          description={formatApiError(detail.error).message}
          requestId={formatApiError(detail.error).requestId}
        />
      </Panel>
    );
  const device = detail.data;
  return (
    <Panel className="section-gap device-detail">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">设备详情 · {device?.name}</h2>
          <div className="panel-kicker mono">
            SN {device?.serial_no} · ID {device?.id}
          </div>
        </div>
        <div className="header-actions">
          <Button onClick={onData}>
            <Eye size={13} />
            查看数据
          </Button>
          <Button variant="secondary" onClick={onClose}>
            <X size={13} />
            关闭
          </Button>
        </div>
      </div>
      <div className="device-detail-summary">
        <div>
          <span>设备类型</span>
          <strong>{device?.device_type}</strong>
        </div>
        <div>
          <span>拓扑角色</span>
          <strong>{device?.topology_role}</strong>
        </div>
        <div>
          <span>生命周期</span>
          <strong>{deviceLifecycleLabel(device?.lifecycle_status)}</strong>
        </div>
        <div>
          <span>资产状态</span>
          <strong>{deviceStatusLabel(device?.status)}</strong>
        </div>
        <div>
          <span>创建时间</span>
          <strong>{text(device?.created_at)}</strong>
        </div>
        <div>
          <span>更新时间</span>
          <strong>{text(device?.updated_at)}</strong>
        </div>
      </div>
      <div className="device-detail-capabilities">
        {device?.capabilities.map((item) => (
          <span key={item} title={item}>
            <Badge tone="info">{deviceCapabilityLabel(item)}</Badge>
          </span>
        ))}
      </div>
      <div className="panel-header">
        <div>
          <h3 className="panel-title">数据流</h3>

        </div>
        <Badge tone="neutral">{streams.data?.items.length ?? 0}</Badge>
      </div>
      {streams.isLoading ? (
        <StateView
          type="loading"
          title="正在加载数据流"
          description="正在读取设备通道。"
        />
      ) : streams.error ? (
        <StateView
          type="error"
          title="数据流加载失败"
          description={formatApiError(streams.error).message}
          requestId={formatApiError(streams.error).requestId}
        />
      ) : streams.data?.items.length ? (
        <div className="device-stream-list">
          {streams.data.items.map((item) => (
            <button
              key={item.id}
              className={streamId === item.id ? "selected" : ""}
              onClick={() => setStreamId(item.id)}
            >
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.code} · {item.id}
                </small>
              </span>
              <span>
                <Badge tone={item.status === "active" ? "success" : "neutral"}>
                  {item.status}
                </Badge>
                <small>
                  {item.type} · {item.unit || "无单位"}
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <StateView
          type="empty"
          title="没有数据流"
          description="系统尚未为该设备同步可见通道。"
        />
      )}
      {streamId && (
        <div className="stream-detail-line">
          {stream.isLoading ? (
            "正在读取数据流详情…"
          ) : stream.error ? (
            `详情加载失败：${formatApiError(stream.error).message}`
          ) : (
            <>
              <strong>{stream.data?.name}</strong>
              <span className="mono">
                {stream.data?.code} · {stream.data?.id}
              </span>
              <span>
                {stream.data?.type} / {stream.data?.unit || "无单位"}
              </span>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
