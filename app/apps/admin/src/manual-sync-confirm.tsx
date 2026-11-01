import { Alert, Modal, Space, Typography } from "antd";

export const manualSyncNotice = "只有在通过本平台以外的方式修改了设备配置后，才需要手动同步。通过本平台修改配置会自动更新平台资料，无需额外同步。";

export function confirmManualSync({ title = "确认手动同步？", scope, reason = "external" }: {
 title?: string;
 scope: string;
 reason?: "external" | "recovery" | "import";
}): Promise<boolean> {
 return new Promise(resolve => {
  Modal.confirm({
   title,
   content: <Space orientation="vertical" size="middle" style={{width:"100%"}}>
    <Alert type="info" title={manualSyncNotice}/>
    {reason==="recovery"&&<Typography.Paragraph style={{margin:0}}>本次用于恢复此前未完成的平台同步。配置已被源端接受，请勿重复提交配置。</Typography.Paragraph>}
    {reason==="import"&&<Typography.Paragraph style={{margin:0}}>首次将源端已有设备接入平台时，也可使用此功能导入设备资料。</Typography.Paragraph>}
    <Typography.Paragraph style={{margin:0}}>{scope}</Typography.Paragraph>
   </Space>,
   okText:"确认同步",
   cancelText:"取消",
   onOk:()=>{resolve(true);},
   onCancel:()=>{resolve(false);},
  });
 });
}
