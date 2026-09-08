// @ts-nocheck
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, App as AntApp, Button, Card, Descriptions, Drawer, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Tooltip } from "@thcpn/admin-ui";
import { api, formatApiError } from "@thcpn/api";
import { PageHeader, Panel, StateView } from "@thcpn/ui";
import { ArrowLeft, Copy, KeyRound, LockKeyhole, MonitorPlay, Plus, RefreshCw, Settings2, ShieldCheck, Trash2, UserRound, UserX } from "lucide-react";

const text = (value, fallback = "—") => value === undefined || value === null || value === "" ? fallback : String(value);
const time = (value) => value ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const statusLabel = (value) => ({ active: "启用", disabled: "停用" }[value] ?? text(value));
const statusColor = (value) => value === "active" ? "green" : "default";
const detailTabs = ["overview", "workspaces", "security", "activity"];

function ErrorState({ error, title = "用户数据加载失败" }) {
  const detail = formatApiError(error);
  return <StateView type="error" title={title} description={detail.message} requestId={detail.requestId} />;
}

function CopyId({ value }) {
  const { message } = AntApp.useApp();
  return <Tooltip title="复制 ID"><Button type="text" size="small" icon={<Copy size={13} />} onClick={() => { void navigator.clipboard.writeText(value); void message.success("ID 已复制"); }} /></Tooltip>;
}

function ReasonFields({ form, confirm, highRisk = false }) {
  return <>
    <Form.Item name="reason" label="操作原因" rules={[{ required: true, min: 5, message: "请填写至少 5 个字符的原因" }]}><Input.TextArea rows={3} placeholder="例如：配合账号安全排查" /></Form.Item>
    {highRisk && <Form.Item name="confirm_text" label={`确认文本：${confirm}`} rules={[{ required: true, message: `请输入“${confirm}”` }]}><Input placeholder={confirm} /></Form.Item>}
  </>;
}

