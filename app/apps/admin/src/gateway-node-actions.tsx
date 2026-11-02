import { confirmManualSync } from "./manual-sync-confirm";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, AutoComplete, Button, Descriptions, Drawer, Dropdown, Form, Input, InputNumber, Modal, Segmented, Space, Typography } from "antd";
import { api, formatApiError, type GatewayNode, type JsonRecord } from "@thcpn/api";

type Action = "create" | "bind" | "replace";
export function GatewayNodeActions({ deviceId, node, onDetails, onConfig }: { deviceId: string; node?: GatewayNode; onDetails?: () => void; onConfig?: (index: number, kind: "sensor" | "time") => void }) {
  const client = useQueryClient(); const { modal, message } = App.useApp(); const [form] = Form.useForm();
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState<{type:"success"|"warning"|"error";text:string}|null>(null);
  const index = node?.target.kind === "gateway_node" ? node.target.node_index : undefined;
  const context = useQuery({ queryKey: ["admin", deviceId, "node-action-context"], queryFn: () => api.admin.deviceLoRaWANV2Context(deviceId), enabled: action === "create" });
  const inventory = useQuery({ queryKey: ["admin", deviceId, "node-action-stock"], queryFn: () => api.admin.physicalNodes(deviceId, { inventory: true, bound: false, page_size: 50 }), enabled: action === "bind" || action === "replace" });
  const refresh = () => client.invalidateQueries({ predicate: q => q.queryKey[0] === "admin" && (q.queryKey.includes(deviceId) || q.queryKey.includes("devices") || q.queryKey.includes("node-inventory")) });
  const open = (next: Action) => { setFeedback(null); form.resetFields(); form.setFieldsValue({ node_index: index }); setAction(next); };
  const execute = async (input: JsonRecord, create = false) => {
    if(input.action === "reconcile" && !await confirmManualSync({scope:"重新读取本网关节点安装关系、配置和指标，更新平台记录。"})) return;
    setBusy(true); setFeedback(null);
    try {
      const result = create ? await api.admin.registerPhysicalNode(String(context.data?.data_source_id), { sn: input.sn, node_index: input.node_index, gateway_device_id: deviceId }) : await api.admin.changePhysicalNode(deviceId, input);
      const partial = result.status !== "completed";
      setFeedback({ type: partial ? "warning" : "success", text: String(result.message) });
      if(partial)void message.warning(String(result.message),8);else void message.success(String(result.message));
      setAction(null);
      if (!partial && input.action !== "reconcile") {
        try { await api.admin.changePhysicalNode(deviceId, { action: "reconcile" }); }
        catch (error) { void message.warning("源端操作已完成，平台同步失败，请使用同步网关节点信息核对。",8);setFeedback({ type: "warning", text: `源端操作已完成，平台指标同步失败：${formatApiError(error).message}。请使用“同步网关节点信息”，不要重复提交安装或更换。` }); }
      }
      await refresh();
    } catch (error) { void message.error(formatApiError(error).message);setFeedback({ type: "error", text: `${formatApiError(error).message}。请刷新核对当前关系后再操作。` }); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    const values = await form.validateFields(); if (!action) return;
    modal.confirm({ title: action === "replace" ? "确认更换节点" : action === "create" ? "确认新建并安装节点" : "确认安装节点", content: `${action === "replace" ? `将 ${node?.node_sn} 更换为 ${values.sn}` : `将 ${values.sn} 安装`}，沿用序号 ${values.node_index}，保留原名称、坐标、配置及该序号的历史数据；此操作不向硬件发送新指令。`, onOk: () => execute({ action: action === "create" ? "register" : action, sn: values.sn, node_index: values.node_index }, action === "create") });
  };
  const unbind = () => modal.confirm({ title: "确认解绑节点", content: `将 ${node?.node_sn} 从网关序号 ${index} 解绑。历史和配置保留，后续配置不再下发；这不是停止硬件采集命令。`, okText: "确认解绑", okButtonProps: { danger: true }, onOk: () => execute({ action: "unbind", sn: node?.node_sn }) });
  const feedbackView = feedback && <Alert type={feedback.type} title={feedback.text} closable onClose={() => setFeedback(null)} />;
  return <Space orientation="vertical" size={4}>
    {!node ? <Button type="primary" disabled={busy} onClick={() => open("create")}>添加节点</Button> : <Dropdown trigger={["click"]} menu={{ items: [
      { key: "position", label: "节点资料", onClick: onDetails },
      { key: "sensor", label: "传感器配置", disabled: !onConfig || !node.bound, onClick: () => { if (index != null) onConfig?.(index, "sensor"); } },
      { key: "time", label: "时间配置", disabled: !onConfig || !node.bound, onClick: () => { if (index != null) onConfig?.(index, "time"); } },
      { type: "divider" },
      ...(node.bound ? [{ key: "replace", label: "更换节点", onClick: () => open("replace") }, { key: "unbind", label: "解绑节点", danger: true, onClick: unbind }] : [{ key: "bind", label: "安装库存节点", onClick: () => open("bind") }, { key: "create", label: "新建节点并安装", onClick: () => open("create") }]),
      { type: "divider" }, { key: "sync", label: "同步网关节点信息", onClick: () => void execute({ action: "reconcile" }) },
    ] }}><Button size="small" loading={busy}>更多</Button></Dropdown>}
    {feedback && !action && <Button size="small" type="link" onClick={() => modal.info({ title: "节点操作结果", content: feedback.text })}>查看操作结果</Button>}
    <Modal title={action === "replace" ? "更换节点" : action === "bind" ? "安装库存节点" : "新建节点并安装"} open={!!action} onCancel={() => { if (!busy) setAction(null); }} onOk={() => void submit()} okText="确认" confirmLoading={busy} okButtonProps={{ disabled: action === "create" && !context.data }} destroyOnHidden>
      {!node && <Segmented style={{ marginBottom: 16 }} value={action ?? "create"} onChange={value => { setFeedback(null); setAction(value as Action); form.resetFields(["sn"]); }} options={[{ value: "create", label: "新建并安装" }, { value: "bind", label: "安装已有库存" }]} />}
      <Alert style={{ marginBottom: 16 }} type="info" title={index != null ? `${node?.name} · 序号 ${index}` : "添加节点"} description={action === "create" ? "新建真实 SN 后安装。已有 SN 不复用、已占用序号不覆盖。" : action === "replace" ? `当前节点：${node?.node_sn}。新节点必须已登记且未安装。` : "选择已登记且未安装的节点，不更改原序号的历史和配置。"} />
      {(context.error && action === "create" || inventory.error && action !== "create") && <Alert type="error" title={formatApiError(action === "create" ? context.error : inventory.error).message} />}
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item name="sn" label={action === "replace" ? "新节点 SN" : "节点 SN"} rules={[{ required: true, whitespace: true, max: 64 }]}>{action === "create" ? <Input maxLength={64} placeholder="填写硬件真实 SN" /> : <AutoComplete options={((inventory.data?.data ?? []) as JsonRecord[]).map(n => ({ value: String(n.sn) }))} placeholder="选择或输入未安装节点 SN" />}</Form.Item>
        <Form.Item name="node_index" label="序号" rules={[{ required: true }]}><InputNumber min={1} max={254} precision={0} disabled={index != null} /></Form.Item>
      </Form>{feedbackView}<Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}><Link to={`/admin/devices?kind=node_v2&gateway=${deviceId}`}>前往节点v2管理全部库存或导入 CSV</Link></Typography.Paragraph>
    </Modal>

  </Space>;
}
