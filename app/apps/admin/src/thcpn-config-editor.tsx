import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, Button, Empty, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, type FormInstance } from "antd";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import {
  advancedConfigFromDraft,
  cloneConfigValue,
  duplicateSensorWarnings,
  formatTwoFieldSchedule,
  parseAdvancedConfig,
  parseTwoFieldSchedule,
  sensorMetrics,
  validateVisualConfig,
  type THCPNConfigDraft,
} from "./thcpn-config-model";

const text = (value: unknown, fallback = "—") => value === null || value === undefined || value === "" ? fallback : String(value);

export function THCPNVisualConfigEditor({ deviceId, form }: { deviceId: string; form: FormInstance<any> }) {
  const watchOptions = { form, preserve: true };
  const dataText = Form.useWatch("data_json", watchOptions) ?? "[]";
  const imageText = Form.useWatch("image_json", watchOptions) ?? "[]";
  const controlText = Form.useWatch("control_json", watchOptions) ?? "{}";
  const expectedConfigId = Number(Form.useWatch("expected_config_id", watchOptions) ?? 0);
  const [activeTab, setActiveTab] = useState("sensors");
  const [parseError, setParseError] = useState("");
  const parsed = useMemo(() => {
    try {
      return { draft: parseAdvancedConfig({ data: dataText, image: imageText, control: controlText }, expectedConfigId), error: "" };
    } catch (error) {
      return { draft: null, error: error instanceof Error ? error.message : "配置 JSON 无效" };
    }
  }, [dataText, imageText, controlText, expectedConfigId]);
  const draft = parsed.draft;
  const updateDraft = (next: THCPNConfigDraft) => {
    const advanced = advancedConfigFromDraft(next);
    form.setFieldsValue({ data_json: advanced.data, image_json: advanced.image, control_json: advanced.control, expected_config_id: next.expectedConfigId });
    setParseError("");
  };
  const switchTab = (next: string) => {
    if (next !== "advanced" && !draft) {
      setParseError(parsed.error);
      return;
    }
    setActiveTab(next);
    setParseError("");
  };
  const errors = draft ? validateVisualConfig(draft) : [];
  const warnings = draft ? duplicateSensorWarnings(draft.sensors) : [];

  return <div className="visual-config-editor">
    <Form.Item name="expected_config_id" hidden><InputNumber /></Form.Item>
    {(parseError || (activeTab !== "advanced" && parsed.error)) && <Alert type="error" showIcon title="配置格式无效" description={parseError || parsed.error} />}
    {activeTab !== "advanced" && errors.length > 0 && <Alert type="error" showIcon title="请修正配置" description={errors.join("；")} />}
    {warnings.length > 0 && <Alert type="warning" showIcon title="发现共享总线冲突" description={`${warnings.join("；")}。管理员确认后仍可保存。`} />}
    <Tabs activeKey={activeTab} onChange={switchTab} items={[
      { key: "sensors", label: `传感器 ${draft?.sensors.length ?? 0}`, children: draft ? <SensorList deviceId={deviceId} draft={draft} updateDraft={updateDraft} /> : null },
      { key: "images", label: `图片通道 ${draft?.images.length ?? 0}`, children: draft ? <ImageList draft={draft} updateDraft={updateDraft} /> : null },
      { key: "control", label: "控制策略", children: draft ? <ControlEditor draft={draft} updateDraft={updateDraft} /> : null },
      { key: "advanced", label: "高级 JSON", children: <AdvancedEditor /> },
    ]} />
  </div>;
}

