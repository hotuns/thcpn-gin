// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { DeviceProfileImage } from "@thcpn/api";
import { DeviceProfileGallery } from "./device-profile-gallery";

const carousel = vi.hoisted(() => {
  Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: () => "zh-CN", setItem: () => {}, removeItem: () => {} } });
  let selected = 0;
  const listeners = new Set<() => void>();
  const api = {
    selectedScrollSnap: () => selected,
    on: (_: string, callback: () => void) => { listeners.add(callback); return api; },
    off: (_: string, callback: () => void) => { listeners.delete(callback); return api; },
    scrollTo: (index: number) => { selected = index; listeners.forEach(callback => callback()); },
    scrollNext: () => api.scrollTo((selected + 1) % 12),
    scrollPrev: () => api.scrollTo((selected + 11) % 12),
  };
  return api;
});
vi.mock("embla-carousel-react", () => ({ default: () => [undefined, carousel] }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("shows all twelve photos and preserves preview indices when moving the cover first", async () => {
  const images: DeviceProfileImage[] = Array.from({ length: 12 }, (_, index) => ({
    id: String(index), device_id: "device", original_filename: `photo-${index}.jpg`,
    content_type: "image/jpeg", size_bytes: 100, sort_order: index, is_cover: index === 7,
    preview_url: `/photo-${index}.jpg`, preview_expires_at: "2099-01-01", uploaded_by: "user",
    created_at: "2026-09-24", updated_at: "2026-09-24",
  }));
  const host = document.createElement("div"), root = createRoot(host), preview = vi.fn();
  try {
    await act(async () => root.render(<DeviceProfileGallery images={images} onPreview={preview} />));
    expect(host.querySelectorAll(".device-photo-slide")).toHaveLength(12);
    expect(host.querySelectorAll(".device-photo-thumbnails button")).toHaveLength(12);
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/photo-7.jpg");
    await act(async () => host.querySelectorAll("button")[0].click());
    expect(preview).toHaveBeenLastCalledWith(7);
    await act(async () => (host.querySelectorAll(".device-photo-thumbnails button")[11] as HTMLButtonElement).click());
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe("12 / 12");
    await act(async () => (host.querySelector('.device-photo-slide[aria-hidden="false"] button') as HTMLButtonElement).click());
    expect(preview).toHaveBeenLastCalledWith(11);
    await act(async () => (host.querySelector('.device-photo-next') as HTMLButtonElement).click());
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe("1 / 12");
    expect(images[0].id).toBe("0");
  } finally { await act(async () => root.unmount()); }
});
