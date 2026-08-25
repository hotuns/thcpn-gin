import { useEffect, useMemo, useState } from "react";
import { ListTree, X } from "lucide-react";
import type { DataStream } from "@thcpn/api";
import { IconButton } from "@thcpn/ui";

export type DataQuickNavItem = {
  id: string;
  label: string;
  level: 0 | 1;
};

export function scrollToDataSection(id: string) {
  document.getElementById(id)?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
    block: "start",
  });
}

export function buildDataQuickNavItems(imageStreams: DataStream[]): DataQuickNavItem[] {
  return [
    { id: "data-section-metrics", label: "查询条件", level: 0 },
    { id: "data-section-trend", label: "遥测趋势", level: 0 },
    { id: "data-section-detail", label: "遥测明细", level: 0 },
    { id: "data-section-images", label: "设备图片", level: 0 },
    ...imageStreams.map((stream) => ({
      id: `data-image-${stream.id}`,
      label: stream.name,
      level: 1 as const,
    })),
  ];
}

export function DataQuickNavigator({
  imageStreams = [],
  items: customItems,
}: {
  imageStreams?: DataStream[];
  items?: DataQuickNavItem[];
}) {
  const [activeId, setActiveId] = useState("data-section-metrics");
  const [open, setOpen] = useState(false);
  const items = useMemo(
    () => customItems ?? buildDataQuickNavItems(imageStreams),
    [customItems, imageStreams],
  );

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const positions = items
          .map((item) => ({
            id: item.id,
            top: document.getElementById(item.id)?.getBoundingClientRect().top,
          }))
          .filter((item): item is { id: string; top: number } =>
            typeof item.top === "number",
          );
        if (!positions.length) return;
        const current = positions.reduce(
          (result, item) => (item.top <= 116 ? item.id : result),
          positions[0].id,
        );
        setActiveId(current);
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [items]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const goTo = (id: string, pointerActivated: boolean) => {
    scrollToDataSection(id);
    setActiveId(id);
    setOpen(false);
    if (pointerActivated && window.matchMedia("(min-width: 1280px)").matches)
      (document.activeElement as HTMLElement | null)?.blur();
  };

  const navigation = (variant: "desktop" | "mobile") => (
    <nav
      className={`data-quick-nav data-quick-nav-panel-${variant}`}
      aria-label="数据页快速定位"
    >
      <div className="data-quick-nav-list">
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            className={item.level ? "nested" : undefined}
            aria-current={activeId === item.id ? "location" : undefined}
            onClick={(event) => goTo(item.id, event.detail > 0)}
          >
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );

  return (
    <>
      <aside className="data-quick-nav-desktop">
        <div className="data-quick-nav-shell">
          <button
            type="button"
            className="data-quick-nav-rail"
            aria-label="展开快速定位"
            onMouseDown={(event) => event.preventDefault()}
          >
            <ListTree size={15} />
          </button>
          {navigation("desktop")}
        </div>
      </aside>
      <IconButton
        label="打开快速定位"
        className="data-quick-nav-toggle"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <ListTree size={18} />
      </IconButton>
      {open && (
        <div className="data-quick-nav-overlay">
          <button
            type="button"
            className="data-quick-nav-backdrop"
            aria-label="关闭快速定位"
            onClick={() => setOpen(false)}
          />
          <div className="data-quick-nav-popover" role="dialog" aria-label="快速定位">
            <IconButton
              label="关闭快速定位"
              className="data-quick-nav-close"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </IconButton>
            {navigation("mobile")}
          </div>
        </div>
      )}
    </>
  );
}
