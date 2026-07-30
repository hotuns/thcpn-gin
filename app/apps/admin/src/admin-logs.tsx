import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, FileText, HardDrive, RefreshCw, Search, Wrench } from "lucide-react";
import { Button, Input, Modal, Select, Space, Table, Tag } from "@thcpn/admin-ui";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { Badge, PageHeader, Panel, StateView } from "@thcpn/ui";

const isoInput = (date: Date) => { const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); };
const displayTime = (value: unknown) => value ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(String(value))) : "—";
const text = (value: unknown, fallback: unknown = "—") => value === undefined || value === null || value === "" ? String(fallback) : String(value);
const bytes = (value: unknown) => { const size = Number(value || 0); if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(2)} GB`; if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`; return `${Math.round(size / 1024)} KB`; };
const levelColor = (level: unknown) => ({ ERROR: "red", WARN: "orange", INFO: "blue", DEBUG: "default" }[String(level).toUpperCase()] ?? "default");

export function AdminLogsPage() {
  const client = useQueryClient();
  const [start, setStart] = useState(() => isoInput(new Date(Date.now() - 86400000)));
  const [end, setEnd] = useState(() => isoInput(new Date()));
  const [level, setLevel] = useState("");
  const [service, setService] = useState("");
  const [actorId, setActorId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [path, setPath] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<JsonRecord | null>(null);
  const [feedback, setFeedback] = useState("");
  const [filesOpen, setFilesOpen] = useState(false);
  const [downloading, setDownloading] = useState("");
  const [filters, setFilters] = useState<JsonRecord>({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), page: 1, page_size: 100 });
  const query = useQuery({ queryKey: ["admin", "platform-logs", filters, page], queryFn: () => api.admin.platformLogs({ ...filters, page }) });
  const policy = useQuery({ queryKey: ["admin", "platform-log-policy"], queryFn: api.admin.platformLogPolicy });
  const files = useQuery({ queryKey: ["admin", "platform-log-files"], queryFn: api.admin.platformLogFiles, enabled: filesOpen });
  const rebuild = useMutation({ mutationFn: api.admin.rebuildPlatformLogIndex, onSuccess: async () => { setFeedback("日志索引已重建"); await client.invalidateQueries({ queryKey: ["admin", "platform-logs"] }); }, onError: (error) => setFeedback(formatApiError(error).message) });
  const search = () => { setPage(1); setFilters({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), level, service, actor_id: actorId.trim(), request_id: requestId.trim(), path: path.trim(), keyword: keyword.trim(), status, page_size: 100 }); };
  const p = policy.data ?? {};
  const saveBlob = (blob: Blob, name: string) => { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); };
  const exportFiltered = async () => { setDownloading("export"); try { saveBlob(await api.admin.exportPlatformLogs(filters), "platform-logs.ndjson"); } catch (error) { setFeedback(formatApiError(error).message); } finally { setDownloading(""); } };
  const downloadFile = async (name: string) => { setDownloading(name); try { saveBlob(await api.admin.downloadPlatformLogFile(name), name); } catch (error) { setFeedback(formatApiError(error).message); } finally { setDownloading(""); } };
  return <>
    <PageHeader eyebrow="System / runtime logs" title="平台日志" description="检索 API 与 Worker 的脱敏运行日志和 HTTP 请求概要。" actions={<Space wrap><Button icon={<FileText size={14} />} onClick={() => setFilesOpen(true)}>原始文件</Button><Button icon={<Download size={14} />} loading={downloading === "export"} onClick={() => void exportFiltered()}>导出结果</Button><Button icon={<Wrench size={14} />} loading={rebuild.isPending} onClick={() => rebuild.mutate()}>重建索引</Button><Button icon={<RefreshCw size={14} />} onClick={() => { void query.refetch(); void policy.refetch(); }}>刷新</Button></Space>} />
    <div className="platform-log-policy">
      <Panel><HardDrive size={18} /><div><span>目录占用</span><strong>{bytes(p.used_bytes)}</strong></div><Badge tone={p.indexed ? "success" : "warning"}>{p.indexed ? "SQLite 索引正常" : "索引未启用"}</Badge></Panel>
      <Panel><div><span>保留策略</span><strong>{text(p.retention_days, 30)} 天 / {text(p.max_total_size_mb, 5120)} MB</strong></div><small>单文件 {text(p.max_file_size_mb, 100)} MB</small></Panel>
    </div>
    <Panel className="platform-log-panel">
      <div className="platform-log-filters">
        <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        <Select allowClear placeholder="全部级别" value={level || undefined} onChange={(value) => setLevel(value ?? "")} options={["ERROR", "WARN", "INFO", "DEBUG"].map((value) => ({ value, label: value }))} />
        <Select allowClear placeholder="全部服务" value={service || undefined} onChange={(value) => setService(value ?? "")} options={[{ value: "api", label: "API" }, { value: "worker", label: "Worker" }]} />
        <Input placeholder="用户 / 管理员 UUID" value={actorId} onChange={(e) => setActorId(e.target.value)} />
        <Input placeholder="Request ID" value={requestId} onChange={(e) => setRequestId(e.target.value)} />
        <Input placeholder="接口路径" value={path} onChange={(e) => setPath(e.target.value)} />
        <Input placeholder="HTTP 状态码" value={status} onChange={(e) => setStatus(e.target.value.replace(/\D/g, ""))} />
        <div className="admin-search"><Search size={15} /><input value={keyword} onChange={(e) => setKeyword(e.target.value.slice(0, 200))} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="搜索消息或字段" /></div>
        <Button type="primary" icon={<Search size={14} />} onClick={search}>查询</Button>
      </div>
      {feedback && <div className="admin-feedback">{feedback}</div>}
      {query.isLoading ? <StateView type="loading" title="正在加载平台日志" description="正在查询本地日志索引。" /> : query.error ? <StateView type="error" title="平台日志加载失败" description={formatApiError(query.error).message} requestId={formatApiError(query.error).requestId} /> : <Table className="platform-log-table" size="small" rowKey="id" dataSource={query.data?.items ?? []} pagination={{ current: page, pageSize: 100, total: query.data?.total ?? 0, showSizeChanger: false, onChange: setPage }} scroll={{ x: 1080 }} columns={[
        { title: "时间", dataIndex: "timestamp", width: 176, render: displayTime },
        { title: "级别", dataIndex: "level", width: 72, render: (value) => <Tag color={levelColor(value)}>{text(value)}</Tag> },
        { title: "服务", dataIndex: "service", width: 72, render: (value) => <Tag>{text(value).toUpperCase()}</Tag> },
        { title: "消息", dataIndex: "message", ellipsis: true, render: (value, item) => <div><strong>{text(value)}</strong><div className="cell-sub mono">{text(item.path, text(item.request_id, ""))}</div></div> },
        { title: "用户", width: 172, render: (_, item) => <div>{text(item.actor_name, text(item.actor_type))}<div className="cell-sub mono">{text(item.actor_id, "匿名")}</div></div> },
        { title: "状态", dataIndex: "status", width: 64, render: (value) => value ? <Tag color={Number(value) >= 500 ? "red" : Number(value) >= 400 ? "orange" : "green"}>{text(value)}</Tag> : "—" },
        { title: "操作", width: 64, render: (_, item) => <Button type="link" size="small" icon={<Eye size={13} />} onClick={() => setSelected(item)}>详情</Button> },
      ]} />}
    </Panel>
    <Modal title="平台日志详情" open={Boolean(selected)} onCancel={() => setSelected(null)} footer={null} width={900} destroyOnHidden><pre className="platform-log-json">{JSON.stringify(selected, null, 2)}</pre></Modal>
    <Modal title="原始滚动日志文件" open={filesOpen} onCancel={() => setFilesOpen(false)} footer={null} width={760} destroyOnHidden>{files.isLoading ? <StateView type="loading" title="正在读取文件列表" description="" /> : files.error ? <StateView type="error" title="文件列表加载失败" description={formatApiError(files.error).message} /> : <Table rowKey="name" pagination={false} dataSource={files.data?.items ?? []} columns={[{ title: "文件", dataIndex: "name", render: (value) => <span className="mono">{text(value)}</span> }, { title: "大小", dataIndex: "size", width: 120, render: bytes }, { title: "修改时间", dataIndex: "modified_at", width: 190, render: displayTime }, { title: "操作", width: 90, render: (_, item) => <Button type="link" icon={<Download size={14} />} loading={downloading === item.name} onClick={() => void downloadFile(String(item.name))}>下载</Button> }]} />}</Modal>
  </>;
}
