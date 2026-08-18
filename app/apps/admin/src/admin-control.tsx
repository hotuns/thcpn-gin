// Governance records contain extensible permission and resource metadata.
// @ts-nocheck
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Segmented,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
} from "@thcpn/admin-ui";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { Badge, PageHeader, Panel, StateView } from "@thcpn/ui";
import {
  ArrowLeft,
  Copy,
  Edit3,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
} from "lucide-react";

const text = (value: unknown, fallback = "—") => value === undefined || value === null || value === "" ? fallback : String(value);
const shortId = (value: unknown) => text(value).slice(0, 8);
const time = (value: unknown) => value ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value))) : "—";
const statusLabel = (value: unknown) => ({ active: "启用", disabled: "停用", archived: "已归档", removed: "已移除", pending: "待处理", revoked: "已撤销", expired: "已过期", success: "成功", failure: "失败" })[String(value)] ?? text(value);
const typeLabel = (value: unknown) => ({ personal: "个人", organization: "组织" })[String(value)] ?? text(value);
const orgLabel = (value: unknown) => ({ lab: "实验室", institution: "机构", company: "企业", government: "政府", service_provider: "服务商", other: "其他" })[String(value)] ?? text(value);
const scopeLabel = (value: unknown) => ({ workspace: "工作区", project: "项目", site: "站点", device: "设备", dataset: "数据集" })[String(value)] ?? text(value);
const actionLabel = (value: unknown) => ({ "workspace.intervention.start": "开启管理员介入", "workspace.intervention.end": "结束管理员介入", "workspace.status.update": "修改工作区状态", "workspace.owner.transfer": "转移 Owner", "member.add": "添加成员", "member.role_update": "调整成员权限", "member.remove": "移除成员", "project.update": "修改项目", "site.update": "修改站点", "access_grant.revoke": "撤销共享", "invitation.revoke": "撤销邀请" })[String(value)] ?? text(value);

function ErrorState({ error, title }: { error: unknown; title: string }) {
  const detail = formatApiError(error);
  return <StateView type="error" title={title} description={detail.message} requestId={detail.requestId} />;
}

function CopyID({ value }: { value: string }) {
  const { message } = AntApp.useApp();
  return <Tooltip title="复制 ID"><Button type="text" size="small" icon={<Copy size={13} />} onClick={() => { void navigator.clipboard.writeText(value); void message.success("ID 已复制"); }} /></Tooltip>;
}

function riskTags(risks: JsonRecord[] = []) {
  if (!risks.length) return <Tag color="green">无风险</Tag>;
  return <Space size={[4, 4]} wrap>{risks.map((risk) => <Tag key={text(risk.code)} color={risk.code === "workspace_disabled" || risk.code === "owner_unavailable" ? "red" : "gold"}>{text(risk.label)}{risk.count ? ` ${risk.count}` : ""}</Tag>)}</Space>;
}

const billingRiskLabel = (value: unknown) => ({ professional_expiring: "即将到期", professional_expired: "已到期", download_usage_warning: "流量预警" })[String(value)] ?? text(value);

