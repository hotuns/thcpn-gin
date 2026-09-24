// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { DataRangeFields, validDataRange } from "./data-builder";

vi.hoisted(() => {
  Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: () => "zh-CN", setItem: () => {}, removeItem: () => {} } });
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("data workflow range", () => {
  it("rejects missing, invalid, equal and reversed times", () => {
    expect(validDataRange("", "2026-09-23T12:00")).toBe(false);
    expect(validDataRange("invalid", "invalid")).toBe(false);
    expect(validDataRange("2026-09-23T12:00", "2026-09-23T12:00")).toBe(false);
    expect(validDataRange("2026-09-23T12:00", "2026-09-22T12:00")).toBe(false);
    expect(validDataRange("2026-09-22T12:00", "2026-09-23T12:00")).toBe(true);
  });
  it("offers quick ranges and renders an accessible invalid-range warning", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const setStart = vi.fn(), setEnd = vi.fn();
    try {
      await act(async () => root.render(<DataRangeFields start="" end="" setStart={setStart} setEnd={setEnd} />));
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("结束时间必须晚于开始时间");
      await act(async () => host.querySelectorAll("button")[1].click());
      const start = Date.parse(setStart.mock.calls[0][0]);
      const end = Date.parse(setEnd.mock.calls[0][0]);
      expect(end - start).toBe(3 * 86_400_000);
      expect(host.querySelectorAll('input[type="datetime-local"][required]')).toHaveLength(2);
    } finally { await act(async () => root.unmount()); }
  });
});
