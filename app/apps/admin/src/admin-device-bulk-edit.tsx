import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Dropdown, Form, Input, InputNumber, Modal, Select, Space, Table } from "antd";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";

const fields = [
  { key: "ecosystem", name: "ecosystem_term_id", label: "设备类型", kind: "ecosystem" },
  { key: "observation_objects", name: "observation_object_ids", label: "观测对象", kind: "observation_object", multiple: true },
  { key: "purposes", name: "purpose_ids", label: "观测用途", kind: "purpose", multiple: true },
  { key: "management", name: "management_term_id", label: "管理方式", kind: "management" },
  { key: "deployment", name: "deployment_term_id", label: "部署方式", kind: "deployment" },
  { key: "commissioned_year", name: "commissioned_year", label: "投运年份" },
  { key: "research_tags", name: "research_tags", label: "研究标签", multiple: true },
];
type Result = { id: string; name: string; error?: string };

export function AdminDeviceBulkEdit({ devices, disabled, onSaved }: {
  devices: JsonRecord[]; disabled: boolean; onSaved: (failedIds: string[]) => Promise<void>;
}) {
  const client = useQueryClient();
  const [mode, setMode] = useState<string>();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [progress, setProgress] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [targets, setTargets] = useState<JsonRecord[]>([]);
  const workspace = Form.useWatch("target_workspace_id", form) as string | undefined;
  const project = Form.useWatch("project_id", form) as string | undefined;
  const operation = Form.useWatch("operation", form) as string | undefined;
  const definition = fields.find(field => field.key === mode);
  const terms = useQuery({ queryKey: ["admin", "device-taxonomy"], queryFn: api.admin.deviceTaxonomy, enabled: !!definition });
  const workspaces = useQuery({ queryKey: ["admin", "workspaces", "assignment"], queryFn: api.workspaces.adminList, enabled: mode === "assign" });
  const projects = useQuery({ queryKey: ["admin", "projects", workspace], queryFn: () => api.projects.adminList(workspace!), enabled: mode === "assign" && !!workspace });
  const sites = useQuery({ queryKey: ["admin", "sites", workspace, project], queryFn: () => api.sites.adminList(workspace!, project), enabled: mode === "assign" && !!workspace });
  const options = (items: JsonRecord[] = []) => items.map(item => ({ value: String(item.id), label: String(item.name) }));
  const label = definition?.label ?? (mode === "assign" ? "分配工作区与项目／站点" : "安装资料");
  const open = (key: string) => { setMode(key); setTargets([...devices]); setResults([]); setProgress(0); setConfirmed(false); form.resetFields(); form.setFieldsValue({ operation: "set" }); };
  const save = async () => {
    const values = await form.validateFields();
    if (!confirmed) { setConfirmed(true); return; }
    setBusy(true); setResults([]); setProgress(0);
    const output: Result[] = [];
    try {
      // Small batches keep ordinary platform writes responsive during bulk edits.
      for (let offset = 0; offset < targets.length; offset += 5) {
        await Promise.all(targets.slice(offset, offset + 5).map(async device => {
          const id = String(device.id);
          try {
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
              if (values.operation !== "inherit") payload[definition.name] = values.operation === "clear" ? (definition.multiple ? [] : null) : values.value;
              await api.admin.updateDeviceEnvironment(id, payload);
            } else if (mode === "assign") {
              await api.admin.assignDevice(id, { target_workspace_id: values.target_workspace_id, project_id: values.project_id ?? null, site_id: values.site_id ?? null });
            } else {
              await api.admin.updateDeviceProfile(id, { [values.field]: values.content ?? "" });
            }
            output.push({ id, name: String(device.name ?? id) });
          } catch (error) { output.push({ id, name: String(device.name ?? id), error: formatApiError(error).message }); }
          setProgress(count => count + 1);
        }));
      }
      setResults(output);
      setConfirmed(false);
      await client.invalidateQueries({ queryKey: ["admin", "device"] });
      await client.invalidateQueries({ queryKey: ["admin", "device-map"] });

    } finally { setBusy(false); }
  };
  const close = () => {
    if (busy) return;
    setMode(undefined);
    if (results.length) void onSaved(results.filter(result => result.error).map(result => result.id));
  };
  const errors = definition ? terms.error : mode === "assign" ? workspaces.error || projects.error || sites.error : null;
  return <>
    <Dropdown disabled={disabled || !devices.length} menu={{ items: [
      { key: "classification", label: "批量修改观测资料", children: fields.map(field => ({ key: field.key, label: field.label })) },
      { key: "assign", label: "批量分配工作区／项目／站点" },
      { key: "profile", label: "批量修改安装资料" },
    ], onClick: ({ key }) => open(key) }}><Button disabled={disabled}>批量编辑</Button></Dropdown>
    <Modal title={`批量${label} · ${targets.length} 台`} open={!!mode} onCancel={close} closable={!busy} maskClosable={!busy} keyboard={!busy} footer={results.length ? <Space><Button onClick={close}>关闭</Button>{results.some(result => result.error) && <Button onClick={() => { const failed = new Set(results.filter(result => result.error).map(result => result.id)); setTargets(targets.filter(device => failed.has(String(device.id)))); setResults([]); }}>仅重试失败设备</Button>}</Space> : <Space><Button disabled={busy} onClick={() => setMode(undefined)}>取消</Button><Button type="primary" loading={busy} disabled={!!errors} onClick={() => void save().catch(() => {})}>{busy ? `正在处理 ${progress} / ${targets.length}` : confirmed ? `确认应用到 ${targets.length} 台设备` : "下一步：确认修改"}</Button></Space>}>
      {errors && <Alert type="error" title="选项读取失败" description={formatApiError(errors).message} />}
      {results.length ? <><Alert type={results.some(result => result.error) ? "warning" : "success"} title={`成功 ${results.filter(result => !result.error).length} 台，失败 ${results.filter(result => result.error).length} 台`} /><Table size="small" rowKey="id" dataSource={results} pagination={{ pageSize: 5 }} columns={[{ title: "设备", dataIndex: "name" }, { title: "结果", render: (_, result: Result) => result.error ?? "成功" }]} /></> : <>
        {confirmed && <Alert type="warning" title={`即将修改 ${targets.length} 台设备的${label}`} description={mode === "assign" ? "所选设备将统一调整归属，原工作区将失去这些设备的访问权。" : "仅修改本次选定字段，其他资料保持不变。"} style={{ marginBottom: 16 }} />}
        <Form form={form} layout="vertical" disabled={busy || confirmed} onValuesChange={() => setConfirmed(false)}>
          {definition ? <>
            <Form.Item name="operation" label="修改方式"><Select options={[{ value: "set", label: "设置统一值（替换该字段）" }, { value: "clear", label: "清空该字段" }, { value: "inherit", label: "沿用网关／站点资料" }]} /></Form.Item>
            {operation === "set" && <Form.Item name="value" label={definition.label} rules={[{ required: true, message: `请填写${definition.label}` }]}>
              {definition.key === "commissioned_year" ? <InputNumber min={1900} max={2100} precision={0} style={{ width: "100%" }} /> : <Select showSearch optionFilterProp="label" mode={definition.key === "research_tags" ? "tags" : definition.multiple ? "multiple" : undefined} loading={terms.isLoading} options={(terms.data?.items ?? []).filter(term => term.kind === definition.kind && term.status === "active").map(term => ({ value: term.id, label: term.name_zh }))} />}
            </Form.Item>}
          </> : mode === "assign" ? <>
            <Form.Item name="target_workspace_id" label="工作区" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" loading={workspaces.isLoading} options={options(workspaces.data?.items)} onChange={() => form.setFieldsValue({ project_id: undefined, site_id: undefined })} /></Form.Item>
            <Form.Item name="project_id" label="项目"><Select allowClear showSearch optionFilterProp="label" disabled={!workspace} loading={projects.isLoading} options={options(projects.data?.items)} onChange={() => form.setFieldValue("site_id", undefined)} /></Form.Item>
            <Form.Item name="site_id" label="站点"><Select allowClear showSearch optionFilterProp="label" disabled={!workspace} loading={sites.isLoading} options={options(sites.data?.items)} /></Form.Item>
          </> : <>
            <Form.Item name="field" label="修改字段" rules={[{ required: true }]}><Select options={[{ value: "description", label: "设备描述／安装说明" }, { value: "location_text", label: "安装地点" }]} /></Form.Item>
            <Form.Item name="content" label="统一内容"><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
          </>}
        </Form>
        {confirmed && <Button type="link" onClick={() => setConfirmed(false)}>返回修改</Button>}
      </>}
    </Modal>
  </>;
}