export function AdminBillingPage() {
  const [risk, setRisk] = useState("all");
  const [keyword, setKeyword] = useState("");
  const query = useQuery({ queryKey: ["admin", "billing-workspaces", risk], queryFn: () => api.admin.workspaces.billingRisks(risk) });
  const all = query.data?.items ?? [];
  const rows = all.filter((item) => `${text(item.workspace_name)} ${text(item.workspace_id)}`.toLowerCase().includes(keyword.toLowerCase()));
  const professional = all.filter((item) => item.billing?.plan === "professional").length;
  const expiring = all.filter((item) => item.risks?.includes("professional_expiring")).length;
  const warnings = all.filter((item) => item.risks?.includes("download_usage_warning")).length;
  return <>
    <PageHeader eyebrow="Commercial / subscriptions" title="订阅管理" description="查看所有工作区套餐、到期风险和下载用量，并进入工作区完成授权或流量包入账。" actions={<Button icon={<RefreshCw size={14} />} onClick={() => void query.refetch()}>刷新</Button>} />
    <div className="billing-overview-cards">
      <Card size="small"><span>工作区</span><strong>{risk === "all" ? all.length : "—"}</strong><small>按工作区管理商业权益</small></Card>
      <Card size="small"><span>有效专业版</span><strong>{professional}</strong><small>全部成员共享权益</small></Card>
      <Card size="small"><span>即将到期</span><strong>{expiring}</strong><small>30 天内需要跟进</small></Card>
      <Card size="small"><span>流量预警</span><strong>{warnings}</strong><small>本月使用达到阈值</small></Card>
    </div>
    <Panel className="billing-workspace-list">
      <div className="governance-toolbar billing-toolbar">
        <Input value={keyword} prefix={<Search size={15} />} allowClear placeholder="搜索工作区名称或 ID" onChange={(event) => setKeyword(event.target.value)} />
        <Segmented value={risk} onChange={setRisk} options={[{ value: "all", label: "全部" }, { value: "professional_expiring", label: "即将到期" }, { value: "professional_expired", label: "已到期" }, { value: "download_usage_warning", label: "流量预警" }]} />
      </div>
      {query.isLoading ? <StateView type="loading" title="正在加载订阅" description="正在汇总工作区套餐与本月用量。" /> : query.error ? <ErrorState error={query.error} title="订阅列表加载失败" /> : <Table rowKey="workspace_id" dataSource={rows} pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 个工作区` }} scroll={{ x: 1040 }} columns={[
        { title: "工作区", width: 280, render: (_, item) => <div><Link className="governance-primary-link" to={`/admin/workspaces/${item.workspace_id}?tab=billing`}>{text(item.workspace_name)}</Link><div className="cell-sub mono">{text(item.workspace_id)}</div></div> },
        { title: "套餐", width: 110, render: (_, item) => <Tag color={item.billing?.plan === "professional" ? "green" : "default"}>{item.billing?.plan === "professional" ? "专业版" : "基础版"}</Tag> },
        { title: "专业版有效期", width: 200, render: (_, item) => item.billing?.professional_expires_at ? <div>{time(item.billing.professional_expires_at)}<div className="cell-sub">{item.billing.plan === "professional" ? `剩余 ${item.billing.days_until_expiry ?? 0} 天` : "已恢复基础版"}</div></div> : "—" },
        { title: "本月下载", width: 220, render: (_, item) => <div><Progress size="small" percent={Math.min(100, Number(item.billing?.usage_percent ?? 0))} status={Number(item.billing?.usage_percent ?? 0) >= 100 ? "exception" : "normal"} /><div className="cell-sub">{bytes(item.billing?.monthly_download_used_bytes)} / {bytes(item.billing?.monthly_download_limit_bytes)}</div></div> },
        { title: "流量包", width: 120, render: (_, item) => bytes(item.billing?.traffic_pack_balance_bytes) },
        { title: "提醒", width: 190, render: (_, item) => item.risks?.length ? <Space wrap size={[4, 4]}>{item.risks.map((entry) => <Tag key={entry} color="gold">{billingRiskLabel(entry)}</Tag>)}</Space> : <Tag color="green">正常</Tag> },
        { title: "操作", width: 120, fixed: "right", render: (_, item) => <Link to={`/admin/workspaces/${item.workspace_id}?tab=billing`}><Button type="link">管理订阅</Button></Link> },
      ]} />}
    </Panel>
  </>;
}

export function AdminWorkspacesPage() {
  const [params, setParams] = useSearchParams();
  const [keyword, setKeyword] = useState(params.get("q") ?? "");
  const filters = {
    q: params.get("q") ?? undefined,
    type: params.get("type") ?? undefined,
    organization_type: params.get("organization_type") ?? undefined,
    status: params.get("status") ?? undefined,
    risk: params.get("risk") ?? undefined,
    sort: params.get("sort") ?? "recent_activity",
    order: params.get("order") ?? "desc",
    page: Number(params.get("page") ?? 1),
    page_size: Number(params.get("page_size") ?? 20),
  };
  const query = useQuery({ queryKey: ["admin", "workspaces", filters], queryFn: () => api.admin.workspaces.list(filters), placeholderData: (previous) => previous });
  const billingRisks = useQuery({ queryKey: ["admin", "billing-risks"], queryFn: () => api.admin.workspaces.billingRisks() });
  const update = (values: Record<string, unknown>) => {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([key, value]) => value === undefined || value === "" ? next.delete(key) : next.set(key, String(value)));
    if (!("page" in values)) next.set("page", "1");
    setParams(next, { replace: true });
  };
  const listSearch = params.toString();
  const expiring = (billingRisks.data?.items ?? []).filter((item) => item.risks?.includes("professional_expiring")).length; const expired = (billingRisks.data?.items ?? []).filter((item) => item.risks?.includes("professional_expired")).length; const usageWarnings = (billingRisks.data?.items ?? []).filter((item) => item.risks?.includes("download_usage_warning")).length;
  return <><div className="grid grid-3"><Card size="small" title="专业版即将到期"><strong>{expiring}</strong><span className="cell-sub">30 天内</span></Card><Card size="small" title="专业版已到期"><strong>{expired}</strong><span className="cell-sub">已恢复基础版</span></Card><Card size="small" title="下载流量预警"><strong>{usageWarnings}</strong><span className="cell-sub">使用量达到 80%</span></Card></div><Panel className="governance-list">
    <div className="governance-toolbar">
      <Input value={keyword} prefix={<Search size={15} />} allowClear placeholder="搜索名称、Owner 或工作区 ID" onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => update({ q: keyword })} />
      <Select allowClear value={filters.type} placeholder="全部类型" options={[{ value: "personal", label: "个人" }, { value: "organization", label: "组织" }]} onChange={(value) => update({ type: value })} />
      <Select allowClear value={filters.organization_type} placeholder="全部组织类型" options={["lab", "institution", "company", "government", "service_provider", "other"].map((value) => ({ value, label: orgLabel(value) }))} onChange={(value) => update({ organization_type: value })} />
      <Select allowClear value={filters.status} placeholder="全部状态" options={[{ value: "active", label: "启用" }, { value: "disabled", label: "停用" }]} onChange={(value) => update({ status: value })} />
      <Select allowClear value={filters.risk} placeholder="全部风险" options={[{ value: "owner_unavailable", label: "Owner 异常" }, { value: "workspace_disabled", label: "工作区停用" }, { value: "pending_invitations", label: "待处理邀请" }, { value: "recent_failures", label: "近期失败操作" }]} onChange={(value) => update({ risk: value })} />
      <Button icon={<RefreshCw size={14} />} onClick={() => void query.refetch()}>刷新</Button>
    </div>
    {query.isLoading ? <StateView type="loading" title="正在加载工作区" description="正在汇总治理信息。" /> : query.error ? <ErrorState error={query.error} title="工作区加载失败" /> : <Table rowKey="id" dataSource={query.data?.items ?? []} scroll={{ x: 1240 }} pagination={{ current: filters.page, pageSize: filters.page_size, total: query.data?.total ?? 0, showSizeChanger: true, showTotal: (total) => `共 ${total} 个`, onChange: (page, pageSize) => update({ page, page_size: pageSize }) }} onChange={(_, __, sorter) => update({ sort: sorter.field ?? "recent_activity", order: sorter.order === "ascend" ? "asc" : "desc", page: 1 })} columns={[
      { title: "工作区", dataIndex: "name", width: 270, sorter: true, render: (_, item) => <div><Link className="governance-primary-link" to={`/admin/workspaces/${item.id}?tab=overview&from=${encodeURIComponent(listSearch)}`}>{text(item.name)}</Link><div className="cell-sub mono">{text(item.id)}</div></div> },
      { title: "Owner", dataIndex: ["owner", "name"], width: 190, render: (_, item) => <div><div className="cell-title">{text(item.owner?.name)}</div><div className="cell-sub">{text(item.owner?.email, text(item.owner?.phone))}</div></div> },
      { title: "类型", dataIndex: "type", width: 90, render: (value, item) => <div>{typeLabel(value)}<div className="cell-sub">{value === "organization" ? orgLabel(item.organization_type) : ""}</div></div> },
      { title: "成员", dataIndex: ["counts", "members"], width: 88, sorter: true },
      { title: "资源", width: 160, render: (_, item) => <span>{item.counts?.projects ?? 0} 项目 / {item.counts?.sites ?? 0} 站点<br/><span className="cell-sub">{item.counts?.devices ?? 0} 台设备</span></span> },
      { title: "直接共享", dataIndex: ["counts", "direct_shares"], width: 104 },
      { title: "状态", dataIndex: "status", width: 82, render: (value) => <Tag color={value === "active" ? "green" : "red"}>{statusLabel(value)}</Tag> },
      { title: "风险", dataIndex: "risks", width: 210, render: riskTags },
      { title: "最近活动", dataIndex: "last_activity_at", width: 170, sorter: true, render: time },
      { title: "操作", width: 110, fixed: "right", render: (_, item) => <Link to={`/admin/workspaces/${item.id}?tab=overview&from=${encodeURIComponent(listSearch)}`}><Button type="link">查看详情</Button></Link> },
    ]} />}
  </Panel></>;
}

export function AdminWorkspaceDetailPage() {
  const { workspaceId = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const workspace = useQuery({ queryKey: ["admin", "workspace", workspaceId], queryFn: () => api.admin.workspaces.get(workspaceId), enabled: Boolean(workspaceId) });
  const switcher = useQuery({ queryKey: ["admin", "workspace-switcher"], queryFn: () => api.admin.workspaces.list({ page_size: 100, sort: "name", order: "asc" }) });
  const tab = params.get("tab") ?? "overview";
  const back = `/admin/workspaces${params.get("from") ? `?${params.get("from")}` : ""}`;
  const setTab = (value: string) => { const next = new URLSearchParams(params); next.set("tab", value); setParams(next, { replace: true }); };
  const switchWorkspace = (id: string) => navigate(`/admin/workspaces/${id}?tab=overview&from=${encodeURIComponent(params.get("from") ?? "")}`);
  if (workspace.isLoading) return <StateView type="loading" title="正在加载工作区" description="正在读取治理详情。" />;
  if (workspace.error) return <ErrorState error={workspace.error} title="工作区加载失败" />;
  const item = workspace.data;
  const context = { workspaceId, refresh: async () => { await queryClient.invalidateQueries({ queryKey: ["admin", "workspace", workspaceId] }); } };
  return <>
    <div className="governance-detail-head">
      <Button type="text" icon={<ArrowLeft size={15} />} onClick={() => navigate(back)}>返回列表</Button>
      <Select showSearch optionFilterProp="label" value={workspaceId} className="workspace-governance-switcher" options={(switcher.data?.items ?? []).map((entry) => ({ value: text(entry.id), label: text(entry.name) }))} onChange={switchWorkspace} />
      <div className="governance-detail-title"><strong>{text(item.name)}</strong><span>{typeLabel(item.type)}工作区 · {text(item.owner?.name)} · <span className="mono">{text(item.id)}</span><CopyID value={text(item.id)} /></span></div>
      <Tag color={item.status === "active" ? "green" : "red"}>{statusLabel(item.status)}</Tag>
      <Tag icon={<ShieldCheck size={13} />} color="blue">修改将记录审计</Tag>
    </div>
    <Panel className="governance-detail-panel">
      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: "overview", label: "概览", children: <Overview workspace={item} /> },
        { key: "billing", label: "计费", children: <Billing workspaceId={workspaceId} /> },
        { key: "members", label: "成员与权限", children: <Members {...context} /> },
        { key: "resources", label: "资源层级", children: <Resources {...context} /> },
        { key: "sharing", label: "共享与邀请", children: <Sharing {...context} /> },
        { key: "audit", label: "审计记录", children: <Audit workspaceId={workspaceId} /> },
        { key: "system", label: "系统操作", children: <SystemOperations workspace={item} {...context} /> },
      ]} />
    </Panel>
  </>;
}

const GB = 1024 ** 3;
const bytes = (value: unknown) => `${(Number(value ?? 0) / GB).toFixed(Number(value ?? 0) >= GB ? 1 : 2)} GB`;

function Billing({ workspaceId }: { workspaceId: string }) {
  const { message } = AntApp.useApp(); const client = useQueryClient(); const [grantOpen, setGrantOpen] = useState(false); const [packOpen, setPackOpen] = useState(false); const [grantForm] = Form.useForm(); const [packForm] = Form.useForm();
  const summary = useQuery({ queryKey: ["admin", "billing", workspaceId], queryFn: () => api.admin.workspaces.billing(workspaceId) });
  const history = useQuery({ queryKey: ["admin", "billing-history", workspaceId], queryFn: () => api.admin.workspaces.billingHistory(workspaceId) });
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: ["admin", "billing", workspaceId] }), client.invalidateQueries({ queryKey: ["admin", "billing-history", workspaceId] })]); };
  const grant = async () => { try { const values = await grantForm.validateFields(); const payload = { ...values, starts_at: values.starts_at?.toISOString(), ends_at: values.ends_at?.toISOString() }; await api.admin.workspaces.grantProfessional(workspaceId, values.reason, payload); setGrantOpen(false); grantForm.resetFields(); await refresh(); void message.success("专业版授权已生效"); } catch (error) { if (!(error as any)?.errorFields) void message.error(formatApiError(error).message); } };
  const addPack = async () => { try { const values = await packForm.validateFields(); await api.admin.workspaces.addTrafficPack(workspaceId, values.reason, { ...values, bytes: Number(values.size_gb) * GB, size_gb: undefined }); setPackOpen(false); packForm.resetFields(); await refresh(); void message.success("流量包已入账"); } catch (error) { if (!(error as any)?.errorFields) void message.error(formatApiError(error).message); } };
  if (summary.isLoading || history.isLoading) return <StateView type="loading" title="正在加载计费信息" description="正在汇总套餐、用量和授权流水。" />;
  if (summary.error || history.error) return <ErrorState error={summary.error ?? history.error} title="计费信息加载失败" />;
  const value = summary.data ?? {}; const professional = value.plan === "professional"; const usage = Math.min(100, Number(value.usage_percent ?? 0));
  return <div className="billing-admin"><div className="tab-toolbar"><div><Tag color={professional ? "green" : "default"}>{professional ? "专业版" : "基础版"}</Tag>{professional && <span className="cell-sub">有效至 {time(value.professional_expires_at)}</span>}</div><Space><Button onClick={() => setPackOpen(true)}>增加流量包</Button><Button type="primary" onClick={() => setGrantOpen(true)}>授予专业版</Button></Space></div>
    <div className="grid grid-3"><Card size="small" title="当前套餐"><strong>{professional ? "专业版" : "基础版永久免费"}</strong><p className="cell-sub">{professional ? `剩余 ${value.days_until_expiry ?? 0} 天` : "设备接入与基础查看不受限制"}</p></Card><Card size="small" title="本月下载"><Progress percent={Number(usage.toFixed(1))} status={usage >= 100 ? "exception" : "normal"} /><p className="cell-sub">{bytes(value.monthly_download_used_bytes)} / {bytes(value.monthly_download_limit_bytes)}</p></Card><Card size="small" title="流量扩展包"><strong>{bytes(value.traffic_pack_balance_bytes)}</strong><p className="cell-sub">专业版月度额度用尽后自动使用</p></Card></div>
    <h3 className="drawer-section-title">专业版授权记录</h3><Table rowKey="id" pagination={false} dataSource={history.data?.plan_grants ?? []} columns={[{ title: "来源", dataIndex: "source_type", render: (v) => ({ device_order: "设备订单", service_contract: "服务合同", manual_correction: "人工纠正" })[v] ?? v }, { title: "合同 / 订单", dataIndex: "reference_no", render: text }, { title: "金额", dataIndex: "amount_cents", render: (v) => `¥${(Number(v) / 100).toFixed(2)}` }, { title: "授权期间", render: (_, row) => `${time(row.starts_at)} 至 ${time(row.ends_at)}` }, { title: "原因", dataIndex: "reason" }, { title: "创建时间", dataIndex: "created_at", render: time }]} />
    <h3 className="drawer-section-title">流量包记录</h3><Table rowKey="id" pagination={false} dataSource={history.data?.traffic_pack_grants ?? []} columns={[{ title: "容量", dataIndex: "bytes", render: bytes }, { title: "金额", dataIndex: "price_cents", render: (v) => `¥${(Number(v) / 100).toFixed(2)}` }, { title: "合同 / 订单", dataIndex: "reference_no", render: text }, { title: "原因", dataIndex: "reason" }, { title: "创建时间", dataIndex: "created_at", render: time }]} />
    <Modal title="授予专业版" open={grantOpen} onCancel={() => setGrantOpen(false)} onOk={() => void grant()} okText="确认授权"><Form form={grantForm} layout="vertical" initialValues={{ source_type: "device_order", duration_months: Number(value.professional_default_months), amount_cents: Number(value.professional_annual_price_cents) }}><Form.Item name="source_type" label="授权来源" rules={[{ required: true }]}><Select options={[{ value: "device_order", label: "设备订单" }, { value: "service_contract", label: "服务合同" }, { value: "manual_correction", label: "人工纠正" }]} /></Form.Item><Form.Item name="reference_no" label="合同 / 订单号"><Input /></Form.Item><div className="drawer-grid"><Form.Item name="duration_months" label="授权月数" rules={[{ required: true }]}><InputNumber min={1} max={120} style={{ width: "100%" }} /></Form.Item><Form.Item name="amount_cents" label="金额（分）"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></div><div className="drawer-grid"><Form.Item name="starts_at" label="指定开始时间"><DatePicker showTime style={{ width: "100%" }} /></Form.Item><Form.Item name="ends_at" label="指定结束时间"><DatePicker showTime style={{ width: "100%" }} /></Form.Item></div><Form.Item name="reason" label="授权原因" rules={[{ required: true, min: 5 }]}><Input.TextArea rows={3} maxLength={300} showCount /></Form.Item></Form></Modal>
    <Modal title="增加流量扩展包" open={packOpen} onCancel={() => setPackOpen(false)} onOk={() => void addPack()} okText="确认入账"><Form form={packForm} layout="vertical" initialValues={{ size_gb: Number(value.traffic_pack_size_bytes) / GB, price_cents: Number(value.traffic_pack_price_cents) }}><Form.Item name="size_gb" label="容量（GB）" rules={[{ required: true }]}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item><Form.Item name="price_cents" label="金额（分）"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item><Form.Item name="reference_no" label="合同 / 订单号"><Input /></Form.Item><Form.Item name="reason" label="入账原因" rules={[{ required: true, min: 5 }]}><Input.TextArea rows={3} maxLength={300} showCount /></Form.Item></Form></Modal>
  </div>;
}

function Overview({ workspace }: { workspace: JsonRecord }) {
  const counts = workspace.counts ?? {};
  return <div className="governance-overview"><Descriptions size="small" bordered column={{ xs: 1, sm: 2, lg: 3 }} items={[
    { key: "type", label: "类型", children: `${typeLabel(workspace.type)}${workspace.organization_type ? ` / ${orgLabel(workspace.organization_type)}` : ""}` },
    { key: "owner", label: "Owner", children: <div>{text(workspace.owner?.name)}<div className="cell-sub">{text(workspace.owner?.email, text(workspace.owner?.phone))}</div></div> },
    { key: "status", label: "状态", children: <Tag color={workspace.status === "active" ? "green" : "red"}>{statusLabel(workspace.status)}</Tag> },
    { key: "members", label: "成员", children: `${counts.members ?? 0} 人` },
    { key: "resources", label: "资源", children: `${counts.projects ?? 0} 项目 / ${counts.sites ?? 0} 站点 / ${counts.devices ?? 0} 设备` },
    { key: "sharing", label: "外部协作", children: `${counts.direct_shares ?? 0} 直接共享 / ${counts.pending_invitations ?? 0} 待处理邀请` },
    { key: "created", label: "创建时间", children: time(workspace.created_at) },
    { key: "updated", label: "更新时间", children: time(workspace.updated_at) },
    { key: "activity", label: "最近活动", children: time(workspace.last_activity_at) },
  ]} /><section className="governance-risk-section"><h3>风险诊断</h3>{workspace.risks?.length ? <div className="risk-list">{workspace.risks.map((risk) => <Alert key={risk.code} type={risk.code === "workspace_disabled" || risk.code === "owner_unavailable" ? "error" : "warning"} showIcon message={risk.label} description={risk.count ? `涉及 ${risk.count} 条记录` : undefined} />)}</div> : <Alert type="success" showIcon message="当前未发现需要系统管理员处理的风险" />}</section></div>;
}

function Members({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient(); const { message } = AntApp.useApp();
  const query = useQuery({ queryKey: ["admin", "members", workspaceId], queryFn: () => api.admin.members.list(workspaceId) });
  const catalog = useQuery({ queryKey: ["admin", "permissions"], queryFn: api.admin.permissionsCatalog });
  const [keyword, setKeyword] = useState(""); const [selected, setSelected] = useState<JsonRecord | null>(null); const [editing, setEditing] = useState<JsonRecord | null>(null); const [creating, setCreating] = useState(false); const [removing, setRemoving] = useState<JsonRecord | null>(null); const [removeReason, setRemoveReason] = useState(""); const [form] = Form.useForm();
  const rows = (query.data?.items ?? []).filter((item) => `${text(item.user?.name)} ${text(item.user?.email)} ${text(item.user?.phone)} ${text(item.template_name)} ${text(item.scope_type)}`.toLowerCase().includes(keyword.toLowerCase()));
  const templates = (catalog.data?.templates ?? []).map((entry) => ({ value: text(entry.code), label: text(entry.name), permissions: entry.permission_codes ?? [] }));
  const permissions = (catalog.data?.permissions ?? []).map((entry) => ({ value: text(entry.code), label: text(entry.name) }));
  const openEdit = (item: JsonRecord) => { setEditing(item); setCreating(false); form.setFieldsValue({ template_code: item.template_code, permission_codes: item.permission_codes, scope_type: item.scope_type, scope_id: item.scope_id, reason: "" }); };
  const openCreate = () => { setCreating(true); setEditing(null); form.setFieldsValue({ template_code: "viewer", permission_codes: templates.find((entry) => entry.value === "viewer")?.permissions ?? [], scope_type: "workspace", scope_id: workspaceId }); };
  const close = () => { setEditing(null); setCreating(false); form.resetFields(); };
  const save = async () => { try { const values = await form.validateFields(); const { reason, ...payload } = values; if (editing) await api.admin.members.update(workspaceId, text(editing.id), reason, payload); else await api.admin.members.add(workspaceId, reason, payload); close(); await client.invalidateQueries({ queryKey: ["admin", "members", workspaceId] }); void message.success(editing ? "成员权限已更新" : "成员已添加"); } catch (error) { if (!(error as any)?.errorFields) void message.error(formatApiError(error).message); } };
  const remove = async () => { if (!removing) return; try { await api.admin.members.remove(workspaceId, text(removing.id), removeReason); setRemoving(null); setRemoveReason(""); await client.invalidateQueries({ queryKey: ["admin", "members", workspaceId] }); void message.success("成员已移除"); } catch (error) { void message.error(formatApiError(error).message); } };
  return <><div className="tab-toolbar"><Input value={keyword} prefix={<Search size={14} />} allowClear placeholder="搜索用户、模板或范围" onChange={(e) => setKeyword(e.target.value)} /><Button type="primary" icon={<UserPlus size={14} />} onClick={openCreate}>添加成员</Button></div>{query.isLoading ? <StateView type="loading" title="正在加载成员" description="正在读取成员权限。" /> : query.error ? <ErrorState error={query.error} title="成员加载失败" /> : <Table rowKey="id" dataSource={rows} scroll={{ x: 880 }} pagination={{ pageSize: 12 }} columns={[
    { title: "用户", render: (_, item) => <Button type="link" className="table-name-button" onClick={() => setSelected(item)}><span>{text(item.user?.name)}</span><small>{text(item.user?.email, text(item.user?.phone))}</small></Button> },
    { title: "权限模板", width: 150, render: (_, item) => <Tag color="blue">{text(item.template_name, item.template_code)}</Tag> },
    { title: "资源范围", width: 200, render: (_, item) => <div>{scopeLabel(item.scope_type)}<div className="cell-sub mono">{shortId(item.scope_id)}</div></div> },
    { title: "权限数", width: 90, render: (_, item) => item.permission_codes?.length ?? 0 },
    { title: "状态", width: 90, render: (_, item) => <Tag color={item.status === "active" ? "green" : "default"}>{statusLabel(item.status)}</Tag> },
    { title: "加入时间", width: 170, render: (_, item) => time(item.joined_at) },
    { title: "操作", width: 130, fixed: "right", render: (_, item) => <Space size={0}><Button type="link" onClick={() => openEdit(item)}>调整</Button><Button type="link" danger onClick={() => setRemoving(item)}>移除</Button></Space> },
  ]} />}
  <Drawer title="成员权限详情" open={Boolean(selected)} onClose={() => setSelected(null)} size={480}>{selected && <><Descriptions column={1} size="small" bordered items={[{ key: "user", label: "用户", children: text(selected.user?.name) }, { key: "template", label: "权限模板", children: text(selected.template_name, selected.template_code) }, { key: "scope", label: "资源范围", children: `${scopeLabel(selected.scope_type)} / ${text(selected.scope_id)}` }, { key: "status", label: "状态", children: statusLabel(selected.status) }]} /><h3 className="drawer-section-title">实际权限</h3><Space wrap>{(selected.permission_codes ?? []).map((code) => <Tag key={code}>{permissions.find((entry) => entry.value === code)?.label ?? code}</Tag>)}</Space></>}</Drawer>
  <Drawer title={editing ? "调整成员权限" : "添加成员"} open={Boolean(editing || creating)} onClose={close} size={500} extra={<Space><Button onClick={close}>取消</Button><Button type="primary" onClick={() => void save()}>保存</Button></Space>}><Form form={form} layout="vertical">{creating && <><Form.Item name="email" label="邮箱"><Input /></Form.Item><Form.Item name="phone" label="手机号"><Input /></Form.Item><Form.Item name="user_id" label="已注册用户 ID"><Input /></Form.Item></>}<Form.Item name="template_code" label="权限模板"><Select options={templates} onChange={(value) => form.setFieldValue("permission_codes", templates.find((entry) => entry.value === value)?.permissions ?? [])} /></Form.Item><Form.Item name="permission_codes" label="实际权限" rules={[{ required: true, message: "至少选择一项权限" }]}><Select mode="multiple" options={permissions} /></Form.Item><Form.Item name="scope_type" label="资源范围"><Select options={["workspace", "project", "site", "device", "dataset"].map((value) => ({ value, label: scopeLabel(value) }))} /></Form.Item><Form.Item name="scope_id" label="范围 ID"><Input /></Form.Item><Form.Item name="reason" label="操作原因" rules={[{ required: true, min: 5, message: "请填写至少 5 个字符的具体原因" }]}><Input.TextArea rows={3} maxLength={300} showCount placeholder="该原因将记录到审计日志" /></Form.Item></Form></Drawer>
  <Modal title="移除工作区成员" open={Boolean(removing)} okText="确认移除" okButtonProps={{ danger: true, disabled: removeReason.trim().length < 5 }} onOk={() => void remove()} onCancel={() => { setRemoving(null); setRemoveReason(""); }}><p>将移除 {text(removing?.user?.name)} 的当前成员关系。</p><Input.TextArea rows={3} value={removeReason} onChange={(event) => setRemoveReason(event.target.value)} maxLength={300} showCount placeholder="填写至少 5 个字符的操作原因" /></Modal></>;
}

function Resources({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient(); const { message } = AntApp.useApp(); const [editing, setEditing] = useState<JsonRecord | null>(null); const [form] = Form.useForm();
  const projects = useQuery({ queryKey: ["admin", "projects", workspaceId], queryFn: () => api.projects.adminList(workspaceId) });
  const sites = useQuery({ queryKey: ["admin", "sites", workspaceId], queryFn: () => api.sites.adminList(workspaceId) });
  const rows = (projects.data?.items ?? []).map((project) => ({ ...project, kind: "project", key: `project-${project.id}`, children: (sites.data?.items ?? []).filter((site) => site.project_id === project.id).map((site) => ({ ...site, kind: "site", key: `site-${site.id}` })) }));
  const open = (item) => { setEditing(item); form.setFieldsValue({ ...item, reason: "" }); };
  const save = async () => { if (!editing) return; try { const values = await form.validateFields(); if (editing.kind === "project") await api.admin.updateProject(text(editing.id), values.reason, { name: values.name, description: values.description, status: values.status }); else await api.admin.updateSite(text(editing.id), values.reason, { name: values.name, description: values.description, location_text: values.location_text, latitude: values.latitude, longitude: values.longitude, status: values.status }); setEditing(null); form.resetFields(); await Promise.all([client.invalidateQueries({ queryKey: ["admin", "projects", workspaceId] }), client.invalidateQueries({ queryKey: ["admin", "sites", workspaceId] })]); void message.success("资源信息已更新"); } catch (error) { if (!(error as any)?.errorFields) void message.error(formatApiError(error).message); } };
  if (projects.isLoading || sites.isLoading) return <StateView type="loading" title="正在加载资源层级" description="正在汇总项目和站点。" />;
  if (projects.error || sites.error) return <ErrorState error={projects.error ?? sites.error} title="资源层级加载失败" />;
  return <><Alert type="info" showIcon message="项目与站点在这里用于诊断层级关系；日常创建仍由工作区管理者在用户平台完成。" /><Table className="resource-tree-table" rowKey="key" dataSource={rows} pagination={false} expandable={{ defaultExpandAllRows: true }} columns={[
    { title: "资源", render: (_, item) => <div><div className="cell-title">{text(item.name)}</div><div className="cell-sub mono">{text(item.id)}</div></div> },
    { title: "类型", width: 100, render: (_, item) => item.kind === "project" ? "项目" : "站点" },
    { title: "位置 / 说明", render: (_, item) => text(item.location_text, item.description) },
    { title: "下级数量", width: 100, render: (_, item) => item.kind === "project" ? `${item.children?.length ?? 0} 站点` : "—" },
    { title: "状态", width: 90, render: (_, item) => <Tag color={item.status === "active" ? "green" : "default"}>{statusLabel(item.status)}</Tag> },
    { title: "操作", width: 90, render: (_, item) => <Button type="link" icon={<Edit3 size={13} />} onClick={() => open(item)}>修复</Button> },
  ]} /><Drawer title={`修复${editing?.kind === "project" ? "项目" : "站点"}资料`} open={Boolean(editing)} onClose={() => { setEditing(null); form.resetFields(); }} size={460} extra={<Button type="primary" onClick={() => void save()}>保存</Button>}><Form form={form} layout="vertical"><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>{editing?.kind === "site" && <><Form.Item name="location_text" label="地址"><Input /></Form.Item><div className="drawer-grid"><Form.Item name="latitude" label="纬度"><InputNumber min={-90} max={90} style={{ width: "100%" }} /></Form.Item><Form.Item name="longitude" label="经度"><InputNumber min={-180} max={180} style={{ width: "100%" }} /></Form.Item></div></>}<Form.Item name="description" label="说明"><Input.TextArea rows={3} /></Form.Item><Form.Item name="status" label="状态"><Select options={[{ value: "active", label: "启用" }, { value: "archived", label: "归档" }]} /></Form.Item><Form.Item name="reason" label="修改原因" rules={[{ required: true, min: 5, message: "请填写至少 5 个字符的具体原因" }]}><Input.TextArea rows={3} maxLength={300} showCount placeholder="该原因将记录到审计日志" /></Form.Item></Form></Drawer></>;
}

function Sharing({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient(); const { message } = AntApp.useApp(); const [mode, setMode] = useState("grants"); const [revoking, setRevoking] = useState<JsonRecord | null>(null); const [reason, setReason] = useState("");
  const grants = useQuery({ queryKey: ["admin", "grants", workspaceId], queryFn: () => api.admin.grants.list(workspaceId) });
  const invitations = useQuery({ queryKey: ["admin", "invitations", workspaceId], queryFn: () => api.admin.invitations.list(workspaceId) });
  const query = mode === "grants" ? grants : invitations; const rows = query.data?.items ?? [];
  const revoke = async () => { if (!revoking) return; try { if (mode === "grants") await api.admin.grants.revoke(text(revoking.id), reason); else await api.admin.invitations.revoke(text(revoking.id), reason); setRevoking(null); setReason(""); await client.invalidateQueries({ queryKey: ["admin", mode === "grants" ? "grants" : "invitations", workspaceId] }); void message.success(mode === "grants" ? "共享已撤销" : "邀请已撤销"); } catch (error) { void message.error(formatApiError(error).message); } };
  return <><Alert type="info" showIcon message="后台用于检查和必要时撤销异常关系；创建共享与邀请仍由工作区管理者完成。" /><div className="tab-toolbar"><Segmented value={mode} onChange={setMode} options={[{ value: "grants", label: `直接授权 ${grants.data?.items?.length ?? 0}` }, { value: "invitations", label: `待接受邀请 ${invitations.data?.items?.length ?? 0}` }]} /><Button icon={<RefreshCw size={14} />} onClick={() => void Promise.all([grants.refetch(), invitations.refetch()])}>刷新</Button></div>{query.isLoading ? <StateView type="loading" title="正在加载共享关系" description="正在读取授权和邀请。" /> : query.error ? <ErrorState error={query.error} title="共享关系加载失败" /> : <Table rowKey="id" dataSource={rows} pagination={{ pageSize: 12 }} columns={[
    { title: "接收人", render: (_, item) => <div><div className="cell-title">{mode === "grants" ? text(item.subject?.name, item.subject?.email) : text(item.invitee_email, item.invitee_phone)}</div><div className="cell-sub mono">{text(item.id)}</div></div> },
    { title: "具体资源", render: (_, item) => <div>{scopeLabel(item.scope_type)}<div className="cell-sub mono">{text(item.scope_id)}</div></div> },
    { title: "权限", render: (_, item) => (item.permission_codes ?? []).slice(0, 5).join("、") || "—" },
    { title: "有效期", width: 170, render: (_, item) => item.expires_at ? time(item.expires_at) : "长期" },
    { title: "再次分享", width: 90, render: (_, item) => item.allow_reshare ? "允许" : "不允许" },
    { title: "状态", width: 90, render: (_, item) => <Tag color={item.status === "active" || item.status === "pending" ? "green" : "default"}>{statusLabel(item.status)}</Tag> },
    { title: "操作", width: 90, render: (_, item) => <Button type="link" danger onClick={() => setRevoking(item)}>撤销</Button> },
  ]} />}
  <Modal title={`撤销${mode === "grants" ? "共享授权" : "邀请"}`} open={Boolean(revoking)} okText="确认撤销" okButtonProps={{ danger: true, disabled: reason.trim().length < 5 }} onOk={() => void revoke()} onCancel={() => { setRevoking(null); setReason(""); }}><p>撤销后对应访问关系将立即失效。</p><Input.TextArea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} showCount placeholder="填写至少 5 个字符的操作原因" /></Modal></>;
}

function Audit({ workspaceId }: { workspaceId: string }) {
  const [filters, setFilters] = useState({ page: 1, page_size: 20, result: "", actor_type: "", action: "" }); const [selected, setSelected] = useState<JsonRecord | null>(null);
  const query = useQuery({ queryKey: ["admin", "audit", workspaceId, filters], queryFn: () => api.admin.audit(workspaceId, filters), placeholderData: (previous) => previous });
  return <><div className="tab-toolbar audit-toolbar"><Select allowClear placeholder="全部结果" value={filters.result || undefined} options={[{ value: "success", label: "成功" }, { value: "failure", label: "失败" }]} onChange={(value) => setFilters({ ...filters, result: value ?? "", page: 1 })} /><Select allowClear placeholder="全部操作者" value={filters.actor_type || undefined} options={[{ value: "system_admin", label: "系统管理员" }, { value: "user", label: "工作区用户" }, { value: "system", label: "系统" }]} onChange={(value) => setFilters({ ...filters, actor_type: value ?? "", page: 1 })} /><Input placeholder="精确操作类型" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value, page: 1 })} /></div>{query.isLoading ? <StateView type="loading" title="正在加载审计记录" description="正在读取治理操作。" /> : query.error ? <ErrorState error={query.error} title="审计记录加载失败" /> : <Table rowKey="id" dataSource={query.data?.items ?? []} pagination={{ current: filters.page, pageSize: filters.page_size, total: query.data?.total ?? 0, showSizeChanger: true, onChange: (page, pageSize) => setFilters({ ...filters, page, page_size: pageSize }) }} onRow={(item) => ({ onClick: () => setSelected(item) })} columns={[
    { title: "时间", dataIndex: "created_at", width: 170, render: time },
    { title: "操作者", width: 170, render: (_, item) => <div><div>{text(item.actor_name, item.actor_type === "system_admin" ? "系统管理员" : item.actor_type)}</div><div className="cell-sub">{item.actor_type === "system_admin" ? "系统管理员" : "工作区用户"}</div></div> },
    { title: "操作", dataIndex: "action", render: (value) => <div>{actionLabel(value)}<div className="cell-sub mono">{text(value)}</div></div> },
    { title: "资源", width: 170, render: (_, item) => <div>{scopeLabel(item.resource_type)}<div className="cell-sub mono">{shortId(item.resource_id)}</div></div> },
    { title: "结果", dataIndex: "result", width: 86, render: (value) => <Tag color={value === "success" ? "green" : "red"}>{statusLabel(value)}</Tag> },
    { title: "原因", dataIndex: "reason", ellipsis: true },
  ]} />}
  <Drawer title="审计详情" open={Boolean(selected)} onClose={() => setSelected(null)} size={520}>{selected && <Descriptions column={1} size="small" bordered items={[{ key: "time", label: "时间", children: time(selected.created_at) }, { key: "actor", label: "操作者", children: text(selected.actor_name, selected.actor_type) }, { key: "action", label: "操作", children: `${actionLabel(selected.action)} (${text(selected.action)})` }, { key: "resource", label: "资源", children: `${text(selected.resource_type)} / ${text(selected.resource_id)}` }, { key: "result", label: "结果", children: statusLabel(selected.result) }, { key: "reason", label: "原因", children: text(selected.reason) }, { key: "request", label: "Request ID", children: <span className="mono">{text(selected.request_id)}</span> }]} />}</Drawer></>;
}

function SystemOperations({ workspace, workspaceId, refresh }: { workspace: JsonRecord; workspaceId: string; refresh: () => Promise<void> }) {
  const { message } = AntApp.useApp(); const members = useQuery({ queryKey: ["admin", "members", workspaceId], queryFn: () => api.admin.members.list(workspaceId) }); const [statusOpen, setStatusOpen] = useState(false); const [ownerOpen, setOwnerOpen] = useState(false); const [confirmText, setConfirmText] = useState(""); const [ownerId, setOwnerId] = useState(""); const [statusReason, setStatusReason] = useState(""); const [ownerReason, setOwnerReason] = useState("");
  const closeStatus = () => { setStatusOpen(false); setConfirmText(""); setStatusReason(""); };
  const closeOwner = () => { setOwnerOpen(false); setConfirmText(""); setOwnerId(""); setOwnerReason(""); };
  const changeStatus = async () => { try { await api.admin.workspaces.updateStatus(workspaceId, statusReason, { status: workspace.status === "active" ? "disabled" : "active", confirm_text: confirmText }); closeStatus(); await refresh(); void message.success("工作区状态已更新"); } catch (error) { void message.error(formatApiError(error).message); } };
  const transfer = async () => { try { await api.admin.workspaces.transferOwner(workspaceId, ownerReason, { owner_user_id: ownerId, confirm_text: confirmText }); closeOwner(); await refresh(); void message.success("Owner 已转移"); } catch (error) { void message.error(formatApiError(error).message); } };
  return <div className="system-operation-list"><Alert type="info" showIcon message="系统管理员可直接执行治理操作；每次修改原因、管理员身份和 request ID 都会写入审计日志。" /><section><div><strong>{workspace.status === "active" ? "停用工作区" : "恢复工作区"}</strong><span>{workspace.status === "active" ? "阻止用户继续使用该工作区；数据不会删除。" : "恢复成员对工作区的正常访问。"}</span></div><Button danger={workspace.status === "active"} onClick={() => setStatusOpen(true)}>{workspace.status === "active" ? "停用" : "恢复"}</Button></section><section><div><strong>转移 Owner</strong><span>{workspace.type === "personal" ? "个人工作区的 Owner 不可转移。" : "仅可转移给当前工作区的启用成员。"}</span></div><Button disabled={workspace.type !== "organization"} onClick={() => setOwnerOpen(true)}>转移 Owner</Button></section>
  <Modal title={workspace.status === "active" ? "停用工作区" : "恢复工作区"} open={statusOpen} onCancel={closeStatus} okButtonProps={{ danger: workspace.status === "active", disabled: confirmText !== "确认" || statusReason.trim().length < 5 }} okText="确认执行" onOk={() => void changeStatus()}><Form layout="vertical"><Form.Item label="操作原因" required><Input.TextArea rows={3} value={statusReason} onChange={(event) => setStatusReason(event.target.value)} maxLength={300} showCount placeholder="填写至少 5 个字符的具体原因" /></Form.Item><Form.Item label="输入“确认”继续"><Input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} /></Form.Item></Form></Modal>
  <Modal title="转移工作区负责人" open={ownerOpen} onCancel={closeOwner} okButtonProps={{ disabled: confirmText !== "转移 Owner" || !ownerId || ownerReason.trim().length < 5 }} okText="确认转移" onOk={() => void transfer()}><Form layout="vertical"><Form.Item label="新负责人"><Select showSearch optionFilterProp="label" value={ownerId || undefined} options={(members.data?.items ?? []).filter((item) => item.status === "active" && item.user?.id !== workspace.owner?.id).map((item) => ({ value: text(item.user?.id), label: `${text(item.user?.name)} · ${text(item.user?.email, item.user?.phone)}` }))} onChange={setOwnerId} /></Form.Item><Form.Item label="操作原因" required><Input.TextArea rows={3} value={ownerReason} onChange={(event) => setOwnerReason(event.target.value)} maxLength={300} showCount placeholder="填写至少 5 个字符的具体原因" /></Form.Item><Form.Item label="输入“转移 Owner”确认"><Input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} /></Form.Item></Form></Modal></div>;
}

export function AdminSettingsPage() {
  const health = useQuery({ queryKey: ["admin", "settings", "health"], queryFn: api.health, refetchInterval: 30_000 });
  const ready = useQuery({ queryKey: ["admin", "settings", "ready"], queryFn: api.ready, refetchInterval: 30_000 });
  const catalog = useQuery({ queryKey: ["admin", "permissions"], queryFn: api.admin.permissionsCatalog });
  return <><PageHeader eyebrow="System / settings" title="系统设置" description="查看服务依赖、权限目录和系统元数据。" actions={<Button icon={<RefreshCw size={14} />} onClick={() => { void health.refetch(); void ready.refetch(); void catalog.refetch(); }}>刷新状态</Button>} /><div className="grid grid-3"><Card title="API 服务" extra={<Tag color={health.isError ? "red" : "green"}>{health.isLoading ? "检查中" : health.isError ? "异常" : "正常"}</Tag>}><p>{health.isError ? formatApiError(health.error).message : "健康检查通过"}</p></Card><Card title="数据库与依赖" extra={<Tag color={ready.isError ? "red" : "green"}>{ready.isLoading ? "检查中" : ready.isError ? "异常" : "正常"}</Tag>}><p>{ready.isError ? formatApiError(ready.error).message : "就绪检查通过"}</p></Card><Card title="权限目录" extra={<Tag color={catalog.isError ? "red" : "blue"}>{catalog.isError ? "不可用" : `${catalog.data?.permissions?.length ?? 0} 项`}</Tag>}><p>成员、分享和邀请共用这套权限定义。</p></Card></div></>;
}
