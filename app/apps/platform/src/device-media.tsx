import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { PhotoSlider } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";
import {
  Camera,
  Download,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  api,
  formatApiError,
  type CameraLiveSession,
  type DataStream,
  type Device,
  type MediaItem,
} from "@thcpn/api";
import { Badge, Button, Panel, StateView } from "@thcpn/ui";
import { workspaceQueryKey } from "@thcpn/workspace";
import { useLocale } from "@thcpn/i18n";

const displayTime = (input: string) =>
  new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(input));
export const tokenFromActionUrl = (input?: string) => {
  if (!input) return "";
  try {
    return (
      new URL(input, window.location.origin).searchParams.get("token") ?? ""
    );
  } catch {
    return "";
  }
};
export const isCameraDevice = (device?: Device) =>
  Boolean(
    device &&
    (device.device_type === "camera" ||
      device.topology_role === "camera" ||
      device.capabilities.some(
        (item) => item.includes("camera") || item.includes("live_view"),
      )),
  );

type PhotoToolbarProps = {
  rotate: number;
  onRotate: (value: number) => void;
  scale: number;
  onScale: (value: number) => void;
  onDownload?: () => void;
  downloading?: boolean;
};

export const renderPhotoToolbar = ({
  rotate,
  onRotate,
  scale,
  onScale,
  onDownload,
  downloading,
}: PhotoToolbarProps) => (
  <div className="photo-preview-tools" role="toolbar" aria-label="图片工具">
    <button
      type="button"
      aria-label="逆时针旋转"
      title="逆时针旋转"
      onClick={() => onRotate(rotate - 90)}
    >
      <RotateCcw size={19} />
    </button>
    <button
      type="button"
      aria-label="顺时针旋转"
      title="顺时针旋转"
      onClick={() => onRotate(rotate + 90)}
    >
      <RotateCw size={19} />
    </button>
    <button
      type="button"
      aria-label="缩小"
      title="缩小"
      disabled={scale <= 0.5}
      onClick={() => onScale(Math.max(0.5, scale - 0.5))}
    >
      <ZoomOut size={19} />
    </button>
    <button
      type="button"
      aria-label="放大"
      title="放大"
      disabled={scale >= 5}
      onClick={() => onScale(Math.min(5, scale + 0.5))}
    >
      <ZoomIn size={19} />
    </button>
    {onDownload && (
      <button
        type="button"
        aria-label="下载图片"
        title="下载图片"
        disabled={downloading}
        onClick={onDownload}
      >
        <Download size={19} />
      </button>
    )}
    <button
      type="button"
      className="photo-reset"
      onClick={() => {
        onRotate(0);
        onScale(1);
      }}
    >
      重置
    </button>
  </div>
);

export function RecentDeviceImages({
  workspaceId,
  device,
  startTime,
  endTime,
  onOpenData,
}: {
  workspaceId: string;
  device: Device;
  startTime: string;
  endTime: string;
  onOpenData: () => void;
}) {
  const [previewIndex, setPreviewIndex] = useState(-1);
  const query = useQuery({
    queryKey: workspaceQueryKey(
      workspaceId,
      "device",
      device.id,
      "overview",
      "images",
      startTime,
      endTime,
    ),
    queryFn: () =>
      api.media.images(device.id, {
        start_time: startTime,
        end_time: endTime,
        page: 1,
        page_size: 4,
      }),
  });
  const images = (query.data?.items ?? []).filter((item) => item.preview_url);
  return (
    <>
      <Panel className="overview-images">
        <div className="panel-header compact-panel-header">
          <div>
            <h2 className="panel-title">最近图片</h2>
            <div className="panel-kicker">最近 7 天采集的图片</div>
          </div>
          <div className="header-actions">
            <Badge tone="info">{query.data?.total ?? 0} 张</Badge>
            <Button variant="secondary" onClick={onOpenData}>
              查看全部
            </Button>
          </div>
        </div>
        {query.isLoading ? (
          <StateView
            type="loading"
            title="正在加载最近图片"
            description="正在获取安全预览地址。"
          />
        ) : query.error ? (
          <StateView
            type="error"
            title="最近图片加载失败"
            description={formatApiError(query.error).message}
            requestId={formatApiError(query.error).requestId}
          />
        ) : images.length ? (
          <div className="overview-image-grid">
            {images.map((item, index) => (
              <button
                type="button"
                key={`${item.data_stream_id}-${item.id}`}
                onClick={() => setPreviewIndex(index)}
              >
                <img
                  src={item.thumbnail_url || item.preview_url}
                  alt={`${device.name} ${displayTime(item.captured_at)}采集图片`}
                  loading="lazy"
                />
                <span>{displayTime(item.captured_at)}</span>
              </button>
            ))}
          </div>
        ) : (
          <StateView
            type="empty"
            title="最近没有图片"
            description="最近 7 天内没有可预览的设备图片。"
          />
        )}
      </Panel>
      <PhotoSlider
        visible={previewIndex >= 0}
        onClose={() => setPreviewIndex(-1)}
        photoWrapClassName="thcpn-photo-wrap"
        index={Math.max(0, previewIndex)}
        onIndexChange={setPreviewIndex}
        images={images.map((item) => ({
          key: item.id,
          src: item.preview_url,
          overlay: (
            <div className="photo-preview-caption">
              <strong>{device.name}</strong>
              <span>{displayTime(item.captured_at)}</span>
            </div>
          ),
        }))}
        loop={images.length > 1}
        maskClosable
        toolbarRender={renderPhotoToolbar}
      />
    </>
  );
}

