// @vitest-environment jsdom
import { act } from "react";
import { createRoot,type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { api,type GatewayNode } from "@thcpn/api";
import { AdminDevicesPage } from "./admin-devices";
import { AdminDeviceNodes } from "./admin-device-installation";
let root:Root;let host:HTMLDivElement;let client:QueryClient;
const gateway={id:"gw",name:"网关v2",serial_no:"GW",device_type:"gateway",source_family:"lorawan_v2",status:"active"};
const node:GatewayNode={key:"gateway:gw:node:37",name:"林下样地",custom_name:"",can_rename:true,bound:true,node_sn:"NODE-A",target:{kind:"gateway_node",gateway_device_id:"gw",node_index:37},streams:[]};
const flush=async()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,50))});
beforeEach(()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});Object.defineProperty(window,"matchMedia",{configurable:true,value:()=>({matches:false,addListener:vi.fn(),removeListener:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn()})});const computed=window.getComputedStyle.bind(window);vi.spyOn(window,"getComputedStyle").mockImplementation(el=>computed(el));
 vi.spyOn(api.admin,"devices").mockResolvedValue({items:[gateway]});vi.spyOn(api.admin,"deviceMap").mockResolvedValue({items:[],total:0,located:0,unlocated:0,unclassified:0});vi.spyOn(api.admin,"deviceChildren").mockResolvedValue({items:[]});
 vi.spyOn(api.admin,"deviceNodes").mockResolvedValue({items:[node]});vi.spyOn(api.admin,"physicalNodes").mockResolvedValue({data:[{id:11,sn:"NODE-B",gateway_sn:null,node_index:null}]});vi.spyOn(api.admin,"changePhysicalNode").mockResolvedValue({status:"completed",message:"关系已更新"});
});
afterEach(async()=>{await act(async()=>root?.unmount());host?.remove();client?.clear();vi.restoreAllMocks();vi.unstubAllGlobals()});
async function mount(page:boolean,onConfig=vi.fn()){
 host=document.createElement("div");document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 await act(async()=>root.render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={["/admin/devices?kind=lorawan_v2"]}>{page?<AdminDevicesPage/>:<AdminDeviceNodes device={gateway} onData={vi.fn()} onConfig={onConfig}/>}</MemoryRouter></App></QueryClientProvider>));await flush();await flush();
}
async function more(label:string){await act(async()=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.replace(/\s/g,"")==="更多")!.click());await flush();await act(async()=>[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item=>item.textContent===label)!.click());await flush();}
it("expands LoRaWAN gateways with indexed nodes instead of THCPN children",async()=>{
 await mount(true);await act(async()=>host.querySelector<HTMLButtonElement>(".ant-table-row-expand-icon")!.click());await flush();await flush();
 expect(host.textContent).toContain("NODE-A");expect(host.textContent).toContain("物理节点");expect(host.textContent).not.toContain("节点工作台");expect(api.admin.deviceChildren).not.toHaveBeenCalled();expect(api.admin.deviceNodes).toHaveBeenCalledWith("gw");
});
it("opens node-specific time configuration directly from the table",async()=>{const onConfig=vi.fn();await mount(false,onConfig);await more("时间配置");expect(onConfig).toHaveBeenCalledWith(37,"time");expect(api.admin.changePhysicalNode).not.toHaveBeenCalled()});
it("replacement preserves the selected position and does not submit before confirmation",async()=>{await mount(false);await more("更换节点");const dialog=document.querySelector(".ant-modal")!;expect(dialog.textContent).toContain("NODE-A");expect(dialog.textContent).toContain("新物理节点 SN");const index=dialog.querySelector<HTMLInputElement>('input[role="spinbutton"]')!;expect(index.value).toBe("37");expect(index.disabled).toBe(true);expect(api.admin.changePhysicalNode).not.toHaveBeenCalled()});
it("supports unbound positions with install actions instead of replacement",async()=>{vi.mocked(api.admin.deviceNodes).mockResolvedValue({items:[{...node,bound:false,node_sn:""}]});await mount(false);await act(async()=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.replace(/\s/g,"")==="更多")!.click());await flush();const menu=document.querySelector('[role="menu"]')!;expect(menu.textContent).toContain("安装库存节点");expect(menu.textContent).toContain("新建节点并安装");expect(menu.textContent).not.toContain("更换节点")});
