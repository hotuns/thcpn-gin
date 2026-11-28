import "./settings-mobile.css";
import { Dialog, DialogContent, DialogTitle } from "../../shared/ui/primitives/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError, type DeviceTaxonomyTerm, type JsonRecord } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Pencil, Plus, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { policyLimit } from "../../shared/config/system-policy";
import { Badge, Button, Textarea, Input, Panel, SelectInput, StateView } from "../../shared/ui";
import { resourceKindLabel, text } from "./settings-model";
import { platformEdition } from "../../app/edition";


export function ResourcesTab() {
  const { currentId, current, refresh: refreshWorkspaces } = useWorkspace();
  const client = useQueryClient();
  const projects = useQuery({
    queryKey: workspaceQueryKey(currentId, "projects"),
    queryFn: () => api.projects.list(currentId!),
    enabled: Boolean(currentId),
  });
  const sites = useQuery({
    queryKey: workspaceQueryKey(currentId, "sites"),
    queryFn: () => api.sites.list(currentId!),
    enabled: Boolean(currentId),
  });
  const taxonomy = useQuery({ queryKey: ["device-taxonomy"], queryFn: api.devices.taxonomy });
  const [resourceDialog, setResourceDialog] = useState<{
    kind: "Project" | "Site";
    record?: JsonRecord;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [editingWorkspace, setEditingWorkspace] = useState(false);
  const showError = (error: unknown) => {
    const item = formatApiError(error);
    setMessage(
      `${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
    );
  };
  const saveResource = async (
    kind: "Project" | "Site",
    record: JsonRecord | undefined,
    payload: JsonRecord,
  ) => {
    if (!currentId) return false;
    try {
      if (kind === "Project") {
        if (record) await api.projects.update(text(record.id), payload);
        else await api.projects.create({ workspace_id: currentId, ...payload });
      } else {
        if (record) await api.sites.update(text(record.id), payload);
        else await api.sites.create({ workspace_id: currentId, ...payload });
        await Promise.all(["device-map", "device"].map(key =>
          client.invalidateQueries({ queryKey: workspaceQueryKey(currentId, key) })
        ));
      }
      setMessage(`${resourceKindLabel(kind)}${record ? "已更新" : "已创建"}`);
      setResourceDialog(null);
      await client.invalidateQueries({
        queryKey: workspaceQueryKey(
          currentId,
          kind === "Project" ? "projects" : "sites",
        ),
      });
      return true;
    } catch (error) {
      showError(error);
      return false;
    }
  };
  const saveWorkspaceName = async (name: string) => {
    if (!currentId) return false;
    try {
      await api.workspaces.update(currentId, { name });
      await refreshWorkspaces();
      setEditingWorkspace(false);
      setMessage("组织名称已更新");
      return true;
    } catch (error) { showError(error); return false; }
  };
  if (!currentId)
    return (
      <Panel>
        <StateView
          type="empty"
          title="请选择组织"
          description="请先选择组织，再管理基础资料。"
        />
      </Panel>
    );
  return (
    <>
      <div className="workspace-resource-layout" data-onboarding="organization-resources">
      {!platformEdition.settingsResourcesOnly && current && <Panel className="workspace-settings-summary"><div className="workspace-setting-row"><div><strong>组织名称</strong></div><div className="workspace-setting-value"><span title={current.name}>{current.name}</span><Button variant="secondary" onClick={() => { setMessage(""); setEditingWorkspace(true); }}><Pencil size={13} />编辑</Button></div></div></Panel>}
      <div className="grid grid-2 workspace-resource-grid">
        <Panel>
          <div className="panel-header">
            <div>
              <h2 className="panel-title">项目</h2>

            </div>
            <div className="resource-panel-actions">
              <Badge tone="info">{projects.data?.items.length ?? 0}</Badge>
              <Button
                variant="secondary"
                onClick={() =>
                  { setMessage(""); setResourceDialog({ kind: "Project" }); }
                }
              >
                <Plus size={14} />
                创建项目
              </Button>
            </div>
          </div>
          <ResourceRows
            query={projects}
            kind="Project"
            onEdit={(record) =>
              { setMessage(""); setResourceDialog({ kind: "Project", record }); }
            }
          />
        </Panel>
        <Panel>
          <div className="panel-header">
            <div>
              <h2 className="panel-title">样地</h2>

            </div>
            <div className="resource-panel-actions">
              <Badge tone="info">{sites.data?.items.length ?? 0}</Badge>
              <Button
                variant="secondary"
                onClick={() => { setMessage(""); setResourceDialog({ kind: "Site" }); }}
              >
                <Plus size={14} />
                创建样地
              </Button>
            </div>
          </div>
          <ResourceRows
            query={sites}
            kind="Site"
            onEdit={(record) =>
              { setMessage(""); setResourceDialog({ kind: "Site", record }); }
            }
          />
        </Panel>
      </div>
      </div>
      {resourceDialog && (
        <ResourceFormDialog
          key={`${resourceDialog.kind}-${text(resourceDialog.record?.id, "new")}`}
          error={message}
          kind={resourceDialog.kind}
          record={resourceDialog.record}
          projects={projects.data?.items ?? []}
          terms={taxonomy.data?.items ?? []}
          onClose={() => setResourceDialog(null)}
          onSave={(payload) =>
            saveResource(resourceDialog.kind, resourceDialog.record, payload)
          }
        />
      )}
      {editingWorkspace && current && <WorkspaceNameDialog error={message} name={current.name} onClose={() => setEditingWorkspace(false)} onSave={saveWorkspaceName} />}
      {message && <div className="command-note section-gap">{message}</div>}
    </>
  );
}

function WorkspaceNameDialog({ name: initialName, error, onClose, onSave }: { error: string; name: string; onClose: () => void; onSave: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await onSave(name.trim()); } finally { setBusy(false); } };
  return <Dialog open onOpenChange={open => !open && !busy && onClose()}><DialogContent className="resource-modal" aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}><Panel className="resource-dialog"><div className="panel-header"><DialogTitle className="panel-title">编辑组织名称</DialogTitle><Button variant="secondary" onClick={onClose} disabled={busy}><X size={14} />关闭</Button></div><form className="resource-dialog-form" onSubmit={submit}><label className="field"><span className="field-label">名称</span><Input autoFocus required maxLength={policyLimit("workspace_name",120)} value={name} onChange={(event) => setName(event.target.value)} /></label>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-actions mobile-form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={busy || !name.trim()}>{busy ? "保存中…" : "保存"}</Button></div></form></Panel></DialogContent></Dialog>;
}

function ResourceRows({
  query,
  kind,
  onEdit,
}: {
  query: any;
  kind: "Project" | "Site";
  onEdit: (record: JsonRecord) => void;
}) {
  if (query.isLoading)
    return (
      <StateView
        type="loading"
        title={`正在加载${resourceKindLabel(kind)}`}
        description="正在读取基础资料。"
      />
    );
  if (query.error)
    return (
      <StateView
        type="error"
        title={`${resourceKindLabel(kind)}加载失败`}
        description={formatApiError(query.error).message}
      />
    );
  if (!query.data?.items.length)
    return (
      <StateView
        type="empty"
        title={`暂无${resourceKindLabel(kind)}`}
        description={`创建第一个${resourceKindLabel(kind)}后会显示在这里。`}
      />
    );
  return (
    <div className="series-list">
      {query.data.items.map((item: JsonRecord) => (
        <div className="series-row resource-row" key={text(item.id)}>
          <div>
            <div className="cell-title">{text(item.name)}</div>
            <div className="cell-sub">
              {text(item.description, text(item.location_text, "暂无描述"))}
            </div>
            <div className="cell-sub mono">{text(item.id)}</div>
          </div>
          <div className="resource-row-actions">
            <Badge tone={item.status === "active" ? "success" : "neutral"}>
              {item.status === "archived" ? "归档" : "启用"}
            </Badge>
            <Button variant="secondary" onClick={() => onEdit(item)}>
              <Pencil size={13} />
              编辑
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ResourceFormDialog({
  error,
  kind,
  record,
  projects,
  terms,
  onClose,
  onSave,
}: {
  error: string;
  kind: "Project" | "Site";
  record?: JsonRecord;
  projects: JsonRecord[];
  terms: DeviceTaxonomyTerm[];
  onClose: () => void;
  onSave: (payload: JsonRecord) => Promise<boolean>;
}) {
  const editing = Boolean(record);
  const [name, setName] = useState(text(record?.name, ""));
  const [description, setDescription] = useState(
    text(record?.description, ""),
  );
  const [location, setLocation] = useState(
    text(record?.location_text, ""),
  );
  const [projectId, setProjectId] = useState(text(record?.project_id, ""));
  const [status, setStatus] = useState(text(record?.status, "active"));
  const [ecosystem, setEcosystem] = useState(text(record?.ecosystem_term_id, ""));
  const [latitude, setLatitude] = useState(text(record?.latitude, ""));
  const [longitude, setLongitude] = useState(text(record?.longitude, ""));
  const [altitude, setAltitude] = useState(text(record?.altitude_m, ""));
  const [busy, setBusy] = useState(false);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave(
        kind === "Project"
          ? { name: name.trim(), description: description.trim(), status }
          : {
              name: name.trim(),
              ...(editing ? {} : { project_id: projectId }),
              description: description.trim(),
              location_text: location.trim(),
              ...(editing ? { status } : {}),
              latitude: latitude === "" ? null : Number(latitude),
              longitude: longitude === "" ? null : Number(longitude),
              altitude_m: altitude === "" ? null : Number(altitude),
              ecosystem_term_id: ecosystem || null,
            },
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={open => !open && !busy && onClose()}>
      <DialogContent className="resource-modal" aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}>
        <Panel className="resource-dialog">
          <div className="panel-header">
          <div>
            <DialogTitle className="panel-title">
              {editing ? "编辑" : "创建"}{resourceKindLabel(kind)}
            </DialogTitle>
            <div className="panel-kicker">
              {kind === "Project" ? "管理项目名称和描述" : "设置所属项目和样地位置"}
            </div>
          </div>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            <X size={14} />
            关闭
          </Button>
        </div>
        <form className="resource-dialog-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">名称</span>
          <Input
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {kind === "Project" ? (
          <label className="field">
            <span className="field-label">描述</span>
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        ) : (
          <>
            <label className="field">
              <span className="field-label">所属项目</span>
              <SelectInput
                required
                disabled={editing}
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">选择项目</option>
                {projects.map((item) => (
                  <option key={text(item.id)} value={text(item.id)}>
                    {text(item.name)}
                  </option>
                ))}
              </SelectInput>
            </label>
            <label className="field">
              <span className="field-label">位置</span>
              <Input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
            </label>
            <label className="field"><span className="field-label">样地简介</span>
              <Textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} />
            </label>
            <div className="grid grid-2">
              <label className="field"><span className="field-label">经度</span>
                <Input type="number" step="any" min={-180} max={180} required={latitude !== ""} value={longitude} onChange={event => setLongitude(event.target.value)} />
              </label>
              <label className="field"><span className="field-label">纬度</span>
                <Input type="number" step="any" min={-90} max={90} required={longitude !== ""} value={latitude} onChange={event => setLatitude(event.target.value)} />
              </label>
            </div>
            <label className="field"><span className="field-label">海拔（米）</span>
              <Input type="number" step="any" value={altitude} onChange={event => setAltitude(event.target.value)} />
            </label>
            <label className="field"><span className="field-label">生态分类</span>
              <SelectInput value={ecosystem} onChange={event => setEcosystem(event.target.value)}>
                <option value="">未设置</option>
                {ecosystem && !terms.some(term => term.id === ecosystem) && <option value={ecosystem}>当前分类</option>}
                {terms.filter(term => term.kind === "ecosystem").map(term => <option key={term.id} value={term.id}>{term.name_zh}</option>)}
              </SelectInput>
            </label>
          </>
        )}
        {editing && (
          <label className="field">
            <span className="field-label">状态</span>
            <SelectInput
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="active">启用</option>
              <option value="archived">归档</option>
            </SelectInput>
          </label>
        )}
          {error && <div className="form-error" role="alert">{error}</div>}<div className="form-actions mobile-form-actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={busy || !name.trim() || (kind === "Site" && !projectId)}
            >
              {busy ? "保存中…" : editing ? "保存更改" : "确认创建"}
            </Button>
          </div>
          </form>
        </Panel>
      </DialogContent>
    </Dialog>
  );
}
