import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PhotoSlider } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";
import { Camera, ImageOff, ZoomIn } from "lucide-react";
import { api, formatApiError, type DataStream } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { useLocale } from "@thcpn/i18n";
import { Button, SelectInput } from "./platform-ui";

export function AtlasMedia({
  workspaceId,
  deviceId,
  streams,
  range,
  asset,
}: {
  workspaceId: string;
  deviceId: string;
  streams: DataStream[];
  range: { start: string; end: string };
  asset: boolean;
}) {
  // The range key remounts pagination so a new search always starts at page one.
  return (
    <MediaBrowser
      key={`${range.start}:${range.end}`}
      {...{ workspaceId, deviceId, streams, range, asset }}
    />
  );
}
function MediaBrowser({
  workspaceId,
  deviceId,
  streams,
  range,
  asset,
}: Parameters<typeof AtlasMedia>[0]) {
  const { t, locale } = useLocale();
  const a = (key: string) => t(`atlas.${key}`);
  const [stream, setStream] = useState("all");
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
    ),
    queryFn: () =>
      stream === "all"
        ? api.media.images(deviceId, {
            start_time: range.start,
            end_time: range.end,
            page,
            page_size: 12,
          })
        : api.media.dataStream(stream, {
            start_time: range.start,
            end_time: range.end,
            page,
            page_size: 12,
          }),
    enabled: !asset,
    staleTime: 60000,
    retry: false,
  });
  const profile = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "atlas", "photos", deviceId),
    queryFn: () => api.devices.profile(deviceId),
    enabled: asset,
    staleTime: 60000,
    retry: false,
  });
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
        subtitle: new Date(i.captured_at).toLocaleString(locale),
      }));
  const query = asset ? profile : images;
  const total = asset ? items.length : (images.data?.total ?? 0);
  const displayed = asset ? items.slice((page - 1) * 12, page * 12) : items;
  return (
    <div className="atlas-media">
      <div className="atlas-media-toolbar">
        <span>
          <Camera size={15} />
          {t("atlas.total", { count: total })}
        </span>
        {!asset && (
          <SelectInput
            aria-label={a("allCameras")}
            value={stream}
            onChange={(e) => {
              setStream(e.target.value);
              setPage(1);
              setPreview(-1);
            }}
          >
            <option value="all">{a("allCameras")}</option>
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
      {query.isLoading ? (
        <div className="atlas-empty">{a("loading")}</div>
      ) : query.error ? (
        <div className="atlas-error" role="alert">
          <p>{formatApiError(query.error).message}</p>
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {a("retry")}
          </Button>
        </div>
      ) : !displayed.length ? (
        <div className="atlas-empty">
          <Camera size={26} />
          <p>{a(asset ? "noPhotos" : "noImages")}</p>
        </div>
      ) : (
        <div className="atlas-photo-grid">
          {displayed.map((item, index) => (
            <Button
              variant="ghost"
              key={item.id}
              className="atlas-photo"
              onClick={() => setPreview(index)}
              aria-label={`${item.title} ${item.subtitle}`}
            >
              <AtlasPhoto
                key={item.thumbnail}
                src={item.thumbnail}
                alt={item.title}
              />
              <span className="atlas-photo-zoom">
                <ZoomIn size={16} />
              </span>
              <span className="atlas-photo-caption">
                <strong>{item.title}</strong>
                <small>{item.subtitle}</small>
              </span>
            </Button>
          ))}
        </div>
      )}
      {total > 12 && (
        <div className="atlas-pagination">
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
            {page} / {Math.ceil(total / 12)}
          </span>
          <Button
            variant="ghost"
            disabled={page * 12 >= total || query.isFetching}
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
function AtlasPhoto({ src, alt }: { src?: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const { t } = useLocale();
  return failed || !src ? (
    <span className="atlas-image-failed">
      <ImageOff size={24} />
      {t("atlas.photoError")}
    </span>
  ) : (
    <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
  );
}
