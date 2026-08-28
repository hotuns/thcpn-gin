import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useIsFetching,
  useQueryClient,
} from "@tanstack/react-query";
import { Clock3, Download, Film, RefreshCw, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { PhotoSlider } from "react-photo-view";
import type { DataStream, Device, MediaItem } from "@thcpn/api";
import { api, formatApiError } from "@thcpn/api";
import { Badge, Button, Panel, StateView } from "@thcpn/ui";
import { workspaceQueryKey } from "@thcpn/workspace";
import { DeviceGifMaker } from "./device-gif-maker";

const displayTime = (input: string) =>
  new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(input));

export type ImageGroupStat = {
  loaded: number;
  total: number | null;
  loading: boolean;
  error: boolean;
};

export type ImageGroupStats = Record<string, ImageGroupStat>;

export function DeviceMedia({
  workspaceId,
  device,
  streams,
  imageStreamIds,
  startTime,
  endTime,
  onStatsChange,
}: {
  workspaceId: string;
  device: Device;
  streams: DataStream[];
  imageStreamIds?: string[];
  startTime: string;
  endTime: string;
  onStatsChange?: (stats: ImageGroupStats) => void;
}) {
  const queryClient = useQueryClient();
  const availableImageStreams = useMemo(
    () => streams.filter((item) => item.type === "image" && item.status === "active"),
    [streams],
  );
  const imageStreams = useMemo(
    () => imageStreamIds === undefined
      ? availableImageStreams
      : availableImageStreams.filter((item) => imageStreamIds.includes(item.id)),
    [availableImageStreams, imageStreamIds],
  );
  const streamSignature = imageStreams.map((item) => item.id).join(",");
  const [activeStreamId, setActiveStreamId] = useState(imageStreams[0]?.id ?? "");
  const [stats, setStats] = useState<ImageGroupStats>({});
  const queryPrefix = workspaceQueryKey(workspaceId, "device", device.id, "images");
  const refreshing = useIsFetching({ queryKey: queryPrefix }) > 0;

  useEffect(() => setStats({}), [device.id, endTime, startTime, streamSignature]);
  useEffect(() => {
    if (!imageStreams.some((item) => item.id === activeStreamId))
      setActiveStreamId(imageStreams[0]?.id ?? "");
  }, [activeStreamId, imageStreams]);
  useEffect(() => onStatsChange?.(stats), [onStatsChange, stats]);

  const updateStats = useCallback((streamId: string, next: ImageGroupStat) => {
    setStats((current) => {
      const previous = current[streamId];
      if (
        previous &&
        previous.loaded === next.loaded &&
        previous.total === next.total &&
        previous.loading === next.loading &&
        previous.error === next.error
      )
        return current;
      return { ...current, [streamId]: next };
    });
  }, []);

  const activeStream = imageStreams.find((item) => item.id === activeStreamId) ?? imageStreams[0];
  const activeTotal = activeStream ? stats[activeStream.id]?.total : undefined;

  return (
    <div id="data-section-images" className="data-page-anchor section-gap">
      <Panel>
        <div className="panel-header">
          <div>
            <h2 className="panel-title">设备图片</h2>
            <div className="panel-kicker">按图片类型独立加载当前时间范围内的采集图片</div>
          </div>
          <div className="header-actions">
            <Badge tone="info">
              {activeTotal === null || activeTotal === undefined ? `${imageStreams.length} 类` : `${activeTotal} 张`}
            </Badge>
            <Button
              variant="secondary"
              disabled={refreshing || !imageStreams.length}
              onClick={() => void queryClient.invalidateQueries({ queryKey: queryPrefix })}
            >
              <RefreshCw size={13} className={refreshing ? "spin" : undefined} />
              {refreshing ? "刷新中" : "刷新"}
            </Button>
          </div>
        </div>
        {imageStreams.length ? (
          <div className="media-image-browser">
            <div className="media-image-tabs" role="tablist" aria-label="图片类型">
              {imageStreams.map((stream) => (
                <button
                  id={`data-image-${stream.id}`}
                  type="button"
                  role="tab"
                  aria-selected={stream.id === activeStream?.id}
                  aria-controls={`data-image-panel-${stream.id}`}
                  className={stream.id === activeStream?.id ? "active" : undefined}
                  key={stream.id}
                  onClick={() => setActiveStreamId(stream.id)}
                >
                  {stream.name}
                </button>
              ))}
            </div>
            {activeStream && (
              <DeviceImageGroup
                key={activeStream.id}
                workspaceId={workspaceId}
                device={device}
                stream={activeStream}
                startTime={startTime}
                endTime={endTime}
                onStatsChange={updateStats}
              />
            )}
          </div>
        ) : (
          <StateView
            type="empty"
            title={availableImageStreams.length ? "未选择图片指标" : "当前设备没有图片来源"}
            description={availableImageStreams.length
              ? "在上方图片选择器中选择要查看的图片类型。"
              : "设备尚未配置启用状态的图片指标。"}
          />
        )}
      </Panel>
    </div>
  );
}

