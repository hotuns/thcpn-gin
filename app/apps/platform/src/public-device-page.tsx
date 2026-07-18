import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Eye, Image as ImageIcon, LockKeyhole, RefreshCw } from "lucide-react";
import { PhotoSlider } from "react-photo-view";
import { api, deviceStatusLabel, deviceTopologyRoleLabel, formatApiError, type MediaItem, type PublicDeviceStream } from "@thcpn/api";
import { Badge, Brand, Button, Panel, StateView } from "@thcpn/ui";
import { renderPhotoToolbar } from "./device-media";
import { TelemetryCharts } from "./telemetry-charts";

const publicTime = (value?: string) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const imageTime = (value: string) => new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

function useMobileLayout() {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

export function PublicDevicePage() {
  const { publicSlug = "" } = useParams();
  const client = useQueryClient();
  const mobile = useMobileLayout();
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const [mobileChartMode, setMobileChartMode] = useState<"compare" | "separate">("separate");
  const metadata = useQuery({ queryKey: ["public-device", publicSlug, "metadata"], queryFn: () => api.publicDevices.get(publicSlug), retry: false });
  const device = metadata.data;
  const telemetry = useQuery({ queryKey: ["public-device", publicSlug, "telemetry"], queryFn: () => api.publicDevices.telemetry(publicSlug), enabled: Boolean(device?.access_granted && device.telemetry_streams?.length), retry: false });
  useEffect(() => {
    document.title = device?.access_granted && device.name ? `${device.name} · 公开数据` : "设备公开数据";
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) { robots = document.createElement("meta"); robots.name = "robots"; document.head.appendChild(robots); }
    robots.content = "noindex,nofollow";
  }, [device?.access_granted, device?.name]);
  const unlock = async (event: FormEvent) => {
    event.preventDefault(); setUnlocking(true); setUnlockError("");
    try { await api.publicDevices.unlock(publicSlug, password); setPassword(""); await metadata.refetch(); }
    catch (error) { const item = formatApiError(error); setUnlockError(item.status === 429 ? "尝试次数过多，请稍后再试" : "密码不正确"); }
    finally { setUnlocking(false); }
  };
  const refresh = async () => { await client.invalidateQueries({ queryKey: ["public-device", publicSlug] }); };
  if (metadata.isLoading) return <PublicShell><StateView type="loading" title="正在加载设备公开数据" description="正在确认公开访问状态。" /></PublicShell>;
  if (metadata.error) return <PublicShell><StateView type="error" title="该设备暂未公开" description="公开地址无效、设备已停用或公开访问已关闭。" requestId={formatApiError(metadata.error).requestId} /></PublicShell>;
  if (!device?.access_granted) return <PublicShell><Panel className="public-password-card"><div className="public-password-icon"><LockKeyhole size={22} /></div><h1>需要访问密码</h1><form onSubmit={unlock}><label className="field"><span className="field-label">访问密码</span><input autoFocus type="password" required minLength={8} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} /></label>{unlockError && <div className="command-note error-note">{unlockError}</div>}<Button type="submit" disabled={unlocking}>{unlocking ? "正在验证…" : "查看设备数据"}</Button></form></Panel></PublicShell>;
  const startTime = telemetry.data?.start_time ?? new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const endTime = telemetry.data?.end_time ?? new Date().toISOString();
  return <PublicShell><div className="public-device-heading"><div><div className="public-eyebrow">最近三天公开数据</div><h1>{device.name}</h1><div className="public-device-status"><Badge tone="success">{deviceStatusLabel(device.status ?? "active")}</Badge><span>{deviceTopologyRoleLabel(device.topology_role ?? device.device_type ?? "standalone")}</span><span>更新于 {publicTime(device.updated_at)}</span></div></div><Button className="public-refresh-button" variant="secondary" onClick={() => void refresh()} aria-label="刷新公开数据"><RefreshCw size={15} /><span>刷新</span></Button></div>{device.telemetry_streams?.length ? <Panel className="public-section"><div className="panel-header compact-panel-header"><h2 className="panel-title">遥测趋势</h2><Badge tone="info">{device.telemetry_streams.length} 项指标</Badge></div>{mobile && <div className="public-chart-mode" role="group" aria-label="图表显示方式"><button type="button" className={mobileChartMode === "compare" ? "active" : ""} onClick={() => setMobileChartMode("compare")}>综合趋势</button><button type="button" className={mobileChartMode === "separate" ? "active" : ""} onClick={() => setMobileChartMode("separate")}>分指标</button></div>}{telemetry.isLoading ? <StateView type="loading" title="正在加载遥测数据" description="正在读取最近 72 小时数据。" /> : telemetry.error ? <StateView type="error" title="遥测数据加载失败" description={formatApiError(telemetry.error).message} requestId={formatApiError(telemetry.error).requestId} /> : telemetry.data?.series.some((item) => item.points.length) ? <div className="panel-body public-telemetry-body"><TelemetryCharts series={telemetry.data.series} startTime={startTime} endTime={endTime} compact={mobile} displayMode={mobile ? mobileChartMode : undefined} /></div> : <StateView type="empty" title="最近三天没有遥测数据" description="该时间范围内没有可展示的数据点。" />}</Panel> : null}{device.image_streams?.length ? <Panel className="public-section"><div className="panel-header compact-panel-header"><h2 className="panel-title">设备图片</h2><Badge tone="info">{device.image_streams.length} 种图片</Badge></div><PublicImageGallery slug={publicSlug} streams={device.image_streams} mobile={mobile} /></Panel> : null}{!device.telemetry_streams?.length && !device.image_streams?.length ? <Panel><StateView type="empty" title="最近三天暂无公开数据" description="该设备没有启用的遥测指标或图片类型。" /></Panel> : null}</PublicShell>;
}

