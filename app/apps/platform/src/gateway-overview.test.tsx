// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { api, type Device, type GatewayNode } from "@thcpn/api";
import { GatewayOverview } from "./gateway-overview";
vi.mock("./lorawan-gateway-info",()=>({LoRaWANGatewayInfo:()=>null}));
let root:Root;let host:HTMLDivElement;let client:QueryClient;
afterEach(async()=>{await act(async()=>root?.unmount());host?.remove();client?.clear();vi.restoreAllMocks()});
function Location(){return <output data-route>{useLocation().search}</output>}
const bound:GatewayNode={key:"gateway:gw:node:37",name:"林下样地",custom_name:"",can_rename:false,node_sn:"NODE-REAL",bound:true,target:{kind:"gateway_node",gateway_device_id:"gw",node_index:37},streams:[]};
const historical:GatewayNode={...bound,key:"gateway:gw:node:8",name:"历史位置",node_sn:"",bound:false,target:{kind:"gateway_node",gateway_device_id:"gw",node_index:8}};
async function mount(family="lorawan_v2"){
 const items=family==="lorawan_v2"?[bound,historical]:[{...bound,target:{kind:"device",device_id:"child"} as const,node_sn:"",bound:undefined}];
 vi.spyOn(api.devices,"nodes").mockResolvedValue({items});vi.spyOn(api.devices,"nodeRuntime").mockResolvedValue({items:[],refreshed_at:""});
 host=document.createElement("div");document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter><GatewayOverview device={{id:"gw",name:"测试网关",source_family:family,device_type:"gateway"} as Device} workspaceId="w"/><Location/></MemoryRouter></QueryClientProvider>));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,40))});
}
it("shows hardware and history in one node list and keeps the correct data target",async()=>{
 await mount();
 expect(host.textContent).toContain("历史位置");
 expect(host.querySelector('table')?.textContent).toContain("NODE-REAL");
 expect(host.querySelector('tbody')?.textContent).toContain("历史位置");
 expect(host.querySelector('[role="tablist"]')).toBeNull();
 const open=[...host.querySelectorAll<HTMLButtonElement>("tbody button")].find(b=>b.textContent==="查看数据")!;
 await act(async()=>open.click());expect(host.querySelector("[data-route]")?.textContent).toContain("gateway%3Agw%3Anode%3A37");
});
it("explains that current hardware does not own all position history",async()=>{
 await mount();const detail=[...host.querySelectorAll<HTMLButtonElement>("tbody button")].find(b=>b.textContent==="节点资料")!;
 await act(async()=>detail.click());
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain("更换硬件前的数据");
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain("NODE-REAL");
});
it("keeps THCPN independent device navigation without unbound slot labels",async()=>{
 await mount("thcpn");expect(host.textContent).not.toContain("未绑定");
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>("tbody button")].find(b=>b.textContent==="节点资料")!.click());
 expect(document.querySelector('a[href="/devices/child?tab=profile"]')).not.toBeNull();
});
