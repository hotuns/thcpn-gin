// @ts-nocheck
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Download, Eye, FileText, RefreshCw, Search } from "lucide-react";
import {
  Button,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "@thcpn/admin-ui";
import { api, formatApiError } from "@thcpn/api";
import { Badge, PageHeader, Panel, StateView } from "@thcpn/ui";

const text = (value: unknown, fallback = "—") =>
  value === undefined || value === null || value === "" ? fallback : String(value);
const time = (value: unknown) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(String(value)))
    : "—";
const dateValue = (date: Date) => date.toISOString().slice(0, 10);

export function AdminLogsPage() {
  const [searchParams] = useSearchParams();
  const initialDeviceId = searchParams.get("device") ?? "";
  const devices = useQuery({ queryKey: ["admin", "devices"], queryFn: api.admin.devices });
  const [deviceId, setDeviceId] = useState(initialDeviceId);
  const [keyword, setKeyword] = useState("");
  const [startDate, setStartDate] = useState(() => dateValue(new Date(Date.now() - 30 * 86400000)));
  const [endDate, setEndDate] = useState(() => dateValue(new Date()));
  const [submitted, setSubmitted] = useState({ deviceId: initialDeviceId, keyword: "", startDate, endDate });
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<any>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState("");
  const rows = devices.data?.items ?? [];
  const logQuery = useQuery({
    queryKey: ["admin", "device-logs", submitted, page],
    enabled: Boolean(submitted.deviceId),
    queryFn: () => api.admin.deviceLogs(submitted.deviceId, {
      start_date: submitted.startDate,
      end_date: submitted.endDate,
      keyword: submitted.keyword,
      page,
      page_size: 50,
    }),
  });
  const deviceOptions = useMemo(() => rows.map((item) => ({ value: String(item.id), label: `${text(item.name, "未命名设备")} · ${text(item.serial_no, String(item.id).slice(0, 8))}` })), [rows]);
  const selectedDevice = rows.find((item) => String(item.id) === submitted.deviceId);

  const search = () => {
    if (!deviceId) {
      setFeedback("请先选择设备");
      return;
    }
    setFeedback("");
    setPage(1);
    setSubmitted({ deviceId, keyword: keyword.trim(), startDate, endDate });
  };
  const showError = (error: unknown) => {
    const detail = formatApiError(error);
    setFeedback(`${detail.message}${detail.requestId ? ` · request id ${detail.requestId}` : ""}`);
  };
  const openPreview = async (item: any) => {
    setBusy(`preview:${item.uuid}`);
    setFeedback("");
    try {
      setPreview(await api.admin.deviceLogPreview(submitted.deviceId, item.uuid));
    } catch (error) {
      showError(error);
    } finally {
      setBusy("");
    }
  };
  const download = async (item: any) => {
    setBusy(`download:${item.uuid}`);
    setFeedback("");
    try {
      const blob = await api.admin.deviceLogDownload(submitted.deviceId, item.uuid);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = text(item.file_name, "device-log");
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showError(error);
    } finally {
      setBusy("");
    }
  };

  return <>
    <PageHeader eyebrow="System / device logs" title="设备日志" description="按设备和日期查找 THCPN 日志，支持在线预览和下载。" actions={<Button icon={<RefreshCw size={14} />} onClick={() => void logQuery.refetch()} disabled={!submitted.deviceId}>刷新</Button>} />
    <Panel>
      <div className="admin-device-filters">
        <Select showSearch optionFilterProp="label" value={deviceId || undefined} onChange={setDeviceId} placeholder="选择设备" options={deviceOptions} style={{ minWidth: 300, flex: 1 }} />
        <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        <div className="admin-search"><Search size={15} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && search()} placeholder="搜索文件名、路径或 UUID" /></div>
        <Button type="primary" icon={<Search size={14} />} onClick={search}>搜索</Button>
      </div>
      {feedback && <div className="admin-feedback">{feedback}</div>}
      {!submitted.deviceId ? <StateView type="empty" title="请选择设备" description="选择设备后查看对应月份的 THCPN 日志。" /> : logQuery.isLoading ? <StateView type="loading" title="正在加载日志" description="正在查询 THCPN 月分表。" /> : logQuery.error ? <StateView type="error" title="日志加载失败" description={formatApiError(logQuery.error).message} requestId={formatApiError(logQuery.error).requestId} /> : <>
        <div className="admin-list-toolbar"><div><strong>{text(selectedDevice?.name, submitted.deviceId)}</strong><div className="cell-sub">{submitted.startDate} 至 {submitted.endDate}</div></div><Badge tone="info">{logQuery.data?.total ?? 0} 条日志</Badge></div>
        <Table rowKey="uuid" dataSource={logQuery.data?.items ?? []} pagination={{ current: page, pageSize: 50, showSizeChanger: false, total: logQuery.data?.total ?? 0, onChange: setPage }} scroll={{ x: 920 }} columns={[{ title: "日志文件", render: (_, item) => <div><div className="cell-title"><FileText size={14} /> {text(item.file_name, "未命名日志")}</div><div className="cell-sub mono">{text(item.uuid)}</div></div> }, { title: "日期", dataIndex: "date", width: 130 }, { title: "创建时间", dataIndex: "created_at", width: 190, render: time }, { title: "路径", dataIndex: "path", ellipsis: true }, { title: "操作", width: 170, render: (_, item) => <Space><Button type="link" icon={<Eye size={14} />} loading={busy === `preview:${item.uuid}`} onClick={() => void openPreview(item)}>预览</Button><Button type="link" icon={<Download size={14} />} loading={busy === `download:${item.uuid}`} onClick={() => void download(item)}>下载</Button></Space> }]} />
      </>}
    </Panel>
    <Modal title={preview ? `预览 · ${text(preview.log?.file_name)}` : "日志预览"} open={Boolean(preview)} onCancel={() => setPreview(null)} footer={null} width={1000} destroyOnClose>
      {preview?.preview_kind === "image" ? <img src={preview.url} alt={text(preview.log?.file_name)} style={{ maxWidth: "100%", maxHeight: "70vh", display: "block", margin: "0 auto" }} /> : preview?.preview_kind === "download" ? <StateView type="empty" title="此文件不支持在线预览" description="请使用下载按钮获取原始文件。" /> : preview?.preview_kind === "text" && preview?.content !== undefined ? <pre style={{ margin: 0, maxHeight: "70vh", overflow: "auto", padding: 20, background: "#f7f9fc", color: "#1f2937", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, lineHeight: 1.6 }}>{preview.content || "此日志文件为空。"}</pre> : <iframe title="日志预览" src={preview?.url} style={{ width: "100%", height: "70vh", border: 0, background: "#fff" }} />}
    </Modal>
  </>;
}
