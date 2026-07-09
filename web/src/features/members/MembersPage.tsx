import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Alert, App as AntApp, Button, Form, Input, Modal, Popconfirm, Result, Select, Space, Spin, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import {
  datasetsApi,
  devicesApi,
  formatApiError,
  membersApi,
  permissionsApi,
  projectsApi,
  sitesApi,
  type Dataset,
  type Device,
  type MemberScopeType,
  type PermissionCode,
  type Project,
  type Site,
  type WorkspaceMember
} from "../../api";
import { Page, Section } from "../../components";
import { useWorkspace } from "../../app/WorkspaceProvider";
import { formatDateTime } from "../../app/format";
import { copyableId, statusColor, tableScrollX } from "../../app/ui";
import { internalRoleMeta, roleLabel } from "../settings/roleMeta";
import { PermissionPicker, PermissionSummary } from "../settings/PermissionPicker";

type SelectorKind = "email" | "phone" | "user_id";
type MemberFormState = {
  selector: SelectorKind;
  value: string;
  template_code: string;
  permission_codes: PermissionCode[];
  scope_type: MemberScopeType;
  scope_id: string;
};

const selectorOptions: Array<{ label: string; value: SelectorKind }> = [
  { label: "邮箱", value: "email" },
  { label: "手机号", value: "phone" },
  { label: "用户 ID", value: "user_id" }
];

const scopeTypeOptions: Array<{ label: string; value: MemberScopeType }> = [
  { label: "工作区", value: "workspace" },
  { label: "项目", value: "project" },
  { label: "站点", value: "site" },
  { label: "设备", value: "device" },
  { label: "数据集", value: "dataset" }
];

