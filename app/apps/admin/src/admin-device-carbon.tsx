import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { Alert, App, Button, Card, DatePicker, Descriptions, Drawer, Segmented, Select, Space, Spin, Table, Tabs, Typography } from "antd";
import { api, formatApiError } from "@thcpn/api";
import { opsTime } from "./admin-device-ops-model";
import { carbonFluxCurves, carbonPhaseCurves } from "./admin-chart-model";
const AdminDataCharts = lazy(() => import("./admin-data-charts").then(module => ({default: module.AdminDataCharts})));

export function AdminDeviceCarbon({deviceId,onExport}:{deviceId:string;onExport:()=>void}) {
  const {message}=App.useApp();
  const [node,setNode]=useState<number>();
  const [field,setField]=useState("A");
  const [range,setRange]=useState<[Dayjs,Dayjs]|null>(()=>[dayjs().subtract(1,"day"),dayjs()]);
  const [applied,setApplied]=useState(()=>({start:dayjs().subtract(1,"day").toISOString(),end:dayjs().toISOString()}));
  const [period,setPeriod]=useState<string>();
  const [fluxView,setFluxView]=useState("chart");
  const overview=useQuery({queryKey:["admin","device",deviceId,"carbon-overview"],queryFn:()=>api.admin.carbonOverview(deviceId)});
  const nodeId=node??overview.data?.nodes[0]?.node_id;
  const flux=useQuery({queryKey:["admin","device",deviceId,"carbon-flux",nodeId,field,applied],queryFn:()=>api.admin.carbonFlux(deviceId,{node_id:nodeId!,field,...applied}),enabled:nodeId!=null});
  const periods=useQuery({queryKey:["admin","device",deviceId,"carbon-periods",nodeId,applied],queryFn:()=>api.admin.carbonPeriods(deviceId,{node_id:nodeId!,...applied}),enabled:nodeId!=null});
  const detail=useQuery({queryKey:["admin","device",deviceId,"carbon-period",nodeId,field,period],queryFn:()=>api.admin.carbonPeriod(deviceId,period!,{node_id:nodeId!,field}),enabled:!!period&&nodeId!=null});
  const fluxCurves=useMemo(()=>carbonFluxCurves(flux.data?.points??[]),[flux.data]);
  return <Card title="碳汇节点与采样数据" extra={<Button onClick={onExport}>导出通量与原始数据</Button>}>
    <Space wrap style={{marginBottom:16}}>
      <Select style={{width:240}} loading={overview.isLoading} value={nodeId} onChange={value=>{setNode(value);setPeriod(undefined);}} options={overview.data?.nodes.map(item=>({value:item.node_id,label:item.name||`Node ${item.node_id}`}))}/>
      <Select value={field} onChange={value=>{setField(value);setPeriod(undefined);}} style={{width:130}} options={["A","B","C","D"].map(value=>({value,label:`地块 ${value}`}))}/>
      <DatePicker.RangePicker value={range} showTime onChange={value=>setRange(value&&value[0]&&value[1]?[value[0],value[1]]:null)} presets={[1,3,7,30].map(days=>({label:`${days} 天`,value:[dayjs().subtract(days,"day"),dayjs()] as [Dayjs,Dayjs]}))}/>
      <Button type="primary" loading={flux.isFetching||periods.isFetching} onClick={()=>{if(!range||!range[1].isAfter(range[0])){void message.warning("请选择有效时间范围");return;}setApplied({start:range[0].toISOString(),end:range[1].toISOString()});}}>查询</Button>
    </Space>
    {[overview.error,flux.error,periods.error].filter(Boolean).map((error,index)=><Alert key={index} type="error" title="碳汇数据加载失败" description={formatApiError(error).message}/>)}
    <Tabs items={[
      {key:"flux",label:"通量数据",children:<Space orientation="vertical" style={{width:"100%"}} size="middle">
        <Segmented aria-label="通量展示方式" value={fluxView} onChange={setFluxView} options={[{value:"chart",label:"数据曲线"},{value:"table",label:"原始表格"}]}/>
        {fluxView==="chart"?<Suspense fallback={<Spin><div style={{height:280}}/></Spin>}><AdminDataCharts series={fluxCurves} loading={flux.isFetching}/></Suspense>:<Table rowKey={item=>`${item.period}:${item.field}`} size="small" dataSource={flux.data?.points??[]} loading={flux.isFetching} pagination={{pageSize:30,showSizeChanger:true}} columns={[
        {title:"采集周期（北京时间）",render:(_,point)=>opsTime(point.period_at)},
        {title:"地块",dataIndex:"field"},{title:"NEE",dataIndex:"nee"},{title:"ER",dataIndex:"er"},{title:"GPP",dataIndex:"gpp"},
        {title:"操作",render:(_,point)=><Button size="small" onClick={()=>setPeriod(point.period)}>查看原始采样</Button>},
      ]}/>}
      </Space>},
      {key:"periods",label:"采样周期",children:<Table rowKey="period" size="small" loading={periods.isFetching} dataSource={periods.data?.items??[]} pagination={{pageSize:30,showSizeChanger:true}} columns={[
        {title:"周期",render:(_,item)=>opsTime(item.period_at)},
        {title:"采样地块",render:(_,item)=>item.fields.join("、")},
        {title:"已有通量地块",render:(_,item)=>item.flux_fields.join("、")},
        {title:"操作",render:(_,item)=><Button size="small" disabled={!item.fields.includes(field)} onClick={()=>setPeriod(item.period)}>查看地块 {field}</Button>},
      ]}/>},
    ]}/>
    <Drawer width="85vw" title={`原始采样 · Node ${nodeId??""} · 地块 ${field}`} open={!!period} onClose={()=>setPeriod(undefined)}>
      {detail.error&&<Alert type="error" title="采样读取失败" description={formatApiError(detail.error).message}/>}
      {detail.data&&<><Descriptions bordered column={3} items={[{key:"time",label:"周期",children:opsTime(detail.data.period_at)},{key:"field",label:"地块",children:detail.data.field},{key:"count",label:"阶段",children:detail.data.phases.length}]}/>{detail.data.warnings?.map((warning,index)=><Alert key={index} type="warning" title={warning}/> )}</>}
      <Tabs items={(detail.data?.phases??[]).map((phase,index)=>({key:String(index),label:`${phase.room==="light"?"明室":phase.room==="black"?"暗室":phase.room} · ${phase.samples} 条`,children:<>
        {!phase.complete&&<Alert type="warning" title="该阶段数据不完整"/>}
        <Tabs items={[
          {key:"curve",label:"采样曲线",children:<Suspense fallback={<Spin><div style={{height:280}}/></Spin>}><AdminDataCharts series={carbonPhaseCurves(phase)} loading={detail.isFetching}/></Suspense>},
          {key:"table",label:"原始表格",children:<Table size="small" rowKey={(point,index)=>`${point.ts}:${index}`} loading={detail.isFetching} dataSource={phase.points} pagination={{pageSize:50,showSizeChanger:true}} scroll={{x:1500}} columns={[
          {title:"时间（北京时间）",dataIndex:"ts",width:200,fixed:"left",render:(value:string)=>opsTime(value)},
          ...[...new Set(phase.points.flatMap(point=>Object.keys(point)))].filter(key=>key!=="ts").map(key=>({title:key,dataIndex:key,width:130})),
        ]}/>}
        ]}/>
      </>}))}/>
      {detail.isFetching&&<Typography.Text>正在读取原始采样…</Typography.Text>}
    </Drawer>
  </Card>;
}
