import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Megaphone } from "lucide-react";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, PageHeader, Panel, StateView } from "@thcpn/ui";

const value = (input: unknown, fallback = "") => input === undefined || input === null ? fallback : String(input);
const items = (input: unknown) => ((input as { items?: JsonRecord[] } | undefined)?.items ?? []);
const unread = (input: unknown) => Number((input as { unread_count?: number } | undefined)?.unread_count ?? 0);
const time = (input: unknown) => input ? new Date(String(input)).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const tone = (level: unknown) => level === "error" ? "danger" : level === "warning" ? "warning" : level === "success" ? "success" : "info";

export function NotificationsPage() {
  const { currentId, current } = useWorkspace();
  const client = useQueryClient();
  const [tab, setTab] = useState<"notifications" | "announcements">("notifications");
  const notificationKey = workspaceQueryKey(currentId, "notifications");
  const announcementKey = workspaceQueryKey(currentId, "announcements");
  const notifications = useQuery({ queryKey: notificationKey, queryFn: () => api.notifications.list(currentId ?? undefined), enabled: Boolean(currentId) });
  const announcements = useQuery({ queryKey: announcementKey, queryFn: () => api.notifications.announcements(currentId ?? undefined), enabled: Boolean(currentId) });
  const refreshSummary = () => client.invalidateQueries({ queryKey: workspaceQueryKey(currentId, "notification-summary") });
  const refreshNotifications = async () => { await Promise.all([client.invalidateQueries({ queryKey: notificationKey }), refreshSummary()]); };
  const refreshAnnouncements = async () => { await Promise.all([client.invalidateQueries({ queryKey: announcementKey }), refreshSummary()]); };

  if (!currentId) return <Panel><StateView type="empty" title="请选择工作区" description="选择工作区后可查看与当前工作相关的提醒和公告。" /></Panel>;
  const query = tab === "notifications" ? notifications : announcements;
  const rows = items(query.data);
  return <>
    <PageHeader eyebrow="Message center" title="通知中心" description={`${current?.name ?? "当前工作区"}的业务提醒与平台公告。`} />
    <div className="notification-page">
      <div className="notification-tabs" role="tablist">
        <button className={tab === "notifications" ? "active" : ""} onClick={() => setTab("notifications")}><Bell size={17} />提醒{unread(notifications.data) > 0 && <span>{unread(notifications.data)}</span>}</button>
        <button className={tab === "announcements" ? "active" : ""} onClick={() => setTab("announcements")}><Megaphone size={17} />公告{unread(announcements.data) > 0 && <span>{unread(announcements.data)}</span>}</button>
        {tab === "notifications" && unread(notifications.data) > 0 && <Button variant="secondary" onClick={async () => { await api.notifications.readAll(currentId); await refreshNotifications(); }}><CheckCheck size={15} />全部已读</Button>}
      </div>
      <Panel className="notification-list-panel">
        {query.isLoading ? <StateView type="loading" title="正在加载消息" description="正在获取最新提醒和公告。" /> : query.error ? <StateView type="error" title="消息加载失败" description={formatApiError(query.error).message} /> : rows.length === 0 ? <StateView type="empty" title={tab === "notifications" ? "暂无提醒" : "暂无公告"} description="有新消息时会在这里展示。" /> : <div className="notification-list">
          {rows.map((item) => {
            const isUnread = !item.read_at;
            const isAnnouncement = tab === "announcements";
            return <article key={value(item.id)} className={isUnread ? "is-unread" : ""}>
              <div className={`notification-icon ${tone(item.level)}`}>{isAnnouncement ? <Megaphone size={18} /> : <Bell size={18} />}</div>
              <div className="notification-copy">
                <div className="notification-title"><strong>{value(item.title, "未命名消息")}</strong>{isUnread && <i />}{isAnnouncement && <Badge tone="neutral">{item.audience_type === "workspace" ? "工作区公告" : "平台公告"}</Badge>}</div>
                <p>{value(item.content)}</p>
                <span>{time(item.published_at ?? item.created_at)}</span>
              </div>
              <div className="notification-actions">
                {Boolean(item.action_url) && <a href={value(item.action_url)}><Button variant="secondary">查看详情</Button></a>}
                {isUnread && <Button variant="secondary" onClick={async () => { isAnnouncement ? await api.notifications.readAnnouncement(value(item.id)) : await api.notifications.read(value(item.id)); await (isAnnouncement ? refreshAnnouncements() : refreshNotifications()); }}>标为已读</Button>}
              </div>
            </article>;
          })}
        </div>}
      </Panel>
    </div>
  </>;
}
