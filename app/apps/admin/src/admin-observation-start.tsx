import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, DatePicker, Form, Input, Modal, Select, Space, Table, Typography } from "antd";
import dayjs from "dayjs";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { opsTime } from "./admin-device-ops-model";

export function AdminObservationStart({device}:{device:JsonRecord}){
 const id=String(device.id);const client=useQueryClient();const {message}=App.useApp();const [form]=Form.useForm();const [target,setTarget]=useState("default");const [busy,setBusy]=useState(false);
 const nodes=useQuery({queryKey:["admin","device",id,"nodes","observation"],queryFn:()=>api.admin.deviceNodes(id),enabled:device.device_type==="gateway"});
 const carbon=useQuery({queryKey:["admin","device",id,"carbon-overview"],queryFn:()=>api.admin.carbonOverview(id),enabled:device.device_type==="carbon_sink"});
 const choices=useMemo(()=>[{value:"default",label:"设备默认",deviceId:id,index:0},...(nodes.data?.items??[]).map(node=>({value:node.key,label:node.name,deviceId:node.target.kind==="device"?node.target.device_id:id,index:node.target.kind==="gateway_node"?node.target.node_index:0})),...(carbon.data?.nodes??[]).map(node=>({value:`carbon:${node.node_id}`,label:node.name,deviceId:id,index:node.node_id}))],[id,nodes.data,carbon.data]);
 const selected=choices.find(choice=>choice.value===target)??choices[0];
 const key=["admin","device",selected.deviceId,"observation-start",selected.index];
 const query=useQuery({queryKey:key,queryFn:()=>api.admin.observationStarts(selected.deviceId,selected.index)});
 const current=query.data?.items.find(item=>item.node_index===selected.index);
 const inherited=selected.index>0?query.data?.items.find(item=>item.node_index===0):undefined;
 useEffect(()=>{form.setFieldsValue({starts_at:current?dayjs(current.starts_at):null,reason:""});},[current?.starts_at,selected.index,selected.deviceId,form]);
 const save=async(clear=false)=>{
  const values=clear?{}:await form.validateFields();
  Modal.confirm({title:clear?"清除正式观测分界？":"确认调整正式观测起始时间？",content:clear?"节点将沿用设备默认时间；设备默认也未设置时，将不再按观测阶段划分数据。原始数据保留。":"此时间之前视为调试数据，用户端查询、统计和导出默认从此时间开始。已有原始数据不会删除。",okText:"确认保存",onOk:async()=>{setBusy(true);try{await api.admin.setObservationStart(selected.deviceId,{node_index:selected.index,starts_at:clear?null:values.starts_at.toISOString(),reason:values.reason?.trim()||(clear?"清除分界":"人工设置正式观测起始时间")});await client.invalidateQueries({queryKey:["admin"]});void message.success("正式观测起始时间已更新");}catch(error){void message.error(formatApiError(error).message);}finally{setBusy(false);}}});
 };
 return <Card title="正式观测起始时间" loading={query.isLoading}>
 {(query.error||nodes.error||carbon.error)?<Alert type="error" title="观测分界读取失败" description={formatApiError(query.error||nodes.error||carbon.error).message}/>:<Space orientation="vertical" style={{width:"100%"}} size="middle">
 {choices.length>1&&<Select aria-label="观测分界目标" style={{width:"100%"}} value={target} onChange={setTarget} options={choices}/>}
 <Typography.Text>{current?`当前分界：${opsTime(current.starts_at)}`:inherited?`沿用设备默认：${opsTime(inherited.starts_at)}`:"尚未设置分界，现有数据不区分调试与正式阶段"}</Typography.Text>
 <Form form={form} layout="vertical" disabled={busy} onFinish={()=>void save().catch(()=>{})}>
  <Form.Item name="starts_at" label="正式观测起始时间（北京时间）" rules={[{required:true,message:"请选择正式观测起始时间"}]}><DatePicker showTime style={{width:"100%"}}/></Form.Item>
  <Form.Item name="reason" label="登记／调整原因"><Input.TextArea maxLength={500} rows={2}/></Form.Item>
  <Space wrap><Button type="primary" htmlType="submit" loading={busy}>保存分界时间</Button><Button disabled={busy} onClick={()=>form.setFieldValue("starts_at",dayjs())}>使用当前时间</Button>{current&&<Button danger disabled={busy} onClick={()=>void save(true)}>清除分界</Button>}</Space>
 </Form>
 <Table size="small" rowKey={(_,index)=>String(index)} pagination={{pageSize:5}} dataSource={(query.data?.history??[]).filter(item=>item.node_index===selected.index)} columns={[{title:"起始时间",render:(_,item)=>item.starts_at?opsTime(item.starts_at):"已清除"},{title:"操作人",dataIndex:"actor"},{title:"原因",dataIndex:"reason"},{title:"登记时间",render:(_,item)=>opsTime(item.created_at)}]}/>
 </Space>}
 </Card>;
}
