// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@thcpn/api";
import { LoRaWANNodeTimeConfig } from "./lorawan-node-time-config";
let root:Root;
let container:HTMLDivElement;
afterEach(async()=>{if(root)await act(async()=>root.unmount());container?.remove();vi.restoreAllMocks();});
const flush=()=>new Promise(resolve=>setTimeout(resolve,30));
async function mount() {
  container=document.createElement("div");document.body.append(container);root=createRoot(container);
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  await act(async()=>root.render(<QueryClientProvider client={client}><LoRaWANNodeTimeConfig deviceId="gateway" nodeIndex={3} workspaceId="workspace"/></QueryClientProvider>));
  await act(flush);
}
it("shows the source schedule and loads history only when requested",async()=>{
  const config={id:1,gateway_sn:"GW",node_index:3,content:"source schedule",wait_time:0,created_at:"2026-10-13T01:00:00Z"};
  const read=vi.spyOn(api.devices,"nodeTimeConfig").mockResolvedValue(config);
  const history=vi.spyOn(api.devices,"nodeTimeConfigs").mockResolvedValue([{...config,id:2,content:"historical schedule"}]);
  await mount(); expect(read).toHaveBeenCalledWith("gateway",3);expect(container.textContent).toContain("source schedule");expect(history).not.toHaveBeenCalled();
  await act(async()=>[...container.querySelectorAll("button")].find(b=>b.textContent==="查看历史时间配置")!.click());await act(flush);
  expect(history).toHaveBeenCalledWith("gateway",3);expect(container.textContent).toContain("historical schedule");
});
it("distinguishes absent configuration from an unavailable upstream API",async()=>{
  vi.spyOn(api.devices,"nodeTimeConfig").mockRejectedValue(new Error("上游尚未开放节点时间配置读取接口"));
  await mount();expect(container.textContent).toContain("时间配置读取失败");expect(container.textContent).not.toContain("暂无时间配置");
});
it("renders an empty state for a successful null response",async()=>{
  vi.spyOn(api.devices,"nodeTimeConfig").mockResolvedValue(null);await mount();expect(container.textContent).toContain("暂无时间配置");
});
it("shows daily start times and preserves the original schedule",async()=>{
  vi.spyOn(api.devices,"nodeTimeConfig").mockResolvedValue({id:1,gateway_sn:"GW",node_index:3,content:"10,20 10",wait_time:0,created_at:"2026-10-13T01:00:00Z"});
  await mount();expect(container.textContent).toMatch(/10:10.*10:20/);expect(container.querySelector("pre")?.textContent).toBe("10,20 10");
});
