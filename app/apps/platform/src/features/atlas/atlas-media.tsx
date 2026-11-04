import { policyLimit } from "../../shared/config/system-policy";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PhotoSlider } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";
import { Camera, ImageOff, ZoomIn, LoaderCircle } from "lucide-react";
import { api, formatApiError, type DataStream } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { useLocale } from "@thcpn/i18n";
import { Button, SelectInput } from "../../shared/ui";

export function AtlasMedia({
  workspaceId,
  deviceId,
  streams,
  range,
  asset,
  pageSize = 12,
  onAvailability,
  assetDeviceId,
  restrictToStreams = false,
  appearance = "atlas",
}: {
  workspaceId: string;
  deviceId: string;
  streams: DataStream[];
  range: { start: string; end: string };
  asset: boolean;
  pageSize?: number;
  onAvailability?: (available: boolean) => void;
  assetDeviceId?: string;
  restrictToStreams?: boolean;
  appearance?: "atlas" | "eco";
}) {
  // The range key remounts pagination so a new search always starts at page one.
  return (
    <MediaBrowser
      key={`${range.start}:${range.end}`}
      {...{ workspaceId, deviceId, streams, range, asset, pageSize, onAvailability, assetDeviceId, restrictToStreams, appearance }}
    />
  );
}
function MediaBrowser({
  workspaceId,
  deviceId,
  streams,
  range,
  asset,
  pageSize = 12,
  onAvailability,
  assetDeviceId,
  restrictToStreams = false,
  appearance = "atlas",
}: Parameters<typeof AtlasMedia>[0]) {
  const { t, locale } = useLocale();
  const cls = (name: string) => `${appearance}-${name}`;
  const a = (key: string) => t(`atlas.${key}`);
  const [camera, setStream] = useState("all");
  const stream = restrictToStreams ? (streams.find(item => item.id === camera)?.id ?? streams[0]?.id ?? "") : camera;
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState(-1);
  const images = useQuery({
    queryKey: workspaceQueryKey(
      workspaceId,
      "atlas",
      "images",
      deviceId,
      stream,
      range.start,
      range.end,
      String(page),
      String(pageSize),
    ),
    queryFn: () =>
      restrictToStreams && !streams.length
        ? Promise.resolve({ items: [], total: 0, page, page_size: pageSize })
        : stream === "all"
        ? api.media.images(deviceId, {
            start_time: range.start,
            end_time: range.end,
            page,
            page_size: Math.min(pageSize,policyLimit("media_page_size",100)),
          })
        : api.media.dataStream(stream, {
            start_time: range.start,
            end_time: range.end,
            page,
            page_size: Math.min(pageSize,policyLimit("media_page_size",100)),
          }),
    enabled: !asset,
    staleTime: 60000,
    retry: false,
  });
  const profile = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "atlas", "photos", assetDeviceId ?? deviceId),
    queryFn: () => api.devices.profile(assetDeviceId ?? deviceId),
    enabled: asset || Boolean(onAvailability),
    staleTime: 60000,
    retry: false,
  });
  useEffect(() => {
    if (images.error || profile.error || (stream !== "all" && streams.length > 0)) onAvailability?.(true);
    else if (images.data && profile.data) onAvailability?.(images.data.total > 0 || profile.data.images.length > 0);
  }, [images.data, profile.data, images.error, profile.error, onAvailability, stream, streams.length]);
  const items = asset
    ? (profile.data?.images ?? []).map((i) => ({
        id: i.id,
        url: i.preview_url,
        thumbnail: i.preview_url,
        title: i.original_filename,
        subtitle: i.is_cover ? a("cover") : "",
      }))
    : (images.data?.items ?? []).map((i) => ({
        id: i.id,
        url: i.preview_url,
        thumbnail: i.thumbnail_url || i.preview_url,
        title:
          streams.find((s) => s.id === i.data_stream_id)?.name ?? a("images"),
        subtitle: appearance === "eco" ? new Date(i.captured_at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : new Date(i.captured_at).toLocaleString(locale),
      }));
  const query = asset ? profile : images;
  const total = asset ? items.length : (images.data?.total ?? 0);
  const displayed = asset
    ? items.slice((page - 1) * pageSize, page * pageSize)
    : items;
  return (
    <div className={cls("media")}>
      <div className={cls("media-toolbar")}>
        <span>
          <Camera size={15} />
          {t("atlas.total", { count: total })}
        </span>
        {!asset && appearance === "eco" && streams.length > 1 && <select className="eco-media-camera" aria-label={a("allCameras")} value={stream} onChange={event => { setStream(event.target.value); setPage(1); setPreview(-1); }}>{!restrictToStreams && <option value="all">{a("allCameras")}</option>}{streams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
        {!asset && appearance !== "eco" && (
          <SelectInput
            aria-label={a("allCameras")}
            value={stream}
            onChange={(e) => {
              setStream(e.target.value);
              setPage(1);
              setPreview(-1);
            }}
          >
            {!restrictToStreams && <option value="all">{a("allCameras")}</option>}
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectInput>
        )}
        <Button variant="ghost" onClick={() => void query.refetch()}>
          {a("refresh")}
        </Button>
      </div>
      {query.isFetching ? (
        <div className={cls("empty")} role="status" aria-busy="true"><LoaderCircle className="spin" aria-hidden="true"/>{a("loading")}</div>
      ) : query.error ? (
        <div className={cls("error")} role="alert">
          <p>{formatApiError(query.error).message}</p>
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {a("retry")}
          </Button>
        </div>
      ) : !displayed.length ? (
        <div className={cls("empty")}>
          <Camera size={26} />
          <p>{a(asset ? "noPhotos" : "noImages")}</p>
        </div>
      ) : (
        <div className={cls("photo-grid")}>
          {displayed.map((item, index) => (
            <Button
              variant="ghost"
              key={item.id}
              className={cls("photo")}
              onClick={() => setPreview(index)}
              aria-label={`${item.title} ${item.subtitle}`}
            >
              <AtlasPhoto
                key={item.thumbnail}
                src={item.thumbnail}
                alt={item.title}
                appearance={appearance}
              />
              <span className={cls("photo-zoom")}>
                <ZoomIn size={16} />
              </span>
              <span className={cls("photo-caption")}>
                <strong>{item.title}</strong>
                <small>{item.subtitle}</small>
              </span>
            </Button>
          ))}
        </div>
      )}
      {total > pageSize && (
        <div className={cls("pagination")}>
          <Button
            variant="ghost"
            disabled={page <= 1 || query.isFetching}
            onClick={() => {
              setPage(page - 1);
              setPreview(-1);
            }}
          >
            {a("previous")}
          </Button>
          <span>
            {page} / {Math.ceil(total / pageSize)}
          </span>
          <Button
            variant="ghost"
            disabled={page * pageSize >= total || query.isFetching}
            onClick={() => {
              setPage(page + 1);
              setPreview(-1);
            }}
          >
            {a("next")}
          </Button>
        </div>
      )}
      <PhotoSlider
        images={displayed.map((i) => ({
          key: i.id,
          src: i.url || "",
          intro: `${i.title} · ${i.subtitle}`,
        }))}
        visible={preview >= 0}
        index={Math.max(0, preview)}
        onIndexChange={setPreview}
        onClose={() => setPreview(-1)}
      />
    </div>
  );
}
function AtlasPhoto({ src, alt, appearance }: { src?: string; alt: string; appearance: "atlas" | "eco" }) {
  const cls = (name: string) => `${appearance}-${name}`;
  const [failed, setFailed] = useState(false);
  const { t } = useLocale();
  return failed || !src ? (
    <span className={cls("image-failed")}>
      <ImageOff size={24} />
      {t("atlas.photoError")}
    </span>
  ) : (
    <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
  );
}
