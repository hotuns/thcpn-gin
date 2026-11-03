import { useQuery } from "@tanstack/react-query";
import { api, formatApiError, type Device, type JsonRecord } from "@thcpn/api";
import { useAuth } from "@thcpn/auth";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Panel, StateView, Table } from "../../shared/ui";
import { text, formatDate } from "./device-model";

export function DeviceActivity({
  device,
  workspaceId,
}: {
  device: Device;
  workspaceId: string;
}) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "audit", "device", device.id),
    queryFn: () => api.audit.list(workspaceId, 500),
  });
  const members = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "members", "audit-names"),
    queryFn: () => api.members.list(workspaceId),
  });
  if (query.isLoading)
    return (
      <Panel>
        <StateView
          type="loading"
          title="正在加载操作记录"
          description="正在读取设备相关审计。"
        />
      </Panel>
    );
  if (query.error)
    return (
      <Panel>
        <StateView
          type="error"
          title="操作记录不可用"
          description={formatApiError(query.error).message}
          requestId={formatApiError(query.error).requestId}
        />
      </Panel>
    );
  const rows = (query.data?.items ?? []).filter(
    (item) => text(item.resource_id, "") === device.id,
  );
  const actorName = (item: JsonRecord) => {
    if (item.actor_type === "system") return "系统";
    if (text(item.actor_id, "") === user?.id) return user.name;
    const member = (members.data?.items ?? []).find(
      (entry) =>
        text(
          (entry.user as JsonRecord | undefined)?.id,
          text(entry.user_id, ""),
        ) === text(item.actor_id, ""),
    );
    const memberUser = member?.user as JsonRecord | undefined;
    return text(
      memberUser?.name,
      text(
        memberUser?.email,
        item.actor_type === "service_account" ? "服务账号" : "未知用户",
      ),
    );
  };
  return (
    <Panel>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">设备操作记录</h2>

        </div>
        <Badge tone="neutral">{rows.length}</Badge>
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <Table className="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作者</th>
                <th>动作</th>
                <th>资源</th>
                <th>结果</th>
                <th>Request ID</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={text(item.id)}>
                  <td>{formatDate(item.created_at)}</td>
                  <td>
                    <div className="cell-title">{actorName(item)}</div>
                    <div className="cell-sub mono">
                      {text(item.actor_id, "系统").slice(0, 8)}
                    </div>
                  </td>
                  <td>{text(item.action)}</td>
                  <td>
                    <div className="cell-title">{device.name}</div>
                    <div className="cell-sub mono">
                      {device.id.slice(0, 8)}…
                    </div>
                  </td>
                  <td>
                    <Badge
                      tone={item.result === "success" ? "success" : "danger"}
                    >
                      {text(item.result)}
                    </Badge>
                  </td>
                  <td className="mono">{text(item.request_id)}</td>
                  <td>{text(item.reason)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : (
        <StateView
          type="empty"
          title="暂无设备操作记录"
          description="当前审计窗口内没有该设备的操作事件。"
        />
      )}
    </Panel>
  );
}
