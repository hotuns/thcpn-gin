import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, Drawer, Form, Input, InputNumber, Modal, Row, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import { api, formatApiError, type SystemSettingField, type SystemSettingsChange } from "@thcpn/api";
import { AdminDeploymentSettings } from "./admin-deployment-settings";

const key = ["admin", "system-settings"];
export function AdminSystemSettings() {
  const { message } = App.useApp();
  const client = useQueryClient();
  const [form] = Form.useForm<Record<string, number>>();
  const [active, setActive] = useState("查询与展示");
  const [confirmation, setConfirmation] = useState<Record<string, number> | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const query = useQuery({ queryKey: key, queryFn: api.admin.settings.get });
  const history = useQuery({ queryKey: [...key, "history"], queryFn: api.admin.settings.history, enabled: historyOpen });
  useEffect(() => { if (query.data) form.setFieldsValue(query.data.values); }, [query.data, form]);
  const fields = query.data?.fields ?? [];
  const groups = [...new Set(fields.map(field => field.group))];
  const currentFields = fields.filter(field => field.group === active);
  const changes = (values: Record<string, number>) => currentFields.filter(field => values[field.key] !== query.data?.values[field.key]).map(field => ({ ...field, before: query.data?.values[field.key], after: values[field.key] }));
  const submit = async () => {
    try {
      const values = await form.validateFields(currentFields.map(field => field.key));
      const modified = changes(values);
      if (!modified.length) { void message.info("本组配置没有变化"); return; }
      setReason(""); setConfirmation(Object.fromEntries(modified.map(field => [field.key, field.after])));
    } catch { /* Ant Design displays validation errors next to the inputs. */ }
  };
  const save = async () => {
    if (!confirmation) return;
    setSaving(true);
    try {
      const result = await api.admin.settings.update(confirmation, reason.trim());
      client.setQueryData(key, result);
      await client.invalidateQueries({ queryKey: [...key, "history"] });
      setConfirmation(null); void message.success("配置已保存，新请求和新导出任务使用新值");
    } catch (error) { void message.error(formatApiError(error).message); }
    finally { setSaving(false); }
  };
  const fieldHelp = (field: SystemSettingField) => {
    if (field.key === "billing_enabled") return "关闭后取消套餐门槛和下载额度限制，查询、上传等系统参数仍生效。";
    if (field.key === "password_max_bytes") return "bcrypt 最大支持 72 字节；英文和数字各占 1 字节，中文通常占 3 字节。";
    if (field.key === "export_points" || field.key === "query_points") return "数值越大，查询耗时和内存占用越高。";
    if (field.key.endsWith("ttl_seconds")) return "只影响新发送的验证码，已发送验证码的过期时间不变。";
    if (field.key === "password_lock_minutes") return "只影响新触发的锁定，不改变已有锁定的解除时间。";
    if (field.key === "export_ttl_hours") return "只影响新建任务，已有文件的过期时间不变。";
    if (field.key === "public_history_hours") return "公开页面只能访问该时间窗口内的数据。";
    return `启动默认值 ${query.data?.defaults[field.key]} ${field.unit}`;
  };
  const changeRows = confirmation ? fields.filter(field => field.key in confirmation).map(field => ({ ...field, before: query.data?.values[field.key], after: confirmation[field.key] })) : [];
  const historyDiff = (item: SystemSettingsChange) => [
    ...fields.filter(field => item.before[field.key] !== item.after[field.key]).map(field => ({ ...field, before: item.before[field.key], after: item.after[field.key] })),
    ...(item.before_public_base_url !== item.after_public_base_url ? [{ key: "public_base_url", label: "用户端访问地址", unit: "—", before: item.before_public_base_url || "使用前端默认地址，未配置时随当前访问地址", after: item.after_public_base_url || "使用前端默认地址，未配置时随当前访问地址" }] : []),
  ];
  const diffColumns = [
    { title: "配置项", dataIndex: "label" }, { title: "修改前", dataIndex: "before", render: (value: string | number) => <span style={{ wordBreak: "break-all" }}>{value}</span> }, { title: "修改后", dataIndex: "after", render: (value: string | number) => <span style={{ wordBreak: "break-all" }}>{value}</span> }, { title: "单位", dataIndex: "unit" },
  ];
  return <Space orientation="vertical" size="middle" style={{ width: "100%" }}><AdminDeploymentSettings onHistory={() => setHistoryOpen(true)} /><Card title="业务参数" extra={<Space><Tag>版本 {query.data?.version ?? 0}</Tag><Button onClick={() => setHistoryOpen(true)}>修改记录</Button><Button onClick={() => void query.refetch()}>刷新配置</Button></Space>} loading={query.isLoading}>
    {query.error ? <Alert type="error" message={formatApiError(query.error).message} action={<Button onClick={() => void query.refetch()}>重试</Button>} /> : <>
      <Alert type="info" message="修改影响全平台。保存前确认变更内容并填写原因；新请求使用新值，正在执行的导出保持启动时的配置。" style={{ marginBottom: 16 }} />
      <Tabs activeKey={active} onChange={setActive} items={groups.map(group => ({ key: group, label: group }))} />
      {active === "套餐参数" && <Alert type="info" message={query.data?.billing_enabled ? "套餐功能已启用，以下参数控制基础版时间窗口和专业版下载额度。" : "当前未启用套餐限制。启用并保存后，以下套餐窗口和额度将对用户生效。"} style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" preserve>
        <Row gutter={[24, 0]}>{currentFields.map(field => <Col key={field.key} xs={24} xl={12}><Form.Item name={field.key} label={`${field.label}（${field.unit}）`} extra={fieldHelp(field)} getValueProps={field.kind === "switch" ? (value: number) => ({ checked: value === 1 }) : undefined} getValueFromEvent={field.kind === "switch" ? (checked: boolean) => checked ? 1 : 0 : undefined} rules={[{ required: true, message: "请输入配置值" }, { type: "integer", min: field.min, max: field.max, message: `请输入 ${field.min}–${field.max} 的整数` }]}>
          {field.kind === "switch" ? <Switch checkedChildren="启用" unCheckedChildren="关闭" /> : <InputNumber min={field.min} max={field.max} precision={0} controls style={{ width: "100%" }} />}
        </Form.Item></Col>)}</Row>
        <Space><Button type="primary" disabled={!query.data || saving} onClick={() => void submit()}>保存本组配置</Button><Button disabled={!query.data || saving} onClick={() => form.setFieldsValue(Object.fromEntries(currentFields.map(field => [field.key, query.data!.defaults[field.key]])))}>填入本组启动默认值</Button></Space>
      </Form>
    </>}
    <Modal open={!!confirmation} title="确认修改系统配置" width={760} confirmLoading={saving} okText="确认保存" cancelText="取消" okButtonProps={{ disabled: reason.trim().length < 5 }} onCancel={() => !saving && setConfirmation(null)} onOk={() => void save()}>
      <Table size="small" rowKey="key" dataSource={changeRows} columns={diffColumns} pagination={false} />
      <Form layout="vertical" style={{ marginTop: 16 }}><Form.Item required label="修改原因（至少 5 个字符）"><Input.TextArea value={reason} maxLength={500} showCount rows={3} onChange={event => setReason(event.target.value)} /></Form.Item></Form>
    </Modal>
    <Drawer title="系统配置修改记录（最近 50 次）" width={1000} open={historyOpen} onClose={() => setHistoryOpen(false)}>
      {history.error ? <Alert type="error" message={formatApiError(history.error).message} /> : <Table rowKey="id" loading={history.isLoading} dataSource={history.data?.items ?? []} pagination={{ pageSize: 10 }} expandable={{ expandedRowRender: item => <Table size="small" rowKey="key" dataSource={historyDiff(item)} columns={diffColumns} pagination={false} /> }} columns={[
        { title: "时间", dataIndex: "created_at", render: value => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) },
        { title: "修改人", dataIndex: "actor_name" }, { title: "原因", dataIndex: "reason" },
      ]} />}
    </Drawer>
    <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>数据库连接、对象存储密钥、内部服务地址和 Worker 并发等部署参数继续由服务器配置维护。</Typography.Paragraph>
  </Card></Space>;
}
