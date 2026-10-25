// Isolated review harness: real export UI, synthetic cached data, no API writes.
import "@thcpn/ui/styles.css";
import "../../app/apps/platform/src/platform.css";
import "../../app/apps/platform/src/shadcn.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, LanguageSwitcher } from "@thcpn/i18n";
import { WorkspaceProvider } from "@thcpn/workspace";
import { api } from "@thcpn/api";
import { ExportsPage } from "../../app/apps/platform/src/exports-page";
import { ColorThemeProvider } from "../../app/apps/platform/src/color-theme";
import "../../app/apps/platform/src/data-builder.css";
import "./preview.css";

localStorage.setItem("thcpn.workspace.current","preview");
const client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity,retry:false}}});
client.setQueryData(["workspaces"],{items:[{workspace:{id:"preview",name:"交互预览"},membership:{role:"owner"}}]});
client.setQueryData(["workspace","preview","devices"],{items:[
  {id:"station",name:"示例森林监测站",serial_no:"DEMO-001",device_type:"standalone"},
  {id:"gateway",name:"示例组网站",serial_no:"DEMO-002",device_type:"gateway",source_family:"lorawan_v2"},
  {id:"carbon",name:"示例碳汇站",serial_no:"DEMO-003",device_type:"carbon_sink"},
]});
client.setQueryData(["workspace","preview","device-map","true"],{items:[]});
client.setQueryData(["device","gateway","nodes","export"],{items:[1,2,3].map(index=>({key:`node-${index}`,name:`样地节点 ${index}`,target:{kind:"gateway_node",gateway_device_id:"gateway",node_index:index}}))});
client.setQueryData(["carbon","carbon","overview"],{nodes_count:2,nodes:[{node_id:1,name:"样地一"},{node_id:2,name:"样地二"}]});
api.exports.create=async()=>{throw new Error("交互预览不创建真实任务");};
const history=new URLSearchParams(location.search).has("history");
const mockJobs={items:["running","failed"].map((status,index)=>({id:`preview-export-${index}`,workspace_id:"preview",requested_by:"preview",resource_type:"device",resource_id:"station",export_type:"standard_station_zip",status,created_at:"2026-10-20T02:15:53Z",updated_at:"2026-10-20T06:00:00Z",expires_at:"2026-10-23T02:15:53Z",request_config:{device_ids:["a","b","c"],start_time:"2026-08-20T00:00:00Z",end_time:"2026-10-20T00:00:00Z",include_data:false,include_images:true},progress:{stage:"packing",packed_images:1832,packed_bytes:875*1048576},error_message:status==="failed"?"导出执行中断或心跳超时，请重新创建任务":undefined}))};
client.setQueryData(["workspace","preview","exports","mine"],mockJobs);
api.exports.list=async()=>mockJobs as Awaited<ReturnType<typeof api.exports.list>>;
createRoot(document.getElementById("root")!).render(<I18nProvider><ColorThemeProvider><QueryClientProvider client={client}><WorkspaceProvider><MemoryRouter initialEntries={["/exports/new"]}>
  <div className="preview-note"><span>导出交互预览 · 模拟数据 · 不连接线上任务</span><LanguageSwitcher compact /></div>
  <main className="preview-export"><ExportsPage creating={!history} /></main>
</MemoryRouter></WorkspaceProvider></QueryClientProvider></ColorThemeProvider></I18nProvider>);
