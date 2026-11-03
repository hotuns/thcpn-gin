import "../../shared/data/mobile-data.css";
import {
  api,
  commonStatusLabel,
  formatApiError,
  roleTemplateLabel,
} from "@thcpn/api";
import {
  useWorkspace
} from "@thcpn/workspace";
import {
  Building2,
  SlidersHorizontal
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  useNavigate,
  useSearchParams
} from "react-router-dom";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  PageHeader,
  Panel,
  SelectInput,
  StateView,
  Table
} from "../../shared/ui";



export function WorkspacesPage() {
  const { workspaces, currentId, setCurrentId, loading, error, refresh } =
    useWorkspace();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [showForm, setShowForm] = useState(params.get("action") === "create");
  const [name, setName] = useState("");
  const [type, setType] = useState("lab");
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (params.get("action") !== "create") return;
    setShowForm(true);
    const next = new URLSearchParams(params);
    next.delete("action");
    setParams(next, { replace: true });
  }, [params, setParams]);
  const manageWorkspace = (workspaceId: string) => {
    if (workspaceId !== currentId) setCurrentId(workspaceId);
    navigate("/settings?tab=resources");
  };
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setFormError("");
    try {
      const created = await api.workspaces.create({
        name: name.trim(),
        organization_type: type,
      });
      setMessage(`已创建 ${created.workspace.name}`);
      setName("");
      setShowForm(false);
      await refresh();
      setCurrentId(created.workspace.id);
    } catch (e) {
      const value = formatApiError(e);
      setFormError(
        `${value.message}${value.requestId ? ` · request id ${value.requestId}` : ""}`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={showForm} onOpenChange={(open) => { if (!busy) setShowForm(open); }}>
      <PageHeader
        eyebrow="组织"
        title="组织"
        description="管理你可以访问的组织。切换后，只显示所选组织内的设备、数据集和导出任务。"
        actions={
          <DialogTrigger asChild>
            <Button onClick={() => setFormError("")}>
              <Building2 size={15} />
              创建组织
            </Button>
          </DialogTrigger>
        }
      />
      {message && (
        <div className="command-note" role="status" style={{ marginBottom: 16 }}>
          {message}
        </div>
      )}
        <DialogContent onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}>
          <DialogHeader>
            <DialogTitle>创建组织</DialogTitle>
            <DialogDescription>为课题组或机构建立独立的设备与数据空间，创建后将自动切换到新组织。</DialogDescription>
          </DialogHeader>
          <form className="shadcn-dialog-form" onSubmit={(event) => { event.preventDefault(); void submit(); }} aria-busy={busy}>
            <label className="field">
              <span className="field-label">组织名称</span>
              <Input required disabled={busy} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：作物生态课题组" />
            </label>
            <label className="field">
              <span className="field-label">组织类型</span>
              <SelectInput value={type} onValueChange={setType} disabled={busy} aria-label="组织类型">
                <option value="lab">实验室</option>
                <option value="institution">机构</option>
                <option value="company">企业</option>
                <option value="government">政府</option>
                <option value="service_provider">服务商</option>
                <option value="other">其他</option>
              </SelectInput>
            </label>
            {formError && <div className="form-error" role="alert">{formError}</div>}
            <DialogFooter>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setShowForm(false)}>取消</Button>
              <Button type="submit" disabled={busy || !name.trim()}>{busy ? "创建中…" : "创建并切换"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      {loading ? (
        <Panel>
          <StateView
            type="loading"
            title="正在加载组织"
            description="正在从服务端恢复可访问的组织空间。"
          />
        </Panel>
      ) : error ? (
        <Panel>
          <StateView
            type="error"
            title="组织列表加载失败"
            description={formatApiError(error).message}
            requestId={formatApiError(error).requestId}
            action={
              <Button variant="secondary" onClick={refresh}>
                重新加载
              </Button>
            }
          />
        </Panel>
      ) : (
        <Panel data-onboarding="organization-list">
          <div className="table-wrap mobile-data-list">
            <Table className="data-table mobile-summary-table">
              <thead>
                <tr>
                  <th>组织</th>
                  <th>类型</th>
                  <th>角色</th>
                  <th>成员状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {workspaces.map((item) => (
                  <tr
                    key={item.id}
                    className={item.id === currentId ? "selected-row" : ""}
                  >
                    <td data-label="组织" className="mobile-cell-title">
                      <div className="cell-title">{item.name}</div>
                      <div className="cell-sub mono">{item.id}</div>
                    </td>
                    <td data-label="类型">
                      {item.type === "personal"
                        ? "个人"
                        : (item.organization_type ?? "组织")}
                    </td>
                    <td data-label="角色" className="mobile-cell-wide">
                      <div className="cell-title">
                        {roleTemplateLabel(
                          item.membership.role.code,
                          item.membership.role.name,
                        )}
                      </div>
                      <div className="cell-sub mono">
                        {item.membership.role.code}
                      </div>
                    </td>
                    <td data-label="成员状态" className="mobile-cell-status">
                      <Badge
                        tone={
                          item.membership.status === "active"
                            ? "success"
                            : "warning"
                        }
                      >
                        {commonStatusLabel(item.membership.status)}
                      </Badge>
                    </td>
                    <td data-label="操作" className="mobile-cell-actions">
                      <div className="workspace-list-actions">
                        {item.id === currentId ? (
                          <Badge tone="info">当前组织</Badge>
                        ) : (
                          <Button
                            variant="secondary"
                            onClick={() => setCurrentId(item.id)}
                          >
                            切换
                          </Button>
                        )}
                        <Button onClick={() => manageWorkspace(item.id)}>
                          <SlidersHorizontal size={14} />
                          管理
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {!workspaces.length && (
              <StateView
                type="empty"
                title="没有可用组织"
                description="创建一个组织组织，或联系管理员加入现有空间。"
              />
            )}
          </div>
        </Panel>
      )}
    </Dialog>
  );
}
