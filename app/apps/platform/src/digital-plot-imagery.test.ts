// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { hongliulin, hongliulinBounds, imageryTileUrl, loadHongliulinMosaic, tileLatitude, tileLongitude } from "./digital-plot-imagery";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("Hongliulin tile registration", () => {
  it("uses an XYZ window around the catalog center, with north at the top", () => {
    const [west, south, east, north] = hongliulinBounds;
    expect(west).toBeLessThan(hongliulin.center[0]);
    expect(east).toBeGreaterThan(hongliulin.center[0]);
    expect(south).toBeLessThan(hongliulin.center[1]);
    expect(north).toBeGreaterThan(hongliulin.center[1]);
    expect(tileLongitude(199854, 18)).toBe(west);
    expect(tileLatitude(101083, 18)).toBe(north);
    expect(tileLatitude(101087, 18)).toBe(south);
    expect(imageryTileUrl(199854, 101083)).toContain("/18/199854/101083.png");
  });
  it("composes exactly 20 tiles at the correct pixel offsets and releases decoded images", async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn(), drawImage } as unknown as CanvasRenderingContext2D);
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close })));
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob() }));
    vi.stubGlobal("fetch", fetchMock);
    const canvas = await loadHongliulinMosaic(new AbortController().signal);
    expect([canvas.width, canvas.height]).toEqual([1280, 1024]);
    expect(fetchMock).toHaveBeenCalledTimes(20);
    expect(drawImage).toHaveBeenCalledTimes(20);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 1024, 768, 256, 256);
    expect(close).toHaveBeenCalledTimes(20);
  });
  it("rejects missing tiles rather than publishing an incomplete mosaic", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(loadHongliulinMosaic(new AbortController().signal)).rejects.toThrow("HTTP 404");
  });
});
