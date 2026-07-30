import { useMemo, useState } from "react";
import type { Key } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag, message } from "antd";
import { MapPin, Plus, RefreshCw, Tags } from "lucide-react";
import { api, formatApiError, type DeviceMapItem, type DeviceTaxonomyTerm, type JsonRecord } from "@thcpn/api";
import { DeviceMap } from "@thcpn/device-map";
import { PageHeader, Panel, StateView } from "@thcpn/ui";

const kinds = [
  ["ecosystem", "生态类型"], ["observation_object", "观测对象"], ["purpose", "观测用途"], ["management", "管理方式"], ["deployment", "部署环境"],
] as const;
const name = (term?: DeviceTaxonomyTerm) => term?.name_zh ?? "未分类";

export function AdminDeviceInsightsPage() {
  const client = useQueryClient();
  const [includeChildren, setIncludeChildren] = useState(false);
  const [ecosystem, setEcosystem] = useState<string>();
  const [purpose, setPurpose] = useState<string>();
  const [selected, setSelected] = useState<Key[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [termOpen, setTermOpen] = useState<DeviceTaxonomyTerm | "new" | null>(null);
  const mapQuery = useQuery({ queryKey: ["admin", "device-map", includeChildren], queryFn: () => api.admin.deviceMap(includeChildren) });
  const catalogQuery = useQuery({ queryKey: ["admin", "device-taxonomy"], queryFn: api.admin.deviceTaxonomy });
  const terms = catalogQuery.data?.items ?? [];
  const options = (kind: string) => terms.filter((term) => term.kind === kind && term.status === "active").map((term) => ({ value: term.id, label: term.name_zh }));
  const rows = useMemo(() => (mapQuery.data?.items ?? []).filter((item) => (!ecosystem || item.environment.ecosystem?.id === ecosystem) && (!purpose || item.environment.purposes.some((term) => term.id === purpose))), [mapQuery.data, ecosystem, purpose]);
  const stats = { total: rows.length, located: rows.filter((item) => item.latitude !== undefined).length, unlocated: rows.filter((item) => item.latitude === undefined).length, unclassified: rows.filter((item) => !item.environment.ecosystem).length };
  return <>
    <PageHeader eyebrow="Assets / geography" title="设备地图与分类" description="按生态类型、观测对象和用途统计设备资产，并查看精确空间分布。" actions={<Button icon={<RefreshCw size={14} />} onClick={() => void Promise.all([mapQuery.refetch(), catalogQuery.refetch()])}>刷新</Button>} />
    <div className="device-insight-stats">{[["设备",stats.total],["已定位",stats.located],["未定位",stats.unlocated],["未分类",stats.unclassified]].map(([label,value])=><Panel key={label}><span>{label}</span><strong>{value}</strong></Panel>)}</div>
    <Panel className="device-insight-panel">
      <Tabs items={[
        { key:"map", label:<span><MapPin size={14}/>地图与统计</span>, children:<><div className="device-insight-toolbar"><Select allowClear placeholder="全部生态类型" value={ecosystem} options={options("ecosystem")} onChange={setEcosystem}/><Select allowClear placeholder="全部观测用途" value={purpose} options={options("purpose")} onChange={setPurpose}/><label><Switch checked={includeChildren} onChange={setIncludeChildren}/> 显示子节点</label>{selected.length ? <Button type="primary" onClick={()=>setBulkOpen(true)}>批量设置 {selected.length} 台</Button>:null}</div>{mapQuery.isLoading?<StateView type="loading" title="正在加载设备地图" description="正在计算有效位置和分类。"/>:mapQuery.error?<StateView type="error" title="设备地图加载失败" description={formatApiError(mapQuery.error).message}/>:<><DeviceMap height={480} styleUrl={import.meta.env.VITE_MAP_STYLE_URL} points={rows.map(mapPoint)} onSelect={(id)=>window.location.assign(`/admin/devices/${id}`)}/><Table rowKey="device_id" size="small" rowSelection={{selectedRowKeys:selected,onChange:setSelected}} dataSource={rows} pagination={{pageSize:20,showSizeChanger:true}} columns={[{title:"设备",render:(_,item)=><div><strong>{item.name}</strong><div className="cell-sub mono">{item.serial_no}</div></div>},{title:"生态类型",width:110,render:(_,item)=>name(item.environment.ecosystem)},{title:"用途",render:(_,item)=><Space size={2} wrap>{item.environment.purposes.map((term)=><Tag key={term.id}>{term.name_zh}</Tag>)}</Space>},{title:"位置",width:110,render:(_,item)=>item.latitude!==undefined?<Tag color="green">{locationLabel(item.location_source)}</Tag>:<Tag>未定位</Tag>},{title:"状态",width:90,dataIndex:"status"}]}/></>}</> },
        { key:"catalog", label:<span><Tags size={14}/>分类目录</span>, children:<><div className="device-insight-toolbar"><span>系统预置编码保持稳定；词条可改名、排序或停用。</span><Button type="primary" icon={<Plus size={14}/>} onClick={()=>setTermOpen("new")}>新增词条</Button></div><Table rowKey="id" size="small" dataSource={terms} pagination={{pageSize:30}} columns={[{title:"类别",width:120,render:(_,term)=>kinds.find(([kind])=>kind===term.kind)?.[1]??term.kind},{title:"编码",dataIndex:"code",width:190,className:"mono"},{title:"中文",dataIndex:"name_zh"},{title:"英文",dataIndex:"name_en"},{title:"状态",width:80,render:(_,term)=><Tag color={term.status==="active"?"green":"default"}>{term.status==="active"?"启用":"停用"}</Tag>},{title:"操作",width:80,render:(_,term)=><Button type="link" size="small" onClick={()=>setTermOpen(term)}>编辑</Button>}]}/></> }
      ]}/>
    </Panel>
    <BulkEnvironmentModal open={bulkOpen} deviceIds={selected.map(String)} terms={terms} onClose={()=>setBulkOpen(false)} onSaved={async()=>{setBulkOpen(false);setSelected([]);await client.invalidateQueries({queryKey:["admin","device-map"]});}}/>
    <TermModal value={termOpen} onClose={()=>setTermOpen(null)} onSaved={async()=>{setTermOpen(null);await client.invalidateQueries({queryKey:["admin","device-taxonomy"]});}}/>
  </>;
}

function BulkEnvironmentModal({open,deviceIds,terms,onClose,onSaved}:{open:boolean;deviceIds:string[];terms:DeviceTaxonomyTerm[];onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [form]=Form.useForm(); const mutation=useMutation({mutationFn:(values:JsonRecord)=>api.admin.bulkUpdateDeviceEnvironment({device_ids:deviceIds,attributes:{...values,overridden_fields:["ecosystem","observation_objects","purposes","management","deployment","commissioned_year","research_tags"]}}),onSuccess:async(result)=>{void message.success(`已更新 ${result.updated??0} 台设备`);await onSaved();},onError:(error)=>void message.error(formatApiError(error).message)});
  const options=(kind:string)=>terms.filter((term)=>term.kind===kind&&term.status==="active").map((term)=>({value:term.id,label:term.name_zh}));
  return <Modal title={`批量设置设备属性 · ${deviceIds.length} 台`} open={open} onCancel={onClose} okText="应用设置" confirmLoading={mutation.isPending} onOk={()=>void form.validateFields().then((values)=>mutation.mutate(values))} destroyOnHidden><Form form={form} layout="vertical"><Form.Item name="ecosystem_term_id" label="生态类型"><Select allowClear options={options("ecosystem")}/></Form.Item><Form.Item name="observation_object_ids" label="观测对象"><Select mode="multiple" options={options("observation_object")}/></Form.Item><Form.Item name="purpose_ids" label="观测用途"><Select mode="multiple" options={options("purpose")}/></Form.Item><div className="drawer-grid"><Form.Item name="management_term_id" label="管理方式"><Select allowClear options={options("management")}/></Form.Item><Form.Item name="deployment_term_id" label="部署环境"><Select allowClear options={options("deployment")}/></Form.Item></div><Form.Item name="commissioned_year" label="投运年份"><InputNumber min={1900} max={2200} style={{width:"100%"}}/></Form.Item><Form.Item name="research_tags" label="研究标签"><Select mode="tags" tokenSeparators={[","]}/></Form.Item></Form></Modal>;
}

function TermModal({value,onClose,onSaved}:{value:DeviceTaxonomyTerm|"new"|null;onClose:()=>void;onSaved:()=>Promise<void>}) { const [form]=Form.useForm(); const mutation=useMutation({mutationFn:(payload:JsonRecord)=>api.admin.upsertDeviceTaxonomy(payload),onSuccess:onSaved,onError:(error)=>void message.error(formatApiError(error).message)}); const open=Boolean(value); return <Modal title={value==="new"?"新增分类词条":"编辑分类词条"} open={open} onCancel={onClose} confirmLoading={mutation.isPending} onOk={()=>void form.validateFields().then((fields)=>mutation.mutate({...fields,id:value!=="new"?value?.id:undefined}))} afterOpenChange={(opened)=>opened&&form.setFieldsValue(value==="new"?{status:"active",sort_order:100}:value??{})} destroyOnHidden><Form form={form} layout="vertical"><Form.Item name="kind" label="类别" rules={[{required:true}]}><Select disabled={value!=="new"} options={kinds.map(([value,label])=>({value,label}))}/></Form.Item><Form.Item name="code" label="稳定编码" rules={[{required:true}]}><Input disabled={value!=="new"}/></Form.Item><div className="drawer-grid"><Form.Item name="name_zh" label="中文名称" rules={[{required:true}]}><Input/></Form.Item><Form.Item name="name_en" label="英文名称" rules={[{required:true}]}><Input/></Form.Item></div><div className="drawer-grid"><Form.Item name="status" label="状态"><Select options={[{value:"active",label:"启用"},{value:"inactive",label:"停用"}]}/></Form.Item><Form.Item name="sort_order" label="排序"><InputNumber style={{width:"100%"}}/></Form.Item></div></Form></Modal> }
function mapPoint(item:DeviceMapItem){return{device_id:item.device_id,name:item.name,device_type:item.device_type,status:item.status,latitude:item.latitude,longitude:item.longitude,child_count:item.child_count,ecosystem:item.environment.ecosystem?.name_zh,purposes:item.environment.purposes.map((term)=>term.name_zh)}}
function locationLabel(source:string){return source==="device"?"设备定位":source==="site"?"站点定位":source==="gateway"?"网关定位":"未定位"}
