import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, RefreshCw, Search, Settings2 } from "lucide-react";
import { Button, Drawer, Form, Input, Popconfirm, Select, Space, Table, Tag } from "@thcpn/admin-ui";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { Badge, PageHeader, Panel, StateView } from "@thcpn/ui";

type Mode = "edit" | "assign" | "child" | "lifecycle" | "capabilities" | "config" | "camera" | null;
const value = (input: unknown, fallback = "—") => input === undefined || input === null || input === "" ? fallback : String(input);
const json = (input: unknown) => JSON.stringify(input ?? {}, null, 2);

export function AdminDevicesPage() {
  const query = useQuery({ queryKey: ["admin", "devices"], queryFn: api.admin.devices });
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<JsonRecord | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [detail, setDetail] = useState("");
  const [form] = Form.useForm();
  const rows = useMemo(() => (query.data?.items ?? []).filter((item) => `${value(item.name)} ${value(item.serial_no)} ${value(item.id)}`.toLowerCase().includes(keyword.toLowerCase())), [keyword, query.data]);
  const id = value(selected?.id, "");

  const open = (next: Exclude<Mode, null>, record: JsonRecord) => {
    setSelected(record); setMode(next); setDetail("");
    if (next === "edit") form.setFieldsValue({ product_id: record.product_id, serial_no: record.serial_no, name: record.name, status: record.status, device_type: record.device_type });
    if (next === "assign") form.setFieldsValue({ target_workspace_id: record.workspace_id, project_id: record.project_id, site_id: record.site_id, assign_children: false });
    if (next === "child") form.setFieldsValue({ child_device_id: "" });
    if (next === "lifecycle") form.setFieldsValue({ lifecycle_status: record.lifecycle_status, note: "" });
    if (next === "capabilities") form.setFieldsValue({ payload: json({ capabilities: record.capabilities ?? [] }) });
    if (next === "config") { form.setFieldsValue({ payload: json({ data_json: {}, image_json: {}, control_json: {} }) }); void loadDetail("config", record); }
    if (next === "camera") form.setFieldsValue({ name: record.name, serial_no: record.serial_no, provider: "ezviz" });
  };
  const close = () => { setMode(null); setDetail(""); form.resetFields(); };
  const loadDetail = async (kind: "children" | "lifecycle" | "capabilities" | "config", record = selected) => {
    if (!record) return; setSelected(record); setBusy(true); setFeedback("");
    try { const deviceId = value(record.id, ""); const response = kind === "children" ? await api.admin.deviceChildren(deviceId) : kind === "lifecycle" ? await api.admin.lifecycle(deviceId) : kind === "capabilities" ? await api.admin.capabilities(deviceId) : await api.admin.deviceConfig(deviceId); setDetail(json(response)); if (kind === "config") form.setFieldsValue({ payload: json(response) }); }
    catch (error) { showError(error); } finally { setBusy(false); }
  };
  const showError = (error: unknown) => { const item = formatApiError(error); setFeedback(`${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`); };
  const submit = async () => {
    setBusy(true); setFeedback("");
    try {
      const fields = await form.validateFields();
      if (!selected && mode !== "camera") throw new Error("请先选择设备");
      if (mode === "edit") await api.admin.updateDevice(id, fields);
      if (mode === "assign") await api.admin.assignDevice(id, fields);
      if (mode === "child") await api.admin.addDeviceChild(id, fields);
      if (mode === "lifecycle") await api.admin.updateLifecycle(id, fields);
      if (mode === "capabilities") await api.admin.updateCapabilities(id, JSON.parse(fields.payload));
      if (mode === "config") await api.admin.updateDeviceConfig(id, JSON.parse(fields.payload));
      if (mode === "camera") await api.admin.createCamera(fields);
      setFeedback("操作已完成"); close(); await query.refetch();
    } catch (error) { if (!(error as any)?.errorFields) showError(error); } finally { setBusy(false); }
  };
  const unassign = async (record: JsonRecord) => { setBusy(true); setFeedback(""); try { await api.admin.unassignDevice(value(record.id, "")); setFeedback("设备分配已解除"); await query.refetch(); } catch (error) { showError(error); } finally { setBusy(false); } };

  return <><PageHeader eyebrow="System / devices" title="系统设备" description="管理设备身份、Workspace 分配、网关拓扑、生命周期和 THCPN 配置。" actions={<Button icon={<RefreshCw size={14} />} onClick={() => void query.refetch()}>刷新</Button>} />
    <Panel><div className="admin-list-toolbar"><div className="admin-search"><Search size={15} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索设备名称、序列号或 ID" /></div><Badge tone="info">{rows.length} 台设备</Badge></div>{feedback && <div className="admin-feedback">{feedback}</div>}{query.isLoading ? <StateView type="loading" title="正在加载设备" description="正在读取系统设备资产。" /> : query.error ? <StateView type="error" title="设备加载失败" description={formatApiError(query.error).message} requestId={formatApiError(query.error).requestId} /> : rows.length ? <Table rowKey="id" dataSource={rows} rowClassName={(record) => record.id === selected?.id ? "admin-selected-row" : ""} columns={columns(open, unassign)} pagination={{ pageSize: 12, showSizeChanger: false }} scroll={{ x: 1080 }} /> : <StateView type="empty" title="没有匹配的设备" description={keyword ? "请调整搜索条件。" : "请先从数据源同步设备资产。"} />}</Panel>
    <Drawer title={drawerTitle(mode, selected)} open={Boolean(mode)} onClose={close} width={560} extra={<Space><Button onClick={close}>取消</Button><Button type="primary" danger={mode === "config"} loading={busy} onClick={() => void submit()}>保存</Button></Space>}><Form form={form} layout="vertical"><DeviceForm mode={mode} /></Form>{detail && <pre className="admin-json-view drawer-json">{detail}</pre>}<div className="drawer-note"><Settings2 size={15} />{mode === "config" ? "高级配置会写入外部设备库，并刷新平台数据流与绑定。提交前请确认 JSON 结构。" : "所有操作都作用于标题中显示的当前设备；完成后设备列表会自动刷新。"}</div></Drawer>
  </>;
}

