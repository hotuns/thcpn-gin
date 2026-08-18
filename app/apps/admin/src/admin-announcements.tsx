// @ts-nocheck
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App as AntApp, Button, Card, DatePicker, Form, Input, Modal, Select, Space, Table, Tabs, Tag } from "@thcpn/admin-ui";
import { api, formatApiError } from "@thcpn/api";
import { PageHeader, Panel, StateView } from "@thcpn/ui";
import { Bell, Megaphone, Plus, RefreshCw, Send } from "lucide-react";

const text = (value: unknown, fallback = "—") => value === undefined || value === null || value === "" ? fallback : String(value);
const time = (value: unknown) => value ? new Date(String(value)).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const status = { draft: "草稿", published: "已发布", archived: "已归档" };
const levelColor = { info: "blue", success: "green", warning: "gold", error: "red" };

export function AdminAnnouncementsPage() {
  const { message } = AntApp.useApp();
  const client = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();
  const [sendForm] = Form.useForm();
  const [sending, setSending] = useState(false);
  const query = useQuery({ queryKey: ["admin", "announcements"], queryFn: () => api.admin.announcements.list() });
  const workspaces = useQuery({ queryKey: ["admin", "announcement-workspaces"], queryFn: () => api.workspaces.adminList({ page_size: 200 }) });
  const rows = query.data?.items ?? [];
  const workspaceOptions = (workspaces.data?.items ?? []).map((item) => ({ value: text(item.id), label: text(item.name) }));

  const create = async () => {
    const values = await form.validateFields();
    await api.admin.announcements.create({ ...values, expires_at: values.expires_at?.toISOString(), workspace_id: values.audience_type === "workspace" ? values.workspace_id : undefined });
    setCreateOpen(false); form.resetFields(); await client.invalidateQueries({ queryKey: ["admin", "announcements"] }); void message.success(values.status === "published" ? "公告已发布" : "草稿已保存");
  };
  const setStatus = async (id: string, next: string) => { await api.admin.announcements.setStatus(id, next); await client.invalidateQueries({ queryKey: ["admin", "announcements"] }); void message.success(next === "published" ? "公告已发布" : "公告已归档"); };
  const send = async () => {
    const values = await sendForm.validateFields(); setSending(true);
    try { const result = await api.admin.announcements.sendNotification({ ...values, user_id: values.target_type === "user" ? values.user_id : undefined, workspace_id: values.target_type === "workspace" ? values.workspace_id : undefined, expires_at: values.expires_at?.toISOString() }); sendForm.resetFields(); void message.success(`提醒已发送给 ${Number(result.created_count ?? 0)} 位用户`); }
    catch (error) { void message.error(formatApiError(error).message); } finally { setSending(false); }
  };

  return <>
    <PageHeader eyebrow="Communication / messages" title="通知与公告" description="向平台用户发布公告，或针对工作区和个人发送站内提醒。" actions={<Button icon={<RefreshCw size={14} />} onClick={() => void query.refetch()}>刷新</Button>} />
    <Tabs className="admin-message-tabs" items={[
      { key: "announcements", label: <span><Megaphone size={15} />公告管理</span>, children: <Panel>
        <div className="admin-message-toolbar"><div><strong>公告列表</strong><span>平台公告对所有用户可见，工作区公告仅对对应成员可见。</span></div><Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>新建公告</Button></div>
        {query.isLoading ? <StateView type="loading" title="正在加载公告" description="正在读取公告记录。" /> : query.error ? <StateView type="error" title="公告加载失败" description={formatApiError(query.error).message} /> : <Table rowKey="id" dataSource={rows} pagination={{ pageSize: 15 }} columns={[
          { title: "公告", render: (_, item) => <div className="admin-message-title"><strong>{text(item.title)}</strong><span>{text(item.content)}</span></div> },
          { title: "范围", width: 150, render: (_, item) => <Tag>{item.audience_type === "workspace" ? "指定工作区" : "全平台"}</Tag> },
          { title: "级别", width: 100, render: (_, item) => <Tag color={levelColor[item.level]}>{text(item.level)}</Tag> },
          { title: "状态", width: 100, render: (_, item) => <Tag color={item.status === "published" ? "green" : item.status === "archived" ? "default" : "gold"}>{status[item.status] ?? text(item.status)}</Tag> },
          { title: "发布时间", width: 180, render: (_, item) => time(item.published_at) },
          { title: "操作", width: 150, render: (_, item) => <Space>{item.status === "draft" && <Button type="link" onClick={() => void setStatus(text(item.id), "published")}>发布</Button>}{item.status !== "archived" && <Button type="link" danger onClick={() => void setStatus(text(item.id), "archived")}>归档</Button>}</Space> },
        ]} />}
      </Panel> },
      { key: "notifications", label: <span><Bell size={15} />发送提醒</span>, children: <div className="admin-send-layout"><Card><div className="admin-send-intro"><div><Send size={20} /></div><h2>发送站内提醒</h2><p>提醒会进入用户通知中心。向工作区发送时，当前所有有效成员都会收到一条独立提醒。</p></div></Card><Panel><Form form={sendForm} layout="vertical" initialValues={{ target_type: "workspace", category: "system", level: "info" }} onFinish={() => void send()}>
        <Form.Item name="target_type" label="接收对象" rules={[{ required: true }]}><Select options={[{ value: "workspace", label: "工作区全体成员" }, { value: "user", label: "指定用户" }]} /></Form.Item>
        <Form.Item noStyle shouldUpdate>{({ getFieldValue }) => getFieldValue("target_type") === "workspace" ? <Form.Item name="workspace_id" label="工作区" rules={[{ required: true, message: "请选择工作区" }]}><Select showSearch optionFilterProp="label" placeholder="选择工作区" options={workspaceOptions} /></Form.Item> : <Form.Item name="user_id" label="用户 ID" rules={[{ required: true, message: "请输入用户 ID" }]}><Input placeholder="用户 UUID" /></Form.Item>}</Form.Item>
        <div className="admin-form-grid"><Form.Item name="category" label="提醒类型"><Select options={[{ value: "system", label: "系统" }, { value: "billing", label: "订阅" }, { value: "device", label: "设备" }, { value: "export", label: "数据导出" }, { value: "security", label: "安全" }]} /></Form.Item><Form.Item name="level" label="级别"><Select options={[{ value: "info", label: "普通" }, { value: "success", label: "成功" }, { value: "warning", label: "警告" }, { value: "error", label: "重要" }]} /></Form.Item></div>
        <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}><Input maxLength={160} /></Form.Item><Form.Item name="content" label="内容" rules={[{ required: true, message: "请输入内容" }]}><Input.TextArea rows={5} maxLength={4000} showCount /></Form.Item>
        <div className="admin-form-grid"><Form.Item name="action_url" label="跳转地址（可选）"><Input placeholder="例如 /subscription" /></Form.Item><Form.Item name="expires_at" label="失效时间（可选）"><DatePicker showTime style={{ width: "100%" }} /></Form.Item></div>
        <Button type="primary" htmlType="submit" loading={sending} icon={<Send size={14} />}>发送提醒</Button>
      </Form></Panel></div> },
    ]} />
    <Modal title="新建公告" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => void create()} okText="保存" width={640} destroyOnClose><Alert type="info" showIcon message="已发布公告会立即出现在对应用户的通知中心。" /><Form form={form} layout="vertical" initialValues={{ audience_type: "all", level: "info", status: "draft" }}>
      <Form.Item name="title" label="公告标题" rules={[{ required: true }]}><Input maxLength={160} /></Form.Item><Form.Item name="content" label="公告内容" rules={[{ required: true }]}><Input.TextArea rows={6} maxLength={8000} showCount /></Form.Item>
      <div className="admin-form-grid"><Form.Item name="audience_type" label="发布范围"><Select options={[{ value: "all", label: "全平台用户" }, { value: "workspace", label: "指定工作区" }]} /></Form.Item><Form.Item noStyle shouldUpdate>{({ getFieldValue }) => getFieldValue("audience_type") === "workspace" ? <Form.Item name="workspace_id" label="工作区" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={workspaceOptions} /></Form.Item> : <Form.Item name="level" label="公告级别"><Select options={[{ value: "info", label: "普通" }, { value: "success", label: "成功" }, { value: "warning", label: "警告" }, { value: "error", label: "重要" }]} /></Form.Item>}</Form.Item></div>
      <div className="admin-form-grid"><Form.Item name="status" label="保存方式"><Select options={[{ value: "draft", label: "保存为草稿" }, { value: "published", label: "立即发布" }]} /></Form.Item><Form.Item name="expires_at" label="自动失效（可选）"><DatePicker showTime style={{ width: "100%" }} /></Form.Item></div>
      <Form.Item noStyle shouldUpdate>{({ getFieldValue }) => getFieldValue("audience_type") === "workspace" && <Form.Item name="level" label="公告级别"><Select options={[{ value: "info", label: "普通" }, { value: "success", label: "成功" }, { value: "warning", label: "警告" }, { value: "error", label: "重要" }]} /></Form.Item>}</Form.Item>
    </Form></Modal>
  </>;
}
