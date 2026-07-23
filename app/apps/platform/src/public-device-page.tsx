import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Eye, Image as ImageIcon, LockKeyhole, RefreshCw } from "lucide-react";
import { PhotoSlider } from "react-photo-view";
import { api, formatApiError, type MediaItem, type PublicDeviceStream } from "@thcpn/api";
import { Badge, Brand, Button, Panel, StateView } from "@thcpn/ui";
import { renderPhotoToolbar } from "./device-media";
import { TelemetryCharts } from "./telemetry-charts";
import { domainLabels, LanguageSwitcher, useLocale } from "@thcpn/i18n";


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
  const { t, formatDateTime } = useLocale();
  const labels = domainLabels(t);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const [mobileChartMode, setMobileChartMode] = useState<"compare" | "separate">("separate");
  const metadata = useQuery({ queryKey: ["public-device", publicSlug, "metadata"], queryFn: () => api.publicDevices.get(publicSlug), retry: false });
  const device = metadata.data;
  const telemetry = useQuery({ queryKey: ["public-device", publicSlug, "telemetry"], queryFn: () => api.publicDevices.telemetry(publicSlug), enabled: Boolean(device?.access_granted && device.telemetry_streams?.length), retry: false });
  useEffect(() => {
    document.title = device?.access_granted && device.name ? `${device.name} · ${t("public:recentData")}` : t("public:recentData");
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) { robots = document.createElement("meta"); robots.name = "robots"; document.head.appendChild(robots); }
    robots.content = "noindex,nofollow";
  }, [device?.access_granted, device?.name, t]);
  const unlock = async (event: FormEvent) => {
    event.preventDefault(); setUnlocking(true); setUnlockError("");
    try { await api.publicDevices.unlock(publicSlug, password); setPassword(""); await metadata.refetch(); }
    catch (error) { const item = formatApiError(error); setUnlockError(item.status === 429 ? "尝试次数过多，请稍后再试" : "密码不正确"); }
    finally { setUnlocking(false); }
  };
  const refresh = async () => { await client.invalidateQueries({ queryKey: ["public-device", publicSlug] }); };
  if (metadata.isLoading) return <PublicShell><StateView type="loading" title={t("public:loading")} description={t("loading")} /></PublicShell>;
  if (metadata.error) {
    const error = formatApiError(metadata.error);
    const title = error.status === 404 ? t("public:unavailable") : error.status === 429 ? t("public:rateLimited") : t("public:loadFailed");
    return <PublicShell><StateView type="error" title={title} description={error.message} requestId={error.requestId} /></PublicShell>;
  }
  if (!device?.access_granted) return <PublicShell><Panel className="public-password-card"><div className="public-password-icon"><LockKeyhole size={22} /></div><h1>{t("public:passwordRequired")}</h1><form onSubmit={unlock}><label className="field"><span className="field-label">{t("public:password")}</span><input autoFocus type="password" required minLength={8} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} /></label>{unlockError && <div className="command-note error-note">{unlockError}</div>}<Button type="submit" disabled={unlocking}>{unlocking ? t("loading") : t("public:unlock")}</Button></form></Panel></PublicShell>;
  const startTime = telemetry.data?.start_time ?? new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const endTime = telemetry.data?.end_time ?? new Date().toISOString();
  return <PublicShell><div className="public-device-heading"><div><div className="public-eyebrow">{t("public:recentData")}</div><h1>{device.name}</h1><div className="public-device-status"><Badge tone="success">{labels.deviceStatus(device.status ?? "active")}</Badge><span>{labels.topology(device.topology_role ?? device.device_type ?? "standalone")}</span><span>{t("public:updatedAt", { time: formatDateTime(device.updated_at) })}</span></div></div><Button className="public-refresh-button" variant="secondary" onClick={() => void refresh()} aria-label={t("public:refreshing")}><RefreshCw size={15} /><span>{t("refresh")}</span></Button></div>{device.telemetry_streams?.length ? <Panel className="public-section"><div className="panel-header compact-panel-header"><h2 className="panel-title">{t("public:telemetry")}</h2><Badge tone="info">{t("public:metricCount", { count: device.telemetry_streams.length })}</Badge></div>{mobile && <div className="public-chart-mode" role="group" aria-label={t("public:telemetry")}><button type="button" className={mobileChartMode === "compare" ? "active" : ""} onClick={() => setMobileChartMode("compare")}>{t("public:combined")}</button><button type="button" className={mobileChartMode === "separate" ? "active" : ""} onClick={() => setMobileChartMode("separate")}>{t("public:separate")}</button></div>}{telemetry.isLoading ? <StateView type="loading" title={t("loading")} description={t("public:recentData")} /> : telemetry.error ? <StateView type="error" title={t("requestFailed")} description={formatApiError(telemetry.error).message} requestId={formatApiError(telemetry.error).requestId} /> : telemetry.data?.series.some((item) => item.points.length) ? <div className="panel-body public-telemetry-body"><TelemetryCharts series={telemetry.data.series} startTime={startTime} endTime={endTime} compact={mobile} displayMode={mobile ? mobileChartMode : undefined} /></div> : <StateView type="empty" title={t("noData")} description={t("public:recentData")} />}</Panel> : null}{device.image_streams?.length ? <Panel className="public-section"><div className="panel-header compact-panel-header"><h2 className="panel-title">{t("public:images")}</h2><Badge tone="info">{t("public:imageTypeCount", { count: device.image_streams.length })}</Badge></div><PublicImageGallery slug={publicSlug} streams={device.image_streams} mobile={mobile} /></Panel> : null}{!device.telemetry_streams?.length && !device.image_streams?.length ? <Panel><StateView type="empty" title={t("noData")} description={t("public:recentData")} /></Panel> : null}</PublicShell>;
}

