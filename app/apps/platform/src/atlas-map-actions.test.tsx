// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { AtlasMapActions } from "./atlas-map";

describe("atlas map action bar", () => {
  it("groups reset and terrain actions without mixing callbacks", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onReset = vi.fn();
    const onTerrain = vi.fn();
    try {
      await act(async () => root.render(<AtlasMapActions ready terrain terrainError={false} onReset={onReset} onTerrain={onTerrain} />));
      const buttons = container.querySelectorAll<HTMLButtonElement>(".atlas-map-actions button");
      expect(buttons).toHaveLength(2);
      await act(async () => buttons[0].click());
      expect(onReset).toHaveBeenCalledOnce();
      expect(onTerrain).not.toHaveBeenCalled();
      await act(async () => buttons[1].click());
      expect(onTerrain).toHaveBeenCalledOnce();
      expect(buttons[1].getAttribute("aria-pressed")).toBe("true");
      await act(async () => root.render(<AtlasMapActions ready={false} terrain={false} terrainError onReset={onReset} onTerrain={onTerrain} />));
      expect(container.querySelectorAll("button")[0].disabled).toBe(false);
      expect(container.querySelectorAll("button")[1].disabled).toBe(true);
      expect(container.querySelector('[role="status"]')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
