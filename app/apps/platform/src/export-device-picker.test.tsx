// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportContents, ExportDevicePicker } from "./export-device-picker";

vi.mock("@thcpn/i18n", () => ({ useLocale: () => ({t:(key:string, values?:{count:number})=>`${key}${values ? ` ${values.count}` : ""}`}) }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
const options=Array.from({length:8},(_,i)=>({id:`d${i}`,label:`Device ${i}`,description:`SN${i}`,searchText:i===7?"forest":""}));
let root:ReturnType<typeof createRoot>|undefined, host:HTMLDivElement;
const change=vi.fn();
async function mount(multiple=true, many=false){
  function Fixture(){const [selected,setSelected]=useState<string[]>([]);return <ExportDevicePicker label="Devices" options={many?options:options.slice(0,1)} mode={multiple?"multiple":"single"} selectedIds={selected} onChange={ids=>{change(ids);setSelected(ids)}} />;}
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  await act(async()=>root!.render(<Fixture/>));
}
afterEach(()=>{act(()=>root?.unmount());root=undefined;host?.remove();change.mockClear();});
describe("export selection is immediate",()=>{
  it("shows a lone device directly, without an expander, search or confirmation",async()=>{
    await mount();
    expect(host.querySelector('[aria-expanded]')).toBeNull();
    expect(host.querySelector('input[type="search"]')).toBeNull();
    expect(host.textContent).not.toContain("完成");
    await act(async()=>host.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
    expect(change).toHaveBeenLastCalledWith(["d0"]);
    expect(host.textContent).toContain("exportEditor.selected 1");
    await act(async()=>host.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
    expect(change).toHaveBeenLastCalledWith([]);
  });
  it("supports search by label, serial or tag; filtered select-all preserves other selections",async()=>{
    await mount(true,true);
    await act(async()=>host.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
    const input=host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"forest");input.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(host.querySelectorAll('[role="checkbox"]')).toHaveLength(1);
    const all=[...host.querySelectorAll("button")].find(button=>button.textContent==="exportEditor.selectAll")!;
    await act(async()=>all.click());
    expect(change).toHaveBeenLastCalledWith(["d0","d7"]);
    const clear=[...host.querySelectorAll("button")].find(button=>button.textContent==="exportEditor.clear")!;
    await act(async()=>clear.click());expect(change).toHaveBeenLastCalledWith([]);
  });
  it("single selection is available without an extra confirmation",async()=>{
    await mount(false,true);
    const buttons=host.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    await act(async()=>buttons[0].click());await act(async()=>buttons[1].click());
    expect(change).toHaveBeenLastCalledWith(["d1"]);
    expect(buttons[0].getAttribute("aria-checked")).toBe("false");
    expect(buttons[1].getAttribute("aria-checked")).toBe("true");
  });
  it("allows data, images, or both and warns for an empty package",async()=>{
    function Fixture(){const [data,setData]=useState(true),[images,setImages]=useState(true);return <ExportContents data={data} images={images} setData={setData} setImages={setImages}/>;}
    host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async()=>root!.render(<Fixture/>));
    const checks=host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]');
    await act(async()=>checks[0].click());
    expect(checks[1].getAttribute("aria-checked")).toBe("true");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await act(async()=>checks[1].click());expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await act(async()=>checks[0].click());expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it("disables unsupported node image exports",async()=>{
    host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async()=>root!.render(<ExportContents data images={false} setData={vi.fn()} setImages={change} imagesAvailable={false}/>));
    const images=host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[1];
    expect(images.disabled).toBe(true);expect(host.textContent).toContain("exportEditor.imagesUnavailable");
    await act(async()=>images.click());expect(change).not.toHaveBeenCalled();
  });
});
