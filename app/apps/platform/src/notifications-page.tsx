import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bell, CheckCheck, Megaphone } from "lucide-react";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, PageHeader, Panel, StateView, Tabs, TabsContent, TabsList, TabsTrigger } from "./platform-ui";
import { Button as ShadcnButton } from "./components/ui/button";

const value = (input: unknown, fallback = "") => input === undefined || input === null ? fallback : String(input);
const items = (input: unknown) => ((input as { items?: JsonRecord[] } | undefined)?.items ?? []);
const unread = (input: unknown) => Number((input as { unread_count?: number } | undefined)?.unread_count ?? 0);
const time = (input: unknown) => input ? new Date(String(input)).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const tone = (level: unknown) => level === "error" ? "danger" : level === "warning" ? "warning" : level === "success" ? "success" : "info";

export function NotificationsPage() {
  const navigate = useNavigate();
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
  const markRead = useMutation({
    mutationFn: async ({ id, announcement }: { id?: string; announcement?: boolean }) => {
      if (announcement && id) await api.notifications.readAnnouncement(id);
      else if (id) await api.notifications.read(id);
      else if (currentId) await api.notifications.readAll(currentId);
    },
    onSuccess: async (_, { announcement }) => { await (announcement ? refreshAnnouncements() : refreshNotifications()); },
  });

  if (!currentId) return <Panel><StateView type="empty" title="请选择组织" description="选择组织后可查看与当前工作相关的提醒和公告。" /></Panel>;
  const query = tab === "notifications" ? notifications : announcements;
  const rows = items(query.data);
  return <>
    <PageHeader eyebrow="Message center" title="通知中心" description={`${current?.name ?? "当前组织"}的业务提醒与平台公告。`} actions={<Button variant="secondary" onClick={() => navigate("/dashboard")}><ArrowLeft size={14} />返回总览</Button>} />
    <Tabs value={tab} onValueChange={(next) => setTab(next as typeof tab)} className="notification-page">
      <div className="notification-toolbar">
        <TabsList aria-label="消息类型">
          <TabsTrigger value="notifications"><Bell size={16} />提醒{unread(notifications.data) > 0 && <Badge tone="info">{unread(notifications.data)}</Badge>}</TabsTrigger>
          <TabsTrigger value="announcements"><Megaphone size={16} />公告{unread(announcements.data) > 0 && <Badge tone="info">{unread(announcements.data)}</Badge>}</TabsTrigger>
        </TabsList>
        {tab === "notifications" && unread(notifications.data) > 0 && <Button variant="secondary" disabled={markRead.isPending} onClick={() => markRead.mutate({})}><CheckCheck size={15} />{markRead.isPending ? "正在更新…" : "全部已读"}</Button>}
      </div>
      {markRead.error && <div role="alert" className="form-error">{formatApiError(markRead.error).message}</div>}
      <TabsContent key={tab} value={tab} className="notification-tab-content">
      <Panel className="notification-list-panel">
        {query.isLoading ? <StateView type="loading" title="正在加载消息" description="正在获取最新提醒和公告。" /> : query.error ? <StateView type="error" title="消息加载失败" description={formatApiError(query.error).message} action={<Button variant="secondary" onClick={() => void query.refetch()}>重新加载</Button>} /> : rows.length === 0 ? <StateView type="empty" title={tab === "notifications" ? "暂无提醒" : "暂无公告"} description="有新消息时会在这里展示。" /> : <div className="notification-list">
          {rows.map((item) => {
            const isUnread = !item.read_at;
            const isAnnouncement = tab === "announcements";
            return <article key={value(item.id)} className={isUnread ? "is-unread" : ""}>
              <div className={`notification-icon ${tone(item.level)}`}>{isAnnouncement ? <Megaphone size={18} /> : <Bell size={18} />}</div>
              <div className="notification-copy">
                <div className="notification-title"><strong>{value(item.title, "未命名消息")}</strong>{isUnread && <i />}{isAnnouncement && <Badge tone="neutral">{item.audience_type === "workspace" ? "组织公告" : "平台公告"}</Badge>}</div>
                <p>{value(item.content)}</p>
                <span>{time(item.published_at ?? item.created_at)}</span>
              </div>
              <div className="notification-actions">
                {Boolean(item.action_url) && <ShadcnButton variant="outline" asChild><a href={value(item.action_url)}>查看详情</a></ShadcnButton>}
                {isUnread && <Button variant="ghost" disabled={markRead.isPending} onClick={() => markRead.mutate({ id: value(item.id), announcement: isAnnouncement })}>标为已读</Button>}
              </div>
            </article>;
          })}
        </div>}
      </Panel>
      </TabsContent>
    </Tabs>
  </>;
}
