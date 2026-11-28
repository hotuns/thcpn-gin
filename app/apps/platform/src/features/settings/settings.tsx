import "./settings-mobile.css";
import { Plus } from "lucide-react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useSystemPolicy } from "../../shared/config/system-policy";
import { Button, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "../../shared/ui";
import { AccessControlTab } from "./access-control";
import { AuditTab } from "./audit-tab";
import { ResourcesTab } from "./resources-tab";
import { platformEdition } from "../../app/edition";

export function SettingsPage() {
 const billingEnabled=useSystemPolicy().data?.billing_enabled;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = params.get("tab") ?? "resources";
  if (tab === "security")
    return <Navigate to="/account?tab=security" replace />;
  if (platformEdition.settingsResourcesOnly) {
    return (
      <>
        <PageHeader
          eyebrow="基础配置"
          title="项目与样地"
          description="管理当前系统的项目与样地分组，供设备归类、筛选与地图展示使用。"
        />
        <ResourcesTab />
      </>
    );
  }
  if (billingEnabled && tab === "billing")
    return <Navigate to="/subscription" replace />;
  if (tab === "billing") return <Navigate to="/settings" replace />;
  const tabs = [
    { id: "resources", label: "基础资料" },
    { id: "access", label: "访问控制" },
    { id: "audit", label: "审计日志" },
  ];
  return (
    <>
      <PageHeader
        eyebrow="组织 / 设置"
        title="组织设置"
        description="管理当前组织的基础资料、协作关系和审计记录。"
        actions={
          <Button variant="secondary" onClick={() => navigate("/workspaces?action=create")}><Plus size={14} />新建组织</Button>
        }
      />
      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value })}>
        <TabsList variant="underline" aria-label="组织设置">
          {tabs.map((item) => <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value={tab}>
          {tab === "resources" ? (
            <ResourcesTab />
          ) : tab === "access" ? (
            <AccessControlTab />
          ) : (
            <AuditTab />
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
