import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCcw } from "lucide-react";
import {
  formatApiError,
  workspacesApi,
  type OrganizationType,
  type WorkspaceWithMembership
} from "../../api";
import { Badge, Button, CopyableId, DataTable, Page, Section, SelectField, TextInput, statusTone, useToast } from "../../components";
import { formatDateTime } from "../../app/format";
import { useWorkspace } from "../../app/WorkspaceProvider";

const organizationOptions: Array<{ label: string; value: OrganizationType }> = [
  { label: "实验室", value: "lab" },
  { label: "机构", value: "institution" },
  { label: "企业", value: "company" },
  { label: "政府", value: "government" },
  { label: "服务商", value: "service_provider" },
  { label: "其他", value: "other" }
];

export function WorkspacesPage() {
  const [form, setForm] = useState({ name: "", organization_type: "lab" as OrganizationType });
  const queryClient = useQueryClient();
  const workspaceContext = useWorkspace();
  const { pushToast } = useToast();
  const create = useMutation({
    mutationFn: workspacesApi.create,
    onSuccess: (created) => {
      workspaceContext.setSelectedWorkspaceId(created.workspace.id);
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setForm({ name: "", organization_type: "lab" });
      pushToast("工作区已创建");
    }
  });

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate({
      name: form.name.trim(),
      organization_type: form.organization_type
    });
  }

  return (
    <Page
      actions={
        <Button icon={<RefreshCcw size={16} />} onClick={workspaceContext.refetch}>
          刷新
        </Button>
      }
      description="管理当前账号可以访问的组织和个人工作区。"
      title="工作区"
    >
      <Section description="新建组织工作区后会自动获得 owner 角色。" title="创建工作区">
        <form className="form-grid" onSubmit={handleCreate}>
          <TextInput
            label="名称"
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
            value={form.name}
          />
          <SelectField
            label="组织类型"
            onChange={(event) => setForm({ ...form, organization_type: event.target.value as OrganizationType })}
            options={organizationOptions}
            value={form.organization_type}
          />
          <div className="form-actions align-end">
            <Button disabled={create.isPending} icon={<Plus size={16} />} type="submit" variant="primary">
              创建
            </Button>
          </div>
        </form>
        {create.error ? <p className="form-error">{formatApiError(create.error)}</p> : null}
      </Section>

      <Section title="我的工作区">
        <DataTable<WorkspaceWithMembership>
          columns={[
            {
              key: "name",
              header: "名称",
              render: (item) => (
                <div className="table-primary">
                  <strong>{item.workspace.name}</strong>
                  <span>{item.workspace.organization_type || item.workspace.type}</span>
                </div>
              )
            },
            {
              key: "status",
              header: "状态",
              render: (item) => <Badge tone={statusTone(item.workspace.status)}>{item.workspace.status}</Badge>
            },
            {
              key: "role",
              header: "角色",
              render: (item) => item.membership.role.name || item.membership.role.code
            },
            {
              key: "created",
              header: "创建时间",
              render: (item) => formatDateTime(item.workspace.created_at)
            },
            {
              key: "id",
              header: "ID",
              render: (item) => <CopyableId value={item.workspace.id} />
            }
          ]}
          empty="还没有工作区"
          getRowKey={(item) => item.workspace.id}
          items={workspaceContext.workspaces}
        />
      </Section>
    </Page>
  );
}
