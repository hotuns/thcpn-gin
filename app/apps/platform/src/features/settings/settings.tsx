import "./settings-mobile.css";
import { ArrowLeft, Plus } from "lucide-react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useSystemPolicy } from "../../shared/config/system-policy";
import { Button, PageHeader, Tabs, TabsList, TabsTrigger } from "../../shared/ui";
import { AccessControlTab } from "./access-control";
import { AuditTab } from "./audit-tab";
import { ResourcesTab } from "./resources-tab";

export function SettingsPage() {
 const billingEnabled=useSystemPolicy().data?.billing_enabled;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = params.get("tab") ?? "resources";
  if (tab === "security")
    return <Navigate to="/account?tab=security" replace />;
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
          <div className="header-actions">
            <Button variant="secondary" onClick={() => navigate("/workspaces")}><ArrowLeft size={14} />返回组织</Button>
            <Button variant="secondary" onClick={() => navigate("/workspaces?action=create")}><Plus size={14} />新建组织</Button>
          </div>
        }
      />
      <Tabs className="section-tabs" value={tab} onValueChange={(value) => setParams({ tab: value })}>
        <TabsList>
          {tabs.map((item) => <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {tab === "resources" ? (
        <ResourcesTab />
      ) : tab === "access" ? (
        <AccessControlTab />
      ) : (
        <AuditTab />
      )}
    </>
  );
}
