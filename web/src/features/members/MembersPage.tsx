import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { membersApi, type InternalMemberRoleCode, type WorkspaceMember } from "../../api";
import { Badge, Button, CopyableId, DataTable, ErrorState, LoadingState, Page, Section, SelectField, TextInput, statusTone, useToast } from "../../components";
import { useWorkspace } from "../../app/WorkspaceProvider";
import { formatDateTime } from "../../app/format";

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
  const { pushToast } = useToast();

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
      pushToast("成员已添加");
    }
  });

  const updateRole = useMutation({
    mutationFn: (member: WorkspaceMember) =>
      membersApi.updateRole(selectedWorkspaceId, member.id, roleDrafts[member.id] || (member.role.code as InternalMemberRoleCode)),
    onSuccess: () => {
      invalidate();
      pushToast("角色已更新");
    }
  });

  const removeMember = useMutation({
    mutationFn: (memberId: string) => membersApi.remove(selectedWorkspaceId, memberId),
    onSuccess: () => {
      invalidate();
      pushToast("成员已移除");
    }
  });

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    addMember.mutate();
  }

  return (
    <Page
      description={selectedWorkspace ? `当前工作区：${selectedWorkspace.workspace.name}` : "请选择工作区后管理成员。"}
      title="成员"
    >
      <Section title="添加成员">
        <form className="form-grid" onSubmit={handleAdd}>
          <SelectField
            label="匹配方式"
            onChange={(event) => setForm({ ...form, selector: event.target.value as SelectorKind })}
            options={selectorOptions}
            value={form.selector}
          />
          <TextInput
            label="匹配值"
            onChange={(event) => setForm({ ...form, value: event.target.value })}
            required
            value={form.value}
          />
          <SelectField
            label="角色"
            onChange={(event) => setForm({ ...form, role_code: event.target.value as InternalMemberRoleCode })}
            options={roleOptions}
            value={form.role_code}
          />
          <div className="form-actions align-end">
            <Button disabled={addMember.isPending || !selectedWorkspaceId} icon={<Plus size={16} />} type="submit" variant="primary">
              添加
            </Button>
          </div>
        </form>
      </Section>

      <Section title="成员列表">
        {members.isLoading ? <LoadingState /> : null}
        {members.error ? <ErrorState error={members.error} onRetry={() => void members.refetch()} /> : null}
        {members.data ? (
          <DataTable<WorkspaceMember>
            columns={[
              {
                key: "user",
                header: "成员",
                render: (member) => (
                  <div className="table-primary">
                    <strong>{member.user.name}</strong>
                    <span>{member.user.email || member.user.phone || member.user.id}</span>
                  </div>
                )
              },
              {
                key: "status",
                header: "状态",
                render: (member) => <Badge tone={statusTone(member.status)}>{member.status}</Badge>
              },
              {
                key: "role",
                header: "角色",
                render: (member) => (
                  <select
                    className="table-select"
                    onChange={(event) =>
                      setRoleDrafts({ ...roleDrafts, [member.id]: event.target.value as InternalMemberRoleCode })
                    }
                    value={roleDrafts[member.id] || member.role.code}
                  >
                    {roleOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )
              },
              {
                key: "joined",
                header: "加入时间",
                render: (member) => formatDateTime(member.joined_at)
              },
              {
                key: "id",
                header: "ID",
                render: (member) => <CopyableId value={member.id} />
              },
              {
                key: "actions",
                header: "操作",
                render: (member) => (
                  <div className="row-actions">
                    <Button disabled={updateRole.isPending} onClick={() => updateRole.mutate(member)}>
                      保存角色
                    </Button>
                    <Button
                      disabled={removeMember.isPending}
                      icon={<Trash2 size={15} />}
                      onClick={() => removeMember.mutate(member.id)}
                      variant="danger"
                    >
                      移除
                    </Button>
                  </div>
                )
              }
            ]}
            empty="暂无成员"
            getRowKey={(member) => member.id}
            items={members.data.items}
          />
        ) : null}
      </Section>
    </Page>
  );
}
