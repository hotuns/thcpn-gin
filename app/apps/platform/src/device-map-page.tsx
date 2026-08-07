import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, LocateFixed, MapPinned, Satellite, X } from "lucide-react";
import { api, deviceTopologyRoleLabel, formatApiError, type DeviceMapItem } from "@thcpn/api";
import { DeviceMap, tiandituImageryStyle } from "@thcpn/device-map";
import { Button, StateView } from "@thcpn/ui";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";

export function DeviceMapPage() {
  const { currentId, current } = useWorkspace();
  const [includeChildren, setIncludeChildren] = useState(false);
  const [ecosystem, setEcosystem] = useState("");
  const [observation, setObservation] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const catalog = useQuery({ queryKey: ["device-taxonomy"], queryFn: api.devices.taxonomy });
  const query = useQuery({
    queryKey: workspaceQueryKey(currentId, "device-map", String(includeChildren)),
    queryFn: () => api.devices.map(currentId!, includeChildren),
    enabled: Boolean(currentId),
  });
  const terms = catalog.data?.items ?? [];
  const rows = useMemo(
    () => (query.data?.items ?? []).filter((item) =>
      (!ecosystem || item.environment.ecosystem?.id === ecosystem)
      && (!observation || item.environment.observation_objects.some((term) => term.id === observation))),
    [query.data, ecosystem, observation],
  );
  const token = import.meta.env.VITE_TIANDITU_TOKEN?.trim();
  const mapStyle = useMemo(() => token ? tiandituImageryStyle(token) : undefined, [token]);
  const selected = rows.find((item) => item.device_id === selectedId);
  const located = rows.filter((item) => item.latitude !== undefined && item.longitude !== undefined).length;
  const unclassified = rows.filter((item) => !item.environment.ecosystem).length;

  useEffect(() => {
    document.body.classList.add("device-map-route");
    return () => document.body.classList.remove("device-map-route");
  }, []);
  useEffect(() => {
    if (selectedId && !rows.some((item) => item.device_id === selectedId)) setSelectedId("");
  }, [rows, selectedId]);

  return (
    <div className="immersive-device-map">
      <DeviceMap
        height="100%"
        styleUrl={token ? undefined : import.meta.env.VITE_MAP_STYLE_URL}
        mapStyle={mapStyle}
        points={rows.map(mapPoint)}
        onSelect={setSelectedId}
      />

      <section className="device-map-console" aria-label="地图筛选">
        <div className="device-map-console-head">
          <div className="device-map-title-mark"><Satellite size={15} /></div>
          <div>
            <span>{current?.name ?? "当前工作区"}</span>
            <h1>设备地图</h1>
          </div>
        </div>
        <div className="device-map-summary" aria-label="设备统计">
          <div><strong>{rows.length}</strong><span>设备</span></div>
          <div><strong>{located}</strong><span>已定位</span></div>
          <div><strong>{rows.length - located}</strong><span>未定位</span></div>
          <div><strong>{unclassified}</strong><span>未分类</span></div>
        </div>
        <div className="device-map-filters">
          <select value={ecosystem} onChange={(event) => setEcosystem(event.target.value)} aria-label="生态类型">
            <option value="">全部生态类型</option>
            {terms.filter((term) => term.kind === "ecosystem").map((term) => <option key={term.id} value={term.id}>{term.name_zh}</option>)}
          </select>
          <select value={observation} onChange={(event) => setObservation(event.target.value)} aria-label="观测对象">
            <option value="">全部观测对象</option>
            {terms.filter((term) => term.kind === "observation_object").map((term) => <option key={term.id} value={term.id}>{term.name_zh}</option>)}
          </select>
          <label className="device-map-child-toggle">
            <input type="checkbox" checked={includeChildren} onChange={(event) => setIncludeChildren(event.target.checked)} />
            <i aria-hidden="true" />
            <span>显示子节点</span>
          </label>
        </div>
        {!token && !import.meta.env.VITE_MAP_STYLE_URL ? <div className="device-map-token-note">配置天地图 Token 后显示影像底图</div> : null}
      </section>

      {query.isLoading ? <div className="device-map-state"><StateView type="loading" title="正在加载设备地图" description="正在读取设备位置。" /></div> : null}
      {query.error ? <div className="device-map-state"><StateView type="error" title="设备地图加载失败" description={formatApiError(query.error).message} requestId={formatApiError(query.error).requestId} /></div> : null}

      {selected ? <DeviceMapDetail item={selected} onClose={() => setSelectedId("")} /> : null}

      <div className="device-map-footnote">
        <span><LocateFixed size={14} />{token ? "天地图影像" : "底图预览"}</span>
        {rows.length - located > 0 ? <span><MapPinned size={14} />{rows.length - located} 台设备尚未定位</span> : <span>全部设备已定位</span>}
      </div>
    </div>
  );
}

function DeviceMapDetail({ item, onClose }: { item: DeviceMapItem; onClose: () => void }) {
  return (
    <aside className="device-map-detail" aria-label="设备信息">
      <button type="button" className="device-map-detail-close" onClick={onClose} aria-label="关闭设备信息"><X size={16} /></button>
      <span className={`device-map-detail-status ${item.status === "active" ? "is-active" : ""}`}>{item.status === "active" ? "在线资产" : item.status}</span>
      <h2>{item.name}</h2>
      <p className="mono">{item.serial_no}</p>
      <dl>
        <div><dt>设备类型</dt><dd>{deviceTopologyRoleLabel(item.device_type)}</dd></div>
        <div><dt>生态类型</dt><dd>{item.environment.ecosystem?.name_zh ?? "未分类"}</dd></div>
        <div><dt>观测对象</dt><dd>{item.environment.observation_objects.map((term) => term.name_zh).join("、") || "未设置"}</dd></div>
        <div><dt>坐标</dt><dd className="mono">{item.longitude?.toFixed(5)}, {item.latitude?.toFixed(5)}</dd></div>
      </dl>
      <Button onClick={() => window.location.assign(`/devices/${item.device_id}`)}>查看设备资料<ChevronRight size={15} /></Button>
    </aside>
  );
}

function mapPoint(item: DeviceMapItem) {
  return {
    device_id: item.device_id,
    name: item.name,
    device_type: item.device_type,
    status: item.status,
    latitude: item.latitude,
    longitude: item.longitude,
    child_count: item.child_count,
    ecosystem: item.environment.ecosystem?.name_zh,
    purposes: item.environment.observation_objects.map((term) => term.name_zh),
  };
}
