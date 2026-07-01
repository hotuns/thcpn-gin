import { useQuery } from "@tanstack/react-query";
import { Activity, FileArchive, FolderKanban, HardDrive, History, RadioTower, SquareStack } from "lucide-react";
import {
  auditApi,
  datasetsApi,
  devicesApi,
  exportJobsApi,
  projectsApi,
  sitesApi
} from "../../api";
import { Badge, Button, ErrorState, LoadingState, Page, Section, statusTone } from "../../components";
import { useWorkspace } from "../../app/WorkspaceProvider";
import { compactNumber, formatDateTime } from "../../app/format";

export function DashboardPage() {
  const { selectedWorkspaceId, selectedWorkspace } = useWorkspace();
  const enabled = Boolean(selectedWorkspaceId);
  const projects = useQuery({
    queryKey: ["projects", selectedWorkspaceId],
    queryFn: () => projectsApi.list(selectedWorkspaceId),
    enabled
  });
  const sites = useQuery({
    queryKey: ["sites", selectedWorkspaceId],
    queryFn: () => sitesApi.list({ workspace_id: selectedWorkspaceId }),
    enabled
  });
  const devices = useQuery({
    queryKey: ["devices", selectedWorkspaceId],
    queryFn: () => devicesApi.list({ workspace_id: selectedWorkspaceId }),
    enabled
  });
  const datasets = useQuery({
    queryKey: ["datasets", selectedWorkspaceId],
    queryFn: () => datasetsApi.list({ workspace_id: selectedWorkspaceId }),
    enabled
  });
  const exports = useQuery({
    queryKey: ["export-jobs", selectedWorkspaceId],
    queryFn: () => exportJobsApi.list({ workspace_id: selectedWorkspaceId, limit: 20 }),
    enabled
  });
  const audits = useQuery({
    queryKey: ["audit-logs", selectedWorkspaceId, 8],
    queryFn: () => auditApi.list({ workspace_id: selectedWorkspaceId, limit: 8 }),
    enabled
  });

  const cards = [
    { label: "项目", icon: FolderKanban, value: projects.data?.items.length, query: projects },
    { label: "站点", icon: RadioTower, value: sites.data?.items.length, query: sites },
    { label: "设备", icon: HardDrive, value: devices.data?.items.length, query: devices },
    { label: "数据集", icon: SquareStack, value: datasets.data?.items.length, query: datasets },
    { label: "导出任务", icon: FileArchive, value: exports.data?.items.length, query: exports }
  ];

  const firstError = cards.find((card) => card.query.error)?.query.error || audits.error;

  return (
    <Page
      description={selectedWorkspace ? `当前工作区：${selectedWorkspace.workspace.name}` : "请选择一个工作区。"}
      title="总览"
    >
      {firstError ? <ErrorState error={firstError} /> : null}

      <div className="metric-grid">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div className="metric-card" key={card.label}>
              <span>
                <Icon size={16} /> {card.label}
              </span>
              <strong>{card.query.isLoading ? "-" : compactNumber(card.value ?? 0)}</strong>
              <small>{card.query.isFetching ? "同步中" : "已同步"}</small>
            </div>
          );
        })}
      </div>

      <Section
        actions={
          <Button
            icon={<Activity size={16} />}
            onClick={() => {
              void projects.refetch();
              void sites.refetch();
              void devices.refetch();
              void datasets.refetch();
              void exports.refetch();
              void audits.refetch();
            }}
          >
            刷新全部
          </Button>
        }
        description="最近的审计记录帮助确认账号和资源操作是否按预期发生。"
        title="最近活动"
      >
        {audits.isLoading ? <LoadingState /> : null}
        {audits.data && audits.data.items.length > 0 ? (
          <div className="activity-list">
            {audits.data.items.map((item) => (
              <div className="activity-item" key={item.id}>
                <History size={16} />
                <div>
                  <strong>{item.action}</strong>
                  <span>
                    {item.resource_type} · {formatDateTime(item.created_at)}
                  </span>
                </div>
                <Badge tone={statusTone(item.result)}>{item.result}</Badge>
              </div>
            ))}
          </div>
        ) : null}
        {audits.data && audits.data.items.length === 0 ? (
          <div className="state state-inline">
            <span>当前工作区暂无审计记录。</span>
          </div>
        ) : null}
      </Section>
    </Page>
  );
}
