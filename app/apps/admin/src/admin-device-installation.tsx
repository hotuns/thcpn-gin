import { AdminNodeStatus } from "./runtime-status";
import { isMeasurement, nodeStatusKeys, statusMetrics, statusValue } from "@thcpn/api";
import { AdminObservationStart } from "./admin-observation-start";
import { AdminDeviceDossier, AdminDeviceScenes } from "./admin-device-dossier";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Alert, App, Button, Card, Checkbox, Col, Row, Descriptions, Drawer, Form, Image, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Typography, Upload } from "antd";
import { api, formatApiError, type DeviceProfileImage, type GatewayNode, type JsonRecord } from "@thcpn/api";
import { AdminNodeLocationEditor } from "./node-location-editor";
import { AdminNodeNameEditor } from "./node-name-editor";
import { GatewayNodeActions } from "./gateway-node-actions";
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
    <AdminDeviceDossier deviceId={id}/>
    <AdminObservationStart device={device}/>
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
      </Space>},{key:"classification",label:"应用场景",children:<AdminDeviceScenes deviceId={id}/>},{key:"photos",label:`安装照片（${profile.data?.images.length??0}）`,children:<Card title={`安装照片 · ${profile.data?.images.length??0} / 12`} extra={<Upload multiple showUploadList={false} accept="image/jpeg,image/png,image/webp" disabled={busy} beforeUpload={file=>{if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>10*1024*1024){void message.error("请选择不超过 10 MB 的 JPEG、PNG 或 WebP 图片");return Upload.LIST_IGNORE;}return true;}} customRequest={options=>{void api.admin.uploadDeviceImages(id,[options.file as File]).then(async response=>{options.onSuccess?.(response);await refresh();}).catch(error=>{options.onError?.(error);void message.error(formatApiError(error).message);});}}><Button>上传安装照片</Button></Upload>}>
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

