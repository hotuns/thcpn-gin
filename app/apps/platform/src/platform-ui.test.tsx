// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { SelectInput } from "./platform-ui";

let root: Root;
let container: HTMLDivElement;
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

function Filter() {
  const [value, setValue] = useState("");
  return <form>
    <SelectInput name="status" id="status" value={value} onValueChange={setValue} aria-label="状态" aria-describedby="status-help">
      <option value="">全部状态</option>
      <option value="ready">已完成</option>
      <option value="failed" disabled>失败</option>
    </SelectInput>
    <button type="button" onClick={() => setValue("")}>重置</button>
    <output>{value}</output>
  </form>;
}

const choose = async (label: string) => {
  await act(async () => (document.querySelector('[role="combobox"]') as HTMLElement).click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === label)!;
  await act(async () => {
    option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
};

it("lets users select all again after narrowing a filter, and reflects external resets", async () => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<Filter />));
  const trigger = document.querySelector('[role="combobox"]')!;
  expect(trigger.id).toBe("status");
  expect(trigger.getAttribute("aria-describedby")).toBe("status-help");
  expect(trigger.textContent).toBe("全部状态");
  await choose("已完成");
  expect(document.querySelector("output")?.textContent).toBe("ready");
  expect(new FormData(container.querySelector("form")!).get("status")).toBe("ready");
  await choose("全部状态");
  expect(document.querySelector("output")?.textContent).toBe("");
  expect(trigger.textContent).toBe("全部状态");
  await choose("已完成");
  await act(async () => [...container.querySelectorAll("button")].find(item => item.textContent === "重置")!.click());
  expect(trigger.textContent).toBe("全部状态");
});