function PublicImageGallery({ slug, streams, mobile }: { slug: string; streams: PublicDeviceStream[]; mobile: boolean }) {
  const [activeId, setActiveId] = useState(streams[0]?.id ?? "");
  const active = streams.find((stream) => stream.id === activeId) ?? streams[0];
  return <div className="public-image-browser"><div className="public-image-tabs" role="tablist" aria-label="图片类型">{streams.map((stream) => <button type="button" role="tab" aria-selected={stream.id === active.id} className={stream.id === active.id ? "active" : ""} key={stream.id} onClick={() => setActiveId(stream.id)}>{stream.name}</button>)}</div>{active && <PublicImageGroup key={active.id} slug={slug} stream={active} pageSize={mobile ? 12 : 24} />}</div>;
}

function PublicImageGroup({ slug, stream, pageSize }: { slug: string; stream: PublicDeviceStream; pageSize: number }) {
  const { t, formatDateTime } = useLocale();
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
  return <section className="public-image-group"><div className="public-image-group-title"><div><ImageIcon size={15} /><strong>{stream.name}</strong></div><span>{t("public:imageCount", { count: total })}</span></div>{query.isLoading ? <StateView type="loading" title={t("public:imageLoading", { name: stream.name })} description={t("loading")} /> : query.error ? <StateView type="error" title={t("public:imageFailed", { name: stream.name })} description={formatApiError(query.error).message} /> : images.length ? <><div className="public-image-grid">{images.map((item, index) => <button type="button" key={`${item.data_stream_id}-${item.id}`} onClick={() => setPreview(index)}><img src={item.thumbnail_url || item.preview_url} alt={`${stream.name} ${formatDateTime(item.captured_at, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`} loading="lazy" /><span>{formatDateTime(item.captured_at, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></button>)}</div><div ref={sentinel} className="public-image-sentinel">{query.isFetchingNextPage ? t("public:loadingMore") : query.hasNextPage ? t("public:loadMoreHint") : t("public:allLoaded")}</div></> : <StateView type="empty" title={t("public:noImages")} description={t("public:recentData")} /> }<PublicPhotoSlider images={images} index={preview} onIndex={setPreview} /></section>;
}

function PublicPhotoSlider({ images, index, onIndex }: { images: MediaItem[]; index: number; onIndex: (value: number) => void }) {
  const { formatDateTime } = useLocale();
  return <PhotoSlider visible={index >= 0} onClose={() => onIndex(-1)} photoWrapClassName="thcpn-photo-wrap" index={Math.max(0, index)} onIndexChange={onIndex} images={images.map((item) => ({ key: item.id, src: item.preview_url, overlay: <div className="photo-preview-caption"><span>{formatDateTime(item.captured_at)}</span></div> }))} loop={images.length > 1} maskClosable toolbarRender={renderPhotoToolbar} />;
}

function PublicShell({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  return <div className="public-device-page"><header><Brand /><div className="public-header-actions"><LanguageSwitcher compact /><span><Eye size={15} />{t("public:readOnly")}</span></div></header><main>{children}</main><footer>{t("public:footer")}</footer></div>;
}
