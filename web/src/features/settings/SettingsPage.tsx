import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Tabs, Typography } from "antd";
import {
  AuditLogsPage,
  AccessGrantsPage,
  InvitationsPage,
  ProjectsPage,
  SitesPage
} from "../resources/ResourcePages";
import { MembersPage } from "../members/MembersPage";
import { SecurityPage } from "../security/SecurityPage";
import { Page } from "../../components";

const settingTabs = [
  { key: "basics", label: "基础资料" },
  { key: "members", label: "成员权限" },
  { key: "grants", label: "资源授权" },
  { key: "invitations", label: "邀请" },
  { key: "audit", label: "审计日志" },
  { key: "account", label: "账号安全" }
];

export function SettingsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const activeTab = settingTabs.some((tab) => tab.key === searchParams.get("tab")) ? searchParams.get("tab") || "basics" : "basics";
  const items = useMemo(
    () => [
      {
        children: (
          <div className="settings-stacked-pages">
            <Typography.Title level={4}>基础资料</Typography.Title>
            <ProjectsPage />
            <SitesPage />
          </div>
        ),
        key: "basics",
        label: "基础资料"
      },
      {
        children: <MembersPage />,
        key: "members",
        label: "成员权限"
      },
      {
        children: <AccessGrantsPage />,
        key: "grants",
        label: "资源授权"
      },
      {
        children: <InvitationsPage />,
        key: "invitations",
        label: "邀请"
      },
      {
        children: <AuditLogsPage />,
        key: "audit",
        label: "审计日志"
      },
      {
        children: <SecurityPage />,
        key: "account",
        label: "账号安全"
      }
    ],
    []
  );

  return (
    <Page
      description="集中管理工作区基础资料、内部成员、外部资源授权、邀请、审计记录和个人账号安全。"
      title="设置"
    >
      <Tabs
        activeKey={activeTab}
        className="settings-tabs"
        items={items}
        onChange={(tab) => navigate(`/settings?tab=${tab}`, { replace: true })}
      />
    </Page>
  );
}