export function MembersPage() {
  const { selectedWorkspaceId, selectedWorkspace } = useWorkspace();
  const [form, setForm] = useState<MemberFormState>({
    selector: "email",
    value: "",
    template_code: "viewer",
    permission_codes: [],
    scope_type: "workspace",
    scope_id: ""
  });
  const [roleDialog, setRoleDialog] = useState<{
    member: WorkspaceMember;
    templateCode: string;
    permissionCodes: PermissionCode[];
    scopeType: MemberScopeType;
    scopeID: string;
  } | null>(null);
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  const members = useQuery({
    queryKey: ["members", selectedWorkspaceId],
    queryFn: () => membersApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });

  const catalog = useQuery({
    queryKey: ["permissions-catalog"],
    queryFn: permissionsApi.catalog
  });

  const projects = useQuery({
    queryKey: ["member-scope-projects", selectedWorkspaceId],
    queryFn: () => projectsApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });

  const sites = useQuery({
    queryKey: ["member-scope-sites", selectedWorkspaceId],
    queryFn: () => sitesApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });

  const devices = useQuery({
    queryKey: ["member-scope-devices", selectedWorkspaceId],
    queryFn: () => devicesApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });

  const datasets = useQuery({
    queryKey: ["member-scope-datasets", selectedWorkspaceId],
    queryFn: () => datasetsApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });

  const scopeLabels = useMemo(
    () => buildScopeLabelMap(selectedWorkspaceId, projects.data?.items ?? [], sites.data?.items ?? [], devices.data?.items ?? [], datasets.data?.items ?? []),
    [datasets.data?.items, devices.data?.items, projects.data?.items, selectedWorkspaceId, sites.data?.items]
  );
  const workspaceScopeID = selectedWorkspaceId || "";
  const formScopeOptions = useMemo(
    () => buildScopeResourceOptions(form.scope_type, selectedWorkspaceId, projects.data?.items ?? [], sites.data?.items ?? [], devices.data?.items ?? [], datasets.data?.items ?? []),
    [datasets.data?.items, devices.data?.items, form.scope_type, projects.data?.items, selectedWorkspaceId, sites.data?.items]
  );
  const roleDialogScopeOptions = useMemo(
    () =>
      roleDialog
        ? buildScopeResourceOptions(roleDialog.scopeType, selectedWorkspaceId, projects.data?.items ?? [], sites.data?.items ?? [], devices.data?.items ?? [], datasets.data?.items ?? [])
        : [],
    [datasets.data?.items, devices.data?.items, projects.data?.items, roleDialog, selectedWorkspaceId, sites.data?.items]
  );

  useEffect(() => {
    if (selectedWorkspaceId && form.scope_type === "workspace" && form.scope_id !== selectedWorkspaceId) {
      setForm((current) => ({ ...current, scope_id: workspaceScopeID }));
    }
  }, [form.scope_id, form.scope_type, selectedWorkspaceId, workspaceScopeID]);

  useEffect(() => {
    if (catalog.data && form.permission_codes.length === 0) {
      setForm((current) => ({ ...current, permission_codes: templatePermissionCodes(catalog.data, current.template_code) }));
    }
  }, [catalog.data, form.permission_codes.length, form.template_code]);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["members", selectedWorkspaceId] });

  const addMember = useMutation({
    mutationFn: () =>
      membersApi.add(selectedWorkspaceId, {
        [form.selector]: form.value.trim(),
        template_code: form.template_code,
        permission_codes: form.permission_codes,
        scope_type: form.scope_type,
        scope_id: form.scope_type === "workspace" ? workspaceScopeID : form.scope_id
      }),
    onSuccess: () => {
      setForm({
        selector: form.selector,
        value: "",
        template_code: "viewer",
        permission_codes: templatePermissionCodes(catalog.data, "viewer"),
        scope_type: "workspace",
        scope_id: workspaceScopeID
      });
      invalidate();
      void message.success("成员已添加");
    }
  });

  const updateRole = useMutation({
    mutationFn: (input: { member: WorkspaceMember; templateCode: string; permissionCodes: PermissionCode[]; scopeType: MemberScopeType; scopeID: string }) =>
      membersApi.updateRole(selectedWorkspaceId, input.member.id, {
        template_code: input.templateCode,
        permission_codes: input.permissionCodes,
        scope_type: input.scopeType,
        scope_id: input.scopeType === "workspace" ? workspaceScopeID : input.scopeID
      }),
    onSuccess: () => {
      setRoleDialog(null);
      invalidate();
      void message.success("成员已更新");
    }
  });

  const removeMember = useMutation({
    mutationFn: (memberId: string) => membersApi.remove(selectedWorkspaceId, memberId),
    onSuccess: () => {
      invalidate();
      void message.success("成员已移除");
    }
  });

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    addMember.mutate();
  }

  function handleAddTemplateChange(templateCode: string) {
    const nextScopeType = normalizeScopeType(templateCode, form.scope_type);
    setForm({
      ...form,
      template_code: templateCode,
      permission_codes: templateCode === "custom" ? form.permission_codes : templatePermissionCodes(catalog.data, templateCode),
      scope_type: nextScopeType,
      scope_id: nextScopeType === "workspace" ? workspaceScopeID : ""
    });
  }

  function handleAddScopeTypeChange(scopeType: MemberScopeType) {
    setForm({ ...form, scope_type: scopeType, scope_id: scopeType === "workspace" ? workspaceScopeID : "" });
  }

  function openRoleDialog(member: WorkspaceMember) {
    setRoleDialog({
      member,
      templateCode: member.template_code,
      permissionCodes: member.permission_codes,
      scopeType: member.scope_type,
      scopeID: member.scope_id
    });
  }

  function handleDialogTemplateChange(templateCode: string) {
    if (!roleDialog) {
      return;
    }
    const nextScopeType = normalizeScopeType(templateCode, roleDialog.scopeType);
    setRoleDialog({
      ...roleDialog,
      templateCode,
      permissionCodes: templateCode === "custom" ? roleDialog.permissionCodes : templatePermissionCodes(catalog.data, templateCode),
      scopeType: nextScopeType,
      scopeID: nextScopeType === "workspace" ? workspaceScopeID : ""
    });
  }

  function handleDialogScopeTypeChange(scopeType: MemberScopeType) {
    if (!roleDialog) {
      return;
    }
    setRoleDialog({ ...roleDialog, scopeType, scopeID: scopeType === "workspace" ? workspaceScopeID : "" });
  }

  const columns: TableColumnsType<WorkspaceMember> = [
    {
      key: "user",
      title: "成员",
      width: 220,
      render: (_, member) => (
        <div className="table-primary">
          <strong>{member.user.name}</strong>
          <span>{member.user.email || member.user.phone || member.user.id}</span>
        </div>
      )
    },
    {
      key: "status",
      title: "状态",
      width: 130,
      render: (_, member) => <Tag color={statusColor(member.status)}>{member.status}</Tag>
    },
    {
      key: "role",
      title: "权限",
      width: 260,
      render: (_, member) => <PermissionSummary catalog={catalog.data} codes={member.permission_codes} />
    },
    {
      key: "template",
      title: "模板",
      width: 160,
      render: (_, member) => <Tag>{member.template_name || roleLabel(member.template_code)}</Tag>
    },
    {
      key: "scope",
      title: "范围",
      width: 260,
      render: (_, member) => <ScopeSummary scopeID={member.scope_id} scopeLabels={scopeLabels} scopeType={member.scope_type} />
    },
    {
      key: "joined",
      title: "加入时间",
      width: 180,
      render: (_, member) => formatDateTime(member.joined_at)
    },
    {
      key: "id",
      title: "ID",
      width: 240,
      render: (_, member) => copyableId(member.id)
    },
    {
      key: "actions",
      title: "操作",
      width: 220,
      render: (_, member) => (
        <div className="row-actions">
          <Button disabled={updateRole.isPending} onClick={() => openRoleDialog(member)}>
            调整
          </Button>
          <Popconfirm
            cancelText="取消"
            okButtonProps={{ danger: true, loading: removeMember.isPending }}
            okText="移除"
            onConfirm={() => removeMember.mutate(member.id)}
            title={`移除 ${member.user.name || member.user.email || member.user.id}`}
          >
            <Button danger disabled={removeMember.isPending} icon={<Trash2 size={15} />}>
              移除
            </Button>
          </Popconfirm>
        </div>
      )
    }
  ];

  return (
    <Page
      description={selectedWorkspace ? `当前工作区：${selectedWorkspace.workspace.name}` : "请选择工作区后管理成员。"}
      title="成员"
    >
      <Section description="长期参与组织管理和协作的人加入工作区成员；外部协作者、售后临时访问请使用资源授权。" title="添加成员">
        <form className="form-grid" onSubmit={handleAdd}>
          <Form.Item className="field" label="匹配方式">
            <Select className="control" onChange={(value) => setForm({ ...form, selector: value })} options={selectorOptions} value={form.selector} />
          </Form.Item>
          <Form.Item className="field" label="匹配值" required>
            <Input className="control" onChange={(event) => setForm({ ...form, value: event.target.value })} required value={form.value} />
          </Form.Item>
          <Form.Item className="field" label="范围类型">
            <Select
              className="control"
              onChange={handleAddScopeTypeChange}
              options={scopeTypeOptions.filter((option) => internalRoleMetaAllowedScopes(form.template_code).includes(option.value))}
              value={form.scope_type}
            />
          </Form.Item>
          <Form.Item className="field" label="范围资源" required>
            <Select
              className="control"
              disabled={form.scope_type === "workspace"}
              onChange={(value) => setForm({ ...form, scope_id: value })}
              options={formScopeOptions}
              placeholder="选择资源"
              showSearch
              value={form.scope_type === "workspace" ? workspaceScopeID : form.scope_id || undefined}
            />
          </Form.Item>
          <div className="form-actions align-end">
            <Button disabled={addMember.isPending || !selectedWorkspaceId || !form.permission_codes.length || (form.scope_type !== "workspace" && !form.scope_id)} htmlType="submit" icon={<Plus size={16} />} type="primary">
              添加
            </Button>
          </div>
        </form>
        <PermissionPicker
          catalog={catalog.data}
          mode="member"
          onChange={(permission_codes) => setForm((current) => ({ ...current, permission_codes }))}
          onTemplateChange={handleAddTemplateChange}
          templateCode={form.template_code}
          value={form.permission_codes}
        />
      </Section>

      <Section title="成员列表">
        {members.isLoading ? (
          <Space className="state state-inline">
            <Spin size="small" />
            <span>正在加载</span>
          </Space>
        ) : null}
        {members.error ? (
          <Result
            className="state state-error"
            extra={<Button onClick={() => void members.refetch()}>重试</Button>}
            status="warning"
            subTitle={<Alert message={formatApiError(members.error)} showIcon type="error" />}
            title="请求未完成"
          />
        ) : null}
        {members.data ? (
          <Table<WorkspaceMember>
            className="data-table"
            columns={columns}
            dataSource={members.data.items}
            locale={{ emptyText: "暂无成员" }}
            pagination={false}
            rowKey={(member) => member.id}
            scroll={{ x: tableScrollX(columns) }}
            size="middle"
            tableLayout="fixed"
          />
        ) : null}
      </Section>

      <Modal
        confirmLoading={updateRole.isPending}
        okText="保存"
        onCancel={() => setRoleDialog(null)}
        onOk={() => roleDialog ? updateRole.mutate(roleDialog) : undefined}
        open={Boolean(roleDialog)}
        title="调整成员"
      >
        {roleDialog ? (
          <div className="role-change-dialog">
            <div className="role-change-current">
              <Typography.Text type="secondary">成员</Typography.Text>
              <Typography.Text strong>{roleDialog.member.user.name}</Typography.Text>
              <Typography.Text type="secondary">{roleDialog.member.user.email || roleDialog.member.user.phone || roleDialog.member.user.id}</Typography.Text>
            </div>
            <Form layout="vertical">
              <PermissionPicker
                catalog={catalog.data}
                disabled={roleDialog.templateCode === "owner"}
                mode="member"
                onChange={(permissionCodes) => setRoleDialog((current) => current ? { ...current, permissionCodes } : current)}
                onTemplateChange={handleDialogTemplateChange}
                templateCode={roleDialog.templateCode}
                value={roleDialog.permissionCodes}
              />
              <Form.Item label="范围类型">
                <Select
                  disabled={roleDialog.templateCode === "owner"}
                  onChange={handleDialogScopeTypeChange}
                  options={scopeTypeOptions.filter((option) => internalRoleMetaAllowedScopes(roleDialog.templateCode).includes(option.value))}
                  value={roleDialog.scopeType}
                />
              </Form.Item>
              <Form.Item label="范围资源">
                <Select
                  disabled={roleDialog.templateCode === "owner" || roleDialog.scopeType === "workspace"}
                  onChange={(value) => setRoleDialog({ ...roleDialog, scopeID: value })}
                  options={roleDialogScopeOptions}
                  showSearch
                  value={roleDialog.scopeType === "workspace" ? workspaceScopeID : roleDialog.scopeID || undefined}
                />
              </Form.Item>
              {updateRole.error ? <Alert message={formatApiError(updateRole.error)} showIcon type="error" /> : null}
            </Form>
          </div>
        ) : null}
      </Modal>
    </Page>
  );
}

