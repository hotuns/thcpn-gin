import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCcw } from "lucide-react";
import { App as AntApp, Button, Form, Input, Select, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import {
  formatApiError,
  workspacesApi,
  type OrganizationType,
  type WorkspaceWithMembership
} from "../../api";
import { Page, Section } from "../../components";
import { formatDateTime } from "../../app/format";
import { useWorkspace } from "../../app/WorkspaceProvider";
import { copyableId, statusColor, tableScrollX } from "../../app/ui";

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
  const { message } = AntApp.useApp();
  const create = useMutation({
    mutationFn: workspacesApi.create,
    onSuccess: (created) => {
      workspaceContext.setSelectedWorkspaceId(created.workspace.id);
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setForm({ name: "", organization_type: "lab" });
      void message.success("工作区已创建");
    }
  });

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate({
      name: form.name.trim(),
      organization_type: form.organization_type
    });
  }

  const columns: TableColumnsType<WorkspaceWithMembership> = [
    {
      key: "name",
      title: "名称",
      width: 220,
      render: (_, item) => (
        <div className="table-primary">
          <strong>{item.workspace.name}</strong>
          <span>{item.workspace.organization_type || item.workspace.type}</span>
        </div>
      )
    },
    {
      key: "status",
      title: "状态",
      width: 130,
      render: (_, item) => <Tag color={statusColor(item.workspace.status)}>{item.workspace.status}</Tag>
    },
    {
      key: "role",
      title: "角色",
      width: 170,
      render: (_, item) => item.membership.role.name || item.membership.role.code
    },
    {
      key: "created",
      title: "创建时间",
      width: 180,
      render: (_, item) => formatDateTime(item.workspace.created_at)
    },
    {
      key: "id",
      title: "ID",
      width: 240,
      render: (_, item) => copyableId(item.workspace.id)
    }
  ];

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
          <Form.Item className="field" label="名称" required>
            <Input className="control" onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
          </Form.Item>
          <Form.Item className="field" label="组织类型">
            <Select
              className="control"
              onChange={(value) => setForm({ ...form, organization_type: value })}
              options={organizationOptions}
              value={form.organization_type}
            />
          </Form.Item>
          <div className="form-actions align-end">
            <Button disabled={create.isPending} htmlType="submit" icon={<Plus size={16} />} type="primary">
              创建
            </Button>
          </div>
        </form>
        {create.error ? <p className="form-error">{formatApiError(create.error)}</p> : null}
      </Section>

      <Section title="我的工作区">
        <Table<WorkspaceWithMembership>
          className="data-table"
          columns={columns}
          dataSource={workspaceContext.workspaces}
          locale={{ emptyText: "还没有工作区" }}
          pagination={false}
          rowKey={(item) => item.workspace.id}
          scroll={{ x: tableScrollX(columns) }}
          size="middle"
          tableLayout="fixed"
        />
      </Section>
    </Page>
  );
}
