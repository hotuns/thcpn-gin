import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, KeyRound, Sparkles, Trash2 } from "lucide-react";
import { api, formatApiError } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, PageHeader, Panel, StateView } from "@thcpn/ui";

const text = (value: unknown, fallback = "—") => value === undefined || value === null || value === "" ? fallback : String(value);
const GB = 1024 ** 3;
const bytes = (value: unknown) => `${(Number(value ?? 0) / GB).toFixed(1)} GB`;
const date = (value: unknown) => value ? new Date(String(value)).toLocaleDateString("zh-CN") : "—";

export function SubscriptionPage() {
  const { currentId, current } = useWorkspace();
  const client = useQueryClient();
  const [keyName, setKeyName] = useState("");
  const [createdSecret, setCreatedSecret] = useState("");
  const [message, setMessage] = useState("");
  const billing = useQuery({ queryKey: workspaceQueryKey(currentId, "billing"), queryFn: () => api.workspaces.billing(currentId!), enabled: Boolean(currentId) });
  const keys = useQuery({ queryKey: workspaceQueryKey(currentId, "api-keys"), queryFn: () => api.workspaces.apiKeys(currentId!), enabled: Boolean(currentId) });
  if (!currentId) return <Panel><StateView type="empty" title="请选择工作区" description="订阅权益归属于工作区，请先选择一个工作区。" /></Panel>;
  if (billing.isLoading) return <Panel><StateView type="loading" title="正在加载订阅" description="正在汇总套餐、权益和本月用量。" /></Panel>;
  if (billing.error || !billing.data) { const error = formatApiError(billing.error); return <Panel><StateView type="error" title="订阅信息加载失败" description={error.message} requestId={error.requestId} /></Panel>; }
  const value = billing.data;
  const professional = value.plan === "professional";
  const used = Number(value.monthly_download_used_bytes ?? 0);
  const limit = Number(value.monthly_download_limit_bytes ?? 0);
  const percent = limit > 0 ? Math.min(100, used * 100 / limit) : 0;
  const price = `¥${(Number(value.professional_annual_price_cents ?? 0) / 100).toLocaleString("zh-CN")}`;
  const createKey = async () => { if (!keyName.trim()) return; try { const item = await api.workspaces.createApiKey(currentId, { name: keyName.trim() }); setCreatedSecret(text(item.secret, "")); setKeyName(""); setMessage(""); await client.invalidateQueries({ queryKey: workspaceQueryKey(currentId, "api-keys") }); } catch (error) { setMessage(formatApiError(error).message); } };
  const revokeKey = async (keyId: string) => { try { await api.workspaces.revokeApiKey(currentId, keyId); await client.invalidateQueries({ queryKey: workspaceQueryKey(currentId, "api-keys") }); } catch (error) { setMessage(formatApiError(error).message); } };
  return <>
    <PageHeader eyebrow="工作区 / 订阅" title="订阅与用量" description={`${current?.name ?? "当前工作区"}的套餐权益、下载用量与开放 API。`} />
    <div className="subscription-page">
      {(value.notices ?? []).map((notice) => <div key={notice.code} className={`notice ${notice.level}`}>{notice.message}{notice.code === "professional_expiring" ? `，剩余 ${value.days_until_expiry} 天` : ""}</div>)}
      <section className={`subscription-hero ${professional ? "is-pro" : ""}`}>
        <div className="subscription-plan-mark"><Sparkles size={22} /></div>
        <div className="subscription-plan-copy"><span>当前套餐</span><h2>{professional ? "专业版" : "基础版"}</h2><p>{professional ? `服务有效至 ${date(value.professional_expires_at)}，工作区全部成员共享权益。` : "永久免费，设备接入、采集和基础查看不受设备数量限制。"}</p></div>
        <div className="subscription-plan-side"><Badge tone={professional ? "success" : "neutral"}>{professional ? "服务中" : "永久免费"}</Badge><strong>{professional ? price : "¥0"}</strong><span>{professional ? "/ 工作区 / 年" : "无需续费"}</span></div>
      </section>
      <div className="subscription-metrics">
        <Panel><span>本月已下载</span><strong>{bytes(used)}</strong><small>{professional ? `含 ${bytes(limit)} 月度额度` : "基础导出不计流量"}</small></Panel>
        <Panel><span>套餐剩余额度</span><strong>{bytes(value.monthly_download_remaining_bytes)}</strong><small>自然月重置，不结转</small></Panel>
        <Panel><span>流量扩展包</span><strong>{bytes(value.traffic_pack_balance_bytes)}</strong><small>长期有效，专业版期间使用</small></Panel>
        <Panel><span>专业版有效期</span><strong>{professional ? `${value.days_until_expiry ?? 0} 天` : "未开通"}</strong><small>{professional ? date(value.professional_expires_at) : "线下合同开通"}</small></Panel>
      </div>
      <Panel className="subscription-usage"><div className="panel-header"><div><h2 className="panel-title">下载流量</h2><div className="panel-kicker">原图、数据文件、导出包和 API 文件合并计算</div></div><strong>{percent.toFixed(1)}%</strong></div><div className="billing-usage-track"><span style={{ width: `${percent}%` }} /></div><div className="billing-usage-meta"><span>{bytes(used)} 已使用</span><span>{professional ? `${bytes(limit)} 套餐额度` : "专业版包含每月 100 GB"}</span></div></Panel>
      <section className="pricing-section">
        <div className="pricing-heading"><span>套餐权益</span><h2>基础能力永久免费，按需开通专业数据服务</h2><p>套餐归属于工作区，全部成员共享权益，不按设备数量收费。</p></div>
        <div className="pricing-grid">
          <article className={`pricing-card ${!professional ? "is-current" : ""}`}>
            <div className="pricing-card-top"><div><span className="pricing-name">基础版</span><p>适合设备日常接入、查看与短周期数据使用</p></div>{!professional && <Badge tone="success">当前套餐</Badge>}</div>
            <div className="pricing-price"><strong>¥0</strong><span>永久免费</span></div>
            <div className="pricing-divider" />
            <ul>
              <li><Check size={16} /><span>设备接入、采集和基础管理</span></li>
              <li><Check size={16} /><span>查看最近 {value.base_history_days} 天设备数据</span></li>
              <li><Check size={16} /><span>查看压缩图片预览</span></li>
              <li><Check size={16} /><span>单设备最近 {value.base_export_days} 天手动导出</span></li>
              <li><Check size={16} /><span>不限设备数量和手动导出次数</span></li>
            </ul>
            <div className="pricing-card-action">{!professional ? "正在使用" : "专业版到期后自动恢复"}</div>
          </article>
          <article className={`pricing-card pricing-card-pro ${professional ? "is-current" : ""}`}>
            <div className="pricing-recommended">推荐</div>
            <div className="pricing-card-top"><div><span className="pricing-name">专业版</span><p>适合科研数据管理、处理和第三方系统集成</p></div>{professional && <Badge tone="success">当前套餐</Badge>}</div>
            <div className="pricing-price"><strong>{price}</strong><span>/ 工作区 / 年</span></div>
            <div className="pricing-divider" />
            <ul>
              <li><Check size={16} /><span>平台保留的完整历史数据</span></li>
              <li><Check size={16} /><span>跨设备、长周期和批量数据导出</span></li>
              <li><Check size={16} /><span>不限次数的标准数据处理</span></li>
              <li><Check size={16} /><span>开放 API 与工作区 API Key</span></li>
              <li><Check size={16} /><span>原图和专业文件下载</span></li>
              <li><Check size={16} /><span>每月 {bytes(value.monthly_download_limit_bytes || 100 * GB)} 下载额度</span></li>
            </ul>
            <div className="pricing-card-action pricing-card-action-primary">{professional ? `已开通 · ${date(value.professional_expires_at)} 到期` : "通过设备订单或服务合同线下开通"}</div>
          </article>
        </div>
        <div className="pricing-footnote"><strong>需要私有部署、定制算法或大额下载流量？</strong><span>企业服务按实际范围通过线下合同单独报价。</span></div>
      </section>
      <Panel><div className="panel-header"><div><h2 className="panel-title">开放 API</h2><div className="panel-kicker">API Key 归属于工作区，普通 JSON 查询不消耗下载额度</div></div><div className="api-key-heading-actions"><a href="/api/v1/open/docs" target="_blank" rel="noreferrer"><Button variant="secondary"><ExternalLink size={14} />API 文档</Button></a><Badge tone={professional ? "success" : "neutral"}>{professional ? "可用" : "专业版功能"}</Badge></div></div>
        {createdSecret && <div className="api-key-secret"><div><strong>请立即保存此密钥</strong><span>关闭后将无法再次查看完整值</span></div><code>{createdSecret}</code><Button variant="secondary" onClick={() => void navigator.clipboard.writeText(createdSecret)}><Copy size={14} />复制</Button></div>}
        {professional && <div className="api-key-create"><input value={keyName} maxLength={100} placeholder="输入密钥名称，例如：实验室数据服务" onChange={(event) => setKeyName(event.target.value)} /><Button onClick={() => void createKey()} disabled={!keyName.trim()}><KeyRound size={14} />创建密钥</Button></div>}
        {message && <div className="notice warning">{message}</div>}
        <div className="api-key-list">{(keys.data?.items ?? []).map((item) => <div key={text(item.id)}><div><strong>{text(item.name)}</strong><span><code>{text(item.key_prefix)}...</code> · 本月 {Number(item.requests_this_month ?? 0).toLocaleString("zh-CN")} 次 · {item.revoked_at ? "已撤销" : item.last_used_at ? `最近使用 ${new Date(String(item.last_used_at)).toLocaleString()}` : "尚未使用"}</span></div>{!item.revoked_at && <Button variant="secondary" onClick={() => void revokeKey(text(item.id))}><Trash2 size={14} />撤销</Button>}</div>)}{!keys.isLoading && !(keys.data?.items ?? []).length && <StateView type="empty" title={professional ? "暂无 API Key" : "开放 API 尚未启用"} description={professional ? "创建密钥后可供第三方系统访问当前工作区数据。" : "工作区开通专业版后可以创建 API Key。"} />}</div>
      </Panel>
    </div>
  </>;
}