export function AdminUsersPage() {
  const [params, setParams] = useSearchParams();
  const [keyword, setKeyword] = useState(params.get("q") ?? "");
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();
  const [password, setPassword] = useState("");
  const { message } = AntApp.useApp();
  const filters = useMemo(() => ({ q: params.get("q") || undefined, status: params.get("status") || undefined, verification: params.get("verification") || undefined, mfa: params.get("mfa") || undefined, locked: params.get("locked") || undefined, login_status: params.get("login_status") || undefined, page: Number(params.get("page") || 1), page_size: 20 }), [params]);
  const query = useQuery({ queryKey: ["admin", "users", filters], queryFn: () => api.admin.users.list(filters) });
  const apply = (key, value) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); next.set("page", "1"); setParams(next); };
  const submitSearch = () => apply("q", keyword.trim());
  const create = async () => { try { const values = await form.validateFields(); const result = await api.admin.users.create(values); setCreateOpen(false); form.resetFields(); setPassword(String(result.temporary_password ?? "")); void message.success("用户已创建"); } catch (error) { if (!error?.errorFields) void message.error(formatApiError(error).message); } };
  const items = query.data?.items ?? [];
  const columns = [
    { title: "用户", fixed: "left", width: 230, render: (_, item) => <Link className="admin-user-name" to={`/admin/users/${item.id}?tab=overview`}><strong>{text(item.name)}</strong><span>{text(item.email, text(item.phone))}</span></Link> },
    { title: "状态", width: 90, render: (_, item) => <Tag color={statusColor(item.status)}>{statusLabel(item.status)}</Tag> },
    { title: "工作区", dataIndex: "workspace_count", width: 110, render: (value) => `${value ?? 0} 个` },
    { title: "MFA", width: 90, render: (_, item) => item.mfa_enabled ? <Tag color="green">已启用</Tag> : <Tag>未启用</Tag> },
    { title: "活跃会话", dataIndex: "active_session_count", width: 100 },
    { title: "最近登录", dataIndex: "last_login_at", width: 170, render: time },
    { title: "注册时间", dataIndex: "created_at", width: 170, render: time },
    { title: "账号状态", width: 130, render: (_, item) => item.locked ? <Tag color="red">已锁定</Tag> : item.must_change_password ? <Tag color="gold">待改密</Tag> : "正常" },
    { title: "操作", width: 100, fixed: "right", render: (_, item) => <Link to={`/admin/users/${item.id}?tab=overview`}><Button type="link" icon={<Settings2 size={14} />}>管理</Button></Link> },
  ];
  return <>
    <PageHeader eyebrow="SYSTEM / USERS" title="用户管理" description="管理普通平台用户账号；系统管理员账号保持独立，不在此列表中。" actions={<Button type="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>创建用户</Button>} />
    <Panel className="admin-user-list-panel">
      <div className="admin-user-toolbar">
        <Input.Search value={keyword} onChange={(event) => setKeyword(event.target.value)} onSearch={submitSearch} placeholder="搜索姓名、邮箱、手机号或用户 ID" allowClear />
        <Select value={params.get("status") || undefined} onChange={(value) => apply("status", value)} placeholder="账号状态" allowClear options={[{ value: "active", label: "启用" }, { value: "disabled", label: "停用" }]} />
        <Select value={params.get("verification") || undefined} onChange={(value) => apply("verification", value)} placeholder="验证状态" allowClear options={[{ value: "verified", label: "已验证" }, { value: "unverified", label: "未验证" }]} />
        <Select value={params.get("mfa") || undefined} onChange={(value) => apply("mfa", value)} placeholder="MFA" allowClear options={[{ value: "enabled", label: "已启用 MFA" }, { value: "disabled", label: "未启用 MFA" }]} />
        <Button icon={<RefreshCw size={14} />} onClick={() => void query.refetch()}>刷新</Button>
      </div>
      {query.isError ? <ErrorState error={query.error} /> : <Table rowKey="id" loading={query.isLoading} columns={columns} dataSource={items} scroll={{ x: 1180 }} pagination={{ current: filters.page, pageSize: 20, total: query.data?.total ?? 0, showSizeChanger: false, onChange: (page) => apply("page", String(page)) }} />}
    </Panel>
    <Modal title="创建平台用户" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => void create()} okText="创建用户" destroyOnHidden><Alert type="info" showIcon message="系统会生成一次性临时密码，用户首次登录必须修改。" style={{ marginBottom: 16 }} /><Form form={form} layout="vertical"><Form.Item name="name" label="姓名" rules={[{ required: true, message: "请输入姓名" }]}><Input /></Form.Item><Form.Item name="email" label="邮箱"><Input type="email" /></Form.Item><Form.Item name="phone" label="手机号"><Input /></Form.Item><Form.Item name="reason" label="创建原因" rules={[{ required: true, min: 5, message: "请填写至少 5 个字符的原因" }]}><Input.TextArea rows={3} /></Form.Item></Form></Modal>
    <Modal title="临时密码仅显示一次" open={Boolean(password)} onCancel={() => setPassword("")} footer={<Button type="primary" onClick={() => { void navigator.clipboard.writeText(password); void message.success("临时密码已复制"); }}>复制并关闭</Button>}><Alert type="warning" showIcon message="请通过安全渠道交付给用户，关闭后无法再次查看。" /><div className="temporary-password">{password}</div></Modal>
  </>;
}

function UserOverview({ user, onEdit }) {
  return <div className="admin-user-overview"><Card size="small" title="账号资料" extra={<Button type="link" onClick={onEdit}>编辑</Button>}><Descriptions column={{ xs: 1, sm: 2 }} size="small" items={[{ key: "name", label: "姓名", children: text(user.name) }, { key: "email", label: "邮箱", children: <>{text(user.email)} {user.email_verified_at && <Tag color="green">已验证</Tag>}</> }, { key: "phone", label: "手机号", children: <>{text(user.phone)} {user.phone_verified_at && <Tag color="green">已验证</Tag>}</> }, { key: "status", label: "账号状态", children: <Tag color={statusColor(user.status)}>{statusLabel(user.status)}</Tag> }, { key: "created", label: "注册时间", children: time(user.created_at) }, { key: "id", label: "用户 ID", children: <Space><span className="mono">{user.id}</span><CopyId value={user.id} /></Space> }]} /></Card><div className="grid grid-4"><Card size="small"><strong>{user.workspace_count ?? 0}</strong><span>工作区</span></Card><Card size="small"><strong>{user.active_session_count ?? 0}</strong><span>活跃会话</span></Card><Card size="small"><strong>{user.mfa_enabled ? "已启用" : "未启用"}</strong><span>MFA</span></Card><Card size="small"><strong>{user.last_login_at ? time(user.last_login_at) : "从未登录"}</strong><span>最近登录</span></Card></div></div>;
}

