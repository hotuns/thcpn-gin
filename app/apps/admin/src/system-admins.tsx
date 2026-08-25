// @ts-nocheck
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App as AntApp, Button, Form, Input, Modal, Space, Table, Tag } from "@thcpn/admin-ui";
import { api, formatApiError } from "@thcpn/api";
import { useAdminAuth } from "@thcpn/auth";
import { PageHeader, Panel, StateView } from "@thcpn/ui";
import { KeyRound, LockKeyhole, LogOut, Plus, UserX } from "lucide-react";

const time = (value) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "从未登录";

export function SystemAdminsPage() {
  const { admin } = useAdminAuth();
  const { message } = AntApp.useApp();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "administrators"], queryFn: () => api.admin.administrators.list() });
  const [createOpen, setCreateOpen] = useState(false);
  const [target, setTarget] = useState(null);
  const [action, setAction] = useState("");
  const [password, setPassword] = useState("");
  const [createForm] = Form.useForm();
  const [actionForm] = Form.useForm();
  const refresh = () => client.invalidateQueries({ queryKey: ["admin", "administrators"] });
  const create = async () => { try { const values = await createForm.validateFields(); const result = await api.admin.administrators.create(values); setCreateOpen(false); createForm.resetFields(); setPassword(result.temporary_password); await refresh(); } catch (error) { if (!error?.errorFields) void message.error(formatApiError(error).message); } };
  const run = async () => { try { const values = await actionForm.validateFields(); if (action === "status") await api.admin.administrators.updateStatus(target.id, { ...values, status: target.status === "active" ? "disabled" : "active", confirm_text: "确认" }); if (action === "unlock") await api.admin.administrators.unlock(target.id, values); if (action === "logout") await api.admin.administrators.revokeAllSessions(target.id, values); if (action === "password") { const result = await api.admin.administrators.temporaryPassword(target.id, { ...values, confirm_text: "重置密码" }); setPassword(result.temporary_password); } setAction(""); setTarget(null); actionForm.resetFields(); await refresh(); void message.success("操作已完成"); } catch (error) { if (!error?.errorFields) void message.error(formatApiError(error).message); } };
  const openAction = (item, value) => { setTarget(item); setAction(value); actionForm.resetFields(); };
  const columns = [
    { title: "管理员", render: (_, item) => <div><strong>{item.name}</strong><div className="cell-sub">{item.email}{item.id === admin?.id ? " · 当前账号" : ""}</div></div> },
    { title: "状态", width: 90, render: (_, item) => <Tag color={item.status === "active" ? "green" : "default"}>{item.status === "active" ? "启用" : "停用"}</Tag> },
    { title: "安全状态", width: 110, render: (_, item) => item.locked_until && new Date(item.locked_until) > new Date() ? <Tag color="red">已锁定</Tag> : "正常" },
    { title: "最近登录", width: 180, render: (_, item) => time(item.last_login_at) },
    { title: "创建时间", width: 180, render: (_, item) => time(item.created_at) },
    { title: "操作", width: 340, render: (_, item) => <Space wrap><Button size="small" icon={<UserX size={13} />} disabled={item.id === admin?.id && item.status === "active"} onClick={() => openAction(item, "status")}>{item.status === "active" ? "停用" : "启用"}</Button><Button size="small" icon={<LockKeyhole size={13} />} onClick={() => openAction(item, "unlock")}>解锁</Button><Button size="small" icon={<KeyRound size={13} />} onClick={() => openAction(item, "password")}>重置密码</Button><Button size="small" icon={<LogOut size={13} />} onClick={() => openAction(item, "logout")}>强制下线</Button></Space> },
  ];
  return <>
    <PageHeader eyebrow="SYSTEM / ADMINISTRATORS" title="管理员账号" description="管理独立的系统后台账号、登录状态和密码。" actions={<Button type="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>创建管理员</Button>} />
    <Panel>{query.isError ? <StateView type="error" title="管理员账号加载失败" description={formatApiError(query.error).message} /> : <Table rowKey="id" loading={query.isLoading} dataSource={query.data?.items ?? []} columns={columns} pagination={false} scroll={{ x: 1050 }} />}</Panel>
    <Modal title="创建系统管理员" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => void create()} okText="创建"><Form form={createForm} layout="vertical"><Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="email" label="登录邮箱" rules={[{ required: true, type: "email" }]}><Input /></Form.Item><Form.Item name="reason" label="创建原因" rules={[{ required: true, min: 5, message: "请填写至少 5 个字符" }]}><Input.TextArea rows={3} /></Form.Item></Form></Modal>
    <Modal title={{ status: target?.status === "active" ? "停用管理员" : "启用管理员", unlock: "解除登录锁定", password: "重置管理员密码", logout: "强制全部下线" }[action]} open={Boolean(action)} onCancel={() => setAction("")} onOk={() => void run()} okText="确认执行"><Form form={actionForm} layout="vertical"><Form.Item name="reason" label="操作原因" rules={[{ required: true, min: 5, message: "请填写至少 5 个字符" }]}><Input.TextArea rows={3} /></Form.Item>{action === "status" && <Form.Item name="confirm_text" label="确认文本：确认" rules={[{ required: true }]}><Input placeholder="确认" /></Form.Item>}{action === "password" && <Form.Item name="confirm_text" label="确认文本：重置密码" rules={[{ required: true }]}><Input placeholder="重置密码" /></Form.Item>}</Form></Modal>
    <Modal title="临时密码仅显示一次" open={Boolean(password)} onCancel={() => setPassword("")} footer={<Button type="primary" onClick={() => { void navigator.clipboard.writeText(password); setPassword(""); void message.success("密码已复制"); }}>复制并关闭</Button>}><Alert type="warning" showIcon message="请通过安全渠道交付。重置密码后该管理员的现有会话已失效。" /><div className="temporary-password">{password}</div></Modal>
  </>;
}
