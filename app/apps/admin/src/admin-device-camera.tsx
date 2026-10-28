import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Card, Descriptions, Space } from "antd";
import { api, formatApiError, type CameraLiveSession } from "@thcpn/api";
import { opsTime } from "./admin-device-ops-model";

export function AdminDeviceCamera({deviceId,onEdit}:{deviceId:string;onEdit:()=>void}) {
  const {message}=App.useApp();
  const [session,setSession]=useState<CameraLiveSession|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!session||!host.current)return;
    let disposed=false;
    let player:{stop:()=>Promise<unknown>;destroy?:()=>void}|undefined;
    void import("ezuikit-js").then(module=>{
      if(disposed||!host.current)return;
      const width=Math.max(320,host.current.clientWidth);
      player=new module.EZUIKitPlayer({id:`admin-camera-${deviceId}`,accessToken:session.access_token,url:session.url,staticPath:"/admin/ezuikit_static",template:"pcLive",width,height:Math.min(640,Math.round(width*9/16)),autoplay:true,audio:0,handleError:()=>setError("视频连接失败，请核对视频绑定、验证信息和设备网络")});
    }).catch(()=>setError("视频播放器加载失败，请刷新重试"));
    return ()=>{disposed=true;try { void player?.stop?.().catch(()=>{});player?.destroy?.(); } catch {} host.current?.replaceChildren();};
  },[session,deviceId]);
  return <Card title="监控站视频调试" extra={<Space><Button onClick={onEdit}>编辑视频绑定</Button><Button type="primary" loading={busy} onClick={async()=>{setBusy(true);setError("");try{setSession(await api.admin.cameraLive(deviceId));}catch(error){void message.error(formatApiError(error).message);}finally{setBusy(false);}}}>{session?"重新连接":"开启视频预览"}</Button></Space>}>
    {error&&<Alert type="error" title={error}/>}
    {session&&<Descriptions size="small" items={[{key:"serial",label:"摄像机序列号",children:session.device_serial},{key:"channel",label:"通道",children:session.channel_no},{key:"expire",label:"会话到期",children:opsTime(session.expires_at)}]}/>}
    {!session&&<Alert type="info" title="直接在后台检查监控站画面，无需登录用户前端"/>}
    <div ref={host} id={`admin-camera-${deviceId}`} style={{width:"100%",minHeight:session?420:0}}/>
  </Card>;
}
