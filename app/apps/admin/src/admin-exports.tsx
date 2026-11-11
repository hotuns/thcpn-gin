import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Card, Descriptions, Drawer, Input, Select, Space, Table, Tag, Typography } from "antd";
import { api, formatApiError, type ExportJob, type JsonRecord } from "@thcpn/api";
import { AdminExportCreate, exportDeviceName } from "./admin-export-create";
import { opsTime } from "./admin-device-ops-model";

const labels:Record<string,string>={pending:"排队中",running:"生成中",success:"已完成",failed:"失败",expired:"已过期"};
const formats:Record<string,string>={standard_station_zip:"标准站 ZIP",group_site_zip:"组网站 ZIP",carbon_station_zip:"碳汇 ZIP",telemetry_excel:"Excel",telemetry_csv:"CSV",media_zip:"图片包",dataset_zip:"数据集 ZIP"};
export function AdminExportsPage({ device }: {device?:JsonRecord}) {
  const {message}=App.useApp();
  const [open,setOpen]=useState(false);
  const [status,setStatus]=useState<string>();
  const [detail,setDetail]=useState<ExportJob|null>(null);
  const devices=useQuery({queryKey:["admin","devices"],queryFn:api.admin.devices});
  const jobs=useQuery({queryKey:["admin","exports",device?.id??"all"],queryFn:()=>api.admin.exportJobs(device ? String(device.id) : undefined),refetchInterval:query=>query.state.data?.items.some(job=>job.status==="pending"||job.status==="running")?5000:false});
  const rows=(jobs.data?.items??[]).filter(job=>!status||job.status===status);
  const names=useMemo(()=>new Map((devices.data?.items??[]).map(item=>[String(item.id),exportDeviceName(item)])),[devices.data]);
  const taskName=(job:ExportJob)=>{
    const cfg=(job.request_config??{}) as JsonRecord;
    const ids=Array.isArray(cfg.device_ids)?cfg.device_ids as string[]:[job.resource_id];
    return String(cfg.gateway_name||ids.map(id=>names.get(id)||id).join("、"));
  };
  const download=async(job:ExportJob)=>{
    try {const result=await api.admin.exportDownload(job.id);window.open(result.url,"_blank","noopener,noreferrer");}catch(err){void message.error(formatApiError(err).message);}
  };
  return <Card title={device?"设备下载任务":"数据下载与导出"} extra={<Space><Button onClick={()=>void jobs.refetch()} loading={jobs.isFetching}>刷新</Button><Button type="primary" onClick={()=>setOpen(true)}>新建导出</Button></Space>}>
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
    <AdminExportCreate open={open} onClose={()=>setOpen(false)} onCreated={()=>void jobs.refetch()} device={device}
      devices={devices.data?.items??[]} devicesLoading={devices.isLoading} devicesError={devices.error} reloadDevices={()=>void devices.refetch()}/>
    <Drawer title="导出任务详情" open={!!detail} width={720} onClose={()=>setDetail(null)}>
      {detail&&<><Descriptions column={1} bordered items={[{key:"id",label:"任务 ID",children:<Typography.Text copyable>{detail.id}</Typography.Text>},{key:"device",label:"设备",children:taskName(detail)},{key:"status",label:"状态",children:labels[detail.status]},{key:"error",label:"失败原因",children:detail.error_message||"—"},{key:"end",label:"完成时间",children:opsTime(detail.finished_at)},{key:"expiry",label:"下载到期",children:opsTime(detail.expires_at)}]}/><Typography.Title level={5}>设备 / 节点与导出参数</Typography.Title><Input.TextArea readOnly value={JSON.stringify(detail.request_config,null,2)} autoSize={{minRows:8,maxRows:22}}/></>}
    </Drawer>
  </Card>;
}