function PublicImageGallery({ slug, streams, mobile }: { slug: string; streams: PublicDeviceStream[]; mobile: boolean }) {
  const [activeId, setActiveId] = useState(streams[0]?.id ?? "");
  const active = streams.find((stream) => stream.id === activeId) ?? streams[0];
  return <div className="public-image-browser"><div className="public-image-tabs" role="tablist" aria-label="图片类型">{streams.map((stream) => <button type="button" role="tab" aria-selected={stream.id === active.id} className={stream.id === active.id ? "active" : ""} key={stream.id} onClick={() => setActiveId(stream.id)}>{stream.name}</button>)}</div>{active && <PublicImageGroup key={active.id} slug={slug} stream={active} pageSize={mobile ? 12 : 24} />}</div>;
}

function PublicImageGroup({ slug, stream, pageSize }: { slug: string; stream: PublicDeviceStream; pageSize: number }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState(-1);
  const query = useInfiniteQuery({ queryKey: ["public-device", slug, "images", stream.id, pageSize], queryFn: ({ pageParam }) => api.publicDevices.images(slug, stream.id, pageParam, pageSize), initialPageParam: 1, getNextPageParam: (last) => last.page * last.page_size < last.total ? last.page + 1 : undefined, retry: false });
  const images = query.data?.pages.flatMap((page) => page.items).filter((item) => item.preview_url) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !query.hasNextPage || query.isFetchingNextPage) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) void query.fetchNextPage(); }, { rootMargin: "600px 0px" });
    observer.observe(target); return () => observer.disconnect();
  }, [query.fetchNextPage, query.hasNextPage, query.isFetchingNextPage]);
  return <section className="public-image-group"><div className="public-image-group-title"><div><ImageIcon size={15} /><strong>{stream.name}</strong></div><span>{total} 张</span></div>{query.isLoading ? <StateView type="loading" title={`正在加载${stream.name}`} description="正在获取安全图片预览。" /> : query.error ? <StateView type="error" title={`${stream.name}加载失败`} description={formatApiError(query.error).message} /> : images.length ? <><div className="public-image-grid">{images.map((item, index) => <button type="button" key={`${item.data_stream_id}-${item.id}`} onClick={() => setPreview(index)}><img src={item.thumbnail_url || item.preview_url} alt={`${stream.name} ${imageTime(item.captured_at)}`} loading="lazy" /><span>{imageTime(item.captured_at)}</span></button>)}</div><div ref={sentinel} className="public-image-sentinel">{query.isFetchingNextPage ? "正在加载更多…" : query.hasNextPage ? "继续向下加载" : "已加载全部"}</div></> : <StateView type="empty" title="最近三天没有图片" description="该图片类型在最近 72 小时没有记录。" /> }<PublicPhotoSlider images={images} index={preview} onIndex={setPreview} /></section>;
}

function PublicPhotoSlider({ images, index, onIndex }: { images: MediaItem[]; index: number; onIndex: (value: number) => void }) {
  return <PhotoSlider visible={index >= 0} onClose={() => onIndex(-1)} photoWrapClassName="thcpn-photo-wrap" index={Math.max(0, index)} onIndexChange={onIndex} images={images.map((item) => ({ key: item.id, src: item.preview_url, overlay: <div className="photo-preview-caption"><span>{publicTime(item.captured_at)}</span></div> }))} loop={images.length > 1} maskClosable toolbarRender={renderPhotoToolbar} />;
}

function PublicShell({ children }: { children: ReactNode }) {
  return <div className="public-device-page"><header><Brand /><div><Eye size={15} />公开只读页面</div></header><main>{children}</main><footer>THCPN Research Network · 数据范围为最近 72 小时</footer></div>;
}
