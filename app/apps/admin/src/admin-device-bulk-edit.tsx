import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Col, DatePicker, Dropdown, Form, Input, Modal, Row, Select, Space, Table, Tag, type MenuProps } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { api, deviceLifecycleOptions, formatApiError, type DeviceDeliveryInput, type JsonRecord } from "@thcpn/api";

const fields = [
  { key: "ecosystem", name: "ecosystem_term_id", label: "生态分类", kind: "ecosystem", multiple: false },
  { key: "observation_objects", name: "observation_object_ids", label: "观测对象", kind: "observation_object", multiple: true },
  { key: "purposes", name: "purpose_ids", label: "应用场景", kind: "purpose", multiple: true },
] as const;

const editLabels = {
  delivery: "交付信息",
  profile: "安装地址 / 说明",
  ops_tags: "运维标签",
  status: "启用 / 停用",
  lifecycle: "生命周期",
  assign: "分配工作区 / 项目 / 站点",
  unassign: "解除分配",
} as const;

type BulkMode = keyof typeof editLabels | (typeof fields)[number]["key"];
type BulkValues = DeviceDeliveryInput & {
  delivery_write?: "fill" | "overwrite";
  operation?: "set" | "clear" | "inherit";
  classification_value?: string | string[];
  tags?: string[];
  status?: "active" | "disabled";
  lifecycle_status?: string;
  occurred_at?: Dayjs;
  note?: string;
  target_workspace_id?: string;
  project_id?: string;
  site_id?: string;
  field?: "location_text" | "description";
  content?: string;
};
type Result = {
  id: string;
  name: string;
  assetNo: string;
  outcome: "updated" | "skipped" | "failed";
  detail?: string;
};

function deliveryInput(values: BulkValues): DeviceDeliveryInput {
  return {
    organization: values.organization?.trim(),
    project_name: values.project_name?.trim(),
    contact_name: values.contact_name?.trim(),
    contact_phone: values.contact_phone?.trim(),
    overwrite: values.delivery_write === "overwrite",
  };
}

async function applyEdit(mode: BulkMode, device: JsonRecord, values: BulkValues): Promise<Pick<Result, "outcome" | "detail">> {
  const id = String(device.id);
  const definition = fields.find(field => field.key === mode);
  if (definition) {
    const existing = await api.admin.deviceEnvironment(id);
    const direct = existing.direct;
    const overridden = existing.overridden_fields.filter(key => key !== definition.key);
    const payload: JsonRecord = {
      ecosystem_term_id: direct.ecosystem?.id ?? null,
      observation_object_ids: direct.observation_objects.map(term => term.id),
      purpose_ids: direct.purposes.map(term => term.id),
      management_term_id: direct.management?.id ?? null,
      deployment_term_id: direct.deployment?.id ?? null,
      commissioned_year: direct.commissioned_year ?? null,
      research_tags: direct.research_tags,
      overridden_fields: values.operation === "inherit" ? overridden : [...overridden, definition.key],
    };
    if (values.operation !== "inherit") payload[definition.name] = values.operation === "clear"
      ? (definition.multiple ? [] : null) : values.classification_value;
    await api.admin.updateDeviceEnvironment(id, payload);
  } else if (mode === "delivery") {
    const result = await api.admin.updateDeviceDelivery(id, deliveryInput(values));
    return {
      outcome: result.updated ? "updated" : "skipped",
      detail: result.linked_project_retained ? "已保留关联项目" : result.updated ? undefined : "没有需要修改的字段",
    };
  } else if (mode === "ops_tags") {
    const existing = await api.admin.deviceInstallation(id);
    await api.admin.saveDeviceInstallation(id, {
      ...existing,
      project_name: existing.recorded_project_name ?? (existing.linked_project_name ? "" : existing.project_name),
      ops_tags: values.tags ?? [],
    });
  } else if (mode === "profile") {
    // The profile endpoint requires both address and description; keep the one not being edited.
    const existing = await api.admin.deviceProfile(id);
    await api.admin.updateDeviceProfile(id, {
      description: existing.description ?? null,
      location_text: existing.location_text ?? null,
      [values.field!]: values.content?.trim() ?? "",
    });
  } else if (mode === "assign") {
    await api.admin.assignDevice(id, { target_workspace_id: values.target_workspace_id, project_id: values.project_id ?? null, site_id: values.site_id ?? null });
  } else if (mode === "unassign") {
    if (!device.workspace_id) return { outcome: "skipped", detail: "未分配工作区" };
    await api.admin.unassignDevice(id);
  } else if (mode === "status") {
    await api.admin.updateDevice(id, { status: values.status });
  } else if (mode === "lifecycle") {
    await api.admin.updateLifecycle(id, { lifecycle_status: values.lifecycle_status, occurred_at: values.occurred_at!.toISOString(), note: values.note });
  }
  return { outcome: "updated" };
}