export function AdminUserDetailPage() {
  const { userId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { message } = AntApp.useApp();
  const [action, setAction] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState("");
  const [editForm] = Form.useForm();
  const user = useQuery({ queryKey: ["admin", "user", userId], queryFn: () => api.admin.users.get(userId), enabled: Boolean(userId) });
  const workspaces = useQuery({ queryKey: ["admin", "user", userId, "workspaces"], queryFn: () => api.admin.users.workspaces(userId), enabled: Boolean(userId) && params.get("tab") === "workspaces" });
  const sessions = useQuery({ queryKey: ["admin", "user", userId, "sessions"], queryFn: () => api.admin.users.sessions(userId), enabled: Boolean(userId) && params.get("tab") === "security" });
  const activity = useQuery({ queryKey: ["admin", "user", userId, "activity"], queryFn: () => api.admin.users.activity(userId, { page: 1, page_size: 100 }), enabled: Boolean(userId) && params.get("tab") === "activity" });
  const deletion = useQuery({ queryKey: ["admin", "user", userId, "deletion"], queryFn: () => api.admin.users.deletionCheck(userId), enabled: Boolean(userId) && params.get("tab") === "security" });
  const demo = useQuery({ queryKey: ["admin", "demo-showcase"], queryFn: api.admin.demoShowcase.get, retry: false });
  if (user.isLoading) return <div className="app-loading">正在加载用户…</div>;
  if (user.isError) return <ErrorState error={user.error} title="用户详情加载失败" />;
  const item = user.data;
  const runAction = async (values) => { try { if (action === "status") await api.admin.users.updateStatus(userId, { status: item.status === "active" ? "disabled" : "active", ...values }); if (action === "logout") await api.admin.users.revokeAllSessions(userId, values); if (action === "unlock") await api.admin.users.unlock(userId, values); if (action === "mfa") await api.admin.users.resetMFA(userId, values); if (action === "password") { const result = await api.admin.users.temporaryPassword(userId, { ...values, confirm_text: "重置密码" }); setTempPassword(result.temporary_password); } if (action === "delete") await api.admin.users.remove(userId, { ...values, confirm_text: "删除用户" }); setAction(""); await client.invalidateQueries({ queryKey: ["admin", "user", userId] }); if (action === "delete") navigate("/admin/users"); else void message.success("操作已完成"); } catch (error) { void message.error(formatApiError(error).message); } };
  const openEdit = () => { editForm.setFieldsValue({ name: item.name, email: item.email ?? "", phone: item.phone ?? "" }); setEditOpen(true); };
  const saveEdit = async () => { try { const values = await editForm.validateFields(); await api.admin.users.update(userId, values); setEditOpen(false); await client.invalidateQueries({ queryKey: ["admin", "user", userId] }); void message.success("用户资料已更新"); } catch (error) { if (!error?.errorFields) void message.error(formatApiError(error).message); } };
  const tab = params.get("tab") || "overview";
  const setTab = (key) => { const next = new URLSearchParams(params); next.set("tab", key); setParams(next); };
  const actionTitle = ({ status: item.status === "active" ? "停用用户" : "启用用户", logout: "强制下线", unlock: "解除锁定", mfa: "重置 MFA", password: "生成临时密码", delete: "删除用户" }[action]);
  return <>
    <div className="admin-user-detail-head"><Button icon={<ArrowLeft size={15} />} onClick={() => navigate("/admin/users")}>用户列表</Button><div><h1>{text(item.name)}</h1><span>{text(item.email, text(item.phone))} · <span className="mono">{item.id}</span></span></div>{demo.data?.user_id === userId ? <Tag color="blue">演示账号</Tag> : <Button icon={<MonitorPlay size={14}/>} onClick={() => void api.admin.demoShowcase.configure(userId).then(() => client.invalidateQueries({queryKey:["admin","demo-showcase"]})).then(() => message.success("已设为演示账号")).catch((error) => message.error(formatApiError(error).message))}>设为演示账号</Button>}<Tag color={statusColor(item.status)}>{statusLabel(item.status)}</Tag><CopyId value={item.id} /></div>
    <Panel className="admin-user-detail-panel"><Tabs activeKey={tab} onChange={setTab} items={[{ key: "overview", label: "概览", children: <UserOverview user={item} onEdit={openEdit} /> },...(demo.data?.user_id === userId ? [{key:"demo",label:"演示设备",children:<DemoShowcasePanel/>}] : []), { key: "workspaces", label: "工作区", children: workspaces.isError ? <ErrorState error={workspaces.error} /> : <Table rowKey="id" loading={workspaces.isLoading} dataSource={workspaces.data?.items ?? []} columns={[{ title: "工作区", render: (_, row) => <Link to={`/admin/workspaces/${row.id}?tab=overview`}>{row.name}</Link> }, { title: "类型", dataIndex: "type" }, { title: "角色", render: (_, row) => <Tag>{text(row.role_name, row.role_code)}</Tag> }, { title: "状态", render: (_, row) => statusLabel(row.status) }, { title: "加入时间", dataIndex: "joined_at", render: time }]} /> }, { key: "security", label: "登录安全", children: <div className="admin-user-security"><Space wrap><Button icon={<UserX size={14} />} onClick={() => setAction("status")}>{item.status === "active" ? "停用账号" : "启用账号"}</Button><Button icon={<LockKeyhole size={14} />} onClick={() => setAction("unlock")} disabled={!item.locked}>解除锁定</Button><Button icon={<KeyRound size={14} />} onClick={() => setAction("password")}>生成临时密码</Button><Button icon={<ShieldCheck size={14} />} onClick={() => setAction("mfa")}>重置 MFA</Button><Button onClick={() => setAction("logout")}>强制全部下线</Button></Space><Card size="small" title="活跃会话" style={{ marginTop: 16 }}><Table rowKey="id" loading={sessions.isLoading} dataSource={sessions.data?.items ?? []} columns={[{ title: "客户端", dataIndex: "user_agent", render: text }, { title: "IP", dataIndex: "client_ip", render: text }, { title: "最近使用", dataIndex: "last_used_at", render: time }, { title: "过期时间", dataIndex: "expires_at", render: time }]} pagination={false} /></Card>{deletion.data && <Card size="small" title="删除检查" style={{ marginTop: 16 }}>{deletion.data.can_delete ? <Alert type="success" message="没有发现业务阻塞，可以进行受限物理删除。" action={<Button danger onClick={() => setAction("delete")}>删除用户</Button>} /> : <Alert type="warning" message="当前用户不能删除" description={<Space direction="vertical">{(deletion.data.blockers ?? []).map((blocker) => <span key={blocker.code}>{blocker.label}：{blocker.count}</span>)}</Space>} />}</Card>}</div> }, { key: "activity", label: "操作记录", children: activity.isError ? <ErrorState error={activity.error} /> : <Table rowKey="id" loading={activity.isLoading} dataSource={activity.data?.items ?? []} columns={[{ title: "时间", dataIndex: "created_at", render: time }, { title: "操作者", render: (_, row) => text(row.actor_name, row.actor_type) }, { title: "操作", dataIndex: "action" }, { title: "结果", render: (_, row) => <Tag color={row.result === "success" ? "green" : "red"}>{row.result === "success" ? "成功" : "失败"}</Tag> }, { title: "request ID", dataIndex: "request_id", render: text }]} /> }]} /></Panel>
    <Modal title={actionTitle} open={Boolean(action)} onCancel={() => setAction("")} onOk={() => document.getElementById("admin-user-action-form")?.requestSubmit()} okText="确认执行"><Form id="admin-user-action-form" onFinish={runAction} layout="vertical"><ReasonFields highRisk={action === "status" || action === "mfa" || action === "password" || action === "delete"} confirm={{ status: "确认", mfa: "重置 MFA", password: "重置密码", delete: "删除用户" }[action]} /></Form></Modal>
    <Modal title="临时密码" open={Boolean(tempPassword)} onCancel={() => setTempPassword("")} footer={<Button type="primary" onClick={() => { void navigator.clipboard.writeText(tempPassword); setTempPassword(""); }}>复制并关闭</Button>}><Alert type="warning" message="只显示一次，请通过安全渠道交付。" /><div className="temporary-password">{tempPassword}</div></Modal>
    <Drawer title="编辑用户资料" open={editOpen} onClose={() => setEditOpen(false)} extra={<Button type="primary" onClick={() => void saveEdit()}>保存</Button>}><Form form={editForm} layout="vertical"><Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="email" label="邮箱"><Input /></Form.Item><Form.Item name="phone" label="手机号"><Input /></Form.Item><Form.Item name="reason" label="修改原因" rules={[{ required: true, min: 5, message: "请填写至少 5 个字符的原因" }]}><Input.TextArea rows={3} /></Form.Item></Form></Drawer>
  </>;
}

function DemoShowcasePanel(){const [keyword,setKeyword]=useState("");const [deviceType,setDeviceType]=useState<string>();const client=useQueryClient();const {message}=AntApp.useApp();const query=useQuery({queryKey:["admin","demo-showcase","devices",keyword],queryFn:()=>api.admin.demoShowcase.devices(keyword)});const items=query.data?.items??[];const deviceTypeLabels={standalone:"标准站",gateway:"组网站",gateway_node:"节点",carbon_sink:"碳汇站",camera:"监控站"};const deviceTypeOptions=Array.from(new Set(items.map((row)=>row.device_type).filter(Boolean))).map((value)=>({value,label:deviceTypeLabels[value]??value}));const filteredItems=deviceType?items.filter((row)=>row.device_type===deviceType):items;const change=async(row)=>{try{if(row.selected)await api.admin.demoShowcase.removeDevice(row.id);else await api.admin.demoShowcase.addDevice(row.id);await client.invalidateQueries({queryKey:["admin","demo-showcase","devices"]});void message.success(row.selected?"已移出演示清单":"已加入演示清单")}catch(error){void message.error(formatApiError(error).message)}};return <div><Alert type="info" showIcon message="精选设备保留原组织归属，演示账号将在演示空间中跨组织查看和操作。转移、解绑、认领和删除始终禁止。"/><Space style={{margin:"16px 0"}} wrap><Input.Search style={{width:480}} value={keyword} onChange={(event)=>setKeyword(event.target.value)} placeholder="搜索设备名称或 SN" allowClear/><Select style={{width:180}} value={deviceType} onChange={setDeviceType} placeholder="全部设备类型" allowClear options={deviceTypeOptions}/></Space><Table rowKey="id" loading={query.isLoading} dataSource={filteredItems} pagination={{pageSize:20}} columns={[{title:"设备",render:(_,row)=><div><strong>{row.name}</strong><div className="cell-sub mono">{row.serial_no}</div></div>},{title:"形态",dataIndex:"device_type",width:100},{title:"原组织",render:(_,row)=><div>{text(row.workspace_name,"未分配")}<div className="cell-sub">{[row.project_name,row.site_name].filter(Boolean).join(" / ")||"未设置项目/样地"}</div></div>},{title:"状态",dataIndex:"status",width:90},{title:"演示清单",width:130,render:(_,row)=>row.selected?<Button danger icon={<Trash2 size={14}/>} onClick={()=>void change(row)}>移出</Button>:<Button type="primary" onClick={()=>void change(row)}>加入</Button>}]}/></div>}
