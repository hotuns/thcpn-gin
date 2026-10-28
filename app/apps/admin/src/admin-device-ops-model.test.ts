import { describe,it,expect } from "vitest";
import type { GatewayNode, TelemetrySeries, DataStream } from "@thcpn/api";
import { operationsExportPayload,operationsStreams,telemetryRows } from "./admin-device-ops-model";

const options={start:"2026-10-01T00:00:00Z",end:"2026-10-02T00:00:00Z",format:"zip" as const,data:true,images:false,nodes:[],carbonNodes:[],fields:[]};
describe("administrator device operations",()=>{
  it("exports an unassigned standard station without inventing a user or workspace",()=>{
    const result=operationsExportPayload({id:"station",device_type:"standalone"},options);
    expect(result).toMatchObject({resource_id:"station",resource_type:"device_batch",request_config:{device_ids:["station"],include_data:true,include_images:false}});
    expect(result).not.toHaveProperty("workspace_id");expect(result).not.toHaveProperty("requested_by");
  });
  it("keeps LoRa indexed targets attached to their gateway identity",()=>{
    const nodes=[{key:"n100",target:{kind:"gateway_node",gateway_device_id:"gateway",node_index:100}}] as GatewayNode[];
    const result=operationsExportPayload({id:"gateway",name:"LoRa",device_type:"gateway",source_family:"lorawan_v2"},{...options,nodes});
    expect(result).toMatchObject({resource_id:"gateway",request_config:{device_ids:["gateway"],gateway_id:"gateway",node_targets:[nodes[0].target]}});
    expect(()=>operationsExportPayload({id:"gateway",device_type:"gateway",source_family:"lorawan_v2"},{...options,nodes,images:true})).toThrow("不支持图片");
  });
  it("validates node, content and date selections before creating a job",()=>{
    expect(()=>operationsExportPayload({id:"g",device_type:"gateway"},options)).toThrow("节点");
    expect(()=>operationsExportPayload({id:"s",device_type:"standalone"},{...options,data:false,images:false})).toThrow("至少选择");
    expect(()=>operationsExportPayload({id:"s",device_type:"standalone"},{...options,end:options.start})).toThrow("时间范围");
  });
  it("preserves carbon Node x plot and raw phase choices",()=>{
    expect(operationsExportPayload({id:"carbon",device_type:"carbon_sink"},{...options,carbonNodes:[2],fields:["C"],images:true})).toMatchObject({export_type:"carbon_station_zip",request_config:{node_ids:[2],fields:["C"],include_flux:true,include_raw_samples:true}});
  });
  it("does not mix node streams into the gateway's own diagnostics",()=>{
    const stream=(id:string)=>({id,type:"telemetry",status:"active"}) as DataStream;
    const node={streams:[stream("node-metric")]} as GatewayNode;
    expect(operationsStreams([stream("gateway-battery"),stream("node-metric")],[node]).map(item=>item.id)).toEqual(["gateway-battery"]);
    expect(operationsStreams([], [node],node).map(item=>item.id)).toEqual(["node-metric"]);
  });
  it("aligns equivalent timestamps without resampling or hiding missing values",()=>{
    const series=[{data_stream_id:"a",points:[{ts:"2026-10-01T08:00:00+08:00",value:1},{ts:"2026-10-01T00:01:00Z",value:2}]},{data_stream_id:"b",points:[{ts:"2026-10-01T00:00:00Z",value:3}]}] as TelemetrySeries[];
    const rows=telemetryRows(series);expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({a:1,b:3});expect(rows[1]).not.toHaveProperty("b");
  });
});