function columns(open: (mode: Exclude<Mode, null>, row: JsonRecord) => void, unassign: (row: JsonRecord) => Promise<void>) { return [
  { title: "设备", dataIndex: "name", render: (_: unknown, row: JsonRecord) => <div><div className="cell-title">{value(row.name, "未命名设备")}</div><div className="cell-sub mono">{value(row.serial_no, value(row.id))}</div></div> },
  { title: "类型 / 拓扑", width: 130, render: (_: unknown, row: JsonRecord) => <div>{value(row.device_type)}<div className="cell-sub">{row.child_count ? `${row.child_count} 个子节点` : value(row.topology_role, "无子节点")}</div></div> },
  { title: "生命周期", dataIndex: "lifecycle_status", width: 120, render: (item: string) => <Tag color={item === "online" ? "green" : item === "retired" ? "default" : "blue"}>{item}</Tag> },
  { title: "Workspace", dataIndex: "workspace_id", width: 145, render: (item: string) => item ? <Tag color="blue">{item.slice(0, 8)}</Tag> : <Tag>未分配</Tag> },
  { title: "状态", dataIndex: "status", width: 95, render: (item: string) => <Tag color={item === "active" ? "green" : "default"}>{item}</Tag> },
  { title: "操作", width: 360, fixed: "right" as const, render: (_: unknown, row: JsonRecord) => <Space size={0} wrap><Button type="link" onClick={() => open("edit", row)}>资料</Button><Button type="link" onClick={() => open("assign", row)}>分配</Button><Button type="link" onClick={() => open("child", row)}>拓扑</Button><Button type="link" onClick={() => open("lifecycle", row)}>生命周期</Button><Button type="link" onClick={() => open("capabilities", row)}>能力</Button><Button type="link" onClick={() => open("config", row)}>配置</Button><Button type="link" onClick={() => open("camera", row)}>建相机</Button>{Boolean(row.workspace_id) && <Popconfirm title="解除 Workspace 分配？" description="设备将不再对该 Workspace 可见。" onConfirm={() => void unassign(row)}><Button type="link" danger>解除</Button></Popconfirm>}</Space> }
]; }

function DeviceForm({ mode }: { mode: Mode }) {
  if (mode === "edit") return <><div className="drawer-grid"><Form.Item name="name" label="设备名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="serial_no" label="序列号" rules={[{ required: true }]}><Input /></Form.Item></div><Form.Item name="product_id" label="产品 ID"><Input /></Form.Item><div className="drawer-grid"><Form.Item name="device_type" label="设备类型"><Select options={["standalone", "gateway", "gateway_node", "camera"].map((item) => ({ value: item, label: item }))} /></Form.Item><Form.Item name="status" label="资产状态"><Select options={["active", "disabled", "retired"].map((item) => ({ value: item, label: item }))} /></Form.Item></div></>;
  if (mode === "assign") return <><Form.Item name="target_workspace_id" label="目标 Workspace ID" rules={[{ required: true, message: "请输入 Workspace ID" }]}><Input /></Form.Item><div className="drawer-grid"><Form.Item name="project_id" label="Project ID"><Input /></Form.Item><Form.Item name="site_id" label="Site ID"><Input /></Form.Item></div><Form.Item name="assign_children" label="网关子节点"><Select options={[{ value: false, label: "只分配当前设备" }, { value: true, label: "同时分配全部子节点" }]} /></Form.Item></>;
  if (mode === "child") return <><Form.Item name="child_device_id" label="子设备 ID" rules={[{ required: true, message: "请输入子设备 ID" }]}><Input /></Form.Item><div className="drawer-note"><GitBranch size={15} />当前设备将成为父网关。系统会校验设备类型和现有拓扑关系。</div></>;
  if (mode === "lifecycle") return <><Form.Item name="lifecycle_status" label="新生命周期" rules={[{ required: true }]}><Select options={["inbound", "installed", "online", "maintenance", "repairing", "retired"].map((item) => ({ value: item, label: item }))} /></Form.Item><Form.Item name="note" label="变更说明"><Input.TextArea rows={4} placeholder="记录本次状态变化的原因" /></Form.Item></>;
  if (mode === "capabilities") return <Form.Item name="payload" label="能力集合 JSON" rules={[{ required: true }]}><Input.TextArea rows={10} className="code-input" /></Form.Item>;
  if (mode === "config") return <Form.Item name="payload" label="THCPN 配置 JSON" rules={[{ required: true }]}><Input.TextArea rows={16} className="code-input" /></Form.Item>;
  return <><Form.Item name="name" label="相机名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="serial_no" label="相机序列号" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="provider" label="服务商"><Select options={[{ value: "ezviz", label: "萤石 Ezviz" }]} /></Form.Item></>;
}

function drawerTitle(mode: Mode, selected: JsonRecord | null) { const name = value(selected?.name, "设备"); return ({ edit: "编辑资料", assign: "分配 Workspace", child: "添加子节点", lifecycle: "更新生命周期", capabilities: "设备能力", config: "THCPN 高级配置", camera: "创建相机" } as Record<string, string>)[mode ?? ""] + ` · ${name}`; }
