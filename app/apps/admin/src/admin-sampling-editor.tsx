import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Descriptions, Form, InputNumber, Modal, Select, Space } from "antd";
import { api, formatApiError } from "@thcpn/api";

export function AdminSamplingEditor({deviceId,carbon=false}:{deviceId:string;carbon?:boolean}) {
  const {message}=App.useApp();
  const client=useQueryClient();
  const [form]=Form.useForm();
  const [busy,setBusy]=useState(false);
  const query=useQuery({queryKey:["admin","device",deviceId,"sampling-profile"],queryFn:()=>api.admin.samplingProfile(deviceId)});
  const mode=Form.useWatch("mode",form);
  useEffect(()=>{if(query.data)form.setFieldsValue(query.data);},[query.data,form]);
  const options=(max:number)=>Array.from({length:max},(_,value)=>({value,label:String(value)}));
  const save=(values:Record<string,unknown>)=>Modal.confirm({title:"保存并提交采集计划？",content:"将修改当前设备的采集与上传时刻。请在保存后核对设备上报时间确认实际执行情况。",onOk:async()=>{
    setBusy(true);
    try{
      const current=query.data!;
      const result=await api.admin.updateSamplingProfile(deviceId,{...current,...values,expected_config_id:current.external_config_id,image_minute:values.image_minute??current.image_minute??0,image_upload_minute:values.image_upload_minute??current.image_upload_minute??0,image_hours:values.image_hours??(current.image_hours.length?current.image_hours:[0]),image_upload_hours:values.image_upload_hours??(current.image_upload_hours.length?current.image_upload_hours:[0])});
      for(const warning of result.warnings??[])void message.warning(warning.message);
      await client.invalidateQueries({predicate:q=>q.queryKey.includes("admin")&&q.queryKey.includes(deviceId)});
      void message.success("采集计划已保存，请核对设备后续上报");
    }catch(error){void message.error(formatApiError(error).message);throw error;}finally{setBusy(false);}
  }});
  return <Card title="采集与上传计划" loading={query.isLoading}>
    {query.error?<Alert type="error" title="采集计划读取失败" description={formatApiError(query.error).message}/>:<>
      <Descriptions bordered size="small" column={2} items={[{key:"version",label:"源配置版本",children:query.data?.external_config_id},{key:"summary",label:"当前计划",children:query.data?.summary}]}/>
      {query.data?.advanced&&<Alert type="warning" title="当前为高级计划，保存将使用下方选择的计划替换采集时刻" style={{marginTop:16}}/>}
      <Form form={form} layout="vertical" style={{marginTop:16}} onFinish={save} disabled={busy}>
        <Form.Item name="mode" label="采集模式" rules={[{required:true}]}><Select options={[{value:"standard",label:"标准 · 每小时 0、30 分"},{value:"low_power",label:"低功耗 · 每小时 0 分"},{value:"high_frequency",label:"高频 · 每小时 0、20、40 分"},{value:"custom",label:"自定义时刻"}]}/></Form.Item>
        {mode==="custom"&&<>
          <Space align="start" wrap>
            {([{name:"data_minutes",label:"采集分钟",max:60},{name:"data_hours",label:"采集小时",max:24},{name:"upload_minutes",label:"上传分钟",max:60},{name:"upload_hours",label:"上传小时",max:24}]).map(field=><Form.Item key={field.name} name={field.name} label={field.label} rules={[{required:true}]}><Select mode="multiple" maxTagCount="responsive" style={{width:260}} options={options(field.max)}/></Form.Item>)}
          </Space>
          {!carbon&&<Space align="start" wrap><Form.Item name="image_minute" label="图片采集分钟" rules={[{required:true}]}><InputNumber min={0} max={59}/></Form.Item><Form.Item name="image_hours" label="图片采集小时" rules={[{required:true}]}><Select mode="multiple" maxTagCount="responsive" style={{width:260}} options={options(24)}/></Form.Item><Form.Item name="image_upload_minute" label="图片上传分钟" rules={[{required:true}]}><InputNumber min={0} max={59}/></Form.Item><Form.Item name="image_upload_hours" label="图片上传小时" rules={[{required:true}]}><Select mode="multiple" maxTagCount="responsive" style={{width:260}} options={options(24)}/></Form.Item></Space>}
        </>}
        <Button type="primary" htmlType="submit" loading={busy} disabled={!query.data?.external_config_id}>保存采集计划</Button>
      </Form>
    </>}
  </Card>;
}