export function LegacyDeviceMedia({
  device,
  streams,
  startTime,
  endTime,
}: {
  device: Device;
  streams: DataStream[];
  startTime: string;
  endTime: string;
}) {
  const [feedback, setFeedback] = useState("");
  const [busyId, setBusyId] = useState("");
  const [previewIndex, setPreviewIndex] = useState(-1);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const mediaStreams = streams.filter((item) => item.type === "image");
  useEffect(() => {
    setFeedback("");
  }, [device.id]);
  const query = useInfiniteQuery({
    queryKey: [
      "device",
      device.id,
      "images",
      "all",
      startTime,
      endTime,
    ],
    queryFn: ({ pageParam }) =>
      api.media.images(device.id, {
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
  const streamNames = useMemo(
    () => new Map(streams.map((item) => [item.id, item.name])),
    [streams],
  );
  const run = async (
    id: string,
    action: () => Promise<unknown>,
    success?: string,
  ) => {
    setBusyId(id);
    setFeedback("");
    try {
      await action();
      if (success) setFeedback(success);
    } catch (error) {
      const item = formatApiError(error);
      setFeedback(
        `${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
      );
    } finally {
      setBusyId("");
    }
  };
  const download = async (item: MediaItem) =>
    run(item.id, async () => {
      const token = tokenFromActionUrl(item.download_url);
      let url = item.download_url ?? "";
      if (token) {
        const result = await api.media.prepareDownload({ token });
        url = String(result.url ?? "");
      }
      if (!url) throw new Error("服务端未返回临时下载地址");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.rel = "noopener";
      anchor.click();
    });
  const allImages = query.data?.pages.flatMap((page) => page.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  const previewImages = allImages.filter(
    (item) => item.media_type === "image" && item.preview_url,
  );
  const imageGroups = useMemo(() => {
    const groups = new Map<string, MediaItem[]>();
    for (const item of previewImages) {
      const name = streamNames.get(item.data_stream_id) ?? "其他图片";
      const group = groups.get(name);
      if (group) group.push(item);
      else groups.set(name, [item]);
    }
    return [...groups.entries()];
  }, [previewImages, streamNames]);
  useEffect(() => {
    const target = loadMoreRef.current;
    if (
      !target ||
      !query.hasNextPage ||
      query.isFetchingNextPage ||
      query.isFetchNextPageError
    )
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void query.fetchNextPage();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [
    query.fetchNextPage,
    query.hasNextPage,
    query.isFetchingNextPage,
    query.isFetchNextPageError,
  ]);
  return (
    <>
      <Panel className="section-gap">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">设备图片</h2>
            <div className="panel-kicker">
              当前时间范围内采集的媒体图片
            </div>
          </div>
          <div className="header-actions">
            <Badge tone="info">{total} 张</Badge>
            <Button variant="secondary" onClick={() => void query.refetch()}>
              <RefreshCw size={13} />
              刷新
            </Button>
          </div>
        </div>
        {feedback && (
          <div className="command-note media-feedback">{feedback}</div>
        )}
        {query.isLoading ? (
          <StateView
            type="loading"
            title="正在加载设备图片"
            description="正在获取安全预览地址。"
          />
        ) : query.error && !allImages.length ? (
          <StateView
            type="error"
            title="设备图片加载失败"
            description={formatApiError(query.error).message}
            requestId={formatApiError(query.error).requestId}
          />
        ) : allImages.length ? (
          <div className="media-groups">
            {imageGroups.map(([groupName, items]) => (
              <section className="media-group" key={groupName}>
                <div className="media-group-title"><h3>{groupName}</h3><span>{items.length} 张</span></div>
                <div className="media-grid">
                  {items.map((item) => (
                    <MediaCard
                      key={`${item.data_stream_id}-${item.id}`}
                      item={item}
                      onPreview={() => setPreviewIndex(previewImages.findIndex((image) => image.id === item.id && image.data_stream_id === item.data_stream_id))}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <StateView
            type="empty"
            title="时间范围内没有图片"
            description={
              mediaStreams.length
                ? "可以调整时间范围或图片来源。"
                : "当前设备没有可用的图片来源。"
            }
          />
        )}
        {allImages.length > 0 && (
          <div className="media-load-more" ref={loadMoreRef} aria-live="polite">
            <span>
              {query.isFetchingNextPage
                ? `正在加载更多图片，已显示 ${allImages.length} / ${total} 张`
                : query.hasNextPage
                  ? `已显示 ${allImages.length} / ${total} 张，继续向下浏览将自动加载`
                  : `已加载全部 ${total} 张图片`}
            </span>
            {query.isFetchNextPageError && (
              <button className="media-load-error" type="button" onClick={() => void query.fetchNextPage()}>
                加载失败，点击重试
              </button>
            )}
          </div>
        )}
      </Panel>
      <PhotoSlider
        visible={previewIndex >= 0}
        onClose={() => setPreviewIndex(-1)}
        photoWrapClassName="thcpn-photo-wrap"
        index={Math.max(0, previewIndex)}
        onIndexChange={setPreviewIndex}
        images={previewImages.map((item) => ({
          key: item.id,
          src: item.preview_url,
          overlay: (
            <div className="photo-preview-caption">
              <span>{displayTime(item.captured_at)}</span>
            </div>
          ),
        }))}
        loop={previewImages.length > 1}
        maskClosable
        toolbarRender={(props) => renderPhotoToolbar({
          ...props,
          downloading: busyId === previewImages[props.index]?.id,
          onDownload: previewImages[props.index]?.download_allowed && previewImages[props.index]?.download_url
            ? () => void download(previewImages[props.index])
            : undefined,
        })}
      />
    </>
  );
}

export { DeviceMedia, type ImageGroupStats } from "./device-image-groups";

function MediaCard({
  item,
  onPreview,
}: {
  item: MediaItem;
  onPreview: () => void;
}) {
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
        <img
          src={item.thumbnail_url || item.preview_url}
          alt={`${displayTime(item.captured_at)}采集图片`}
          loading="lazy"
        />
      </div>
      <div className="media-card-body">
        <div className="cell-sub">{displayTime(item.captured_at)}</div>
      </div>
    </article>
  );
}

export function CameraLive({ device }: { device: Device }) {
  const { locale } = useLocale();
  const containerId = `ezviz-${useId().replaceAll(":", "")}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<{ stop?: () => Promise<unknown> | unknown } | null>(
    null,
  );
  const [session, setSession] = useState<CameraLiveSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [playerTemplate, setPlayerTemplate] = useState<"pcLive" | "mobileLive">(
    () =>
      window.matchMedia("(max-width: 680px)").matches ? "mobileLive" : "pcLive",
  );
  useEffect(() => {
    setSession(null);
    setError("");
  }, [device.id]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 680px)");
    const updateTemplate = () =>
      setPlayerTemplate(media.matches ? "mobileLive" : "pcLive");
    media.addEventListener("change", updateTemplate);
    return () => media.removeEventListener("change", updateTemplate);
  }, []);
  useEffect(() => {
    if (!session || !containerRef.current) return;
    let cancelled = false;
    const mount = async () => {
      try {
        const module = await import("ezuikit-js");
        if (cancelled || !containerRef.current) return;
        const width = Math.max(
          320,
          Math.min(containerRef.current.clientWidth, window.innerWidth - 32),
        );
        const Player = (module as any).EZUIKitPlayer;
        playerRef.current = new Player({
          id: containerId,
          accessToken: session.access_token,
          url: session.url,
          staticPath: "/ezuikit_static",
          template: playerTemplate,
          language: locale === "zh-CN" ? "zh" : "en",
          width,
          height: Math.round((width * 9) / 16),
          autoplay: true,
          audio: 0,
          handleError: (reason: unknown) =>
            setError(
              `播放器错误：${String((reason as any)?.message ?? reason)}`,
            ),
        });
      } catch (reason) {
        setError(`播放器加载失败：${formatApiError(reason).message}`);
      }
    };
    void mount();
    return () => {
      cancelled = true;
      try {
        void playerRef.current?.stop?.();
      } finally {
        playerRef.current = null;
        containerRef.current?.replaceChildren();
      }
    };
  }, [containerId, locale, playerTemplate, session]);
  const create = async () => {
    setBusy(true);
    setError("");
    setSession(null);
    try {
      setSession(await api.devices.liveSession(device.id));
    } catch (reason) {
      const item = formatApiError(reason);
      setError(
        `${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel className="section-gap camera-live">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">监控站实时画面</h2>
          <div className="panel-kicker">
            短期会话只在当前页面内使用，切换设备后自动销毁播放器
          </div>
        </div>
        <Button disabled={busy} onClick={() => void create()}>
          <Camera size={14} />
          {busy ? "正在创建…" : session ? "刷新会话" : "开始预览"}
        </Button>
      </div>
      {error && <div className="form-error camera-error">{error}</div>}
      {session ? (
        <>
          <div id={containerId} ref={containerRef} className="camera-player" />
          <div className="camera-session-meta">
            <span>
              {session.provider} · {session.quality}
            </span>
            <span>通道 {session.channel_no}</span>
            <span>会话过期：{displayTime(session.expires_at)}</span>
          </div>
        </>
      ) : (
        <StateView
          type="empty"
          title="实时预览尚未开始"
          description="点击开始预览后，系统将申请短期播放凭证。"
        />
      )}
    </Panel>
  );
}
