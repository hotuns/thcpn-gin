import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Alert, App, Button, Card, Descriptions, Form, Image, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Typography, Upload } from "antd";
import { api, formatApiError, type DeviceProfileImage, type JsonRecord } from "@thcpn/api";
import { AdminNodeLocationEditor } from "./node-location-editor";
import { AdminNodeNameEditor } from "./node-name-editor";
import { invalidateNodeNames } from "@thcpn/workspace";
import { opsTime } from "./admin-device-ops-model";

export function AdminDeviceInstallation({device}:{device:JsonRecord}) {
  const id=String(device.id);
  const {message}=App.useApp();
  const client=useQueryClient();
  const [form]=Form.useForm();
  const [locationForm]=Form.useForm();
  const [busy,setBusy]=useState(false);
  const initialized=useRef(false);
  const [editing,setEditing]=useState<DeviceProfileImage|null>(null);
  const [caption,setCaption]=useState("");
  const profile=useQuery({queryKey:["admin","device",id,"profile"],queryFn:()=>api.admin.deviceProfile(id)});
  useEffect(()=>{
    if(profile.data&&!initialized.current){initialized.current=true;form.setFieldsValue({description:profile.data.description??"",location_text:profile.data.location_text??""});locationForm.setFieldsValue({latitude:profile.data.manual_latitude,longitude:profile.data.manual_longitude});}
  },[profile.data,form,locationForm]);
  const refresh=async()=>{await client.invalidateQueries({predicate:query=>query.queryKey.includes("admin")&&(query.queryKey.includes(id)||query.queryKey.includes("device-map"))});};
  const execute=async(action:()=>Promise<unknown>,text:string)=>{
    setBusy(true);try{await action();await refresh();void message.success(text);return true;}catch(error){void message.error(formatApiError(error).message);return false;}finally{setBusy(false);}
  };
  const reorder=(imageId:string,offset:number)=>{
    const ids=(profile.data?.images??[]).map(item=>item.id);const index=ids.indexOf(imageId),next=index+offset;
    if(index<0||next<0||next>=ids.length)return;
    [ids[index],ids[next]]=[ids[next],ids[index]];
    void execute(()=>api.admin.reorderDeviceImages(id,ids),"图片顺序已保存");
  };
  return <Space orientation="vertical" size="middle" style={{width:"100%"}}>
    {profile.error?<Alert type="error" title="安装资料读取失败" description={formatApiError(profile.error).message}/>:<>
      {profile.data?.location_warning&&<Alert type="warning" title={profile.data.location_warning}/>}
      <Tabs items={[{key:"location",label:"位置与说明",children:<Space orientation="vertical" style={{width:"100%"}}>
      <Card title="安装说明" loading={profile.isLoading}>
        <Form form={form} layout="vertical" onFinish={values=>void execute(()=>api.admin.updateDeviceProfile(id,values),"安装资料已保存")}>
          <Form.Item name="description" label="设备描述 / 安装说明"><Input.TextArea rows={3} maxLength={4000} showCount/></Form.Item>
          <Form.Item name="location_text" label="安装地点"><Input placeholder="例如样地编号、立杆位置或安装地址" maxLength={500}/></Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>保存资料</Button>
        </Form>
      </Card>
      <Card title="安装坐标（WGS84）" loading={profile.isLoading}>
        <Descriptions size="small" column={2} style={{marginBottom:16}} items={[
          {key:"effective",label:"当前生效坐标",children:profile.data?.effective_location?`${profile.data.effective_location.longitude??"—"}, ${profile.data.effective_location.latitude??"—"}`:"未定位"},
          {key:"source",label:"位置来源",children:({device:"人工安装位置",source:"设备源数据",site:"关联站点",none:"未设置"} as Record<string,string>)[profile.data?.location_source??"none"]},
        ]}/>
        <Form form={locationForm} layout="inline" onFinish={values=>void execute(()=>api.admin.setDeviceLocation(id,values),"安装坐标已保存，地图已更新")}>
          <Form.Item name="longitude" label="经度" rules={[{required:true},{type:"number",min:-180,max:180}]}><InputNumber min={-180} max={180} precision={7}/></Form.Item>
          <Form.Item name="latitude" label="纬度" rules={[{required:true},{type:"number",min:-90,max:90}]}><InputNumber min={-90} max={90} precision={7}/></Form.Item>
          <Form.Item><Space><Button type="primary" htmlType="submit" loading={busy}>保存坐标</Button><Button disabled={busy||profile.data?.manual_latitude==null} onClick={()=>Modal.confirm({title:"清除人工安装坐标？",content:"地图将恢复使用设备源数据或关联站点位置。",onOk:async()=>{if(await execute(()=>api.admin.setDeviceLocation(id,{latitude:null,longitude:null}),"人工坐标已清除"))locationForm.resetFields();}})}>恢复默认位置</Button></Space></Form.Item>
        </Form>
        <Typography.Paragraph type="secondary" style={{marginTop:12,marginBottom:0}}>人工安装坐标优先用于平台地图，不改变设备上报的原始位置。</Typography.Paragraph>
      </Card>
      </Space>},{key:"classification",label:"观测资料",children:<AdminDeviceClassification deviceId={id}/>},{key:"photos",label:`安装照片（${profile.data?.images.length??0}）`,children:<Card title={`安装照片 · ${profile.data?.images.length??0} / 12`} extra={<Upload multiple showUploadList={false} accept="image/jpeg,image/png,image/webp" disabled={busy} beforeUpload={file=>{if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>10*1024*1024){void message.error("请选择不超过 10 MB 的 JPEG、PNG 或 WebP 图片");return Upload.LIST_IGNORE;}return true;}} customRequest={options=>{void api.admin.uploadDeviceImages(id,[options.file as File]).then(async response=>{options.onSuccess?.(response);await refresh();}).catch(error=>{options.onError?.(error);void message.error(formatApiError(error).message);});}}><Button>上传安装照片</Button></Upload>}>
        <Image.PreviewGroup><Table rowKey="id" size="small" dataSource={profile.data?.images??[]} pagination={false} columns={[
          {title:"图片",width:150,render:(_,item)=><Image width={120} height={80} style={{objectFit:"cover"}} src={item.preview_url}/>},
          {title:"说明",render:(_,item)=><>{item.is_cover&&<Tag color="blue">封面</Tag>}{item.caption||item.original_filename}</>},
          {title:"操作",render:(_,item,index)=><Space wrap><Button size="small" disabled={busy} onClick={()=>{setEditing(item);setCaption(item.caption??"");}}>编辑说明</Button><Button size="small" disabled={busy||item.is_cover} onClick={()=>void execute(()=>api.admin.updateDeviceImage(id,item.id,{is_cover:true}),"封面已更新")}>设为封面</Button><Button size="small" disabled={busy||index===0} onClick={()=>reorder(item.id,-1)}>前移</Button><Button size="small" disabled={busy||index===(profile.data?.images.length??0)-1} onClick={()=>reorder(item.id,1)}>后移</Button><Button size="small" danger disabled={busy} onClick={()=>Modal.confirm({title:"删除安装照片？",okButtonProps:{danger:true},onOk:()=>execute(()=>api.admin.deleteDeviceImage(id,item.id),"照片已删除")})}>删除</Button></Space>},
        ]}/></Image.PreviewGroup>
      </Card>}]}/>
    </>}
    <Modal title="编辑安装照片说明" open={!!editing} onCancel={()=>setEditing(null)} confirmLoading={busy} onOk={()=>{if(editing)void execute(()=>api.admin.updateDeviceImage(id,editing.id,{caption}),"说明已保存").then(success=>{if(success)setEditing(null);});}}><Input.TextArea rows={3} value={caption} onChange={event=>setCaption(event.target.value)} maxLength={500}/></Modal>
  </Space>;
}

