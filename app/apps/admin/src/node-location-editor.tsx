import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale } from "@thcpn/i18n";
import { App, Button, Form, InputNumber, Modal, Space } from "@thcpn/admin-ui";
import { api, formatApiError, type GatewayNode } from "@thcpn/api";

export function AdminNodeLocationEditor({ deviceId, node }: { deviceId: string; node: GatewayNode }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<{ latitude: number; longitude: number }>();
  const client = useQueryClient();
  const { message } = App.useApp();
  const { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const save = async (clear = false) => {
    const values = clear ? { latitude: null, longitude: null } : await form.validateFields();
    if (node.target.kind !== "gateway_node") return;
    setBusy(true);
    try {
      await api.admin.updateNodeLocation(deviceId, node.target.node_index, values);
      await client.invalidateQueries({ predicate: query => (query.queryKey.includes("nodes") && query.queryKey.includes(deviceId)) || query.queryKey.includes("device-map") });
      setOpen(false); void message.success(text("节点位置已保存", "Node location saved"));
    } catch (error) { void message.error(formatApiError(error).message); } finally { setBusy(false); }
  };
  return <><Button onClick={() => { form.setFieldsValue({ latitude: node.latitude, longitude: node.longitude }); setOpen(true); }}>{text("节点位置", "Node location")}</Button>
    <Modal title={`${text("节点位置", "Node location")} · ${node.name}`} open={open} onCancel={() => { if (!busy) setOpen(false); }} confirmLoading={busy} onOk={() => void save().catch(() => {})} destroyOnHidden footer={(_, { OkBtn, CancelBtn }) => <Space>{node.latitude != null && <Button disabled={busy} onClick={() => void save(true)}>{text("清空位置", "Clear location")}</Button>}<CancelBtn/><OkBtn/></Space>}>
      <p>{text("WGS84 坐标，仅保存到平台，不下发设备。", "WGS84 coordinates, saved on the platform only; not sent to the device.")}</p>
      <Form form={form} layout="vertical" disabled={busy}>
        <Form.Item name="longitude" label={text("经度", "Longitude")} rules={[{required:true},{type:"number",min:-180,max:180}]}><InputNumber min={-180} max={180} style={{width:"100%"}}/></Form.Item>
        <Form.Item name="latitude" label={text("纬度", "Latitude")} rules={[{required:true},{type:"number",min:-90,max:90}]}><InputNumber min={-90} max={90} style={{width:"100%"}}/></Form.Item>
      </Form>
    </Modal></>;
}
