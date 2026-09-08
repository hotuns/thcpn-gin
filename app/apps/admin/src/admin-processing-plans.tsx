import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from "@thcpn/admin-ui";
import { api, formatApiError, type ProcessingPlan, type ProcessingProcessor } from "@thcpn/api";
import { PageHeader, StateView } from "@thcpn/ui";
import { Plus, RefreshCw } from "lucide-react";

const statusLabel = { draft: "草稿", published: "已发布", disabled: "已停用" };
export function AdminProcessingPlansPage() {
  const client = useQueryClient(); const { message } = App.useApp(); const [editing,setEditing]=useState<ProcessingPlan|null|undefined>();
  const plans=useQuery({queryKey:["admin","processing-plans"],queryFn:api.admin.processingPlans.list});
  const processors=useQuery({queryKey:["admin","processing-processors"],queryFn:api.admin.processingPlans.processors});
  const refresh=()=>Promise.all([client.invalidateQueries({queryKey:["admin","processing-plans"]}),client.invalidateQueries({queryKey:["admin","processing-processors"]})]);
  const action=async(id:string,type:"publish"|"disable")=>{try{await api.admin.processingPlans[type](id);await refresh();void message.success(type==="publish"?"方案已发布":"方案已停用")}catch(error){void message.error(formatApiError(error).message)}};
  return <><PageHeader eyebrow="System / processing" title="数据处理方案" description="将代码层处理器配置为用户可使用的全平台业务方案。" actions={<Space><Button icon={<RefreshCw size={14}/>} onClick={()=>void refresh()}>同步处理器</Button><Button type="primary" icon={<Plus size={14}/>} onClick={()=>setEditing(null)}>新建方案</Button></Space>}/>
    <Card>{plans.isLoading?<StateView type="loading" title="正在加载处理方案" description=""/>:plans.error?<StateView type="error" title="处理方案加载失败" description={formatApiError(plans.error).message}/>:<Table rowKey="id" dataSource={plans.data?.items??[]} columns={[
      {title:"方案",render:(_,item)=><div><strong>{item.name}</strong><div className="cell-sub">{item.code} · v{item.current_version}{item.published_version?` / 已发布 v${item.published_version}`:""}</div></div>},
      {title:"处理器",render:(_,item)=><span>{item.processor_code}@{item.processor_version}</span>},
      {title:"状态",render:(_,item)=><Tag color={item.status==="published"?"green":item.status==="disabled"?"default":"gold"}>{statusLabel[item.status]}</Tag>},
      {title:"操作",render:(_,item)=><Space><Button size="small" onClick={()=>setEditing(item)}>编辑新版本</Button><Button size="small" type="primary" onClick={()=>void action(item.id,"publish")}>发布当前版本</Button>{item.status!=="disabled"&&<Button size="small" danger onClick={()=>void action(item.id,"disable")}>停用</Button>}</Space>},
    ]}/>}</Card>
    {editing!==undefined&&<PlanEditor item={editing} processors={processors.data?.items??[]} onClose={()=>setEditing(undefined)} onSaved={async()=>{setEditing(undefined);await refresh()}}/>}
  </>;
}

type ParameterDefinition = { type?: string; title?: string; description?: string; enum?: unknown[] };
type ParameterSchema = { properties?: Record<string, ParameterDefinition>; required?: string[] };

function PlanEditor({item,processors,onClose,onSaved}:{item:ProcessingPlan|null;processors:ProcessingProcessor[];onClose:()=>void;onSaved:()=>Promise<void>}){
  const {message}=App.useApp(); const [form]=Form.useForm(); const [busy,setBusy]=useState(false);
  const processorOptions=useMemo(()=>processors.filter(item=>item.enabled).map(item=>({value:`${item.code}@${item.version}`,label:`${item.name} · ${item.version}`})),[processors]);
  const initialProcessor=`${item?.processor_code??processors[0]?.code??""}@${item?.processor_version??processors[0]?.version??""}`;
  const [processorKey,setProcessorKey]=useState(initialProcessor);
  const processor=processors.find(value=>`${value.code}@${value.version}`===processorKey);
  const schema=(processor?.manifest?.parameters??{}) as ParameterSchema;
  const properties=schema.properties??{};
  const required=schema.required??[];
  const initial={code:item?.code??"",name:item?.name??"",description:item?.description??"",processor:initialProcessor,target_types:item?.target_types??["device"],parameters:item?.parameters??{}};
  const save=async()=>{const values=await form.validateFields();const [processor_code,processor_version]=values.processor.split("@");setBusy(true);try{const payload={code:values.code,name:values.name,description:values.description??"",processor_code,processor_version,parameters:values.parameters??{},trigger:{mode:"each_input"},target_types:values.target_types};if(item)await api.admin.processingPlans.update(item.id,payload);else await api.admin.processingPlans.create(payload);void message.success(item?"已创建方案新版本":"方案草稿已创建");await onSaved()}catch(error){void message.error(formatApiError(error).message)}finally{setBusy(false)}};
  return <Modal open title={item?`编辑方案：${item.name}`:"新建处理方案"} onCancel={onClose} onOk={()=>void save()} confirmLoading={busy} okText="保存草稿" width={720}><Form form={form} layout="vertical" initialValues={initial}><Form.Item name="name" label="方案名称" rules={[{required:true}]}><Input/></Form.Item><Form.Item name="code" label="方案编码" rules={[{required:true}]}><Input disabled={Boolean(item)}/></Form.Item><Form.Item name="description" label="方案说明"><Input.TextArea rows={2}/></Form.Item><Form.Item name="processor" label="代码处理器" rules={[{required:true}]}><Select options={processorOptions} onChange={(value)=>{setProcessorKey(value);form.setFieldValue("parameters",{})}}/></Form.Item><Form.Item name="target_types" label="适用目标" rules={[{required:true}]}><Select mode="multiple" options={[{value:"device",label:"设备"},{value:"site",label:"站点"}]}/></Form.Item><div className="section-label">运维固定参数</div>{Object.keys(properties).length===0?<div className="cell-sub">该处理器没有需要配置的固定参数。</div>:Object.entries(properties).map(([key,definition])=><Form.Item key={key} name={["parameters",key]} label={definition.title??key} extra={definition.description} rules={[{required:required.includes(key)}]}>{definition.enum?<Select options={definition.enum.map((value)=>({value,label:String(value)}))}/>:definition.type==="boolean"?<Select options={[{value:true,label:"是"},{value:false,label:"否"}]}/>:definition.type==="number"||definition.type==="integer"?<InputNumber precision={definition.type==="integer"?0:undefined} style={{width:"100%"}}/>:<Input/>}</Form.Item>)}</Form></Modal>;
}
