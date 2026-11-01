// @vitest-environment jsdom
import { act } from "react";
import { createRoot,type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { api } from "@thcpn/api";
import { LoRaWANNodeInventory } from "./lorawan-node-inventory";
let root:Root;let host:HTMLDivElement;let client:QueryClient;
const flush=async()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,60))});
const button=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.replace(/\s/g,"")===label)!;
beforeEach(()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});Object.defineProperty(window,"matchMedia",{configurable:true,value:()=>({matches:false,addListener:vi.fn(),removeListener:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn()})});const computed=window.getComputedStyle.bind(window);vi.spyOn(window,"getComputedStyle").mockImplementation(el=>computed(el));
 vi.spyOn(api.admin,"sources").mockResolvedValue({items:[{id:"source",name:"LoRa源",source_family:"lorawan_v2",status:"active"}]});vi.spyOn(api.admin,"physicalNodeGateways").mockResolvedValue({items:[{id:"gw",name:"测试网关",sn:"GW"}]});vi.spyOn(api.admin,"sourcePhysicalNodes").mockResolvedValue({data:[],pagination:{total_count:0}});vi.spyOn(api.admin,"deviceLoRaWANV2Context").mockResolvedValue({data_source_id:"source"});
 vi.spyOn(api.admin,"registerPhysicalNode").mockResolvedValue({status:"completed",created:true,bound:true,message:"节点已新建并安装"});vi.spyOn(api.admin,"changePhysicalNode").mockResolvedValue({status:"completed",message:"同步完成"});
 vi.spyOn(api.admin,"previewPhysicalNodeCSV").mockResolvedValue({items:[{line:2,sn:"000123",node_index:3},{line:3,sn:"NODE-B",node_index:7}]});
});
afterEach(async()=>{await act(async()=>root?.unmount());host?.remove();client?.clear();vi.restoreAllMocks();vi.unstubAllGlobals()});
async function mount(gateway=true){host=document.createElement("div");document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});await act(async()=>root.render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={[`/admin/devices?kind=node_v2&source=source${gateway?"&gateway=gw":""}`]}><LoRaWANNodeInventory/></MemoryRouter></App></QueryClientProvider>));await flush();await flush();}
async function upload(){await act(async()=>button("CSV新建并安装").click());await flush();const file=new File(["sn,node_index\n000123,3\nNODE-B,7"],"nodes.csv",{type:"text/csv"});Object.defineProperty(file,"text",{value:async()=>"sn,node_index\n000123,3\nNODE-B,7"});const input=document.querySelector<HTMLInputElement>('input[type="file"]')!;Object.defineProperty(input,"files",{value:[file],configurable:true});await act(async()=>input.dispatchEvent(new Event("change",{bubbles:true})));await flush();}
it("opens source inventory without entering or requiring a gateway",async()=>{await mount(false);expect(api.admin.sourcePhysicalNodes).toHaveBeenCalled();expect(api.admin.deviceLoRaWANV2Context).not.toHaveBeenCalled();expect(button("新建节点").disabled).toBe(false);expect(api.admin.registerPhysicalNode).not.toHaveBeenCalled()});
it("previews CSV, confirms creation and installs exact rows, then synchronizes only once",async()=>{
 await mount();await upload();expect(api.admin.previewPhysicalNodeCSV).toHaveBeenCalledWith("sn,node_index\n000123,3\nNODE-B,7");expect(document.body.textContent).toContain("000123");expect(api.admin.registerPhysicalNode).not.toHaveBeenCalled();
 await act(async()=>button("开始新建并安装").click());await flush();expect(api.admin.registerPhysicalNode).not.toHaveBeenCalled();
 await act(async()=>document.querySelector<HTMLButtonElement>(".ant-modal-confirm .ant-btn-primary")!.click());await flush();await flush();
 expect(api.admin.registerPhysicalNode).toHaveBeenNthCalledWith(1,"source",{sn:"000123",node_index:3,gateway_device_id:"gw"});expect(api.admin.registerPhysicalNode).toHaveBeenNthCalledWith(2,"source",{sn:"NODE-B",node_index:7,gateway_device_id:"gw"});expect(api.admin.changePhysicalNode).toHaveBeenCalledTimes(1);expect(api.admin.changePhysicalNode).toHaveBeenCalledWith("gw",{action:"reconcile"});
});
it("blocks execution when preview reports invalid or duplicate rows",async()=>{vi.mocked(api.admin.previewPhysicalNodeCSV).mockResolvedValue({items:[{line:1,sn:"A",node_index:1,error:"文件内 SN 重复"}]});await mount();await upload();expect(button("开始新建并安装").disabled).toBe(true);expect(api.admin.registerPhysicalNode).not.toHaveBeenCalled()});
