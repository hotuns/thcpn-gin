// @vitest-environment jsdom
import { act, lazy, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditionRoute } from "./edition-route";

const edition = vi.hoisted(() => ({ simplified: true }));
vi.mock("./features", async (importOriginal) => {
  const original = await importOriginal<typeof import("./features")>();
  return {
    ...original,
    get platformHomePath() { return edition.simplified ? "/atlas" : "/dashboard"; },
    platformPathAvailable: (path: string) => original.platformPathAvailable(path, edition.simplified),
  };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = undefined;
});

async function mount(path: string, simplified: boolean) {
  edition.simplified = simplified;
  const loadAdvanced = vi.fn(async () => ({ default: () => <div>Advanced page</div> }));
  const Advanced = lazy(loadAdvanced);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(
    <MemoryRouter initialEntries={[path]}>
      <Suspense fallback="Loading">
        <Routes>
          <Route element={<EditionRoute />}>
            <Route path="/atlas" element={<div>Atlas home</div>} />
            <Route path="/exports/new" element={<div>New export</div>} />
            <Route path="*" element={<Advanced />} />
          </Route>
        </Routes>
      </Suspense>
    </MemoryRouter>,
  ));
  return loadAdvanced;
}

describe("edition route boundary", () => {
  it("redirects omitted pages before loading their components", async () => {
    const load = await mount("/processing/task-1", true);
    expect(container.textContent).toBe("Atlas home");
    expect(load).not.toHaveBeenCalled();
  });
  it("allows export creation in the simplified edition", async () => {
    await mount("/exports/new?device_id=1", true);
    expect(container.textContent).toBe("New export");
  });
  it("leaves advanced routes available in the full edition", async () => {
    const load = await mount("/processing/task-1", false);
    expect(container.textContent).toBe("Advanced page");
    expect(load).toHaveBeenCalledOnce();
  });
});
