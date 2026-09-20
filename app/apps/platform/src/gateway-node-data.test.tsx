// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { api, type Device, type GatewayNode } from "@thcpn/api";
import { GatewayNodeData } from "./gateway-node-data";
vi.mock("./telemetry-charts", () => ({ TelemetryCharts: () => <div>趋势图</div> }));
let root: Root | undefined;
let container: HTMLDivElement;
beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); });
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));
async function mount(nodes: GatewayNode[], family: string) {
 vi.spyOn(api.devices, "nodes").mockResolvedValue({ items: nodes });
 container=document.createElement("div"); document.body.append(container); root=createRoot(container);
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 const gateway={id:"gateway-1",name:"组网站",device_type:"gateway",source_family:family} as Device;
 await act(async()=>{ root!.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/devices/gateway-1?tab=data&node=${encodeURIComponent(nodes[0].key)}`]}><GatewayNodeData gateway={gateway} workspaceId="workspace"/></MemoryRouter></QueryClientProvider>); });
 await act(flush);
}
async function choose(trigger: Element, label: string) {
 await act(async()=>{(trigger as HTMLButtonElement).click();});
 const option=[...document.querySelectorAll('[role="option"]')].find((item)=>item.textContent?.includes(label)) as HTMLElement;
 await act(async()=>{option.click();});
}
function node(index:number, family:string): GatewayNode {
 const id=family==="lorawan_v2"?"gateway-1":`device-${index}`;
 const target=family==="lorawan_v2"?{kind:"gateway_node" as const,gateway_device_id:id,node_index:index}:{kind:"device" as const,device_id:id};
 return { custom_name: "", can_rename: false, key:family==="lorawan_v2"?`gateway:${id}:node:${index}`:`device:${id}`,name:`节点 ${index}`,target,streams:[{id:`stream-${index}`,device_id:id,code:"temperature",name:"温度",type:"telemetry",unit:"℃",status:"active",computed:false,created_by:"admin",created_at:"",updated_at:""}] };
}
describe("unified gateway query",()=>{
 for (const family of ["thcpn","lorawan_v2"]) it(`${family}: comparison batches by physical device and keeps partial results`,async()=>{
  const telemetry=vi.spyOn(api.telemetry,"device").mockImplementation(async(_id,input)=>({device_id:_id,limit:5000,start_time:input.startTime,end_time:input.endTime,series:(input.dataStreamIds??[]).map((id)=>({data_stream_id:id,code:"temperature",name:"温度",points:[],source_count:0,returned_count:0,sampled:false,complete:id!=="stream-2",...(id==="stream-2"?{error:"节点读取失败"}:{})}))}));
  await mount([node(1,family),node(2,family)],family);
  const mode=container.querySelectorAll('[role="combobox"]')[0];
  await choose(mode,"节点对比");
  const button=[...container.querySelectorAll("button")].find((item)=>item.textContent==="查询")!;
  await act(async()=>button.click());await act(flush);
  expect(telemetry).toHaveBeenCalledTimes(family==="lorawan_v2"?1:2);
  expect(telemetry.mock.calls.flatMap((call)=>call[1].dataStreamIds)).toEqual(["stream-1","stream-2"]);
  expect(container.textContent).toContain("节点读取失败");
  const link=container.querySelector('a[href^="/exports?"]')!;
  expect(link.getAttribute("href")).toContain("gateway=gateway-1");
  expect(link.getAttribute("href")).toContain("nodes=");
 });
 it("keeps configured indexed nodes selectable without recent streams",async()=>{
  const first=node(1,"lorawan_v2"),second=node(2,"lorawan_v2");first.streams=[];second.streams=[];
  const telemetry=vi.spyOn(api.telemetry,"device");await mount([first,second],"lorawan_v2");
  expect(container.textContent).toContain("暂无指标");
  const nodeSelect=container.querySelectorAll('[role="combobox"]')[1];
  await act(async()=>{(nodeSelect as HTMLButtonElement).click();});
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
  expect(telemetry).not.toHaveBeenCalled();
 });
});
