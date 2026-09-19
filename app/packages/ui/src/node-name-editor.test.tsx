// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeNameEditor } from "./node-name-editor";
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = function() {this.open = true;};
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {await act(async () => root.unmount()); host.remove();});
async function mount(save: (name: string) => Promise<unknown>, allowEmpty = true) {
  await act(async () => root.render(<NodeNameEditor name="原名称" onSave={save} allowEmpty={allowEmpty}/>));
  await act(async () => host.querySelector("button")!.click());
}
async function enter(value: string) {
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", {bubbles: true}));
  });
}
async function save() {await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "保存")!.click());}
describe("node name editor", () => {
  it("trims names, supports clearing indexed nodes, and closes on success", async () => {
    const callback = vi.fn().mockResolvedValue({}); await mount(callback);
    await enter("  林下  "); await save(); expect(callback).toHaveBeenCalledWith("林下"); expect(host.querySelector("dialog")).toBeNull();
    await act(async () => host.querySelector("button")!.click()); await enter("  "); await save(); expect(callback).toHaveBeenLastCalledWith("");
  });
  it("rejects names over 50 Unicode characters and empty device node names", async () => {
    const callback = vi.fn(); await mount(callback, false);
    await enter("树".repeat(51)); await save(); expect(callback).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await enter(" "); await save(); expect(callback).not.toHaveBeenCalled();
  });
  it("retains the draft when save fails and allows retry", async () => {
    const callback = vi.fn().mockRejectedValueOnce(new Error("保存失败")).mockResolvedValueOnce({}); await mount(callback);
    await enter("重试名称"); await save(); expect(host.querySelector("input")!.value).toBe("重试名称"); expect(host.querySelector('[role="alert"]')!.textContent).toBe("保存失败");
    await save(); expect(callback).toHaveBeenCalledTimes(2); expect(host.querySelector("dialog")).toBeNull();
  });
});