export function AdminDeviceNodes({device,onData,onTopology,onConfig,onHistory,compact=false}:{device:JsonRecord;onData:(key:string)=>void;onTopology?:()=>void;onConfig?:(index:number,kind?:"sensor"|"time")=>void;onHistory?:()=>void;compact?:boolean}) {
  const id=String(device.id), lora=device.source_family==="lorawan_v2";
  const client=useQueryClient();
  const [readRuntime,setReadRuntime]=useState(false);
  const [statusPage,setStatusPage]=useState(1);
  const [pageSize,setPageSize]=useState(20);
  const [search,setSearch]=useState("");
  const [detailKey,setDetailKey]=useState<string|null>(null);
  const nodes=useQuery({queryKey:["admin","device",id,"nodes","operations"],queryFn:async()=>{if(lora)await api.admin.physicalNodes(id);return api.admin.deviceNodes(id);}});
  const rows=nodes.data?.items??[];
  const detail=rows.find(node=>node.key===detailKey);
  const visible=rows.filter(n=>[n.name,n.node_sn,n.target.kind==="gateway_node"?String(n.target.node_index):""].some(v=>v?.toLowerCase().includes(search.toLowerCase())));
  const page=Math.min(statusPage,Math.max(1,Math.ceil(visible.length/pageSize)));
  const currentNodes=visible.slice((page-1)*pageSize,page*pageSize);
  const indices=currentNodes.flatMap(node=>node.target.kind==="gateway_node"?[node.target.node_index]:[]);
  const runtime=useQuery({queryKey:["admin","device",id,"nodes","runtime",lora?indices.join(","):"all"],queryFn:()=>api.admin.nodeRuntime(id,lora?indices:undefined),enabled:lora?indices.length>0:readRuntime,staleTime:Infinity,refetchOnWindowFocus:false,refetchOnMount:"always",retry:false});
  const positions=<Space orientation="vertical" size="middle" style={{width:"100%"}}>
    <Space wrap style={{justifyContent:"space-between",width:"100%"}}>
      <Space><Input.Search aria-label="搜索节点" placeholder={lora?"名称、SN 或序号":"搜索节点名称"} allowClear value={search} onChange={e=>{setSearch(e.target.value);setStatusPage(1);}} style={{width:280}}/>
</Space>
      <Button disabled={lora&&!indices.length} loading={runtime.isFetching} onClick={()=>{setReadRuntime(true);if(lora||readRuntime)void runtime.refetch();}}>{lora?"刷新状态":"读取电量与信号"}</Button>
    </Space>

    {(nodes.error||runtime.error)&&<Alert type="error" title="节点读取失败" description={formatApiError(nodes.error||runtime.error).message}/>}
    <Table<GatewayNode> rowKey="key" size="middle" loading={nodes.isLoading} dataSource={visible} pagination={{current:page,pageSize,showSizeChanger:true,onChange:(page,size)=>{setStatusPage(page);setPageSize(size);}}} scroll={{x:compact?760:1000}} locale={{emptyText:compact?"暂无节点":lora?"暂无节点，请添加节点。":"暂无关联节点，请管理网关拓扑。"}} columns={[
      {title:"节点",render:(_,node)=><Space orientation="vertical" size={0}><Typography.Text strong>{node.name}</Typography.Text>{lora&&<Typography.Text>SN {node.node_sn}</Typography.Text>}{node.target.kind==="gateway_node"&&<Typography.Text type="secondary">序号 {node.target.node_index}</Typography.Text>}</Space>},

      {title:"指标",width:75,render:(_,node)=>node.streams.filter(isMeasurement).length},
      {title:lora?"节点状态":"电量 / 信号",width:lora?300:undefined,render:(_,node)=>{if(lora&&compact){const reading=runtime.data?.items.find(item=>item.key===node.key);return <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:"8px 16px"}}>{nodeStatusKeys.map(key=><div key={key}><Typography.Text type="secondary" style={{fontSize:12}}>{statusMetrics[key].label}</Typography.Text><div>{runtime.isFetching?"…":runtime.error||reading?.error?"—":statusValue(key,reading?.[key as "battery"|"rssi"|"snr"|"sd_card_rate"])}</div></div>)}</div>;}if(lora)return <AdminNodeStatus deviceId={id} node={node} reading={runtime.data?.items.find(item=>item.key===node.key)} loading={runtime.isFetching} error={runtime.error?formatApiError(runtime.error).message:undefined}/>;const state=runtime.data?.items.find(item=>item.key===node.key);return state?.error?<Tag color="red">读取失败</Tag>:state?<Space orientation="vertical" size={0}><span>{state.battery??"—"} V · {state.rssi??"—"}</span><Typography.Text type="secondary">{opsTime(state.sampled_at)}</Typography.Text></Space>:"尚未读取";}},
      {title:"状态更新时间",render:(_,node)=>opsTime(runtime.data?.items.find(item=>item.key===node.key)?.sampled_at)},
      {title:"经纬度",hidden:compact,render:(_,node)=>node.longitude!=null?`${node.longitude}, ${node.latitude}`:"未设置"},
      {title:"操作",hidden:compact,render:(_,node)=><Space wrap><Button size="small" onClick={()=>onData(node.key)}>查看数据</Button>{node.target.kind==="gateway_node"?<GatewayNodeActions deviceId={id} node={node} onDetails={()=>setDetailKey(node.key)} onConfig={onConfig?(index,kind)=>onConfig(index,kind):undefined}/>:<Button size="small"><Link to={`/admin/devices/${node.target.device_id}`}>设备资料</Link></Button>}</Space>},
    ]}/>
  </Space>;
  const toolbar=<Space wrap>{lora&&<><GatewayNodeActions deviceId={id}/>{onHistory&&<Button onClick={onHistory}>历史数据</Button>}<Button onClick={()=>void nodes.refetch()} loading={nodes.isFetching}>刷新节点</Button><Button><Link to={`/admin/devices?kind=node_v2&gateway=${id}`}>节点v2库存</Link></Button></>}{onTopology&&<Button onClick={onTopology}>管理拓扑</Button>}</Space>;
  return <Space orientation="vertical" size="middle" style={{width:"100%"}}>
    {compact?<><Space wrap style={{justifyContent:"space-between",width:"100%"}}><Typography.Text strong>节点 · {visible.length} 个</Typography.Text></Space>{positions}</>:<Card title={lora?"节点管理":"THCPN · 组网节点"} extra={toolbar}>{positions}</Card>}
    <Drawer title="节点资料" open={!!detail} onClose={()=>setDetailKey(null)} size={560}>
      {detail&&<Space orientation="vertical" size="large" style={{width:"100%"}}>{lora&&<AdminNodeStatus showTime deviceId={id} node={detail} reading={runtime.data?.items.find(item=>item.key===detail.key)} loading={runtime.isFetching}/>}<Descriptions column={1} bordered items={[
        {key:"name",label:"节点名称",children:<Space>{detail.name}<AdminNodeNameEditor name={detail.custom_name} allowEmpty onSave={async name=>{if(detail.target.kind==="gateway_node")await api.admin.renameNode(id,detail.target.node_index,name);await invalidateNodeNames(client);setDetailKey(null);}}/></Space>},
        {key:"index",label:"序号",children:detail.target.kind==="gateway_node"?detail.target.node_index:"—"},
        {key:"sn",label:"节点 SN",children:detail.node_sn||"未绑定"},
        {key:"gateway",label:"所属网关",children:`${device.name} · ${device.serial_no}`},
        {key:"location",label:"安装坐标",children:<Space>{detail.longitude!=null?`${detail.longitude}, ${detail.latitude}`:"未设置"}<AdminNodeLocationEditor deviceId={id} node={detail}/></Space>},
      ]}/>
        <Space><Button type="primary" onClick={()=>{onData(detail.key);setDetailKey(null);}}>查看节点数据</Button>{onConfig&&detail.bound&&detail.target.kind==="gateway_node"&&<Button onClick={()=>{if(detail.target.kind==="gateway_node")onConfig(detail.target.node_index);setDetailKey(null);}}>编辑采集配置</Button>}</Space>
      </Space>}
    </Drawer>
  </Space>;
}
