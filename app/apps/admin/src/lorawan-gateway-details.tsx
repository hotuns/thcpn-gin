import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Form, Input } from "antd";
import { api, formatApiError, type LoRaWANGatewayDetails } from "@thcpn/api";

export function LoRaWANGatewayDetailsEditor({deviceId}:{deviceId:string}){
 const client=useQueryClient();const {message}=App.useApp();const [form]=Form.useForm<LoRaWANGatewayDetails>();const [busy,setBusy]=useState(false);
 const key=["admin","device",deviceId,"gateway-details"];
 const query=useQuery({queryKey:key,queryFn:()=>api.admin.gatewayDetails(deviceId)});
 useEffect(()=>{if(query.data)form.setFieldsValue(query.data);},[query.data,form]);
 return <Card title="网关扩展信息" loading={query.isLoading} style={{marginTop:16}}>
 {query.error?<Alert type="error" title="扩展信息读取失败" description={formatApiError(query.error).message}/>:<Form form={form} layout="vertical" disabled={busy} onFinish={async values=>{setBusy(true);try{await api.admin.saveGatewayDetails(deviceId,{app_key:values.app_key??"",eui:values.eui??"",wifi_name:values.wifi_name??""});await client.invalidateQueries({queryKey:key});void message.success("网关扩展信息已保存");}catch(error){void message.error(formatApiError(error).message);}finally{setBusy(false);}}}>
  <Form.Item name="app_key" label="AppKey"><Input.Password maxLength={128} autoComplete="off"/></Form.Item>
  <Form.Item name="eui" label="EUI"><Input maxLength={128} autoComplete="off"/></Form.Item>
  <Form.Item name="wifi_name" label="Wi-Fi 名称"><Input maxLength={128} autoComplete="off"/></Form.Item>
  <Button type="primary" htmlType="submit" loading={busy}>保存扩展信息</Button>
 </Form>}
 </Card>;
}
