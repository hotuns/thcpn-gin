import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatApiError, type DeviceMapItem } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { RadioTower, Network, Leaf, Video, Database, Activity, Gauge, Search, Signal, SignalHigh, SignalMedium, SignalLow } from "lucide-react";
import { reportingCounts } from "./atlas-health";
import { ObservatoryAutoScroll } from "../../shared/observatory/observatory-motion";
import { AnimatedNumber } from "./eco-animated-number";
import "./eco-directory.css";

const types = [
  { kind: "standalone", label: "标准站", Icon: RadioTower },
  { kind: "network", label: "组网站", Icon: Network },
  { kind: "carbon_sink", label: "碳汇", Icon: Leaf },
  { kind: "camera", label: "监控", Icon: Video },
] as const;

export function EcoDirectory({ workspaceId, devices, selectedDevice, selectedNodeKey, onSelect, onSelectNode, kind, onKindChange, scoped = false, motionEnabled = false, revealed = true }: {
  workspaceId: string;
  devices: DeviceMapItem[];
  selectedDevice?: DeviceMapItem;
  selectedNodeKey: string;
  onSelect: (id: string) => void;
  onSelectNode: (key: string) => void;
  kind: string;
  onKindChange: (kind: string) => void;
  scoped?: boolean;
  motionEnabled?: boolean;
  revealed?: boolean;
}) {
  const [search, setSearch] = useState("");
  const physical = useMemo(() => devices.filter(device => !device.gateway_device_id), [devices]);
  const ids = physical.map(device => device.device_id).sort();
  const overview = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "dashboard", "7"),
    queryFn: () => api.dashboard(workspaceId, 7),
    enabled: !scoped,
    staleTime: 30000,
    refetchInterval: query => Math.max(5, Math.min(300, query.state.data?.refresh_interval_seconds ?? 30)) * 1000,
    retry: false,
  });
  const runtime = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "atlas", "runtime", ids.join(",")),
    queryFn: () => api.devices.runtime(ids),
    enabled: scoped && ids.length > 0,
    staleTime: 60000, refetchInterval: 60000, retry: false,
  });
  const counts = reportingCounts(ids, runtime.data, Date.now());
  const total = scoped ? physical.length : overview.data?.devices.total;
  const workspaceReportingUnknown = overview.data && overview.data.devices.reporting === 0
    && overview.data.devices.total > overview.data.devices.inactive
    && overview.data.devices.unknown >= overview.data.devices.total - overview.data.devices.inactive;
  const reporting = scoped
    ? runtime.data && !runtime.isError && counts.unknown < counts.total ? counts.normal : undefined
    : workspaceReportingUnknown ? undefined : overview.data?.devices.reporting;
  const daily = scoped ? undefined : overview.data?.records.today.value;
  const unknown = scoped ? counts.unknown : overview.data?.devices.unknown;
  const ratio = total && reporting != null && unknown === 0 ? reporting / total * 100 : undefined;
  const format = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
  const gateway = selectedDevice?.device_type === "gateway" ? selectedDevice : undefined;
  const nodes = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "atlas", gateway?.device_id ?? "", "nodes"),
    queryFn: () => api.devices.nodes(gateway!.device_id), enabled: Boolean(gateway),
    staleTime: 60000, retry: false,
  });
  const indices = nodes.data?.items.flatMap(node => node.target.kind === "gateway_node" ? [node.target.node_index] : []) ?? [];
  const nodeRuntime = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "device", gateway?.device_id ?? "", "node-runtime", indices.join(",")),
    queryFn: () => api.devices.nodeRuntime(gateway!.device_id, indices),
    enabled: Boolean(gateway && indices.length), staleTime: 60000, refetchInterval: 60000, retry: false,
  });
  const term = search.trim().toLocaleLowerCase();
  const choices = physical.filter(device =>
    (kind === "all" || (kind === "network" ? ["gateway", "gateway_node"].includes(device.device_type) : device.device_type === kind)) &&
    (!term || `${device.name} ${device.serial_no}`.toLocaleLowerCase().includes(term)));
  const options = selectedDevice && !choices.some(device => device.device_id === selectedDevice.device_id) ? [selectedDevice, ...choices] : choices;
  const error = (scoped ? runtime.error : overview.error) || nodes.error || nodeRuntime.error;
  const retry = () => { if (scoped) void runtime.refetch(); else void overview.refetch(); if (gateway) void nodes.refetch(); if (indices.length) void nodeRuntime.refetch(); };
  return <aside className="eco-directory" data-motion={motionEnabled ? "running" : "paused"}>
    <section className="eco-panel eco-overview t-panel-slide" data-open={revealed || !motionEnabled} aria-label="观测总览">
      <h2 className="eco-panel-title">观测总览</h2>
      <div className="eco-overview-counts" title={scoped ? "当前设备范围" : "工作空间全部设备"}>
        {[
          { label: "接入设备", value: total, Icon: RadioTower, formatter: format },
          { tone: "mint", label: "正常上报", value: reporting, Icon: Activity, formatter: format },
          { tone: "gold", label: "今日采集", value: daily, Icon: Database, formatter: format },
          { label: "上报率", value: ratio, Icon: Gauge, formatter: (value: number) => `${value.toFixed(1)}%` },
        ].map(({ tone, label, value, Icon, formatter }) => <div className="eco-overview-count" key={label} data-tone={tone}><Icon size={26} aria-hidden="true"/><div className="eco-overview-copy"><span>{label}</span><strong><AnimatedNumber value={value} enabled={motionEnabled} formatter={formatter}/></strong></div></div>)}
      </div>
      <div className="eco-type-switch" role="group" aria-label="设备类型">
        {types.map(({ kind: value, label, Icon }) => <button type="button" key={value} data-kind={value} aria-pressed={kind === value} onClick={() => onKindChange(kind === value ? "all" : value)}><Icon size={29} strokeWidth={1.5}/><span>{label}</span></button>)}
      </div>
    </section>
    <section className="eco-panel eco-device-panel t-panel-slide" data-open={revealed || !motionEnabled} aria-label={gateway ? "组网设备" : "观测设备"}>
      <h2 className="eco-panel-title">{gateway ? "组网设备" : "观测设备"}</h2>
      <div className="eco-device-picker">
        <label className="eco-device-search"><Search size={13}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索设备 / SN" aria-label="搜索设备"/></label>
        <select aria-label="选择观测设备" value={selectedDevice?.device_id ?? ""} onChange={event => onSelect(event.target.value)}>
          {!selectedDevice && <option value="">选择设备</option>}
          {options.map(device => <option key={device.device_id} value={device.device_id}>{device.name} · {device.serial_no}</option>)}
        </select>
      </div>
      {gateway ? <>
        <button type="button" className="eco-gateway" aria-pressed={selectedNodeKey === "gateway"} onClick={() => onSelectNode("gateway")}>
          <RadioTower size={35} strokeWidth={1.3}/><span><strong>{gateway.name}</strong><small>{gateway.serial_no}</small></span>
        </button>
        <div className="eco-gateway-counts"><span>网关 <b>1</b></span><span>节点 <b>{nodes.data?.items.length ?? "—"}</b></span><span>信号质量 <b>—</b></span></div>
        <ObservatoryAutoScroll className="eco-node-table-wrap" label="组网节点列表" paused={!motionEnabled} resetKey={`${gateway.device_id}:${selectedNodeKey}:${search}:${nodes.data?.items.map(node => node.key).join(",") ?? ""}`}><table className="eco-node-table"><thead><tr><th>节点名称</th><th>信号</th><th>状态</th><th>节点 ID</th></tr></thead><tbody>
          {nodes.data?.items.map(node => {
            const reading = nodeRuntime.data?.items.find(item => item.key === node.key);
            const signal = nodeRuntime.isError || reading?.error ? undefined : reading?.rssi;
            const Icon = signal == null || signal >= 0 ? Signal : signal >= -80 ? SignalHigh : signal >= -100 ? SignalMedium : SignalLow;
            const sampled = reading?.sampled_at ? Date.parse(reading.sampled_at) : NaN;
            const current = !reading?.error && !nodeRuntime.isError && Number.isFinite(sampled) && Date.now() - sampled <= 86400000 && sampled <= Date.now();
            return <tr key={node.key} data-selected={selectedNodeKey === node.key}>
              <td><button type="button" onClick={() => onSelectNode(node.key)} aria-pressed={selectedNodeKey === node.key} title={node.name}><i/>{node.name}</button></td>
              <td title={signal == null ? "未知" : `${signal}${signal < 0 ? " dBm" : ""}`}>{signal == null ? "—" : <Icon size={18}/>}</td>
              <td><span className="eco-node-status" data-current={current}>{current && <i/>}{current ? "已上报" : "—"}</span></td>
              <td title={node.node_sn}>{node.node_sn || "—"}</td>
            </tr>;
          })}
        </tbody></table>{nodes.isLoading ? <div className="eco-directory-empty">加载节点…</div> : nodes.data && !nodes.data.items.length ? <div className="eco-directory-empty">暂无节点</div> : null}</ObservatoryAutoScroll>
      </> : <ObservatoryAutoScroll className="eco-device-rows" label="观测设备列表" paused={!motionEnabled} resetKey={`${selectedDevice?.device_id ?? ""}:${kind}:${search}:${choices.map(device => device.device_id).join(",")}`}>{choices.length ? choices.map(device => <button type="button" key={device.device_id} onClick={() => onSelect(device.device_id)} aria-pressed={selectedDevice?.device_id === device.device_id}><RadioTower size={19}/><span><strong>{device.name}</strong><small>{device.serial_no}</small></span><span>›</span></button>) : <div className="eco-directory-empty">暂无匹配设备</div>}</ObservatoryAutoScroll>}
      {error && <button type="button" className="eco-directory-error" onClick={retry} title={formatApiError(error).message}>数据读取失败 · 重试</button>}
    </section>
    <section className="eco-panel eco-distribution t-panel-slide" data-open={revealed || !motionEnabled} aria-label="设备分布">
      <h2 className="eco-panel-title">设备分布</h2>
      <div className="eco-distribution-bars">{types.map(({ kind: value, label }) => {
        const count = physical.filter(device => device.device_type === (value === "network" ? "gateway" : value)).length;
        const max = Math.max(1, ...types.map(item => physical.filter(device => device.device_type === (item.kind === "network" ? "gateway" : item.kind)).length));
        return <div key={value} data-kind={value}><span>{label}</span><div><i style={{ width: `${count / max * 100}%` }}/></div><b><AnimatedNumber value={count} enabled={motionEnabled} formatter={format}/></b></div>;
      })}</div>
    </section>
  </aside>;
}
