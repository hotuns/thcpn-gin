import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Alert, App as AntApp, Button, Form, Input, Result, Select, Space, Spin, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { formatApiError, membersApi, type InternalMemberRoleCode, type WorkspaceMember } from "../../api";
import { Page, Section } from "../../components";
import { useWorkspace } from "../../app/WorkspaceProvider";
import { formatDateTime } from "../../app/format";
import { copyableId, statusColor, tableScrollX } from "../../app/ui";

type SelectorKind = "email" | "phone" | "user_id";

const selectorOptions: Array<{ label: string; value: SelectorKind }> = [
  { label: "邮箱", value: "email" },
  { label: "手机号", value: "phone" },
  { label: "用户 ID", value: "user_id" }
];

const roleOptions: Array<{ label: string; value: InternalMemberRoleCode }> = [
  { label: "Owner", value: "owner" },
  { label: "Admin", value: "admin" },
  { label: "项目经理", value: "project_manager" },
  { label: "站点操作员", value: "site_operator" },
  { label: "数据管理员", value: "data_manager" },
  { label: "研究员", value: "researcher" },
  { label: "只读", value: "viewer" }
];

export function MembersPage() {
  const { selectedWorkspaceId, selectedWorkspace } = useWorkspace();
  const [form, setForm] = useState({ selector: "email" as SelectorKind, value: "", role_code: "viewer" as InternalMemberRoleCode });
  const [roleDrafts, setRoleDrafts] = useState<Record<string, InternalMemberRoleCode>>({});
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  const members = useQuery({
    queryKey: ["members", selectedWorkspaceId],
    queryFn: () => membersApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["members", selectedWorkspaceId] });

  const addMember = useMutation({
    mutationFn: () =>
      membersApi.add(selectedWorkspaceId, {
        [form.selector]: form.value.trim(),
        role_code: form.role_code
      }),
    onSuccess: () => {
      setForm({ selector: form.selector, value: "", role_code: "viewer" });
      invalidate();
      void message.success("成员已添加");
    }
  });

  const updateRole = useMutation({
    mutationFn: (member: WorkspaceMember) =>
      membersApi.updateRole(selectedWorkspaceId, member.id, roleDrafts[member.id] || (member.role.code as InternalMemberRoleCode)),
    onSuccess: () => {
      invalidate();
      void message.success("角色已更新");
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
      title: "角色",
      width: 180,
      render: (_, member) => (
        <Select
          onChange={(value) => setRoleDrafts({ ...roleDrafts, [member.id]: value })}
          options={roleOptions}
          style={{ minWidth: 160 }}
          value={roleDrafts[member.id] || member.role.code}
        />
      )
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
          <Button disabled={updateRole.isPending} onClick={() => updateRole.mutate(member)}>
            保存角色
          </Button>
          <Button
            danger
            disabled={removeMember.isPending}
            icon={<Trash2 size={15} />}
            onClick={() => removeMember.mutate(member.id)}
          >
            移除
          </Button>
        </div>
      )
    }
  ];

  return (
    <Page
      description={selectedWorkspace ? `当前工作区：${selectedWorkspace.workspace.name}` : "请选择工作区后管理成员。"}
      title="成员"
    >
      <Section title="添加成员">
        <form className="form-grid" onSubmit={handleAdd}>
          <Form.Item className="field" label="匹配方式">
            <Select className="control" onChange={(value) => setForm({ ...form, selector: value })} options={selectorOptions} value={form.selector} />
          </Form.Item>
          <Form.Item className="field" label="匹配值" required>
            <Input className="control" onChange={(event) => setForm({ ...form, value: event.target.value })} required value={form.value} />
          </Form.Item>
          <Form.Item className="field" label="角色">
            <Select className="control" onChange={(value) => setForm({ ...form, role_code: value })} options={roleOptions} value={form.role_code} />
          </Form.Item>
          <div className="form-actions align-end">
            <Button disabled={addMember.isPending || !selectedWorkspaceId} htmlType="submit" icon={<Plus size={16} />} type="primary">
              添加
            </Button>
          </div>
        </form>
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
    </Page>
  );
}
