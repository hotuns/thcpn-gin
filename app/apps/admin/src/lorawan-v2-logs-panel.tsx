import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, Search } from "lucide-react";
import { Button, Input, Table } from "@thcpn/admin-ui";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { Badge, StateView } from "@thcpn/ui";

const text = (input: unknown, fallback = "—") => input === undefined || input === null || input === "" ? fallback : String(input);
const dateValue = (date: Date) => date.toISOString().slice(0, 10);
const time = (input: unknown) => input ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(String(input))) : "—";

export function LoRaWANV2LogsPanel({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
  const [startAt, setStartAt] = useState(() => dateValue(new Date(Date.now() - 30 * 86400000)));
  const [endAt, setEndAt] = useState(() => dateValue(new Date()));
  const [submitted, setSubmitted] = useState({ startAt, endAt });
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["admin", "device", deviceId, "lorawan-v2-logs", submitted, page],
    queryFn: () => api.admin.deviceLoRaWANV2GatewayLogs(deviceId, { start_at: submitted.startAt, end_at: submitted.endAt, page, page_size: 50 }),
  });
  const root = (query.data?.payload ?? query.data ?? {}) as JsonRecord;
  const items = ((root.data ?? root.items ?? []) as JsonRecord[]);
  const pagination = (root.pagination ?? {}) as JsonRecord;
  const total = Number(pagination.total ?? items.length);
  const search = () => { setPage(1); setSubmitted({ startAt, endAt }); };

  return <div className="admin-device-detail-content"><section className="admin-detail-section">
    <div className="admin-detail-section-head"><div><h2>LoRa V2 网关日志</h2><span>通过 LoRa V2 API 实时读取网关日志文件</span></div><Button icon={<RefreshCw size={14} />} onClick={() => void query.refetch()}>刷新</Button></div>
    <div className="lora-log-filters"><Input type="date" value={startAt} onChange={(event) => setStartAt(event.target.value)} /><Input type="date" value={endAt} onChange={(event) => setEndAt(event.target.value)} /><Button type="primary" icon={<Search size={14} />} onClick={search}>查询</Button></div>
    {query.isLoading ? <StateView type="loading" title="正在加载日志" description="正在请求 LoRa V2 网关日志接口。" /> : query.error ? <StateView type="error" title="日志加载失败" description={formatApiError(query.error).message} requestId={formatApiError(query.error).requestId} /> : <><div className="admin-list-toolbar"><strong>{deviceName}</strong><Badge tone="info">{total} 条日志</Badge></div><Table rowKey={(item) => `${text(item.file)}-${text(item.created_at)}`} dataSource={items} pagination={{ current: page, pageSize: 50, showSizeChanger: false, total, onChange: setPage }} scroll={{ x: 760 }} columns={[
      { title: "日志日期", dataIndex: "log_date", width: 130 },
      { title: "创建时间", dataIndex: "created_at", width: 190, render: time },
      { title: "更新时间", dataIndex: "updated_at", width: 190, render: time },
      { title: "日志文件", dataIndex: "file", render: (file) => file ? <a href={text(file)} target="_blank" rel="noreferrer">打开日志 <ExternalLink size={13} /></a> : "—" },
    ]} /></>}
  </section></div>;
}
