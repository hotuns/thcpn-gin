import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Leaf, LocateFixed, MapPinned, Minus, Plus, Satellite, SlidersHorizontal, X } from "lucide-react";
import { api, deviceTopologyRoleLabel, formatApiError, type DeviceMapItem, type DeviceTaxonomyTerm } from "@thcpn/api";
import { DeviceMap, iconifyIconUrl, tiandituImageryStyle } from "@thcpn/device-map";
import { Button, StateView, Switch } from "../../shared/ui";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { DEVICE_LIST_STALE_TIME, DEVICE_MAP_STALE_TIME } from "../../shared/data/device-list-cache";
import type { Map as LibreMap } from "maplibre-gl";
import { MapTools } from "../../shared/maps/map-tools";
import { useIsMobile } from "../../shared/hooks/use-mobile";
import { MobileMapPanels } from "../../shared/maps/mobile-map-panels";

export function DeviceMapPage() {
  const mobile = useIsMobile();
  const [mobilePanel, setMobilePanel] = useState("");
  const [toolsOpen, setToolsOpen] = useState(false);
  const selectDevice = (id: string) => { setSelectedId(id); if (mobile) { setMobilePanel("inspector"); setToolsOpen(false); } };
  const [mapInstance, setMapInstance] = useState<LibreMap | null>(null);
  const [readyMap, setReadyMap] = useState<LibreMap | null>(null);
  const { currentId, current } = useWorkspace();
  const [includeChildren, setIncludeChildren] = useState(false);
  const [ecosystem, setEcosystem] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [consoleCollapsed, setConsoleCollapsed] = useState(
    () => localStorage.getItem("ecocloud:device-map-console-collapsed") === "true",
  );
  const filterPanelId = useId();
  const filtersOpen = mobile ? mobilePanel === "directory" : !consoleCollapsed;
  const catalog = useQuery({ queryKey: ["device-taxonomy"], queryFn: api.devices.taxonomy, staleTime: DEVICE_LIST_STALE_TIME });
  const query = useQuery({
    queryKey: workspaceQueryKey(currentId, "device-map", String(includeChildren)),
    queryFn: () => api.devices.map(currentId!, includeChildren),
    enabled: Boolean(currentId),
    staleTime: DEVICE_MAP_STALE_TIME,
  });
  const terms = catalog.data?.items ?? [];
  const rows = useMemo(
    () => (query.data?.items ?? []).filter((item) =>
      !ecosystem || item.environment.ecosystem?.id === ecosystem),
    [query.data, ecosystem],
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
  useEffect(() => {
    localStorage.setItem("ecocloud:device-map-console-collapsed", String(consoleCollapsed));
  }, [consoleCollapsed]);

  const filterPanel = (
    <section id={filterPanelId} hidden={!filtersOpen} className="device-map-console" aria-label="地图筛选">
      {(filtersOpen || mobile) && <>
        <div className="device-map-console-head">
          <div className="device-map-title-mark"><Satellite size={15} /></div>
          <div>
            <span>{current?.name ?? "当前组织"}</span>
            <h1>设备地图</h1>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="收起地图筛选" title="收起地图筛选" onClick={() => mobile ? setMobilePanel("") : setConsoleCollapsed(true)}><X size={16} /></Button>
        </div>
        <div className="device-map-summary" data-onboarding="map-summary" aria-label="设备统计">
          <div><strong>{rows.length}</strong><span>设备</span></div>
          <div><strong>{located}</strong><span>已定位</span></div>
          <div><strong>{rows.length - located}</strong><span>未定位</span></div>
          <div><strong>{unclassified}</strong><span>未分类</span></div>
        </div>
        <div className="device-map-filters" data-onboarding="map-filters">
          <MapDeviceTypeSelect value={ecosystem} options={terms.filter((term) => term.kind === "ecosystem")} onChange={setEcosystem} />
          <label className="device-map-child-toggle">
            <Switch checked={includeChildren} onCheckedChange={setIncludeChildren} aria-label="显示子节点" />
            <span>显示子节点</span>
          </label>
        </div>
        {mobile && <div className="mobile-device-directory" aria-label="设备目录">{rows.map(item => <Button key={item.device_id} variant="ghost" aria-pressed={selectedId === item.device_id} onClick={() => selectDevice(item.device_id)}><span>{item.name}</span><small>{item.latitude === undefined || item.longitude === undefined ? "未定位" : item.serial_no}</small></Button>)}</div>}
        {!token && !import.meta.env.VITE_MAP_STYLE_URL ? <div className="device-map-token-note">配置天地图 Token 后显示影像底图</div> : null}
      </>}
    </section>
  );

  return (
    <div className="immersive-device-map" data-onboarding="map-canvas">
      <DeviceMap
        onMapCreated={setMapInstance}
        onMapReady={setReadyMap}
        showNavigation={false}
        height={mobile ? (mobilePanel === "directory" || (mobilePanel === "inspector" && selected) ? "calc(60% - 64px)" : "calc(100% - 64px)") : "100%"}
        styleUrl={token ? undefined : import.meta.env.VITE_MAP_STYLE_URL}
        mapStyle={mapStyle}
        points={rows.map(mapPoint)}
        selectedDeviceId={selectedId}
        onSelect={selectDevice}
      />
      {mobile && <MobileMapPanels value={mobilePanel} onChange={value => { setMobilePanel(value); if (value) setToolsOpen(false); }} options={[{ value: "directory", label: "目录与筛选" }, { value: "inspector", label: "设备详情", disabled: !selected }]} />}
      <MapTools
        map={readyMap}
        open={toolsOpen}
        onOpenChange={open => { setToolsOpen(open); if (mobile && open) setMobilePanel(""); }}
        renderLayout={(toolsTrigger, toolsPanel) => (
          <div className="device-map-controls">
            <div className="device-map-toolbar" role="group" aria-label="地图控件">
              <MapZoomButtons map={mapInstance} />
              <span className="device-map-toolbar-divider" aria-hidden="true" />
              {!mobile && (
                <Button type="button" variant="ghost" aria-label="地图筛选" title="地图筛选" aria-expanded={filtersOpen} aria-controls={filterPanelId} onClick={() => setConsoleCollapsed(collapsed => !collapsed)}>
                  <SlidersHorizontal size={18} />
                </Button>
              )}
              {toolsTrigger}
            </div>
            {filterPanel}
            {toolsPanel}
          </div>
        )}
      />

      {query.isLoading ? <div className="device-map-state"><StateView type="loading" title="正在加载设备地图" description="正在读取设备位置。" /></div> : null}
      {query.error ? <div className="device-map-state"><StateView type="error" title="设备地图加载失败" description={formatApiError(query.error).message} requestId={formatApiError(query.error).requestId} /></div> : null}

      {selected && (!mobile || mobilePanel === "inspector") ? <DeviceMapDetail item={selected} onClose={() => mobile ? setMobilePanel("") : setSelectedId("")} /> : null}

      <div className="device-map-footnote">
        <span><LocateFixed size={14} />{token ? "天地图影像" : "底图预览"}</span>
        {rows.length - located > 0 ? <span><MapPinned size={14} />{rows.length - located} 台设备尚未定位</span> : <span>全部设备已定位</span>}
      </div>
    </div>
  );
}

function MapZoomButtons({ map }: { map: LibreMap | null }) {
  const [atMax, setAtMax] = useState(false);
  const [atMin, setAtMin] = useState(false);

  useEffect(() => {
    if (!map) return;
    const update = () => {
      setAtMax(map.getZoom() >= map.getMaxZoom());
      setAtMin(map.getZoom() <= map.getMinZoom());
    };
    update();
    map.on("zoom", update);
    return () => { map.off("zoom", update); };
  }, [map]);

  return <>
    <Button type="button" variant="ghost" aria-label="放大" title="放大" disabled={!map || atMax} onClick={event => map?.zoomIn({}, { originalEvent: event.nativeEvent })}><Plus size={18} /></Button>
    <Button type="button" variant="ghost" aria-label="缩小" title="缩小" disabled={!map || atMin} onClick={event => map?.zoomOut({}, { originalEvent: event.nativeEvent })}><Minus size={18} /></Button>
  </>;
}

function MapDeviceTypeSelect({ value, options, onChange }: { value: string; options: DeviceTaxonomyTerm[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((term) => term.id === value);
  const select = (next: string) => { onChange(next); setOpen(false); };
  return <div className={`map-device-type-select ${open ? "is-open" : ""}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" aria-label="设备类型" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <MapDeviceTypeIcon term={selected} /><span>{selected?.name_zh ?? "全部设备类型"}</span><ChevronDown size={14} />
    </button>
    {open ? <div className="map-device-type-menu" role="listbox">
      <button type="button" role="option" aria-selected={!value} onClick={() => select("")}><span className="map-device-type-empty" /><span>全部设备类型</span>{!value ? <Check size={13} /> : null}</button>
      {options.map((term) => <button type="button" role="option" aria-selected={term.id === value} key={term.id} onClick={() => select(term.id)}><MapDeviceTypeIcon term={term} /><span>{term.name_zh}</span>{term.id === value ? <Check size={13} /> : null}</button>)}
    </div> : null}
  </div>;
}

function MapDeviceTypeIcon({ term }: { term?: DeviceTaxonomyTerm }) {
  const src = iconifyIconUrl(term?.icon);
  return src ? <img src={src} alt="" /> : <Leaf size={14} />;
}

function DeviceMapDetail({ item, onClose }: { item: DeviceMapItem; onClose: () => void }) {
  const deviceTypeIcon = iconifyIconUrl(item.environment.ecosystem?.icon);
  return (
    <aside className="device-map-detail" aria-label="设备信息">
      <button type="button" className="device-map-detail-close" onClick={onClose} aria-label="关闭设备信息"><X size={16} /></button>
      <span className={`device-map-detail-status ${item.status === "active" ? "is-active" : ""}`}>{item.status === "active" ? "已启用资产" : item.status}</span>
      <h2>{item.name}</h2>
      <p className="mono">SN {item.serial_no}</p>
      <dl>
        <div><dt>设备形态</dt><dd>{deviceTopologyRoleLabel(item.device_type)}</dd></div>
        <div><dt>设备类型</dt><dd>{deviceTypeIcon ? <img className="device-map-detail-type-icon" src={deviceTypeIcon} alt="" /> : null}{item.environment.ecosystem?.name_zh ?? "未分类"}</dd></div>
        <div><dt>观测对象</dt><dd>{item.environment.observation_objects.map((term) => term.name_zh).join("、") || "未设置"}</dd></div>
        <div><dt>坐标</dt><dd className="mono">{item.longitude !== undefined && item.latitude !== undefined ? `${item.longitude.toFixed(5)}, ${item.latitude.toFixed(5)}` : "未定位"}</dd></div>
      </dl>
      <Button onClick={() => window.location.assign(item.gateway_device_id && item.node_index ? `/devices/${item.gateway_device_id}?tab=data&node=${encodeURIComponent(`gateway:${item.gateway_device_id}:node:${item.node_index}`)}` : `/devices/${item.device_id}`)}>查看设备资料<ChevronRight size={15} /></Button>
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
    category_icon: item.environment.ecosystem?.icon,
    purposes: item.environment.observation_objects.map((term) => term.name_zh),
  };
}
