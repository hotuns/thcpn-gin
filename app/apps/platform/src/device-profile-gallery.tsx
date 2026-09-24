import type { DeviceProfileImage } from "@thcpn/api";
import { useEffect, useRef, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./components/ui/button";

export function DeviceProfileGallery({ images, onPreview }: { images: DeviceProfileImage[]; onPreview: (index: number) => void }) {
  const coverIndex = Math.max(0, images.findIndex(image => image.is_cover));
  const ordered = images.map((image, index) => ({ image, index }));
  if (coverIndex > 0) ordered.unshift(...ordered.splice(coverIndex, 1));
  const [viewport, api] = useEmblaCarousel({ loop: images.length > 1 });
  const [active, setActive] = useState(0);
  const thumbs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!api) return;
    const update = () => setActive(api.selectedScrollSnap());
    update();
    api.on("select", update).on("reInit", update);
    return () => { api.off("select", update).off("reInit", update); };
  }, [api]);
  useEffect(() => {
    const strip = thumbs.current;
    const thumb = strip?.children[active] as HTMLElement | undefined;
    if (strip && thumb) strip.scrollTo?.({ left: thumb.offsetLeft - strip.offsetLeft - strip.clientWidth / 2 + thumb.clientWidth / 2 });
  }, [active]);
  if (!images.length) return null;
  return <section className="device-photo-carousel" role="region" aria-roledescription="carousel" aria-label="资产图片" onKeyDown={event => {
    if (event.key === "ArrowLeft") { event.preventDefault(); api?.scrollPrev(); }
    if (event.key === "ArrowRight") { event.preventDefault(); api?.scrollNext(); }
  }}>
    <div className="device-photo-stage">
      <div ref={viewport} className="device-photo-viewport"><div className="device-photo-track">
        {ordered.map(({ image, index }, position) => <div className="device-photo-slide" key={image.id} role="group" aria-roledescription="slide" aria-label={`${position + 1} / ${images.length}`} aria-hidden={position !== active}>
          <button type="button" tabIndex={position === active ? 0 : -1} onClick={() => onPreview(index)} aria-label={image.caption || image.original_filename}>
            <img src={image.preview_url} alt={image.caption || image.original_filename} loading={position === 0 ? "eager" : "lazy"} draggable={false} />
            {index === coverIndex && <span className="image-cover-badge">封面</span>}
          </button>
        </div>)}
      </div></div>
      {images.length > 1 && <><Button type="button" variant="outline" className="device-photo-prev" aria-label="上一张" onClick={() => api?.scrollPrev()}><ChevronLeft size={20} /></Button><Button type="button" variant="outline" className="device-photo-next" aria-label="下一张" onClick={() => api?.scrollNext()}><ChevronRight size={20} /></Button></>}
    </div>
    <div className="device-photo-caption"><span>{ordered[active]?.image.caption || ordered[active]?.image.original_filename}</span><span aria-live="polite">{active + 1} / {images.length}</span></div>
    {images.length > 1 && <div className="device-photo-thumbnails" ref={thumbs}>
      {ordered.map(({ image }, position) => <button type="button" key={image.id} aria-label={image.caption || image.original_filename} aria-pressed={position === active} onClick={() => api?.scrollTo(position)}>
        <img src={image.preview_url} alt="" loading="lazy" draggable={false} /><span>{position + 1}</span>
      </button>)}
    </div>}
  </section>;
}
