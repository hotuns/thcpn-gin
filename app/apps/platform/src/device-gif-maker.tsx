import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Check, Clock3, Download, Film, HardDrive, Images, Timer, X } from "lucide-react";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import type { DataStream, Device, MediaItem } from "@thcpn/api";
import { api, formatApiError } from "@thcpn/api";
import { Button, StateView } from "@thcpn/ui";

type ImageSource = "thumbnail" | "original";

const dayKey = (input: string) => {
  const date = new Date(input);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const displayTime = (input: string) =>
  new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(input));

const formatDuration = (milliseconds: number) => {
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds % 1 ? 1 : 0)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
};

const formatEstimatedSize = (frames: number, source: ImageSource) => {
  if (!frames) return "—";
  const pixels = source === "original" ? 1920 * 1080 : 480 * 360;
  const megabytes = frames * pixels * 0.45 / 1024 / 1024;
  return megabytes < 1 ? `约 ${Math.max(0.1, megabytes).toFixed(1)} MB` : `约 ${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
};

async function loadFrame(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("图片读取失败");
  return createImageBitmap(await response.blob());
}

async function originalUrl(item: MediaItem) {
  const token = item.download_url ? new URL(item.download_url, window.location.origin).searchParams.get("token") : "";
  if (!token) throw new Error("所选图片没有原图读取权限");
  const result = await api.media.prepareDownload({ token });
  const url = String(result.url ?? "");
  if (!url) throw new Error("服务端未返回原图地址");
  return url;
}

async function encodeGif(items: MediaItem[], source: ImageSource, delay: number, onProgress: (value: number) => void) {
  const resolveUrl = (item: MediaItem) => source === "original" ? originalUrl(item) : Promise.resolve(item.thumbnail_url || item.preview_url);
  const first = await loadFrame(await resolveUrl(items[0]));
  const width = first.width;
  const height = first.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器无法创建图片画布");
  const gif = GIFEncoder();

  for (let index = 0; index < items.length; index += 1) {
    const bitmap = index === 0 ? first : await loadFrame(await resolveUrl(items[index]));
    const scale = Math.min(width / bitmap.width, height / bitmap.height);
    const frameWidth = Math.round(bitmap.width * scale);
    const frameHeight = Math.round(bitmap.height * scale);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, (width - frameWidth) / 2, (height - frameHeight) / 2, frameWidth, frameHeight);
    bitmap.close();
    const pixels = context.getImageData(0, 0, width, height).data;
    const palette = quantize(pixels, 256);
    gif.writeFrame(applyPalette(pixels, palette), width, height, { palette, delay, repeat: 0 });
    onProgress(index + 1);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  gif.finish();
  const bytes = gif.bytes();
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: "image/gif" });
}

export function DeviceGifMaker({ device, stream, startTime, endTime, onClose }: {
  device: Device;
  stream: DataStream;
  startTime: string;
  endTime: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ordinal, setOrdinal] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [source, setSource] = useState<ImageSource>("thumbnail");
  const [delay, setDelay] = useState(500);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState("");
  const [resultSize, setResultSize] = useState(0);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded: MediaItem[] = [];
        let page = 1;
        let hasMore = false;
        do {
          const result = await api.media.dataStream(stream.id, {
            start_time: new Date(startTime).toISOString(), end_time: new Date(endTime).toISOString(), page, page_size: 100,
          });
          loaded.push(...result.items.filter((item) => item.media_type === "image" && item.preview_url));
          hasMore = result.page * result.page_size < result.total;
          page += 1;
        } while (hasMore);
        if (active) setItems(loaded.sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime()));
      } catch (cause) {
        if (active) setError(formatApiError(cause).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [endTime, startTime, stream.id]);

  useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl); }, [resultUrl]);

  const dailyItems = useMemo(() => {
    const groups = new Map<string, MediaItem[]>();
    items.forEach((item) => {
      const key = dayKey(item.captured_at);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    });
    return [...groups.values()].map((group) => group[ordinal - 1]).filter(Boolean);
  }, [items, ordinal]);
  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  const originalAvailable = items.length > 0 && items.every((item) => item.download_allowed && item.download_url);

  const clearResult = () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl("");
    setResultSize(0);
  };
  const updateSelection = (next: Set<string>) => { clearResult(); setSelectedIds(next); };
  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    updateSelection(next);
  };
  const addDailySelection = () => {
    const next = new Set(selectedIds);
    dailyItems.forEach((item) => next.add(item.id));
    updateSelection(next);
  };
  const generate = async () => {
    setGenerating(true);
    setError("");
    setProgress(0);
    clearResult();
    try {
      const blob = await encodeGif(selectedItems, source, delay, setProgress);
      setResultSize(blob.size);
      setResultUrl(URL.createObjectURL(blob));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "GIF 生成失败");
    } finally {
      setGenerating(false);
    }
  };
  const download = () => {
    const anchor = document.createElement("a");
    anchor.href = resultUrl;
    anchor.download = `${device.serial_no || device.name || "device"}-${stream.name}.gif`.replace(/[^\w\u4e00-\u9fff.-]+/g, "-");
    anchor.click();
  };

  return createPortal(
    <div className="gif-workspace-layer">
      <section className="gif-workspace" role="dialog" aria-modal="true" aria-label={`制作${stream.name} GIF`}>
        <header className="gif-workspace-header">
          <div><Film size={19} /><span><strong>制作 GIF</strong><small>{stream.name} · {displayTime(startTime)} 至 {displayTime(endTime)}</small></span></div>
          <Button variant="secondary" onClick={onClose}><X size={14} />关闭</Button>
        </header>
        {loading ? <StateView type="loading" title="正在加载图片" description="正在读取当前时间范围内的全部图片。" />
          : error && !items.length ? <StateView type="error" title="图片加载失败" description={error} />
            : !items.length ? <StateView type="empty" title="没有可用图片" description="请关闭制作台并调整页面顶部的时间范围。" />
              : <div className="gif-workspace-content">
                <main className="gif-frame-browser">
                  <div className="gif-selection-toolbar">
                    <div className="gif-quick-select">
                      <CalendarDays size={16} />
                      <label><span>每天第</span><input type="number" min={1} step={1} value={ordinal} onChange={(event) => setOrdinal(Math.max(1, Number(event.target.value) || 1))} /><span>张</span></label>
                      <Button variant="secondary" onClick={addDailySelection}>加入选择（{dailyItems.length} 张）</Button>
                    </div>
                    <div className="gif-manual-actions"><strong>已选 {selectedItems.length} / {items.length} 张</strong><button type="button" onClick={() => updateSelection(new Set(items.map((item) => item.id)))}>全选</button><button type="button" onClick={() => updateSelection(new Set())}>清空</button></div>
                  </div>
                  <div className="gif-frame-grid">
                    {items.map((item) => <button key={item.id} type="button" className={selectedIds.has(item.id) ? "is-selected" : ""} onClick={() => toggle(item.id)} aria-label={`${selectedIds.has(item.id) ? "取消选择" : "选择"}${displayTime(item.captured_at)}`}><img src={item.thumbnail_url || item.preview_url} alt="" loading="lazy" />{selectedIds.has(item.id) && <span className="gif-frame-check"><Check size={14} /></span>}<time dateTime={item.captured_at}><Clock3 size={12} />{displayTime(item.captured_at)}</time></button>)}
                  </div>
                </main>
                <aside className="gif-settings-panel">
                  <div className="gif-setting-section"><h3>图像来源</h3><div className="gif-source-options">
                    <button type="button" className={source === "thumbnail" ? "is-active" : ""} onClick={() => { clearResult(); setSource("thumbnail"); }}><Images size={17} /><span><strong>缩略图</strong><small>生成更快，文件较小</small></span></button>
                    <button type="button" disabled={!originalAvailable} className={source === "original" ? "is-active" : ""} onClick={() => { clearResult(); setSource("original"); }}><HardDrive size={17} /><span><strong>原图</strong><small>{originalAvailable ? "保持原始尺寸与细节" : "当前账户没有原图权限"}</small></span></button>
                  </div></div>
                  <div className="gif-setting-section"><label className="gif-delay-field"><span>每帧停留</span><select value={delay} onChange={(event) => { clearResult(); setDelay(Number(event.target.value)); }}><option value={200}>0.2 秒</option><option value={500}>0.5 秒</option><option value={1000}>1 秒</option><option value={2000}>2 秒</option></select></label></div>
                  <dl className="gif-estimate"><div><dt><Images size={15} />帧数</dt><dd>{selectedItems.length} 帧</dd></div><div><dt><Timer size={15} />GIF 时长</dt><dd>{selectedItems.length ? formatDuration(selectedItems.length * delay) : "—"}</dd></div><div><dt><HardDrive size={15} />预计体积</dt><dd>{formatEstimatedSize(selectedItems.length, source)}</dd></div></dl>
                  <p className="gif-estimate-note">体积按图像来源与帧数估算，实际大小以生成结果为准。</p>
                  {error && <div className="command-note media-feedback">{error}</div>}
                  <Button className="gif-generate-button" disabled={generating || selectedItems.length < 2} onClick={() => void generate()}><Film size={15} />{generating ? `生成中 ${progress}/${selectedItems.length}` : "生成 GIF"}</Button>
                  {resultUrl && <div className="gif-result"><img src={resultUrl} alt="生成的 GIF 预览" /><span>实际体积 {(resultSize / 1024 / 1024).toFixed(1)} MB</span><Button onClick={download}><Download size={14} />下载 GIF</Button></div>}
                </aside>
              </div>}
      </section>
    </div>,
    document.body,
  );
}
