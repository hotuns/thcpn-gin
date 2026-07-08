import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Alert, App as AntApp, Button, Form, Input, Modal, Popconfirm, Result, Select, Space, Spin, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { formatApiError, membersApi, type InternalMemberRoleCode, type WorkspaceMember } from "../../api";
import { Page, Section } from "../../components";
import { useWorkspace } from "../../app/WorkspaceProvider";
import { formatDateTime } from "../../app/format";
import { copyableId, statusColor, tableScrollX } from "../../app/ui";
import { internalRoleOptions, roleLabel } from "../settings/roleMeta";

type SelectorKind = "email" | "phone" | "user_id";

const selectorOptions: Array<{ label: string; value: SelectorKind }> = [
  { label: "邮箱", value: "email" },
  { label: "手机号", value: "phone" },
  { label: "用户 ID", value: "user_id" }
];

export function MembersPage() {
  const { selectedWorkspaceId, selectedWorkspace } = useWorkspace();
  const [form, setForm] = useState({ selector: "email" as SelectorKind, value: "", role_code: "viewer" as InternalMemberRoleCode });
  const [roleDialog, setRoleDialog] = useState<{ member: WorkspaceMember; roleCode: InternalMemberRoleCode } | null>(null);
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
    mutationFn: (input: { member: WorkspaceMember; roleCode: InternalMemberRoleCode }) =>
      membersApi.updateRole(selectedWorkspaceId, input.member.id, input.roleCode),
    onSuccess: () => {
      setRoleDialog(null);
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
      width: 260,
      render: (_, member) => <RoleSummary code={member.role.code} />
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
          <Button disabled={updateRole.isPending} onClick={() => setRoleDialog({ member, roleCode: member.role.code as InternalMemberRoleCode })}>
            调整角色
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
          <Form.Item className="field" label="角色">
            <Select
              className="control"
              onChange={(value) => setForm({ ...form, role_code: value })}
              optionRender={(option) => <RoleOption code={option.value as InternalMemberRoleCode} />}
              options={internalRoleOptions}
              value={form.role_code}
            />
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

      <Modal
        confirmLoading={updateRole.isPending}
        okText="保存角色"
        onCancel={() => setRoleDialog(null)}
        onOk={() => roleDialog ? updateRole.mutate(roleDialog) : undefined}
        open={Boolean(roleDialog)}
        title="调整成员角色"
      >
        {roleDialog ? (
          <div className="role-change-dialog">
            <div className="role-change-current">
              <Typography.Text type="secondary">成员</Typography.Text>
              <Typography.Text strong>{roleDialog.member.user.name}</Typography.Text>
              <Typography.Text type="secondary">{roleDialog.member.user.email || roleDialog.member.user.phone || roleDialog.member.user.id}</Typography.Text>
            </div>
            <Form layout="vertical">
              <Form.Item label="当前角色">
                <RoleSummary code={roleDialog.member.role.code} />
              </Form.Item>
              <Form.Item label="新角色">
                <Select
                  onChange={(value) => setRoleDialog({ ...roleDialog, roleCode: value })}
                  optionRender={(option) => <RoleOption code={option.value as InternalMemberRoleCode} />}
                  options={internalRoleOptions}
                  value={roleDialog.roleCode}
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

function RoleSummary({ code }: { code: string }) {
  return (
    <div className="role-summary">
      <strong>{roleLabel(code)}</strong>
    </div>
  );
}

function RoleOption({ code }: { code: InternalMemberRoleCode }) {
  return (
    <div className="role-option">
      <strong>{roleLabel(code)}</strong>
    </div>
  );
}