export function AdminDeviceNodes({device,onData,onTopology}:{device:JsonRecord;onData:(key:string)=>void;onTopology?:()=>void}) {
  const id=String(device.id);
  const client=useQueryClient();
  const [readRuntime,setReadRuntime]=useState(false);
  const nodes=useQuery({queryKey:["admin","device",id,"nodes","operations"],queryFn:()=>api.admin.deviceNodes(id)});
  const runtime=useQuery({queryKey:["admin","device",id,"nodes","runtime"],queryFn:()=>api.admin.nodeRuntime(id),enabled:readRuntime});
  return (
    <Card title="节点管理" extra={<Space>{onTopology&&<Button onClick={onTopology}>管理拓扑</Button>}<Button loading={runtime.isFetching} onClick={()=>{setReadRuntime(true);if(readRuntime)void runtime.refetch();}}>读取节点最新状态</Button></Space>}>
      {(nodes.error||runtime.error)&&<Alert type="error" title="节点读取失败" description={formatApiError(nodes.error||runtime.error).message}/>}
      <Table rowKey="key" size="small" loading={nodes.isLoading} dataSource={nodes.data?.items??[]} pagination={{pageSize:20,showSizeChanger:true}} scroll={{x:1000}} columns={[
        {title:"节点",render:(_,node)=><Space><Typography.Text strong>{node.name}</Typography.Text><AdminNodeNameEditor name={node.custom_name} allowEmpty={node.target.kind!=="device"} onSave={async name=>{if(node.target.kind==="gateway_node")await api.admin.renameNode(id,node.target.node_index,name);else await api.admin.updateDevice(node.target.device_id,{name});await invalidateNodeNames(client);}}/></Space>},
        {title:"指标",width:75,render:(_,node)=>node.streams.length},
        {title:"最新状态",render:(_,node)=>{const state=runtime.data?.items.find(item=>item.key===node.key);return state?.error?<Tag color="red">{state.error}</Tag>:state?<Space orientation="vertical" size={0}><span>电压 {state.battery??"—"} V · 信号 {state.rssi??"—"}</span><Typography.Text type="secondary">{opsTime(state.sampled_at)}</Typography.Text></Space>:"点击读取最新状态";}},
        {title:"位置",render:(_,node)=>node.longitude!=null?`${node.longitude}, ${node.latitude}`:"未登记"},
        {title:"操作",render:(_,node)=><Space><Button size="small" onClick={()=>onData(node.key)}>查看数据</Button>{node.target.kind==="gateway_node"?<AdminNodeLocationEditor deviceId={id} node={node}/>:<Button size="small"><Link to={`/admin/devices/${node.target.device_id}`}>节点资料</Link></Button>}</Space>},
      ]}/>
    </Card>
  );
}