function DeviceImageGroup({
  workspaceId,
  device,
  stream,
  startTime,
  endTime,
  onStatsChange,
}: {
  workspaceId: string;
  device: Device;
  stream: DataStream;
  startTime: string;
  endTime: string;
  onStatsChange: (streamId: string, stat: ImageGroupStat) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const [busyId, setBusyId] = useState("");
  const [previewIndex, setPreviewIndex] = useState(-1);
  const [gifOpen, setGifOpen] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const query = useInfiniteQuery({
    queryKey: workspaceQueryKey(
      workspaceId,
      "device",
      device.id,
      "images",
      "stream",
      stream.id,
      startTime,
      endTime,
    ),
    queryFn: ({ pageParam }) =>
      api.media.dataStream(stream.id, {
        start_time: new Date(startTime).toISOString(),
        end_time: new Date(endTime).toISOString(),
        page: pageParam,
        page_size: 24,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.page_size < lastPage.total
        ? lastPage.page + 1
        : undefined,
    enabled: Boolean(startTime && endTime),
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const images = items.filter(
    (item) => item.media_type === "image" && item.preview_url,
  );
  const total = query.data?.pages[0]?.total ?? (query.isSuccess ? 0 : null);

  useEffect(() => {
    setFeedback("");
    setPreviewIndex(-1);
  }, [device.id, endTime, startTime, stream.id]);
  useEffect(() => {
    onStatsChange(stream.id, {
      loaded: items.length,
      total,
      loading: query.isLoading,
      error: Boolean(query.error),
    });
  }, [items.length, onStatsChange, query.error, query.isLoading, stream.id, total]);
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !query.hasNextPage || query.isFetchingNextPage || query.isFetchNextPageError)
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void query.fetchNextPage();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [query.fetchNextPage, query.hasNextPage, query.isFetchingNextPage, query.isFetchNextPageError]);

  const download = async (item: MediaItem) => {
    setBusyId(item.id);
    setFeedback("");
    try {
      const token = item.download_url
        ? new URL(item.download_url, window.location.origin).searchParams.get("token")
        : "";
      const result = token ? await api.media.prepareDownload({ token }) : null;
      const url = String(result?.url ?? item.download_url ?? "");
      if (!url) throw new Error("服务端未返回临时下载地址");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.rel = "noopener";
      anchor.click();
    } catch (error) {
      const detail = formatApiError(error);
      setFeedback(
        `${detail.message}${detail.requestId ? ` · request id ${detail.requestId}` : ""}`,
      );
    } finally {
      setBusyId("");
    }
  };

  return (
    <section id={`data-image-panel-${stream.id}`} className="media-group" role="tabpanel" aria-labelledby={`data-image-${stream.id}`}>
      <div className="media-group-title">
        <h3>{stream.name}</h3>
        <div className="media-group-actions">
          <span>{total === null ? "加载中" : `${total} 张`}</span>
          <Button variant="secondary" disabled={!total} onClick={() => setGifOpen(true)}><Film size={13} />制作 GIF</Button>
        </div>
      </div>
      {feedback && <div className="command-note media-feedback">{feedback}</div>}
      {query.isLoading ? (
        <StateView
          type="loading"
          title={`正在加载${stream.name}`}
          description="正在获取安全预览地址。"
        />
      ) : query.error && !items.length ? (
        <StateView
          type="error"
          title={`${stream.name}加载失败`}
          description={formatApiError(query.error).message}
          requestId={formatApiError(query.error).requestId}
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              重试
            </Button>
          }
        />
      ) : images.length ? (
        <div className="media-grid">
          {images.map((item, index) => (
            <MediaCard key={`${item.data_stream_id}-${item.id}`} item={item} onPreview={() => setPreviewIndex(index)} />
          ))}
        </div>
      ) : (
        <StateView
          type="empty"
          title="当前时间范围无图片"
          description="可以调整页面顶部的时间范围后重新查看。"
        />
      )}
      {items.length > 0 && (
        <div className="media-load-more" ref={loadMoreRef} aria-live="polite">
          <span>
            {query.isFetchingNextPage
              ? `正在加载更多，已显示 ${items.length} / ${total ?? "—"} 张`
              : query.hasNextPage
                ? `已显示 ${items.length} / ${total ?? "—"} 张，浏览到本组末尾将自动加载`
                : `已加载本组全部 ${total ?? items.length} 张图片`}
          </span>
          {query.isFetchNextPageError && (
            <button type="button" className="media-load-error" onClick={() => void query.fetchNextPage()}>
              加载失败，点击重试
            </button>
          )}
        </div>
      )}
      <PhotoSlider
        visible={previewIndex >= 0}
        onClose={() => setPreviewIndex(-1)}
        photoWrapClassName="thcpn-photo-wrap"
        index={Math.max(0, previewIndex)}
        onIndexChange={setPreviewIndex}
        images={images.map((item) => ({
          key: item.id,
          src: item.preview_url,
          overlay: <div className="photo-preview-caption"><span>{displayTime(item.captured_at)}</span></div>,
        }))}
        loop={images.length > 1}
        maskClosable
        toolbarRender={({ rotate, onRotate, scale, onScale, index }) => (
          <div className="photo-preview-tools" role="toolbar" aria-label="图片工具">
            <button type="button" aria-label="逆时针旋转" title="逆时针旋转" onClick={() => onRotate(rotate - 90)}><RotateCcw size={19} /></button>
            <button type="button" aria-label="顺时针旋转" title="顺时针旋转" onClick={() => onRotate(rotate + 90)}><RotateCw size={19} /></button>
            <button type="button" aria-label="缩小" title="缩小" disabled={scale <= 0.5} onClick={() => onScale(Math.max(0.5, scale - 0.5))}><ZoomOut size={19} /></button>
            <button type="button" aria-label="放大" title="放大" disabled={scale >= 5} onClick={() => onScale(Math.min(5, scale + 0.5))}><ZoomIn size={19} /></button>
            {images[index]?.download_allowed && images[index]?.download_url && (
              <button type="button" aria-label="下载图片" title="下载图片" disabled={busyId === images[index].id} onClick={() => void download(images[index])}><Download size={19} /></button>
            )}
            <button type="button" className="photo-reset" onClick={() => { onRotate(0); onScale(1); }}>重置</button>
          </div>
        )}
      />
      {gifOpen && <DeviceGifMaker device={device} stream={stream} startTime={startTime} endTime={endTime} onClose={() => setGifOpen(false)} />}
    </section>
  );
}

function MediaCard({ item, onPreview }: { item: MediaItem; onPreview: () => void }) {
  return (
    <article className="media-card">
      <div
        className="media-preview media-preview-clickable"
        onClick={onPreview}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") onPreview();
        }}
      >
        <img src={item.thumbnail_url || item.preview_url} alt={`${displayTime(item.captured_at)}采集图片`} loading="lazy" />
      </div>
      <div className="media-card-time"><Clock3 size={12} /><time dateTime={item.captured_at}>{displayTime(item.captured_at)}</time></div>
    </article>
  );
}