export function AdminDeviceBulkEdit({ devices, disabled, onSaved }: {
  devices: JsonRecord[]; disabled: boolean; onSaved: (failedIds: string[]) => void;
}) {
  const client = useQueryClient();
  const [mode, setMode] = useState<BulkMode>();
  const [form] = Form.useForm<BulkValues>();
  const [targets, setTargets] = useState<JsonRecord[]>([]);
  const [review, setReview] = useState<BulkValues>();
  const [formError, setFormError] = useState("");
  const [processing, setProcessing] = useState<{ done: number; total: number }>();
  const [results, setResults] = useState<Result[]>([]);
  const workspace = Form.useWatch("target_workspace_id", form);
  const project = Form.useWatch("project_id", form);
  const operation = Form.useWatch("operation", form);
  const definition = fields.find(field => field.key === mode);
  const terms = useQuery({ queryKey: ["admin", "device-taxonomy"], queryFn: api.admin.deviceTaxonomy, enabled: !!definition });
  const workspaces = useQuery({ queryKey: ["admin", "workspaces", "assignment"], queryFn: api.workspaces.adminList, enabled: mode === "assign" });
  const projects = useQuery({ queryKey: ["admin", "projects", workspace], queryFn: () => api.projects.adminList(workspace!), enabled: mode === "assign" && !!workspace });
  const sites = useQuery({ queryKey: ["admin", "sites", workspace, project], queryFn: () => api.sites.adminList(workspace!, project), enabled: mode === "assign" && !!workspace && !!project });
  const options = (items: JsonRecord[] = []) => items.map(item => ({ value: String(item.id), label: String(item.name) }));
  const label = definition?.label ?? (mode && mode in editLabels ? editLabels[mode as keyof typeof editLabels] : "");
  const optionsError = definition ? terms.error : mode === "assign" ? workspaces.error || projects.error || sites.error : null;
  const failed = results.filter(result => result.outcome === "failed");
  const skipped = results.filter(result => result.outcome === "skipped").length;
  const busy = !!processing;
  const danger = mode === "unassign" || (mode === "status" && review?.status === "disabled") || (mode === "lifecycle" && review?.lifecycle_status === "retired");

  const open = (next: BulkMode) => {
    setMode(next);
    setTargets([...devices]);
    setReview(next === "unassign" ? {} : undefined);
    setResults([]);
    setFormError("");
    form.resetFields();
    form.setFieldsValue({ operation: "set", delivery_write: "fill", occurred_at: dayjs() });
  };
  const editItem = (key: keyof typeof editLabels) => ({ key, label: editLabels[key], onClick: () => open(key) });
  const menu: MenuProps["items"] = [
    { key: "installation", type: "group", label: "安装与交付", children: [editItem("delivery"), editItem("profile"), editItem("ops_tags")] },
    { key: "state", type: "group", label: "设备状态", children: [editItem("status"), editItem("lifecycle")] },
    { key: "ownership", type: "group", label: "归属与分类", children: [
      editItem("assign"), editItem("unassign"),
      { key: "classification", label: "应用场景与观测分类", children: fields.map(field => ({
        key: field.key, label: field.label, onClick: () => open(field.key),
      })) },
    ] },
  ];

  const prepareReview = async () => {
    let values: BulkValues;
    try { values = await form.validateFields(); } catch { return; }
    if (mode === "delivery") {
      const delivery = deliveryInput(values);
      if (!delivery.organization && !delivery.project_name && !delivery.contact_name && !delivery.contact_phone) {
        setFormError("请填写至少一项交付信息");
        return;
      }
      if (!!delivery.contact_name !== !!delivery.contact_phone) {
        setFormError("联系人和联系电话请一起填写");
        return;
      }
    }
    setFormError("");
    setReview(values);
  };

  const apply = async (batch: JsonRecord[]) => {
    if (!mode || !review || busy) return;
    setProcessing({ done: 0, total: batch.length });
    const output: Result[] = [];
    try {
      // Limit concurrent writes and keep results in selection order.
      for (let offset = 0; offset < batch.length; offset += 5) {
        output.push(...await Promise.all(batch.slice(offset, offset + 5).map(async (device): Promise<Result> => {
          const id = String(device.id);
          const identity = { id, name: String(device.name || "未命名设备"), assetNo: String(device.asset_no || "") };
          try {
            return { ...identity, ...await applyEdit(mode, device, review) };
          } catch (error) {
            return { ...identity, outcome: "failed", detail: formatApiError(error).message };
          } finally {
            setProcessing(current => current && ({ ...current, done: current.done + 1 }));
          }
        })));
      }
      setResults(previous => {
        if (!previous.length) return output;
        const retries = new Map(output.map(item => [item.id, item]));
        return previous.map(item => retries.get(item.id) ?? item);
      });
      void client.invalidateQueries({ queryKey: ["admin", "device"] });
      void client.invalidateQueries({ queryKey: ["admin", "device-map"] });
    } finally {
      setProcessing(undefined);
    }
  };
  const close = () => {
    if (busy) return;
    setMode(undefined);
    if (results.length) onSaved(failed.map(result => result.id));
  };
  const retryFailures = () => {
    const ids = new Set(failed.map(result => result.id));
    void apply(targets.filter(device => ids.has(String(device.id))));
  };
  const confirmation = mode === "assign"
    ? "设备将统一分配到所选工作区。项目或站点留空时会解除原关联；转移工作区后，原工作区将失去访问权限。"
    : mode === "unassign"
      ? "设备解除分配后，原工作区将失去访问权限。"
      : mode === "delivery"
        ? (review?.delivery_write === "overwrite"
          ? "本次填写的字段将覆盖原值，空白项和已关联的项目保留。"
          : "仅补充空白字段，保留已有交付信息和已关联的项目。")
        : undefined;

  return <>
    <Dropdown disabled={disabled || !devices.length} trigger={["click"]} menu={{ items: menu }}>
      <Button type="primary" disabled={disabled || !devices.length}>批量编辑</Button>
    </Dropdown>
    <Modal
      title={label ? `${label} · ${targets.length} 台设备` : "批量编辑"}
      open={!!mode}
      forceRender
      width={600}
      onCancel={close}
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: false }}
      footer={results.length ? <Space>
        <Button disabled={busy} onClick={close}>关闭</Button>
        {failed.length > 0 && <Button type="primary" danger={danger} loading={busy} onClick={retryFailures}>重试失败设备</Button>}
      </Space> : <Space>
        <Button disabled={busy} onClick={review && mode !== "unassign" ? () => setReview(undefined) : close}>{review && mode !== "unassign" ? "返回修改" : "取消"}</Button>
        <Button type="primary" danger={danger} loading={busy} disabled={!!optionsError} onClick={() => review ? void apply(targets) : void prepareReview()}>
          {review ? "确认应用" : "下一步：确认修改"}
        </Button>
      </Space>}
    >
      {processing && <Alert type="info" title={`正在处理 ${processing.done} / ${processing.total} 台设备`} style={{ marginBottom: 16 }} />}
      {results.length > 0 && <Space orientation="vertical" style={{ width: "100%" }}>
        <Alert type={failed.length ? "warning" : "success"} title={`已更新 ${results.length - skipped - failed.length} 台 · 跳过 ${skipped} 台 · 失败 ${failed.length} 台`} />
        <Table<Result> size="small" rowKey="id" dataSource={results} pagination={{ pageSize: 5, hideOnSinglePage: true }} columns={[
          { title: "设备", dataIndex: "name", render: (name, item) => <div>{name}{item.assetNo && <div>{item.assetNo}</div>}</div> },
          { title: "结果", render: (_, item) => <>
            <Tag color={item.outcome === "updated" ? "success" : item.outcome === "failed" ? "error" : undefined}>
              {item.outcome === "updated" ? "已更新" : item.outcome === "failed" ? "失败" : "跳过"}
            </Tag>
            {item.detail}
          </> },
        ]} />
      </Space>}
      <div hidden={results.length > 0}>
        {optionsError && <Alert type="error" title="选项读取失败" description={formatApiError(optionsError).message} style={{ marginBottom: 16 }} />}
        {review && !busy && <Alert type={danger ? "warning" : "info"} title={`将应用到已选的 ${targets.length} 台设备`} description={confirmation} style={{ marginBottom: 16 }} />}
        {formError && <Alert type="error" title={formError} style={{ marginBottom: 16 }} />}
        <Form<BulkValues> form={form} layout="vertical" disabled={busy || !!review} onValuesChange={() => setFormError("")}>
          {definition ? <>
            <Form.Item name="operation" label="修改方式"><Select options={[
              { value: "set", label: "设置统一值（替换该字段）" },
              { value: "clear", label: "清空该字段" },
              { value: "inherit", label: "沿用网关／站点资料" },
            ]} /></Form.Item>
            {operation === "set" && <Form.Item name="classification_value" label={definition.label} rules={[{ required: true, message: `请选择${definition.label}` }]}>
              <Select showSearch optionFilterProp="label" mode={definition.multiple ? "multiple" : undefined} loading={terms.isLoading} options={(terms.data?.items ?? [])
                .filter(term => term.kind === definition.kind && term.status === "active")
                .map(term => ({ value: term.id, label: term.name_zh }))} />
            </Form.Item>}
          </> : mode === "delivery" ? <>
            <Form.Item name="delivery_write" label="更新方式"><Select options={[
              { value: "fill", label: "仅填补空白（默认）" },
              { value: "overwrite", label: "覆盖本次填写的字段" },
            ]} /></Form.Item>
            <Row gutter={16}>
              <Col xs={24} sm={12}><Form.Item name="organization" label="所属单位"><Input maxLength={200} /></Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item name="project_name" label="项目名称"><Input maxLength={200} /></Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item name="contact_name" label="联系人"><Input maxLength={200} /></Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item name="contact_phone" label="联系电话"><Input maxLength={200} inputMode="tel" /></Form.Item></Col>
            </Row>
          </> : mode === "ops_tags" ? <Form.Item name="tags" label="运维标签"><Select mode="tags" maxCount={30} tokenSeparators={[",", "，"]} /></Form.Item>
          : mode === "assign" ? <>
            <Form.Item name="target_workspace_id" label="工作区" rules={[{ required: true, message: "请选择工作区" }]}><Select showSearch optionFilterProp="label" loading={workspaces.isLoading} options={options(workspaces.data?.items)} onChange={() => form.setFieldsValue({ project_id: undefined, site_id: undefined })} /></Form.Item>
            <Form.Item name="project_id" label="项目"><Select allowClear showSearch optionFilterProp="label" disabled={!workspace || busy || !!review} loading={projects.isLoading} options={options(projects.data?.items)} onChange={() => form.setFieldValue("site_id", undefined)} /></Form.Item>
            <Form.Item name="site_id" label="站点"><Select allowClear showSearch optionFilterProp="label" placeholder={project ? "请选择站点（选填）" : "请先选择项目"} disabled={!project || busy || !!review} loading={sites.isLoading} options={options(sites.data?.items)} /></Form.Item>
          </> : mode === "profile" ? <>
            <Form.Item name="field" label="修改字段" rules={[{ required: true, message: "请选择要修改的字段" }]}><Select options={[{ value: "location_text", label: "安装地址" }, { value: "description", label: "安装说明" }]} /></Form.Item>
            <Form.Item name="content" label="统一内容"><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
          </> : mode === "status" ? <Form.Item name="status" label="设备状态" rules={[{ required: true, message: "请选择设备状态" }]}>
            <Select options={[{ value: "active", label: "启用" }, { value: "disabled", label: "停用" }]} />
          </Form.Item> : mode === "lifecycle" ? <>
            <Form.Item name="lifecycle_status" label="生命周期" rules={[{ required: true, message: "请选择生命周期" }]}>
              <Select options={[...deviceLifecycleOptions]} />
            </Form.Item>
            <Form.Item name="occurred_at" label="状态生效时间" rules={[{ required: true, message: "请选择生效时间" }]}>
              <DatePicker showTime style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="note" label="变更说明"><Input.TextArea rows={3} /></Form.Item>
          </> : null}
        </Form>
      </div>
    </Modal>
  </>;
}