function SensorList({ deviceId, draft, updateDraft }: { deviceId: string; draft: THCPNConfigDraft; updateDraft: (draft: THCPNConfigDraft) => void }) {
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const move = (index: number, direction: -1 | 1) => {
    const next = cloneConfigValue(draft);
    const target = index + direction;
    if (target < 0 || target >= next.sensors.length) return;
    [next.sensors[index], next.sensors[target]] = [next.sensors[target], next.sensors[index]];
    updateDraft(next);
  };
  return <div className="visual-config-section">
    <div className="visual-config-toolbar"><div><strong>数据传感器</strong><span>从源库模板添加，也可编辑当前设备的全部实例参数</span></div><Button type="primary" icon={<Plus size={14} />} onClick={() => setCatalogOpen(true)}>添加传感器</Button></div>
    {draft.sensors.length ? <Table rowKey={(item) => String(draft.sensors.indexOf(item))} size="small" pagination={false} dataSource={draft.sensors} scroll={{ x: 840 }} columns={[
      { title: "传感器", render: (_, item) => <div><strong>{text(item.sensorType, "未命名型号")}</strong><div className="cell-sub">{text(item.description, "无说明")}</div></div> },
      { title: "连接", width: 150, render: (_, item) => <div>{text(item.port)} / {text(item.port_num)}<div className="cell-sub">{text(item.sensor, "未知驱动")}</div></div> },
      { title: "指标", width: 250, render: (_, item) => { const metrics = sensorMetrics(item); return <div className="sensor-metric-tags"><span>{metrics.length} 项</span>{metrics.slice(0, 4).map((metric, index) => <Tag key={`${text(metric.key)}-${index}`}>{text(((metric.info ?? {}) as JsonRecord).name, text(metric.key))}</Tag>)}</div>; } },
      { title: "操作", width: 190, fixed: "right", render: (_, __, index) => <Space size={2}><Button type="text" icon={<Pencil size={13} />} onClick={() => setEditingIndex(index)}>编辑</Button><Button type="text" icon={<Copy size={13} />} aria-label="复制传感器" onClick={() => { const next = cloneConfigValue(draft); next.sensors.splice(index + 1, 0, cloneConfigValue(next.sensors[index])); updateDraft(next); }} /><Button type="text" icon={<ChevronUp size={13} />} disabled={index === 0} aria-label="上移传感器" onClick={() => move(index, -1)} /><Button type="text" icon={<ChevronDown size={13} />} disabled={index === draft.sensors.length - 1} aria-label="下移传感器" onClick={() => move(index, 1)} /><Button type="text" danger icon={<Trash2 size={13} />} aria-label="删除传感器" onClick={() => { const next = cloneConfigValue(draft); next.sensors.splice(index, 1); updateDraft(next); }} /></Space> },
    ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置数据传感器" />}
    <SensorCatalogModal deviceId={deviceId} open={catalogOpen} onClose={() => setCatalogOpen(false)} onAdd={(entry) => { const next = cloneConfigValue(draft); next.sensors.push(entry); updateDraft(next); setCatalogOpen(false); setEditingIndex(next.sensors.length - 1); }} />
    <SensorEditorModal value={editingIndex === null ? null : draft.sensors[editingIndex]} open={editingIndex !== null} onClose={() => setEditingIndex(null)} onSave={(value) => { if (editingIndex === null) return; const next = cloneConfigValue(draft); next.sensors[editingIndex] = value; updateDraft(next); setEditingIndex(null); }} />
  </div>;
}

function SensorCatalogModal({ deviceId, open, onClose, onAdd }: { deviceId: string; open: boolean; onClose: () => void; onAdd: (entry: JsonRecord) => void }) {
  const [q, setQ] = useState("");
  const [port, setPort] = useState<string | undefined>();
  const [driver, setDriver] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["admin", "device", deviceId, "sensor-templates", q, port, driver, page], queryFn: () => api.admin.sensorTemplates(deviceId, { q, port: port ?? "", driver: driver ?? "", page, page_size: 12 }), enabled: open });
  const items = ((query.data?.items ?? []) as JsonRecord[]);
  const ports = Array.from(new Set(items.map((item) => text(item.port, "")).filter(Boolean)));
  const drivers = Array.from(new Set(items.map((item) => text(item.driver, "")).filter(Boolean)));
  return <Modal title="从源库添加传感器" open={open} onCancel={onClose} footer={null} width={920} destroyOnHidden>
    <div className="sensor-catalog-toolbar"><Input.Search allowClear placeholder="搜索型号、说明或驱动" value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} /><Select allowClear placeholder="全部端口" value={port} options={ports.map((value) => ({ value, label: value }))} onChange={(value) => { setPort(value); setPage(1); }} /><Select allowClear placeholder="全部驱动" value={driver} options={drivers.map((value) => ({ value, label: value }))} onChange={(value) => { setDriver(value); setPage(1); }} /></div>
    {query.error ? <Alert type="error" showIcon title="传感器模板加载失败" description={formatApiError(query.error).message} /> : <Table rowKey="id" loading={query.isLoading} size="small" dataSource={items} pagination={{ current: page, pageSize: 12, total: Number(query.data?.total ?? 0), showSizeChanger: false, onChange: setPage }} columns={[
      { title: "型号", render: (_, item) => <div><strong>{text(item.sensor_type)}</strong><div className="cell-sub">{text(item.description, "无说明")}</div></div> },
      { title: "连接", width: 150, render: (_, item) => <div>{text(item.port)} / {text(item.port_num)}<div className="cell-sub">{text(item.driver)}</div></div> },
      { title: "指标", width: 300, render: (_, item) => { const metrics = (item.metrics ?? []) as JsonRecord[]; return <div className="sensor-metric-tags"><span>{metrics.length} 项</span>{metrics.slice(0, 5).map((metric) => <Tag key={text(metric.key)}>{text(metric.name, text(metric.key))}</Tag>)}{metrics.length > 5 ? <Tag>其余 {metrics.length - 5} 项</Tag> : null}</div>; } },
      { title: "", width: 90, render: (_, item) => <Button type="primary" disabled={item.valid === false} onClick={() => onAdd(cloneConfigValue((item.config_entry ?? {}) as JsonRecord))}>添加</Button> },
    ]} />}
  </Modal>;
}