function ScopeSummary({ scopeID, scopeLabels, scopeType }: { scopeID: string; scopeLabels: Map<string, string>; scopeType: MemberScopeType }) {
  return (
    <div className="table-primary">
      <strong>{scopeLabels.get(scopeKey(scopeType, scopeID)) || `${scopeTypeLabel(scopeType)} · ${scopeID}`}</strong>
      <span>{copyableId(scopeID)}</span>
    </div>
  );
}

function normalizeScopeType(templateCode: string, currentScopeType: MemberScopeType): MemberScopeType {
  const allowedScopes = internalRoleMetaAllowedScopes(templateCode);
  return allowedScopes.includes(currentScopeType) ? currentScopeType : allowedScopes[0];
}

function internalRoleMetaAllowedScopes(templateCode: string): MemberScopeType[] {
  return internalRoleMeta[templateCode as keyof typeof internalRoleMeta]?.allowedScopes ?? ["workspace", "project", "site", "device", "dataset"];
}

function templatePermissionCodes(catalog: { templates: Array<{ code: string; permission_codes: PermissionCode[] }> } | undefined, templateCode: string): PermissionCode[] {
  return catalog?.templates.find((template) => template.code === templateCode)?.permission_codes ?? [];
}

function buildScopeResourceOptions(scopeType: MemberScopeType, workspaceID: string, projects: Project[], sites: Site[], devices: Device[], datasets: Dataset[]) {
  switch (scopeType) {
    case "workspace":
      return [{ label: `工作区 · ${workspaceID}`, value: workspaceID }];
    case "project":
      return projects.map((project) => ({ label: `项目 · ${project.name}`, value: project.id }));
    case "site":
      return sites.map((site) => ({ label: `站点 · ${site.name}`, value: site.id }));
    case "device":
      return devices.map((device) => ({ label: `设备 · ${device.name} · ${device.serial_no}`, value: device.id }));
    case "dataset":
      return datasets.map((dataset) => ({ label: `数据集 · ${dataset.name}`, value: dataset.id }));
    default:
      return [];
  }
}

function buildScopeLabelMap(workspaceID: string, projects: Project[], sites: Site[], devices: Device[], datasets: Dataset[]) {
  const labels = new Map<string, string>();
  if (workspaceID) {
    labels.set(scopeKey("workspace", workspaceID), `工作区 · ${workspaceID}`);
  }
  projects.forEach((project) => labels.set(scopeKey("project", project.id), `项目 · ${project.name}`));
  sites.forEach((site) => labels.set(scopeKey("site", site.id), `站点 · ${site.name}`));
  devices.forEach((device) => labels.set(scopeKey("device", device.id), `设备 · ${device.name}`));
  datasets.forEach((dataset) => labels.set(scopeKey("dataset", dataset.id), `数据集 · ${dataset.name}`));
  return labels;
}

function scopeKey(scopeType: MemberScopeType, scopeID: string) {
  return `${scopeType}:${scopeID}`;
}

function scopeTypeLabel(scopeType: MemberScopeType) {
  return scopeTypeOptions.find((option) => option.value === scopeType)?.label || scopeType;
}
