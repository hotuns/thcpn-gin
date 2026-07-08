import { useQuery } from "@tanstack/react-query";
import { Activity, FileArchive, FolderKanban, HardDrive, History, RadioTower, SquareStack } from "lucide-react";
import { Alert, Button, Result, Space, Spin, Tag } from "antd";
import {
  auditApi,
  datasetsApi,
  devicesApi,
  exportJobsApi,
  formatApiError,
  projectsApi,
  sitesApi
} from "../../api";
import { Page, Section } from "../../components";
import { useWorkspace } from "../../app/WorkspaceProvider";
import { compactNumber, formatDateTime } from "../../app/format";
import { statusColor } from "../../app/ui";

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
    <Page title={selectedWorkspace ? `总览 · ${selectedWorkspace.workspace.name}` : "总览"}>
      {firstError ? (
        <Result
          className="state state-error"
          status="warning"
          subTitle={<Alert message={formatApiError(firstError)} showIcon type="error" />}
          title="请求未完成"
        />
      ) : null}

      <div className="metric-grid">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div className="metric-card" key={card.label}>
              <span>
                <Icon size={16} /> {card.label}
              </span>
              <strong>{card.query.isLoading ? "-" : compactNumber(card.value ?? 0)}</strong>
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
        title="最近活动"
      >
        {audits.isLoading ? (
          <Space className="state state-inline">
            <Spin size="small" />
            <span>正在加载</span>
          </Space>
        ) : null}
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
                <Tag color={statusColor(item.result)}>{item.result}</Tag>
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