function AdminDeviceClassification({deviceId}:{deviceId:string}) {
  const {message}=App.useApp();
  const [form]=Form.useForm();
  const [busy,setBusy]=useState(false);
  const data=useQuery({queryKey:["admin","device",deviceId,"environment"],queryFn:()=>api.admin.deviceEnvironment(deviceId)});
  const catalog=useQuery({queryKey:["admin","device-taxonomy"],queryFn:api.admin.deviceTaxonomy});
  const fields=[{value:"ecosystem",label:"设备类型"},{value:"observation_objects",label:"观测对象"},{value:"purposes",label:"观测用途"},{value:"management",label:"管理方式"},{value:"deployment",label:"部署方式"},{value:"commissioned_year",label:"投运年份"},{value:"research_tags",label:"研究标签"}];
  const overridden=Form.useWatch("overridden_fields",form) as string[]|undefined;
  useEffect(()=>{if(data.data){const direct=data.data.direct;form.setFieldsValue({overridden_fields:data.data.overridden_fields,ecosystem_term_id:direct.ecosystem?.id,observation_object_ids:direct.observation_objects.map(term=>term.id),purpose_ids:direct.purposes.map(term=>term.id),management_term_id:direct.management?.id,deployment_term_id:direct.deployment?.id,commissioned_year:direct.commissioned_year,research_tags:direct.research_tags});}},[data.data,form]);
  const options=(kind:string)=>(catalog.data?.items??[]).filter(term=>term.kind===kind&&term.status==="active").map(term=>({value:term.id,label:term.name_zh}));
  return <Card title="观测资料与分类" loading={data.isLoading||catalog.isLoading}>
    {(data.error||catalog.error)?<Alert type="error" title="分类读取失败" description={formatApiError(data.error||catalog.error).message}/>:<Form form={form} layout="vertical" onFinish={async values=>{setBusy(true);try{await api.admin.updateDeviceEnvironment(deviceId,{...values,ecosystem_term_id:values.ecosystem_term_id??null,management_term_id:values.management_term_id??null,deployment_term_id:values.deployment_term_id??null,commissioned_year:values.commissioned_year??null,observation_object_ids:values.observation_object_ids??[],purpose_ids:values.purpose_ids??[],research_tags:values.research_tags??[],overridden_fields:values.overridden_fields??[]});await data.refetch();void message.success("观测资料已保存");}catch(error){void message.error(formatApiError(error).message);}finally{setBusy(false);}}}>
      <Form.Item name="overridden_fields" label="为此设备单独设置的字段" extra="未选字段沿用网关或站点的观测资料。"><Select mode="multiple" options={fields}/></Form.Item>
      <Space align="start" wrap style={{width:"100%"}}>
        <Form.Item name="ecosystem_term_id" label="设备类型"><Select disabled={!overridden?.includes("ecosystem")} allowClear style={{width:200}} options={options("ecosystem")}/></Form.Item>
        <Form.Item name="observation_object_ids" label="观测对象"><Select disabled={!overridden?.includes("observation_objects")} mode="multiple" style={{width:260}} options={options("observation_object")}/></Form.Item>
        <Form.Item name="purpose_ids" label="观测用途"><Select disabled={!overridden?.includes("purposes")} mode="multiple" style={{width:260}} options={options("purpose")}/></Form.Item>
        <Form.Item name="management_term_id" label="管理方式"><Select disabled={!overridden?.includes("management")} allowClear style={{width:200}} options={options("management")}/></Form.Item>
        <Form.Item name="deployment_term_id" label="部署方式"><Select disabled={!overridden?.includes("deployment")} allowClear style={{width:200}} options={options("deployment")}/></Form.Item>
        <Form.Item name="commissioned_year" label="投运年份"><InputNumber disabled={!overridden?.includes("commissioned_year")} min={1900} max={2100}/></Form.Item>
      </Space>
      <Form.Item name="research_tags" label="研究标签"><Select mode="tags" disabled={!overridden?.includes("research_tags")}/></Form.Item>
      <Button type="primary" htmlType="submit" loading={busy}>保存观测资料</Button>
    </Form>}
  </Card>;
}
