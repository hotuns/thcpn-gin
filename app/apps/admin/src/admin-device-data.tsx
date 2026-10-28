import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { Alert, App, Button, Card, DatePicker, Descriptions, Empty, Image, Modal, Segmented, Select, Space, Spin, Table, Tabs, Tag, Typography } from "antd";
import { api, formatApiError, type GatewayNode, type JsonRecord, type MediaItem } from "@thcpn/api";
import { operationsStreams, opsTime, telemetryRows } from "./admin-device-ops-model";

const AdminDataCharts = lazy(() => import("./admin-data-charts").then(module => ({default: module.AdminDataCharts})));

export function AdminDeviceData({device,nodeKey,onNodeChange,onExport}:{device:JsonRecord;nodeKey:string;onNodeChange:(key:string)=>void;onExport:()=>void}) {
  const {message}=App.useApp();
  const id=String(device.id);
  const gateway=device.device_type==="gateway";
  const lora=device.source_family==="lorawan_v2";
  const [range,setRange]=useState<[Dayjs,Dayjs]|null>(()=>[dayjs().subtract(lora?6:24,"hour"),dayjs()]);
  const [applied,setApplied]=useState(()=>({startTime:dayjs().subtract(lora?6:24,"hour").toISOString(),endTime:dayjs().toISOString()}));
  const [selection,setSelection]=useState<{target:string;ids:string[]}|null>(null);
  const [tab,setTab]=useState("telemetry");
  const [view,setView]=useState("chart");
  const [page,setPage]=useState(1);
  const [mediaStream,setMediaStream]=useState<string>();
  const nodes=useQuery({queryKey:["admin","device",id,"nodes","operations"],queryFn:()=>api.admin.deviceNodes(id),enabled:gateway});
  const node=nodes.data?.items.find(item=>item.key===nodeKey);
  const targetId=node?.target.kind==="device"?node.target.device_id:id;
  const streams=useQuery({queryKey:["admin","device",targetId,"data-streams"],queryFn:()=>api.admin.deviceDataStreams(targetId)});
  const active=useMemo(()=>operationsStreams(streams.data?.items??[],nodes.data?.items??[],node),[streams.data,nodes.data,node]);
  const ids=(selection?.target===`${id}:${nodeKey}`?selection.ids:active.map(stream=>stream.id)).filter(id=>active.some(stream=>stream.id===id));
  const telemetry=useQuery({queryKey:["admin","device",targetId,"operations-telemetry",ids.join(","),applied],queryFn:()=>api.admin.queryDeviceTelemetry(targetId,{...applied,dataStreamIds:ids}),enabled:tab==="telemetry"&&ids.length>0&&(!gateway||!nodes.isLoading)});
  const chartSeries=useMemo(()=>(telemetry.data?.series??[]).map(series=>({id:series.data_stream_id,name:series.name,code:series.code,unit:series.unit,points:series.points})),[telemetry.data]);
  const rows=useMemo(()=>telemetryRows(telemetry.data?.series??[]),[telemetry.data]);
  const media=useQuery({queryKey:["admin","device",targetId,"operations-media",applied,page,mediaStream],queryFn:()=>api.admin.deviceMedia(targetId,{start_time:applied.startTime,end_time:applied.endTime,page,page_size:20,media_type:"image",...(mediaStream?{data_stream_id:mediaStream}:{})}),enabled:tab==="images"&&!lora});
  const apply=()=>{
    if(!range||!range[1].isAfter(range[0])) {void message.warning("请选择有效的时间范围");return;}
    const next={startTime:range[0].toISOString(),endTime:range[1].toISOString()};
    setPage(1);
    if(next.startTime===applied.startTime&&next.endTime===applied.endTime)void(tab==="telemetry"?telemetry.refetch():media.refetch());
    else setApplied(next);
  };
  const mediaDownload=async(item:MediaItem)=>{
    if(!item.download_url)return;
    try{const result=await api.admin.downloadMedia(item.download_url);window.open(result.url,"_blank","noopener,noreferrer");}catch(err){void message.error(formatApiError(err).message);}
  };
  const removeImage=(item:MediaItem)=>Modal.confirm({title:"删除这张采集图片？",content:"这会删除源图片文件，无法撤销。",okText:"删除图片",okButtonProps:{danger:true},onOk:async()=>{if(!item.delete_url)return;await api.admin.deleteMedia(item.delete_url);await media.refetch();}});
  const loading=streams.isLoading||nodes.isLoading;
  const errors=[streams.error,nodes.error,telemetry.error].filter(Boolean);
  const pointWarnings=(telemetry.data?.series??[]).flatMap(series=>series.warnings?.map(warning=>`${series.name}：${warning.message}`)??[]);
  const partial=telemetry.data?.series.some(series=>!series.complete);
  return <Card title="设备与节点数据" extra={<Button onClick={onExport}>导出与下载任务</Button>}>
    <Space wrap align="end" style={{marginBottom:16,width:"100%"}}>
      {gateway&&<Space orientation="vertical"><Typography.Text>查询节点</Typography.Text><Select value={nodeKey} style={{width:260}} showSearch optionFilterProp="label" loading={nodes.isFetching} onChange={key=>{onNodeChange(key);setPage(1);setMediaStream(undefined);}} options={[{value:"",label:"网关自身"},...(nodes.data?.items??[]).map(item=>({value:item.key,label:item.name}))]}/></Space>}
      <Space orientation="vertical"><Typography.Text>时间范围（北京时间）</Typography.Text><DatePicker.RangePicker showTime value={range} style={{width:420}} onChange={value=>setRange(value&&value[0]&&value[1]?[value[0],value[1]]:null)} presets={[6,24,72,168].map(hours=>({label:hours<24?`${hours} 小时`:`${hours/24} 天`,value:[dayjs().subtract(hours,"hour"),dayjs()] as [Dayjs,Dayjs]}))}/></Space>
      <Button type="primary" onClick={apply} loading={telemetry.isFetching||media.isFetching}>查询 / 刷新</Button>
    </Space>
    <Tabs activeKey={tab} onChange={setTab} items={[
      {key:"telemetry",label:"指标数据",children:<Space orientation="vertical" style={{width:"100%"}} size="middle">
        <Select mode="multiple" showSearch optionFilterProp="label" placeholder="选择数据指标" style={{width:"100%"}} maxTagCount="responsive" value={ids} onChange={values=>setSelection({target:`${id}:${nodeKey}`,ids:values})} loading={loading} options={active.map(stream=>({value:stream.id,label:`${stream.name} · ${stream.code}${stream.unit?` (${stream.unit})`:""}`}))}/>
        <Space><Button size="small" onClick={()=>setSelection(null)}>全选指标</Button><Button size="small" onClick={()=>setSelection({target:`${id}:${nodeKey}`,ids:[]})}>清空</Button><Typography.Text type="secondary">按原始记录查询，每个指标最多 5,000 条；更大范围使用后台导出。</Typography.Text></Space>
        {errors.map((error,index)=><Alert key={index} type="error" title="数据查询失败" description={formatApiError(error).message}/>)}
        {(telemetry.data?.series??[]).filter(series=>series.error).map(series=><Alert key={series.data_stream_id} type="error" title={series.name} description={series.error}/>)}
        {partial&&<Alert type="warning" title="当前结果未完整覆盖全部记录，请创建后台导出获取完整数据。"/>}
        {pointWarnings.length>0&&<Alert type="warning" title="记录解析提示" description={pointWarnings.map((item,index)=><div key={index}>{item}</div>)}/>}
        <Segmented aria-label="指标展示方式" value={view} onChange={setView} options={[{value:"chart",label:"数据曲线"},{value:"table",label:"原始表格"}]}/>
        {view==="chart"?<Suspense fallback={<Spin tip="正在加载图表组件…"><div style={{height:280}}/></Spin>}><AdminDataCharts series={chartSeries} loading={loading||telemetry.isFetching}/></Suspense>:<>
        <Table size="small" rowKey="data_stream_id" loading={loading||telemetry.isFetching} dataSource={telemetry.data?.series??[]} pagination={false} scroll={{x:800}} columns={[
          {title:"指标",render:(_,series)=><><Typography.Text strong>{series.name}</Typography.Text><div>{series.code}{series.unit?` · ${series.unit}`:""}</div></>},
          {title:"记录数",render:(_,series)=>series.points.length},
          {title:"最近值",render:(_,series)=>series.points.at(-1)?.value??"—"},
          {title:"最小 / 最大",render:(_,series)=>series.points.length?`${Math.min(...series.points.map(point=>point.value))} / ${Math.max(...series.points.map(point=>point.value))}`:"—"},
          {title:"最近采集时间",render:(_,series)=>opsTime(series.points.at(-1)?.ts)},
        ]}/>
        {!loading&&!active.length?<Empty description="当前设备或节点没有数值指标，请检查源配置并同步平台配置"/>:<Table size="small" loading={telemetry.isFetching} rowKey="key" dataSource={rows} pagination={{pageSize:50,showSizeChanger:true,showTotal:total=>`${total} 个采集时刻`}} scroll={{x:Math.max(800,ids.length*170+210)}} columns={[
          {title:"采集时间（北京时间）",dataIndex:"timestamp",width:210,fixed:"left",render:(timestamp:string)=>opsTime(timestamp)},
          ...active.filter(stream=>ids.includes(stream.id)).map(stream=>({title:`${stream.name}${stream.unit?` (${stream.unit})`:""}`,dataIndex:stream.id,width:170,render:(value:unknown)=>value==null?"—":String(value)})),
        ]}/>}
        </>}
      </Space>},
      {key:"images",label:"采集图片",children:lora?<Empty description="LoRa V2 索引节点没有采集图片"/>:<Space orientation="vertical" style={{width:"100%"}} size="middle">
        <Select allowClear placeholder="全部图片通道" style={{width:300}} value={mediaStream} onChange={value=>{setMediaStream(value);setPage(1);}} options={(streams.data?.items??[]).filter(stream=>stream.type==="image").map(stream=>({value:stream.id,label:stream.name}))}/>
        {media.error&&<Alert type="error" title="图片查询失败" description={formatApiError(media.error).message}/>}
        <Image.PreviewGroup><Table size="small" rowKey={item=>`${item.data_stream_id}:${item.id}`} dataSource={media.data?.items??[]} loading={media.isFetching} pagination={{current:page,pageSize:20,total:media.data?.total??0,showSizeChanger:false,onChange:setPage,showTotal:total=>`${total} 张`}} columns={[
          {title:"图片",width:180,render:(_,item)=><Image width={140} height={90} style={{objectFit:"cover"}} src={item.thumbnail_url||item.preview_url} preview={{src:item.preview_url}}/>},
          {title:"通道",render:(_,item)=>streams.data?.items.find(stream=>stream.id===item.data_stream_id)?.name??item.data_stream_id},
          {title:"采集时间（北京时间）",render:(_,item)=>opsTime(item.captured_at)},
          {title:"操作",width:210,render:(_,item)=><Space><Button size="small" disabled={!item.download_url} onClick={()=>void mediaDownload(item)}>下载原图</Button><Button size="small" danger disabled={!item.delete_url} onClick={()=>removeImage(item)}>删除</Button></Space>},
        ]}/></Image.PreviewGroup>
      </Space>},
    ]}/>
  </Card>;
}
