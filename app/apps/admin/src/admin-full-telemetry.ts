import { api } from "@thcpn/api";

type Input = Parameters<typeof api.admin.queryDeviceTelemetry>[1];
export async function adminFullTelemetry(deviceId:string, input:Input):Promise<Awaited<ReturnType<typeof api.admin.queryDeviceTelemetry>>> {
  const result=await api.admin.queryDeviceTelemetry(deviceId,input);
  if(!result.series.some(series=>!series.complete&&!series.error))return result;
  const start=Date.parse(input.startTime),end=Date.parse(input.endTime);
  if(end-start<=2000)throw new Error("查询已拆分至 2 秒，仍无法获取完整记录，请使用后台导出获取数据");
  const middle=new Date(Math.floor((start+end)/2000)*1000).toISOString();
  const left=await adminFullTelemetry(deviceId,{...input,endTime:middle});
  const right=await adminFullTelemetry(deviceId,{...input,startTime:middle});
  return {...result,series:left.series.map(series=>{
    const other=right.series.find(item=>item.data_stream_id===series.data_stream_id);
    if(!other)return series;
    const points=[...new Map([...series.points,...other.points].map(point=>[point.ts,point])).values()].sort((a,b)=>Date.parse(a.ts)-Date.parse(b.ts));
    return {...series,points,sampled:false,complete:series.complete&&other.complete,returned_count:points.length,error:series.error||other.error,warnings:[...(series.warnings??[]),...(other.warnings??[])]};
  })};
}
