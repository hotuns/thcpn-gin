import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Eye, FileText, RefreshCw, Search } from "lucide-react";
import { Button, Input, Modal, Space, Table } from "@thcpn/admin-ui";
import { api, formatApiError } from "@thcpn/api";
import { Badge, StateView } from "@thcpn/ui";

const text = (value: unknown, fallback = "—") => value === undefined || value === null || value === "" ? fallback : String(value);
const dateValue = (date: Date) => date.toISOString().slice(0, 10);
const time = (value: unknown) => value ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(String(value))) : "—";

export function DeviceLogsPanel({ deviceId, deviceName }: { deviceId: string; deviceName?: string }) {
  const [keyword, setKeyword] = useState("");
  const [startDate, setStartDate] = useState(() => dateValue(new Date(Date.now() - 30 * 86400000)));
  const [endDate, setEndDate] = useState(() => dateValue(new Date()));
  const [submitted, setSubmitted] = useState({ keyword: "", startDate, endDate });
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<any>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState("");
  const query = useQuery({ queryKey: ["admin", "device-logs", deviceId, submitted, page], queryFn: () => api.admin.deviceLogs(deviceId, { start_date: submitted.startDate, end_date: submitted.endDate, keyword: submitted.keyword, page, page_size: 50 }) });
  const search = () => { setPage(1); setSubmitted({ keyword: keyword.trim(), startDate, endDate }); };
  const showError = (error: unknown) => { const detail = formatApiError(error); setFeedback(`${detail.message}${detail.requestId ? ` · request id ${detail.requestId}` : ""}`); };
  const openPreview = async (item: any) => { setBusy(`preview:${item.uuid}`); setFeedback(""); try { setPreview(await api.admin.deviceLogPreview(deviceId, item.uuid)); } catch (error) { showError(error); } finally { setBusy(""); } };
  const download = async (item: any) => { setBusy(`download:${item.uuid}`); setFeedback(""); try { const blob = await api.admin.deviceLogDownload(deviceId, item.uuid); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = text(item.file_name, "device-log"); anchor.click(); URL.revokeObjectURL(url); } catch (error) { showError(error); } finally { setBusy(""); } };
  return <div className="admin-device-detail-content"><section className="admin-detail-section">
    <div className="admin-detail-section-head"><div><h2>设备日志</h2><span>查询、预览和下载源数据库中的设备日志</span></div><Button icon={<RefreshCw size={14} />} onClick={() => void query.refetch()}>刷新</Button></div>
    <div className="admin-device-filters"><Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /><Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /><div className="admin-search"><Search size={15} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && search()} placeholder="搜索文件名、路径或 UUID" /></div><Button type="primary" icon={<Search size={14} />} onClick={search}>搜索</Button></div>
    {feedback && <div className="admin-feedback">{feedback}</div>}
    {query.isLoading ? <StateView type="loading" title="正在加载日志" description="正在查询 THCPN 月分表。" /> : query.error ? <StateView type="error" title="日志加载失败" description={formatApiError(query.error).message} requestId={formatApiError(query.error).requestId} /> : <><div className="admin-list-toolbar"><strong>{deviceName ?? deviceId}</strong><Badge tone="info">{query.data?.total ?? 0} 条日志</Badge></div><Table rowKey="uuid" dataSource={query.data?.items ?? []} pagination={{ current: page, pageSize: 50, showSizeChanger: false, total: query.data?.total ?? 0, onChange: setPage }} scroll={{ x: 920 }} columns={[{ title: "日志文件", render: (_, item) => <div><div className="cell-title"><FileText size={14} /> {text(item.file_name, "未命名日志")}</div><div className="cell-sub mono">{text(item.uuid)}</div></div> }, { title: "日期", dataIndex: "date", width: 130 }, { title: "创建时间", dataIndex: "created_at", width: 190, render: time }, { title: "路径", dataIndex: "path", ellipsis: true }, { title: "操作", width: 170, render: (_, item) => <Space><Button type="link" icon={<Eye size={14} />} loading={busy === `preview:${item.uuid}`} onClick={() => void openPreview(item)}>预览</Button><Button type="link" icon={<Download size={14} />} loading={busy === `download:${item.uuid}`} onClick={() => void download(item)}>下载</Button></Space> }]} /></>}
  </section><Modal title={preview ? `预览 · ${text(preview.log?.file_name)}` : "日志预览"} open={Boolean(preview)} onCancel={() => setPreview(null)} footer={null} width={1000} destroyOnHidden>{preview?.preview_kind === "image" ? <img src={preview.url} alt={text(preview.log?.file_name)} style={{ maxWidth: "100%", maxHeight: "70vh", display: "block", margin: "0 auto" }} /> : preview?.preview_kind === "download" ? <StateView type="empty" title="此文件不支持在线预览" description="请使用下载按钮获取原始文件。" /> : preview?.preview_kind === "text" && preview?.content !== undefined ? <pre className="platform-log-json">{preview.content || "此日志文件为空。"}</pre> : <iframe title="日志预览" src={preview?.url} style={{ width: "100%", height: "70vh", border: 0 }} />}</Modal></div>;
}
