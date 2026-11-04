import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, deviceTopologyRoleLabel, formatApiError, isMeasurement, type DataStream, type DeviceMapItem } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { ArrowDown, ArrowUp, Pin } from "lucide-react";
import { Button, Input, SelectInput } from "../../shared/ui";
import { ATLAS_METRIC_LIMIT } from "./atlas-metric-preferences";
import "./atlas-metric-settings.css";

export function AtlasMetricSelection({ metrics, value, onChange, appearance = "atlas" }: { metrics: DataStream[]; value: string[]; onChange: (ids: string[]) => void; appearance?: "atlas" | "eco" }) {
  const cls = (name: string) => `${appearance}-${name}`;
  const [search, setSearch] = useState("");
  const [onlyChosen, setOnlyChosen] = useState(false);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter(item => item !== id) : [...value, id].slice(0, ATLAS_METRIC_LIMIT));
  const move = (id: string, delta: number) => {
    const next = [...value]; const index = next.indexOf(id); const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]]; onChange(next);
  };
  const matches = metrics.filter(stream => `${stream.name} ${stream.code}`.toLowerCase().includes(search.toLowerCase()) && (!onlyChosen || value.includes(stream.id)));
  return <div className={cls("metric-selector")}>
    <Input aria-label="搜索指标" placeholder="搜索指标名称或编码" value={search} onChange={event => setSearch(event.target.value)} />
    <div className={cls("metric-selector-tabs")}><Button variant="ghost" aria-pressed={!onlyChosen} onClick={() => setOnlyChosen(false)}>全部指标 {metrics.length}</Button><Button variant="ghost" aria-pressed={onlyChosen} onClick={() => setOnlyChosen(true)}>已选 {value.length}/{ATLAS_METRIC_LIMIT}</Button></div>
    <div className={cls("metric-selector-list")}>
      {value.length > 0 && <section><h4>展示顺序</h4>{value.map((id, index) => {
        const stream = metrics.find(item => item.id === id);
        return stream && <div key={id} className={cls("metric-order-row")}><Pin size={13} /><span>{index + 1}. {stream.name}</span><Button variant="ghost" aria-label={`上移${stream.name}`} disabled={index === 0} onClick={() => move(id, -1)}><ArrowUp size={13} /></Button><Button variant="ghost" aria-label={`下移${stream.name}`} disabled={index === value.length - 1} onClick={() => move(id, 1)}><ArrowDown size={13} /></Button></div>;
      })}</section>}
      {[true, false].map(measurement => {
        const group = matches.filter(stream => isMeasurement(stream) === measurement);
        return group.length > 0 && <section key={String(measurement)}><h4>{measurement ? "观测指标" : "设备状态"}</h4>{group.map(stream => <label key={stream.id} className={cls("metric-choice")}><input type="checkbox" checked={value.includes(stream.id)} disabled={!value.includes(stream.id) && value.length >= ATLAS_METRIC_LIMIT} onChange={() => toggle(stream.id)} /><span>{stream.name}<small>{stream.code}</small></span><small>{stream.unit}</small></label>)}</section>;
      })}
      {!matches.length && <p>没有匹配的指标</p>}
    </div>
    {appearance !== "eco" && <small>最多展示 6 项 · 使用上下箭头调整顺序</small>}
  </div>;
}

export function AtlasMetricDefaultsEditor({ workspaceId, devices, value, onChange }: { workspaceId: string; devices: DeviceMapItem[]; value?: Record<string, string[]>; onChange: (value: Record<string, string[]>) => void }) {
  const available = devices.filter(device => !device.gateway_device_id);
  const kinds = [...new Set(available.map(device => device.device_type))];
  const [kind, setKind] = useState(kinds[0] ?? "");
  const [example, setExample] = useState("");
  const examples = available.filter(device => device.device_type === kind);
  const device = examples.find(item => item.device_id === example) ?? examples[0];
  const streams = useQuery({ queryKey: workspaceQueryKey(workspaceId, "atlas", "defaults", device?.device_id ?? ""), queryFn: () => api.dataStreams.list(device!.device_id), enabled: !!device, staleTime: 60000 });
  const gateway = kind === "gateway";
  const nodes = useQuery({ queryKey: workspaceQueryKey(workspaceId, "atlas", "defaults-nodes", device?.device_id ?? ""), queryFn: () => api.devices.nodes(device!.device_id), enabled: !!device && gateway, staleTime: 60000 });
  const catalog = [...(streams.data?.items ?? []), ...(nodes.data?.items.flatMap(node => node.streams) ?? [])].filter(stream => stream.type === "telemetry" && stream.status === "active");
  const metrics = [...new Map(catalog.map(stream => [stream.code, { ...stream, id: stream.code }])).values()];
  const defaults = value?.[`device:${kind}`] ?? [];
  return <section className="atlas-default-metrics"><header><strong>各类设备默认指标</strong><p>按指标编码匹配设备或节点，最多 6 项。不支持的指标自动跳过；未配置时默认展示前 4 个观测指标。</p></header>
    <div className="atlas-default-metric-controls"><SelectInput aria-label="默认指标设备类型" value={kind} onChange={event => { setKind(event.target.value); setExample(""); }}>{kinds.map(item => <option key={item} value={item}>{deviceTopologyRoleLabel(item)}</option>)}</SelectInput><SelectInput aria-label="参考设备" value={device?.device_id ?? ""} onChange={event => setExample(event.target.value)}>{examples.map(item => <option key={item.device_id} value={item.device_id}>{item.name}</option>)}</SelectInput></div>
    {(streams.isLoading || (gateway && nodes.isLoading)) ? <p role="status">正在加载指标…</p> : streams.error || nodes.error ? <p role="alert">{formatApiError(streams.error ?? nodes.error).message}<Button variant="ghost" onClick={() => { void streams.refetch(); if (gateway) void nodes.refetch(); }}>重试</Button></p> : !metrics.length ? <p>该设备暂无可配置的指标，请选择其他参考设备。</p> : <>
      {defaults.filter(code => !metrics.some(stream => stream.code === code)).length > 0 && <p>部分已配置指标不在当前参考设备中，可以在下方取消选择。</p>}
      <AtlasMetricSelection key={`${kind}:${device?.device_id}`} metrics={[...metrics, ...defaults.filter(code => !metrics.some(stream => stream.code === code)).map(code => ({ ...metrics[0], id: code, code, name: `${code}（当前参考设备未提供）` }))]} value={defaults} onChange={ids => onChange({ ...value, [`device:${kind}`]: ids })} />
    </>}
    {value?.[`device:${kind}`] !== undefined && <Button variant="ghost" onClick={() => { const next = { ...value }; delete next[`device:${kind}`]; onChange(next); }}>恢复自动推荐</Button>}
  </section>;
}