function SensorEditorModal({ value, open, onClose, onSave }: { value: JsonRecord | null; open: boolean; onClose: () => void; onSave: (value: JsonRecord) => void }) {
  const [form] = Form.useForm<JsonRecord>();
  const [topExtras, setTopExtras] = useState<JsonRecord>({});
  const [paramExtras, setParamExtras] = useState<JsonRecord>({});
  const initialize = () => {
    const initial = cloneConfigValue(value ?? {});
    const params = ((initial.params ?? {}) as JsonRecord);
    setTopExtras(omitKeys(initial, ["id", "sensorType", "description", "sensor_type", "sensor", "port", "port_num", "port_nums", "params", "created_at"]));
    setParamExtras(omitKeys(params, ["command", "wait_time", "contents"]));
    form.resetFields();
    form.setFieldsValue(initial);
  };
  const save = async () => {
    await form.validateFields();
    const fields = form.getFieldsValue(true) as JsonRecord;
    const ports = Array.isArray(fields.port_nums) ? fields.port_nums.map(normalizeNumberValue) : [];
    const params = { ...paramExtras, ...((fields.params ?? {}) as JsonRecord) };
    onSave({ ...topExtras, ...fields, port_nums: ports, params });
  };
  return <Modal title={`编辑传感器 · ${text(value?.sensorType, "新实例")}`} open={open} onCancel={onClose} width={980} destroyOnHidden okText="保存实例" onOk={() => void save()} afterOpenChange={(opened) => opened && initialize()}>
    <Form form={form} layout="vertical" preserve>
      <div className="config-form-grid config-form-grid-4"><Form.Item name="sensorType" label="传感器型号" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="description" label="实例说明"><Input /></Form.Item><Form.Item name="sensor_type" label="设备适配类型"><Input /></Form.Item><Form.Item name="id" label="模板 ID"><InputNumber style={{ width: "100%" }} /></Form.Item></div>
      <div className="config-form-grid config-form-grid-4"><Form.Item name="sensor" label="驱动" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="port" label="端口" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="port_num" label="端口编号" rules={[{ required: true }]}><InputNumber precision={0} style={{ width: "100%" }} /></Form.Item><Form.Item name="port_nums" label="可选端口"><Select mode="tags" tokenSeparators={[","]} /></Form.Item></div>
      <div className="config-form-grid config-form-grid-3"><Form.Item name={["params", "command"]} label="协议命令"><Input className="code-input" /></Form.Item><Form.Item name={["params", "wait_time"]} label="等待时间"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item><Form.Item name="created_at" label="模板创建时间"><Input /></Form.Item></div>
      <div className="visual-subsection-head"><div><strong>数据指标</strong><span>配置读取 key、名称、单位、范围和解码规则</span></div></div>
      <Form.List name={["params", "contents"]}>{(fields, { add, remove, move }) => <div className="metric-editor-list">{fields.map((field, index) => <div className="metric-editor-row" key={field.key}><div className="metric-editor-index">{index + 1}</div><div className="metric-editor-fields"><Form.Item name={[field.name, "key"]} label="Key" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name={[field.name, "info", "name"]} label="名称"><Input /></Form.Item><Form.Item name={[field.name, "info", "type"]} label="类型"><Input /></Form.Item><Form.Item name={[field.name, "info", "unit"]} label="单位"><Input /></Form.Item><Form.Item name={[field.name, "info", "index"]} label="索引"><InputNumber precision={0} style={{ width: "100%" }} /></Form.Item><Form.Item name={[field.name, "info", "min"]} label="最小值"><InputNumber style={{ width: "100%" }} /></Form.Item><Form.Item name={[field.name, "info", "max"]} label="最大值"><InputNumber style={{ width: "100%" }} /></Form.Item><Form.Item name={[field.name, "decode"]} label="Decode"><Input className="code-input" /></Form.Item></div><Space orientation="vertical" size={0}><Button type="text" icon={<ChevronUp size={13} />} disabled={index === 0} onClick={() => move(index, index - 1)} /><Button type="text" icon={<ChevronDown size={13} />} disabled={index === fields.length - 1} onClick={() => move(index, index + 1)} /><Button type="text" danger icon={<Trash2 size={13} />} onClick={() => remove(index)} /></Space></div>)}<Button block type="dashed" icon={<Plus size={14} />} onClick={() => add({ key: "", info: { name: "", type: "", unit: "", index: fields.length }, decode: "" })}>添加指标</Button></div>}</Form.List>
      <TypedKeyValueEditor title="参数扩展字段" value={paramExtras} reservedKeys={["command", "wait_time", "contents"]} onChange={setParamExtras} />
      <TypedKeyValueEditor title="传感器扩展字段" value={topExtras} reservedKeys={["id", "sensorType", "description", "sensor_type", "sensor", "port", "port_num", "port_nums", "params", "created_at"]} onChange={setTopExtras} />
      <Alert className="config-preserve-note" type="info" showIcon title="扩展字段支持字符串、数字、布尔值、对象、数组和 null；高级 JSON 仍可编辑完整原文。" />
    </Form>
  </Modal>;
}

