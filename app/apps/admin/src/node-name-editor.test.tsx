// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminNodeNameEditor } from "./node-name-editor";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  // jsdom has no pseudo-element layout; retain real computed styles for AntD.
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => computedStyle(element));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function mount(name: string, onSave = vi.fn().mockResolvedValue(undefined), allowEmpty = true) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<AdminNodeNameEditor name={name} onSave={onSave} allowEmpty={allowEmpty}/>));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  return onSave;
}
async function save() {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.ant-modal-footer button')].find(item => /^(保存|Save)$/.test(item.textContent ?? ""))!;
  await act(async () => button.click());
}
it("uses AntD modal/input/button and saves a trimmed name", async () => {
  const callback = await mount(" 节点名称 ");
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.querySelector(".ant-modal .ant-input")).not.toBeNull();
  await save();
  expect(callback).toHaveBeenCalledWith("节点名称");
});
it("rejects empty names for independent node devices", async () => {
  const callback = await mount("", undefined, false);
  await save();
  expect(callback).not.toHaveBeenCalled();
  expect(document.querySelector(".ant-alert")).not.toBeNull();
});
it("allows indexed nodes to restore their default name", async () => {
  const callback = await mount("");
  await save();
  expect(callback).toHaveBeenCalledWith("");
});
it("keeps errors visible when saving fails", async () => {
  await mount("节点", vi.fn().mockRejectedValue(new Error("save failed")));
  await save();
  expect(document.querySelector(".ant-alert")?.textContent).toContain("save failed");
});
