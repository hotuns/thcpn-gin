import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, DatePicker, Descriptions, Form, Input, Modal, Select, Space } from "antd";
import dayjs from "dayjs";
import { api, formatApiError } from "@thcpn/api";

export function AdminDeviceDossier({ deviceId }: { deviceId: string }) {
 const client=useQueryClient(); const {message}=App.useApp(); const [form]=Form.useForm(); const [busy,setBusy]=useState(false);
 const data=useQuery({queryKey:["admin","device",deviceId,"installation"],queryFn:()=>api.admin.deviceInstallation(deviceId)});
 useEffect(()=>{if(data.data)form.setFieldsValue({...data.data,installed_on:data.data.installed_on?dayjs(data.data.installed_on):null});},[data.data,form]);
 const save=async(complete:boolean)=>{
  const values=await form.validateFields();
  if(complete&&values.observation_mode==="custom"&&!values.observation_start_at){form.setFields([{name:"observation_start_at",errors:["请选择正式观测起始时间"]}]);return;}
  if(complete&&!values.installed_on){form.setFields([{name:"installed_on",errors:["请选择安装日期"]}]);return;}
  const perform=async()=>{setBusy(true);try{await api.admin.saveDeviceInstallation(deviceId,{...values,installed_on:values.installed_on?.format("YYYY-MM-DD")??null,complete_installation:complete,observation_start_at:complete&&values.observation_mode==="custom"?values.observation_start_at?.toISOString():undefined});await client.invalidateQueries({queryKey:["admin"]});void message.success(complete?"安装已完成，设备进入运行中":"安装档案已保存");}catch(error){void message.error(formatApiError(error).message);}finally{setBusy(false);}};
  if(complete)Modal.confirm({title:"确认完成安装？",content:"保存安装档案并将生命周期设为运行中。安装人自动记录当前管理员账号；同时登记正式观测起始时间，用于排除安装前调试数据。",onOk:perform});else await perform();
 };
 return <Card title="安装与交付档案" loading={data.isLoading}>
  {data.error?<Alert type="error" title="安装档案读取失败" description={formatApiError(data.error).message}/>:<>
  <Descriptions size="small" column={2} items={[{key:"installer",label:"安装人",children:data.data?.installer_name||"保存安装日期后自动记录当前账号"},{key:"updated",label:"最近修改",children:data.data?.updated_at?dayjs(data.data.updated_at).format("YYYY-MM-DD HH:mm"):"—"},{key:"retired",label:"退役日期",children:data.data?.retired_on||"—"},{key:"retirement",label:"退役原因",children:data.data?.retirement_reason||"—"}]}/>
  <Form form={form} layout="vertical" disabled={busy} style={{marginTop:20}}>
   <div className="drawer-grid"><Form.Item name="installed_on" label="安装日期"><DatePicker style={{width:"100%"}}/></Form.Item><Form.Item name="organization" label="所属单位"><Input maxLength={200}/></Form.Item></div>
   <div className="drawer-grid"><Form.Item name="contact_name" label="联系人"><Input maxLength={200}/></Form.Item><Form.Item name="contact_phone" label="联系电话"><Input maxLength={200}/></Form.Item></div>
   <Form.Item name="project_name" label="项目名称" extra="已关联项目时，统一展示关联项目名称；未关联时可填写。"><Input maxLength={200}/></Form.Item>
   <Form.Item name="ops_tags" label="运维标签" extra="仅后台可见，不影响用户标签。"><Select mode="tags" tokenSeparators={[",","，"]} maxCount={30}/></Form.Item>
   <Form.Item name="observation_mode" label="完成安装时开始正式观测" initialValue="now"><Select options={[{value:"now",label:"从完成安装时开始（已有分界则保留）"},{value:"custom",label:"指定正式观测起始时间"}]}/></Form.Item>
   <Form.Item noStyle shouldUpdate={(previous,next)=>previous.observation_mode!==next.observation_mode}>{({getFieldValue})=>getFieldValue("observation_mode")==="custom"?<Form.Item name="observation_start_at" label="正式观测起始时间（北京时间）"><DatePicker showTime style={{width:"100%"}}/></Form.Item>:null}</Form.Item>
   <Space><Button type="primary" loading={busy} onClick={()=>void save(false).catch(()=>{})}>保存档案</Button><Button loading={busy} onClick={()=>void save(true).catch(()=>{})}>完成安装</Button></Space>
  </Form></>}
 </Card>;
}

export function AdminDeviceScenes({deviceId}:{deviceId:string}){
 const client=useQueryClient();const {message}=App.useApp();const [form]=Form.useForm();const [busy,setBusy]=useState(false);
 const data=useQuery({queryKey:["admin","device",deviceId,"environment"],queryFn:()=>api.admin.deviceEnvironment(deviceId)});
 const catalog=useQuery({queryKey:["admin","device-taxonomy"],queryFn:api.admin.deviceTaxonomy});
 const independent=Form.useWatch("independent",form);
 useEffect(()=>{if(data.data)form.setFieldsValue({independent:["purposes","ecosystem","observation_objects"].some(field=>data.data!.overridden_fields.includes(field)),purpose_ids:data.data.effective.purposes.map(t=>t.id),ecosystem_term_id:data.data.effective.ecosystem?.id,observation_object_ids:data.data.effective.observation_objects.map(t=>t.id)});},[data.data,form]);
 const options=(kind:string)=>(catalog.data?.items??[]).filter(term=>term.kind===kind&&term.status==="active").map(term=>({value:term.id,label:term.name_zh}));
 return <Card title="应用场景与观测分类" loading={data.isLoading||catalog.isLoading}>
 {data.error||catalog.error?<Alert type="error" title="分类读取失败" description={formatApiError(data.error||catalog.error).message}/>:<Form form={form} layout="vertical" onFinish={async values=>{if(!data.data)return;setBusy(true);try{const old=data.data.direct;const keys=["purposes","ecosystem","observation_objects"];await api.admin.updateDeviceEnvironment(deviceId,{purpose_ids:values.purpose_ids??[],ecosystem_term_id:values.ecosystem_term_id??null,observation_object_ids:values.observation_object_ids??[],management_term_id:old.management?.id??null,deployment_term_id:old.deployment?.id??null,commissioned_year:old.commissioned_year??null,research_tags:old.research_tags,overridden_fields:[...data.data.overridden_fields.filter(k=>!keys.includes(k)),...(values.independent?keys:[])]});await client.invalidateQueries({queryKey:["admin","device"]});void message.success("应用场景已保存");}catch(error){void message.error(formatApiError(error).message);}finally{setBusy(false);}}}>
 <Form.Item name="independent" label="分类来源"><Select options={[{value:false,label:"沿用网关／站点资料"},{value:true,label:"为此设备单独设置"}]}/></Form.Item>
 <Form.Item name="purpose_ids" label="应用场景"><Select mode="multiple" disabled={!independent} options={options("purpose")}/></Form.Item>
 <Form.Item name="ecosystem_term_id" label="生态分类（可选）"><Select allowClear disabled={!independent} options={options("ecosystem")}/></Form.Item>
 <Form.Item name="observation_object_ids" label="观测对象（可选）"><Select mode="multiple" disabled={!independent} options={options("observation_object")}/></Form.Item>
 <Button type="primary" htmlType="submit" loading={busy}>保存分类</Button>
 </Form>}
 </Card>;
}