function ImageList({ draft, updateDraft }: { draft: THCPNConfigDraft; updateDraft: (draft: THCPNConfigDraft) => void }) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const current = creating ? {} : editingIndex === null ? null : draft.images[editingIndex];
  const save = (image: JsonRecord) => { const next = cloneConfigValue(draft); if (creating) next.images.push(image); else if (editingIndex !== null) next.images[editingIndex] = image; updateDraft(next); setCreating(false); setEditingIndex(null); };
  return <div className="visual-config-section"><div className="visual-config-toolbar"><div><strong>图片通道</strong><span>配置图片 key、名称和物理端口</span></div><Button type="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>添加通道</Button></div>
    {draft.images.length ? <Table rowKey={(item) => String(draft.images.indexOf(item))} size="small" pagination={false} dataSource={draft.images} columns={[
      { title: "Key", dataIndex: "key", width: 130 }, { title: "名称", render: (_, item) => <div><strong>{text(item.name, text(item.key))}</strong><div className="cell-sub">{text(item.desc, "无说明")}</div></div> }, { title: "端口", width: 160, render: (_, item) => `${text(item.port)} / ${text(item.port_num)}` }, { title: "类型", dataIndex: "sensorType", width: 130 },
      { title: "操作", width: 120, render: (_, __, index) => <Space><Button type="text" icon={<Pencil size={13} />} onClick={() => setEditingIndex(index)}>编辑</Button><Button type="text" danger icon={<Trash2 size={13} />} onClick={() => { const next = cloneConfigValue(draft); next.images.splice(index, 1); updateDraft(next); }} /></Space> },
    ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置图片通道" />}
    <ImageEditorModal value={current} open={creating || editingIndex !== null} onClose={() => { setCreating(false); setEditingIndex(null); }} onSave={save} />
  </div>;
}

function ImageEditorModal({ value, open, onClose, onSave }: { value: JsonRecord | null; open: boolean; onClose: () => void; onSave: (value: JsonRecord) => void }) {
  const [form] = Form.useForm<JsonRecord>();
  const [extras, setExtras] = useState<JsonRecord>({});
  const initialize = () => {
    const initial = cloneConfigValue(value ?? { port: "http", port_nums: [] });
    setExtras(omitKeys(initial, ["key", "name", "desc", "port", "port_num", "port_nums", "sensorType"]));
    form.resetFields();
    form.setFieldsValue(initial);
  };
  const save = async () => {
    await form.validateFields();
    const fields = form.getFieldsValue(true) as JsonRecord;
    const ports = Array.isArray(fields.port_nums) ? fields.port_nums.map(normalizeNumberValue) : [];
    onSave({ ...extras, ...fields, port_nums: ports });
  };
  return <Modal title={value && Object.keys(value).length ? `编辑图片通道 · ${text(value.key)}` : "添加图片通道"} open={open} onCancel={onClose} destroyOnHidden okText="保存通道" onOk={() => void save()} afterOpenChange={(opened) => opened && initialize()}>
    <Form form={form} layout="vertical" preserve><div className="config-form-grid"><Form.Item name="key" label="数据 Key" rules={[{ required: true }]}><Input placeholder="例如 key1" /></Form.Item><Form.Item name="name" label="显示名称" rules={[{ required: true }]}><Input /></Form.Item></div><Form.Item name="desc" label="说明"><Input /></Form.Item><div className="config-form-grid config-form-grid-3"><Form.Item name="port" label="端口" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="port_num" label="端口编号" rules={[{ required: true }]}><InputNumber precision={0} style={{ width: "100%" }} /></Form.Item><Form.Item name="sensorType" label="相机类型"><Input /></Form.Item></div><Form.Item name="port_nums" label="可选端口"><Select mode="tags" tokenSeparators={[","]} /></Form.Item><TypedKeyValueEditor title="图片通道扩展字段" value={extras} reservedKeys={["key", "name", "desc", "port", "port_num", "port_nums", "sensorType"]} onChange={setExtras} /><Alert type="info" showIcon title="高级 JSON 可继续维护完整原文。" /></Form>
  </Modal>;
}

const scheduleFields = [
  ["data_capture_invl", "数据采集"], ["data_upload_invl", "数据上传"], ["img_capture_invl", "图片采集"], ["img_upload_invl", "图片上传"], ["misc_invl", "其他任务"],
] as const;

function ControlEditor({ draft, updateDraft }: { draft: THCPNConfigDraft; updateDraft: (draft: THCPNConfigDraft) => void }) {
  const known = new Set(scheduleFields.map(([key]) => key));
  const extras = Object.entries(draft.control).filter(([key]) => !known.has(key as typeof scheduleFields[number][0]));
  const setControl = (key: string, value: unknown) => { const next = cloneConfigValue(draft); if (value === undefined || value === "") delete next.control[key]; else next.control[key] = value; updateDraft(next); };
  const setExtras = (value: JsonRecord) => {
    const next = cloneConfigValue(draft);
    for (const key of Object.keys(next.control)) if (!known.has(key as typeof scheduleFields[number][0])) delete next.control[key];
    Object.assign(next.control, value);
    updateDraft(next);
  };
  return <div className="visual-config-section"><div className="visual-config-toolbar"><div><strong>控制与采集计划</strong><span>采集和上传计划独立设置，格式为“分钟 小时”</span></div></div><div className="schedule-editor-list">{scheduleFields.map(([key, label]) => <ScheduleEditor key={key} label={label} value={draft.control[key]} onChange={(value) => setControl(key, value)} />)}</div><div className="control-extra-list"><TypedKeyValueEditor title="其他控制字段" value={Object.fromEntries(extras)} reservedKeys={scheduleFields.map(([key]) => key)} onChange={setExtras} /></div></div>;
}

type ExtraValueType = "string" | "number" | "boolean" | "object" | "array" | "null";

function valueType(value: unknown): ExtraValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "object") return typeof value as ExtraValueType;
  return "string";
}

