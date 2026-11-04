import { useState } from "react";
import { AnimatedNumber } from "./eco-animated-number";
import { Dialog, Popover } from "radix-ui";
import { X, ChevronRight } from "lucide-react";
import { formatApiError } from "@thcpn/api";
import { AtlasMedia } from "./atlas-media";
import { AtlasMetricSelection } from "./atlas-metric-settings";
import { seriesSummary } from "./atlas-model";
import { EcoTrendViewer } from "./eco-trend-viewer";
import { useAtlasDevice, type AtlasDeviceOptions } from "./use-atlas-device";
import "./eco-device.css";

export function EcoDeviceInspector(props: AtlasDeviceOptions & { motionEnabled?: boolean; revealed?: boolean }) {
  const { device, workspaceId, config, onNodeChange } = props;
  const model = useAtlasDevice(props);
  const { node, nodeKey, nodes, metrics, selected, visible, results, range, streams, isGateway } = model;
  const [hours, setHours] = useState(config.trend_hours ?? 24);
  const focusedMetricId = visible.some(stream => stream.id === model.focusedChart) ? model.focusedChart : visible[0]?.id;
  return <section className="eco-inspector eco-device-inspector t-panel-slide" data-open={(props.revealed ?? true) || !props.motionEnabled}>
    <h2 className="eco-panel-title eco-section-heading">设备采集数据</h2>
    <div className="eco-device-toolbar">
      <div className="eco-device-identity" title={device.name}><span>{device.name}</span>{isGateway && <><span> / </span><select aria-label="选择节点" value={nodeKey} onChange={event => { model.setNodeKey(event.target.value); model.setChosen(null); onNodeChange?.(event.target.value); }}><option value="gateway">网关概况</option>{nodes.data?.items.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}</select></>}</div>
      <div className="eco-time-pills">{[[24, "24小时"], [168, "7天"], [720, "30天"]].map(([value, label]) => <button type="button" key={value} aria-pressed={hours === value} onClick={() => { setHours(Number(value)); model.setHours(Number(value)); }}>{label}</button>)}</div>
    </div>
    <div className="eco-metric-actions">
      <Popover.Root open={model.pickerOpen} onOpenChange={open => { model.setPickerOpen(open); if (open) { model.setMetricDraft(selected); model.setPreferenceError(""); } }}>
        <Popover.Trigger asChild><button type="button" className="eco-all-metrics">全部指标 · {metrics.length}<ChevronRight size={12} /></button></Popover.Trigger>
        <Popover.Portal><Popover.Content className="eco-metric-popover" side="left" align="start" sideOffset={12} collisionPadding={12} aria-label="指标展示设置">
          <header><h3>指标展示设置</h3><Popover.Close asChild><button type="button" aria-label="关闭指标设置"><X size={16} /></button></Popover.Close></header>
          <AtlasMetricSelection key={model.storageKey} appearance="eco" metrics={metrics} value={model.metricDraft} onChange={model.setMetricDraft} />
          {model.preferenceError && <p role="alert">{model.preferenceError}</p>}
          <footer><button type="button" onClick={() => model.savePreference(true)}>恢复类型默认</button><button type="button" onClick={() => model.savePreference()}>保存</button></footer>
        </Popover.Content></Popover.Portal>
      </Popover.Root>
    </div>
    {streams.error || nodes.error ? <div className="eco-data-state" role="alert">{formatApiError(streams.error ?? nodes.error).message}</div> : streams.isLoading || (nodeKey !== "gateway" && nodes.isLoading) ? <div className="eco-data-state" role="status">正在加载…</div> : !visible.length ? <div className="eco-data-state">{metrics.length ? "请选择关注指标" : "暂无采集指标"}</div> : <div className="eco-observation-list">
      {visible.map(stream => {
        const result = results.get(stream.id);
        const summary = seriesSummary(result?.data?.series.find(series => series.data_stream_id === stream.id));
        return <button type="button" key={stream.id} className="eco-observation-row" aria-pressed={focusedMetricId === stream.id} onClick={() => model.setFocusedChart(stream.id)}>
          <span className="eco-observation-name">{stream.name}</span><strong className="eco-observation-value">{result?.isFetching && !summary.latest ? "…" : <AnimatedNumber value={summary.latest?.value} enabled={props.motionEnabled ?? false} />}<small>{stream.unit}</small></strong>
        </button>;
      })}
    </div>}
    {config.show_trends !== false && <EcoTrendViewer motionEnabled={props.motionEnabled} streams={visible} results={results} range={range} focusedId={model.focusedChart} onFocus={model.setFocusedChart} />}
    {config.show_images !== false && <EcoImagery model={model} device={device} workspaceId={workspaceId} />}

  </section>;
}

function EcoImagery({ model, device, workspaceId }: { model: ReturnType<typeof useAtlasDevice>; device: AtlasDeviceOptions["device"]; workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [asset, setAsset] = useState(false);
  const { node, nodeKey, isGateway, catalog, imageDevice, range } = model;
  const streams = (node?.streams ?? (isGateway && nodeKey !== "gateway" ? [] : catalog)).filter(stream => stream.type === "image" && stream.status === "active" && (node || stream.device_id === imageDevice));
  const restrictToStreams = node?.target.kind === "gateway_node" || (isGateway && nodeKey !== "gateway" && !node);
  const mediaProps = { appearance: "eco" as const, workspaceId, assetDeviceId: device.device_id, streams, restrictToStreams, range };
  return <section className="eco-imagery" hidden={!model.mediaAvailable}>
    <header className="eco-section-heading"><h3>采集图片</h3><button type="button" onClick={() => { setAsset(false); setOpen(true); }}>查看全部<ChevronRight size={12} /></button></header>
    <AtlasMedia key={`${imageDevice}:${nodeKey}`} {...mediaProps} deviceId={imageDevice} asset={false} pageSize={2} onAvailability={model.setMediaAvailable} />
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal><Dialog.Overlay className="eco-gallery-overlay" /><Dialog.Content className="eco-gallery" aria-describedby={undefined}>
        <header className="eco-gallery-heading"><Dialog.Title>设备影像</Dialog.Title><Dialog.Close asChild><button type="button" aria-label="关闭影像图库"><X size={20} /></button></Dialog.Close></header>
        <div className="eco-gallery-tabs"><button type="button" aria-pressed={!asset} onClick={() => setAsset(false)}>采集图片</button><button type="button" aria-pressed={asset} onClick={() => setAsset(true)}>资产照片</button></div>
        <AtlasMedia key={`${asset}:${imageDevice}:${nodeKey}`} {...mediaProps} deviceId={asset ? device.device_id : imageDevice} asset={asset} pageSize={12} />
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </section>;
}
