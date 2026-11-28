import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { PhotoSlider } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";
import {
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Expand,
  ImageOff,
  LoaderCircle,
  RefreshCw,
  X,
  ZoomIn,
} from "lucide-react";
import { api, formatApiError, type DeviceMapItem } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { useLocale } from "@thcpn/i18n";
import { policyLimit } from "../../shared/config/system-policy";
import { streamCatalog, timeRange } from "./atlas-model";
import { AtlasMedia } from "./atlas-media";
import { SlidingTabs } from "./atlas-sliding-tabs";
import "./atlas-filmstrip.css";

type Props = {
  workspaceId: string;
  device: DeviceMapItem;
  selectedNodeKey: string;
  hours: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hudCollapsed: boolean;
  motionEnabled: boolean;
};

export function AtlasFilmstrip({
  workspaceId,
  device,
  selectedNodeKey,
  hours,
  open,
  onOpenChange,
  hudCollapsed,
  motionEnabled,
}: Props) {
  const { locale, t } = useLocale();
  const [camera, setCamera] = useState("all");
  const [previewIndex, setPreviewIndex] = useState(-1);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryAsset, setGalleryAsset] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const range = useMemo(() => timeRange(hours), [hours, device.device_id, selectedNodeKey]);

  const streamsQuery = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "atlas", device.device_id, "streams"),
    queryFn: () => api.dataStreams.list(device.device_id),
    staleTime: 60000,
  });

  const isGateway = device.device_type === "gateway";
  const nodesQuery = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "atlas", device.device_id, "nodes"),
    queryFn: () => api.devices.nodes(device.device_id),
    enabled: isGateway,
    staleTime: 60000,
  });

  const catalog = useMemo(
    () => streamCatalog(streamsQuery.data?.items ?? [], nodesQuery.data?.items ?? []),
    [streamsQuery.data, nodesQuery.data],
  );

  const node = nodesQuery.data?.items.find((n) => n.key === selectedNodeKey);
  const imageDevice = node?.target.kind === "device" ? node.target.device_id : device.device_id;

  const imageStreams = useMemo(
    () =>
      (node?.streams ?? (isGateway && selectedNodeKey !== "gateway" ? [] : catalog)).filter(
        (stream) =>
          stream.type === "image" &&
          stream.status === "active" &&
          (node || stream.device_id === imageDevice),
      ),
    [node, isGateway, selectedNodeKey, catalog, imageDevice],
  );

  const restrictToStreams =
    node?.target.kind === "gateway_node" || (isGateway && selectedNodeKey !== "gateway" && !node);
  const activeStream = restrictToStreams
    ? imageStreams.find((item) => item.id === camera)?.id ?? imageStreams[0]?.id ?? ""
    : camera;

  useEffect(() => {
    setCamera("all");
    setPreviewIndex(-1);
  }, [device.device_id, selectedNodeKey]);

  const pageSize = Math.min(20, policyLimit("media_page_size", 100));

  const infiniteImages = useInfiniteQuery({
    queryKey: workspaceQueryKey(
      workspaceId,
      "atlas",
      "filmstrip",
      imageDevice,
      activeStream,
      String(hours),
    ),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      if (restrictToStreams && !imageStreams.length) {
        return Promise.resolve({ items: [], total: 0, page: pageParam, page_size: pageSize });
      }
      return activeStream === "all"
        ? api.media.images(imageDevice, {
            start_time: range.start,
            end_time: range.end,
            page: pageParam,
            page_size: pageSize,
          })
        : api.media.dataStream(activeStream, {
            start_time: range.start,
            end_time: range.end,
            page: pageParam,
            page_size: pageSize,
          });
    },
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.page * lastPage.page_size;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
    staleTime: 60000,
    retry: false,
  });

  const profileQuery = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "atlas", "photos", device.device_id),
    queryFn: () => api.devices.profile(device.device_id),
    staleTime: 60000,
    retry: false,
  });

  const items = useMemo(
    () =>
      (infiniteImages.data?.pages ?? []).flatMap((page) =>
        page.items.map((item) => ({
          id: item.id,
          url: item.preview_url,
          thumbnail: item.thumbnail_url || item.preview_url,
          title:
            imageStreams.find((s) => s.id === item.data_stream_id)?.name ?? t("atlas.images"),
          subtitle: new Date(item.captured_at).toLocaleTimeString(locale, {
            hour: "2-digit",
            minute: "2-digit",
          }),
          fullTime: new Date(item.captured_at).toLocaleString(locale),
        })),
      ),
    [infiniteImages.data, imageStreams, locale, t],
  );

  const collectedTotal = infiniteImages.data?.pages[0]?.total ?? 0;
  const assetTotal = profileQuery.data?.images.length ?? 0;
  const totalCount = collectedTotal > 0 ? collectedTotal : assetTotal;
  const hasAnyMedia =
    collectedTotal > 0 ||
    assetTotal > 0 ||
    Boolean(infiniteImages.error) ||
    (activeStream !== "all" && imageStreams.length > 0);

  // Auto-load next page when scrolling near the right edge of the filmstrip
  useEffect(() => {
    if (!open || !infiniteImages.hasNextPage || infiniteImages.isFetchingNextPage) return;
    const root = trackRef.current;
    const target = sentinelRef.current;
    if (!root || !target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void infiniteImages.fetchNextPage();
        }
      },
      { root, rootMargin: "0px 180px 0px 0px", threshold: 0.01 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [open, infiniteImages.hasNextPage, infiniteImages.isFetchingNextPage, infiniteImages.fetchNextPage]);

  if (!hasAnyMedia && !infiniteImages.isLoading) return null;

  const scrollTrack = (direction: -1 | 1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * 340, behavior: motionEnabled ? "smooth" : "auto" });
  };

  const mediaProps = {
    appearance: "eco" as const,
    workspaceId,
    assetDeviceId: device.device_id,
    streams: imageStreams,
    restrictToStreams,
    range,
  };

  return (
    <div
      className={`obs-filmstrip-dock${open ? " is-open" : ""}${hudCollapsed ? " is-wide" : ""}`}
      data-open={open}
    >
      {!open ? (
        <button
          type="button"
          className="obs-filmstrip-trigger"
          aria-expanded="false"
          aria-label={`展开影像胶片条，共 ${totalCount} 张`}
          onClick={() => onOpenChange(true)}
        >
          <Camera size={14} aria-hidden="true" />
          <span>影像 · {infiniteImages.isLoading ? "…" : totalCount}</span>
          <ChevronUp size={14} aria-hidden="true" />
        </button>
      ) : (
        <section className="obs-filmstrip-panel" aria-label="采集影像胶片条">
          <header className="obs-filmstrip-header">
            <div className="obs-filmstrip-title">
              <Camera size={14} aria-hidden="true" />
              <h3>采集图片</h3>
              <span className="obs-filmstrip-count">共 {collectedTotal} 张</span>
              {imageStreams.length > 1 && (
                <select
                  className="eco-media-camera"
                  aria-label="筛选图片流"
                  value={activeStream}
                  onChange={(event) => {
                    setCamera(event.target.value);
                    setPreviewIndex(-1);
                  }}
                >
                  {!restrictToStreams && <option value="all">全部图片流</option>}
                  {imageStreams.map((stream) => (
                    <option key={stream.id} value={stream.id}>
                      {stream.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="obs-filmstrip-actions">
              <button
                type="button"
                className="obs-strip-btn"
                aria-label="刷新影像"
                title="刷新影像"
                onClick={() => void infiniteImages.refetch()}
              >
                <RefreshCw size={12} className={infiniteImages.isFetching ? "spin" : ""} />
              </button>
              <button
                type="button"
                className="obs-strip-btn obs-strip-btn-text"
                onClick={() => {
                  setGalleryAsset(collectedTotal === 0 && assetTotal > 0);
                  setGalleryOpen(true);
                }}
              >
                <Expand size={12} aria-hidden="true" />
                <span>查看全部</span>
              </button>
              <button
                type="button"
                className="obs-strip-btn"
                aria-label="收起影像胶片条"
                title="收起影像"
                onClick={() => onOpenChange(false)}
              >
                <ChevronDown size={15} />
              </button>
            </div>
          </header>

          <div className="obs-filmstrip-stage">
            {items.length > 3 && (
              <button
                type="button"
                className="obs-strip-nav is-prev"
                aria-label="向左滚动影像"
                onClick={() => scrollTrack(-1)}
              >
                <ChevronLeft size={16} />
              </button>
            )}

            <div
              ref={trackRef}
              className="obs-filmstrip-track"
              onWheel={(event) => {
                if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && trackRef.current) {
                  trackRef.current.scrollLeft += event.deltaY;
                }
              }}
            >
              {infiniteImages.isLoading ? (
                <div className="obs-filmstrip-state" role="status">
                  <LoaderCircle size={15} className="spin" aria-hidden="true" />
                  <span>正在加载影像…</span>
                </div>
              ) : infiniteImages.error ? (
                <div className="obs-filmstrip-state" role="alert">
                  <span>{formatApiError(infiniteImages.error).message}</span>
                  <button
                    type="button"
                    className="obs-strip-btn obs-strip-btn-text"
                    onClick={() => void infiniteImages.refetch()}
                  >
                    重试
                  </button>
                </div>
              ) : !items.length ? (
                <div className="obs-filmstrip-state">
                  <span>当前时间范围暂无采集图片</span>
                  {assetTotal > 0 && (
                    <button
                      type="button"
                      className="obs-strip-btn obs-strip-btn-text"
                      onClick={() => {
                        setGalleryAsset(true);
                        setGalleryOpen(true);
                      }}
                    >
                      查看资产照片 ({assetTotal})
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {items.map((item, idx) => (
                    <FilmstripThumb
                      key={item.id}
                      thumbnail={item.thumbnail}
                      title={item.title}
                      subtitle={item.subtitle}
                      onOpen={() => setPreviewIndex(idx)}
                    />
                  ))}
                  {infiniteImages.hasNextPage && (
                    <div ref={sentinelRef} className="obs-filmstrip-sentinel">
                      {infiniteImages.isFetchingNextPage ? (
                        <LoaderCircle size={16} className="spin" aria-hidden="true" />
                      ) : (
                        <button
                          type="button"
                          className="obs-strip-btn obs-strip-btn-text"
                          onClick={() => void infiniteImages.fetchNextPage()}
                        >
                          加载更多
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {items.length > 3 && (
              <button
                type="button"
                className="obs-strip-nav is-next"
                aria-label="向右滚动影像"
                onClick={() => scrollTrack(1)}
              >
                <ChevronRight size={16} />
              </button>
            )}
          </div>
        </section>
      )}

      {/* Lightbox across all loaded filmstrip images */}
      <PhotoSlider
        images={items.map((item) => ({
          key: item.id,
          src: item.url || "",
          intro: `${item.title} · ${item.fullTime}`,
        }))}
        visible={previewIndex >= 0}
        index={Math.max(0, previewIndex)}
        onIndexChange={setPreviewIndex}
        onClose={() => setPreviewIndex(-1)}
      />

      {/* Fullscreen Grid Gallery Dialog (Collected Images + Asset Photos) */}
      <Dialog.Root open={galleryOpen} onOpenChange={setGalleryOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="eco-gallery-overlay" />
          <Dialog.Content className="eco-gallery" aria-describedby={undefined}>
            <header className="eco-gallery-heading">
              <Dialog.Title>设备影像</Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" aria-label="关闭影像图库">
                  <X size={18} />
                </button>
              </Dialog.Close>
            </header>
            <SlidingTabs
              className="eco-gallery-tabs"
              ariaLabel="影像分类"
              motionEnabled={motionEnabled}
              value={galleryAsset ? "asset" : "collected"}
              onChange={(next) => setGalleryAsset(next === "asset")}
              items={[
                { value: "collected", label: "采集图片" },
                { value: "asset", label: "资产照片" },
              ]}
            />
            <AtlasMedia
              key={`${galleryAsset}:${imageDevice}:${selectedNodeKey}`}
              {...mediaProps}
              deviceId={galleryAsset ? device.device_id : imageDevice}
              asset={galleryAsset}
              pageSize={12}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function FilmstripThumb({
  thumbnail,
  title,
  subtitle,
  onOpen,
}: {
  thumbnail?: string;
  title: string;
  subtitle: string;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className="obs-filmstrip-thumb"
      aria-label={`${title} ${subtitle}`}
      onClick={onOpen}
    >
      {failed || !thumbnail ? (
        <span className="obs-thumb-fallback">
          <ImageOff size={18} aria-hidden="true" />
        </span>
      ) : (
        <img src={thumbnail} alt={title} loading="lazy" onError={() => setFailed(true)} />
      )}
      <span className="obs-thumb-zoom" aria-hidden="true">
        <ZoomIn size={13} />
      </span>
      <span className="obs-thumb-caption">
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
    </button>
  );
}