function valueText(value: unknown) {
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value ?? "");
}

function parseTypedValue(type: ExtraValueType, raw: string): unknown {
  if (type === "null") return null;
  if (type === "boolean") {
    if (raw !== "true" && raw !== "false") throw new Error("布尔值只能填写 true 或 false");
    return raw === "true";
  }
  if (type === "number") {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) throw new Error("请输入有效数字");
    return parsed;
  }
  if (type === "object" || type === "array") {
    const parsed = JSON.parse(raw);
    if (type === "array" ? !Array.isArray(parsed) : !parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error(type === "array" ? "请输入 JSON 数组" : "请输入 JSON 对象");
    return parsed;
  }
  return raw;
}

function TypedKeyValueEditor({ title, value, reservedKeys, onChange }: { title: string; value: JsonRecord; reservedKeys: readonly string[]; onChange: (value: JsonRecord) => void }) {
  const [editing, setEditing] = useState<{ originalKey?: string; key: string; type: ExtraValueType; raw: string } | null>(null);
  const [error, setError] = useState("");
  const entries = Object.entries(value);
  const openEntry = (key?: string, item?: unknown) => { setError(""); setEditing({ originalKey: key, key: key ?? "", type: valueType(item), raw: key ? valueText(item) : "" }); };
  const save = () => {
    if (!editing) return;
    const key = editing.key.trim();
    if (!key) { setError("字段名不能为空"); return; }
    if (reservedKeys.includes(key)) { setError("该字段已由可视化表单管理"); return; }
    if (key !== editing.originalKey && Object.prototype.hasOwnProperty.call(value, key)) { setError("字段名不能重复"); return; }
    try {
      const next = { ...value };
      if (editing.originalKey && editing.originalKey !== key) delete next[editing.originalKey];
      next[key] = parseTypedValue(editing.type, editing.raw);
      onChange(next);
      setEditing(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "字段值无效"); }
  };
  return <div className="typed-extra-editor"><div className="visual-subsection-head"><div><strong>{title}</strong><span>完整维护模板中的厂商扩展配置</span></div><Button size="small" icon={<Plus size={13} />} onClick={() => openEntry()}>添加字段</Button></div>{entries.length ? <div className="typed-extra-list">{entries.map(([key, item]) => <div key={key}><code>{key}</code><Tag>{valueType(item)}</Tag><span>{valueText(item)}</span><Space size={2}><Button type="text" icon={<Pencil size={13} />} aria-label={`编辑 ${key}`} onClick={() => openEntry(key, item)} /><Button type="text" danger icon={<Trash2 size={13} />} aria-label={`删除 ${key}`} onClick={() => { const next = { ...value }; delete next[key]; onChange(next); }} /></Space></div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有扩展字段" />}<Modal title={editing?.originalKey ? "编辑扩展字段" : "添加扩展字段"} open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={save} okText="保存字段" destroyOnHidden>{editing ? <div className="typed-extra-form"><label><span>字段名</span><Input value={editing.key} onChange={(event) => setEditing({ ...editing, key: event.target.value })} /></label><label><span>类型</span><Select value={editing.type} options={["string", "number", "boolean", "object", "array", "null"].map((item) => ({ value: item, label: item }))} onChange={(type) => setEditing({ ...editing, type, raw: type === "boolean" ? "false" : type === "object" ? "{}" : type === "array" ? "[]" : type === "null" ? "" : editing.raw })} /></label><label><span>值</span>{editing.type === "object" || editing.type === "array" ? <Input.TextArea rows={8} className="code-input" value={editing.raw} onChange={(event) => setEditing({ ...editing, raw: event.target.value })} /> : <Input disabled={editing.type === "null"} value={editing.raw} onChange={(event) => setEditing({ ...editing, raw: event.target.value })} />}</label>{error ? <Alert type="error" showIcon title={error} /> : null}</div> : null}</Modal></div>;
}

function omitKeys(value: JsonRecord, keys: readonly string[]): JsonRecord {
  const next = cloneConfigValue(value);
  for (const key of keys) delete next[key];
  return next;
}

function normalizeNumberValue(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && String(value).trim() !== "" ? number : value;
}

function ScheduleEditor({ label, value, onChange }: { label: string; value: unknown; onChange: (value: string) => void }) {
  const parsed = parseTwoFieldSchedule(value);
  const minuteOptions = Array.from({ length: 60 }, (_, item) => ({ value: item, label: String(item).padStart(2, "0") }));
  const hourOptions = Array.from({ length: 24 }, (_, item) => ({ value: item, label: String(item).padStart(2, "0") }));
  if (!parsed.valid) return <div className="schedule-editor-row advanced"><div><strong>{label}</strong><span>高级自定义计划</span></div><Input value={text(value, "")} onChange={(event) => onChange(event.target.value)} className="code-input" placeholder="分钟 小时" /><Button onClick={() => onChange("0 *")}>改为结构化</Button></div>;
  const update = (minutes: number[], hours: number[], wildcard = parsed.wildcardHours) => onChange(formatTwoFieldSchedule(minutes, hours, wildcard));
  return <div className="schedule-editor-row"><div><strong>{label}</strong><span>{text(value)}</span></div><label><span>分钟</span><Select mode="multiple" value={parsed.minutes} options={minuteOptions} onChange={(minutes) => update(minutes, parsed.hours)} /></label><label><span>小时</span><Select mode="multiple" disabled={parsed.wildcardHours} value={parsed.hours} options={hourOptions} onChange={(hours) => update(parsed.minutes, hours)} /></label><Select className="schedule-range-mode" value={parsed.wildcardHours ? "all" : "selected"} options={[{ value: "all", label: "每小时" }, { value: "selected", label: "指定小时" }]} onChange={(mode) => update(parsed.minutes, mode === "all" ? [] : parsed.hours.length ? parsed.hours : [0], mode === "all")} /></div>;
}

function AdvancedEditor() {
  return <div className="advanced-config-fields"><Alert type="warning" showIcon title="高级模式会直接修改完整配置" description="切换回可视化时会重新解析三段 JSON。未知厂商字段会保留，但 JSON 无效时不能保存。" /><Form.Item name="data_json" label="数据通道 · data_json" rules={[{ required: true }]}><Input.TextArea rows={14} className="code-input" spellCheck={false} /></Form.Item><Form.Item name="image_json" label="图片通道 · image_json" rules={[{ required: true }]}><Input.TextArea rows={10} className="code-input" spellCheck={false} /></Form.Item><Form.Item name="control_json" label="控制配置 · control_json" rules={[{ required: true }]}><Input.TextArea rows={10} className="code-input" spellCheck={false} /></Form.Item></div>;
}
