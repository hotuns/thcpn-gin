import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { Alert, App, Button, Card, Checkbox, DatePicker, Descriptions, Drawer, Form, Input, Modal, Radio, Select, Space, Table, Tag, Typography } from "antd";
import { api, formatApiError, type ExportJob, type JsonRecord } from "@thcpn/api";
import { operationsExportPayload, opsTime, type OpsExportOptions } from "./admin-device-ops-model";

const labels:Record<string,string>={pending:"排队中",running:"生成中",success:"已完成",failed:"失败",expired:"已过期"};
const formats:Record<string,string>={standard_station_zip:"标准站 ZIP",group_site_zip:"组网站 ZIP",carbon_station_zip:"碳汇 ZIP",telemetry_excel:"Excel",telemetry_csv:"CSV",media_zip:"图片包",dataset_zip:"数据集 ZIP"};
const recentRange = (): [Dayjs,Dayjs] => [dayjs().subtract(7,"day"),dayjs()];

export function AdminExportsPage({ device }: {device?:JsonRecord}) {
  const {message}=App.useApp();
  const [open,setOpen]=useState(false);
  const [deviceId,setDeviceId]=useState(String(device?.id ?? ""));
  const [range,setRange]=useState<[Dayjs,Dayjs]|null>(recentRange);
  const [format,setFormat]=useState<OpsExportOptions["format"]>("zip");
  const [includeData,setIncludeData]=useState(true);
  const [includeImages,setIncludeImages]=useState(true);
  const [nodeKeys,setNodeKeys]=useState<string[]|null>(null);
  const [carbonNodes,setCarbonNodes]=useState<number[]|null>(null);
  const [fields,setFields]=useState<string[]>(["A","B","C","D"]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [status,setStatus]=useState<string>();
  const [detail,setDetail]=useState<ExportJob|null>(null);
  const devices=useQuery({queryKey:["admin","devices"],queryFn:api.admin.devices});
  const selected=device?.id===deviceId ? device : devices.data?.items.find(item=>item.id===deviceId);
  const gateway=selected?.device_type==="gateway";
  const carbon=selected?.device_type==="carbon_sink";
  const lora=selected?.source_family==="lorawan_v2";
  const nodes=useQuery({queryKey:["admin","device",deviceId,"nodes","exports"],queryFn:()=>api.admin.deviceNodes(deviceId),enabled:open&&gateway});
  const overview=useQuery({queryKey:["admin","device",deviceId,"carbon-overview"],queryFn:()=>api.admin.carbonOverview(deviceId),enabled:open&&carbon});
  const jobs=useQuery({queryKey:["admin","exports",device?.id??"all"],queryFn:()=>api.admin.exportJobs(device ? String(device.id) : undefined),refetchInterval:query=>query.state.data?.items.some(job=>job.status==="pending"||job.status==="running")?5000:false});
  useEffect(()=>{
    setNodeKeys(null); setCarbonNodes(null); setIncludeData(true);setIncludeImages(!lora);setFormat(selected?.device_type==="gateway_node"?"telemetry_excel":selected?.device_type==="camera"?"media_zip":"zip");
  },[deviceId,lora,selected?.device_type]);
  const nodeOptions=nodes.data?.items??[];
  const keys=nodeKeys??nodeOptions.map(node=>node.key);
  const allCarbonNodes=overview.data?.nodes.map(node=>Number(node.node_id))??[];
  const selectedCarbon=carbonNodes??allCarbonNodes;
  const rows=(jobs.data?.items??[]).filter(job=>!status||job.status===status);
  const targetError=carbon?overview.error:gateway&&format==="zip"?nodes.error:null;
  const targetLoading=carbon?overview.isLoading:gateway&&format==="zip"?nodes.isLoading:false;
  const names=useMemo(()=>new Map((devices.data?.items??[]).map(item=>[String(item.id),String(item.name||item.serial_no||item.id)])),[devices.data]);
  const taskName=(job:ExportJob)=>{
    const cfg=(job.request_config??{}) as JsonRecord;
    const ids=Array.isArray(cfg.device_ids)?cfg.device_ids as string[]:[job.resource_id];
    return String(cfg.gateway_name||ids.map(id=>names.get(id)||id).join("、"));
  };
  const create=async()=>{
    setError("");setBusy(true);
    try {
      if(!selected||!range) throw new Error("请选择设备和时间范围");
      const payload=operationsExportPayload(selected,{start:range[0].toISOString(),end:range[1].toISOString(),format,data:includeData,images:includeImages,nodes:nodeOptions.filter(node=>keys.includes(node.key)),carbonNodes:selectedCarbon,fields});
      await api.admin.createExport(payload);setOpen(false);void message.success("导出任务已创建，可在后台下载");await jobs.refetch();
    }catch(err){setError(formatApiError(err).message);}finally{setBusy(false);}
  };
  const download=async(job:ExportJob)=>{
    try {const result=await api.admin.exportDownload(job.id);window.open(result.url,"_blank","noopener,noreferrer");}catch(err){void message.error(formatApiError(err).message);}
  };
  return <Card title={device?"设备下载任务":"数据下载与导出"} extra={<Space><Button onClick={()=>void jobs.refetch()} loading={jobs.isFetching}>刷新</Button><Button type="primary" onClick={()=>{setError("");if(device)setDeviceId(String(device.id));setOpen(true);}}>新建导出</Button></Space>}>
    <Space style={{marginBottom:16}}><Select allowClear placeholder="全部状态" value={status} onChange={setStatus} style={{width:150}} options={Object.entries(labels).map(([value,label])=>({value,label}))}/><Typography.Text type="secondary">后台创建的任务仅管理员可见，不会出现在用户端；此处也可查看用户发起的任务。</Typography.Text></Space>
    {jobs.error&&<Alert type="error" title="导出任务读取失败" description={formatApiError(jobs.error).message}/>}
    <Table rowKey="id" size="small" loading={jobs.isLoading} dataSource={rows} pagination={{pageSize:20,showSizeChanger:true}} scroll={{x:1050}} columns={[
      {title:"设备 / 目标",render:(_,job)=><><Typography.Text strong>{taskName(job)}</Typography.Text><div><Typography.Text type="secondary">{formats[job.export_type]||job.export_type}</Typography.Text></div></>},
      {title:"发起方",width:100,render:(_,job)=><Tag color={(job as ExportJob&{requested_by_admin?:string}).requested_by_admin?"blue":"default"}>{(job as ExportJob&{requested_by_admin?:string}).requested_by_admin?"运维后台":"用户前端"}</Tag>},
      {title:"状态 / 进度",width:160,render:(_,job)=><><Tag color={job.status==="failed"?"red":job.status==="success"?"green":"default"}>{labels[job.status]}</Tag>{job.progress?.stage&&<div>{job.progress.stage==="uploading"?"上传中":"打包中"} · {job.progress.packed_images??0} 张</div>}</>},
      {title:"时间范围",width:210,render:(_,job)=>{const cfg=(job.request_config??{}) as JsonRecord;return <>{opsTime(String(cfg.start_time||""))}<div>至 {opsTime(String(cfg.end_time||""))}</div></>;}},
      {title:"创建时间",width:180,render:(_,job)=>opsTime(job.created_at)},
      {title:"操作",width:200,render:(_,job)=><Space><Button size="small" onClick={()=>setDetail(job)}>详情</Button><Button size="small" disabled={job.status!=="success"||Date.parse(job.expires_at)<=Date.now()} onClick={()=>void download(job)}>下载</Button>{job.status==="failed"&&job.resource_type!=="dataset"&&<Button size="small" onClick={()=>void api.admin.createExport({resource_type:job.resource_type,resource_id:job.resource_id,export_type:job.export_type,request_config:job.request_config??{}}).then(()=>jobs.refetch()).catch(err=>message.error(formatApiError(err).message))}>重新导出</Button>}</Space>},
    ]}/>
    <Modal title="新建后台导出" open={open} width={720} onCancel={()=>{if(!busy)setOpen(false);}} onOk={()=>void create()} confirmLoading={busy} okText="创建任务" okButtonProps={{disabled:!selected||targetLoading||!!targetError}} destroyOnHidden styles={{body:{maxHeight:"70vh",overflowY:"auto"}}}>
      <Form layout="vertical">
        <Alert type="info" title="仅后台可见" description="本任务不归属用户或工作区，用户端无法查看或下载。" style={{marginBottom:16}}/>
        {error&&<Alert type="error" title={error} style={{marginBottom:16}}/>}
        <Form.Item label="设备" required><Select showSearch optionFilterProp="label" value={deviceId||undefined} disabled={!!device} onChange={setDeviceId} options={(devices.data?.items??(device?[device]:[])).map(item=>({value:String(item.id),label:`${item.name} · ${item.serial_no}`}))}/></Form.Item>
        <Form.Item label="时间范围（北京时间）" required><DatePicker.RangePicker showTime value={range} onChange={value=>setRange(value&&value[0]&&value[1]?[value[0],value[1]]:null)} style={{width:"100%"}} presets={[{label:"最近 6 小时",value:[dayjs().subtract(6,"hour"),dayjs()]},{label:"最近 3 天",value:[dayjs().subtract(3,"day"),dayjs()]},{label:"最近 7 天",value:recentRange()}]}/></Form.Item>
        {!carbon&&<Form.Item label="文件类型"><Radio.Group value={format} onChange={event=>setFormat(event.target.value)} options={[...(["standalone","gateway"].includes(String(selected?.device_type))?[{value:"zip",label:"设备数据 / 图片 ZIP"}]:[]),{value:"telemetry_excel",label:"全部指标 Excel"},{value:"telemetry_csv",label:"全部指标 CSV"},...(!lora?[{value:"media_zip",label:"图片 ZIP"}]:[])]}/></Form.Item>}
        {gateway&&format==="zip"&&<Form.Item label="节点" required><Select mode="multiple" maxTagCount="responsive" showSearch optionFilterProp="label" value={keys} onChange={setNodeKeys} loading={nodes.isFetching} options={nodeOptions.map(node=>({value:node.key,label:node.name}))}/><Space><Button type="link" onClick={()=>setNodeKeys(null)}>全选</Button><Button type="link" onClick={()=>setNodeKeys([])}>清空</Button></Space></Form.Item>}
        {carbon&&<><Form.Item label="Node" required><Select mode="multiple" maxTagCount="responsive" value={selectedCarbon} onChange={setCarbonNodes} loading={overview.isFetching} options={(overview.data?.nodes??[]).map(node=>({value:Number(node.node_id),label:node.name||`Node ${node.node_id}`}))}/></Form.Item><Form.Item label="地块" required><Checkbox.Group value={fields} onChange={values=>setFields(values as string[])} options={["A","B","C","D"]}/></Form.Item></>}
        {(format==="zip"||carbon)&&<Form.Item label="打包内容" required><Space><Checkbox checked={includeData} onChange={event=>setIncludeData(event.target.checked)}>{carbon?"通量数据":"设备数据"}</Checkbox><Checkbox checked={includeImages} disabled={lora} onChange={event=>setIncludeImages(event.target.checked)}>{carbon?"原始采样":"采集图片"}</Checkbox></Space></Form.Item>}
        {(nodes.error||overview.error)&&<Alert type="error" title="导出目标加载失败" description={formatApiError(nodes.error||overview.error).message}/>}
        <Alert type="info" title="任务由后台异步生成，完成后在本页下载。较大的导出可关闭页面后回来查看。"/>
      </Form>
    </Modal>
    <Drawer title="导出任务详情" open={!!detail} width={720} onClose={()=>setDetail(null)}>
      {detail&&<><Descriptions column={1} bordered items={[{key:"id",label:"任务 ID",children:<Typography.Text copyable>{detail.id}</Typography.Text>},{key:"device",label:"设备",children:taskName(detail)},{key:"status",label:"状态",children:labels[detail.status]},{key:"error",label:"失败原因",children:detail.error_message||"—"},{key:"end",label:"完成时间",children:opsTime(detail.finished_at)},{key:"expiry",label:"下载到期",children:opsTime(detail.expires_at)}]}/><Typography.Title level={5}>设备 / 节点与导出参数</Typography.Title><Input.TextArea readOnly value={JSON.stringify(detail.request_config,null,2)} autoSize={{minRows:8,maxRows:22}}/></>}
    </Drawer>
  </Card>;
}
