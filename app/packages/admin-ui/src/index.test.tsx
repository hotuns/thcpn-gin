// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { IconButton, adminButtonTokens } from "./index";

let host: HTMLDivElement;
let root: Root;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); });
it("defines consistent AntD sizes without automatic Chinese button spacing", () => {
  expect(adminButtonTokens).toMatchObject({ controlHeight: 36, controlHeightSM: 28, controlHeightLG: 44, borderRadius: 6, borderRadiusSM: 6, borderRadiusLG: 6, autoInsertSpace: false });
});
it("uses an accessible AntD icon button and preserves click behavior", async () => {
  host=document.createElement("div"); document.body.append(host); root=createRoot(host);
  const click=vi.fn();
  await act(async () => root.render(<IconButton label="Action" onClick={click}><span>icon</span></IconButton>));
  const button=host.querySelector("button")!;
  expect(button.classList.contains("ant-btn")).toBe(true);
  expect(button.classList.contains("icon-btn")).toBe(false);
  expect(button.getAttribute("aria-label")).toBe("Action");
  expect(button.getAttribute("type")).toBe("button");
  await act(async () => button.click());
  expect(click).toHaveBeenCalledTimes(1);
});
