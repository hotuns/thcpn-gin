import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, RefreshCcw, Trash2 } from "lucide-react";
import {
  Alert,
  App as AntApp,
  Button as AntButton,
  Checkbox,
  Form,
  Input,
  Result,
  Select,
  Space,
  Spin,
  Table,
  Tag
} from "antd";
import type { TableColumnsType } from "antd";
import {
  accessGrantsApi,
  auditApi,
  dataStreamsApi,
  datasetsApi,
  devicesApi,
  exportJobsApi,
  formatApiError,
  invitationsApi,
  projectsApi,
  sitesApi,
  type AccessGrant,
  type AccessGrantRoleCode,
  type AccessGrantScopeType,
  type AuditLog,
  type DataStream,
  type Dataset,
  type DatasetDataType,
  type DatasetSourceType,
  type Device,
  type ExportJob,
  type ExportResourceType,
  type ExportType,
  type Invitation,
  type Project,
  type Site
} from "../../api";
import { useWorkspace } from "../../app/WorkspaceProvider";
import { formatDateTime, labelOrDash } from "../../app/format";
import {
  Badge,
  Button,
  CopyableId,
  DataTable,
  ErrorState,
  LoadingState,
  Page,
  Section,
  SelectField,
  TextInput,
  statusTone
} from "../../components";
import { copyableId, statusColor, tableScrollX } from "../../app/ui";

const datasetTypeOptions: Array<{ label: string; value: DatasetDataType }> = [
  { label: "遥测", value: "telemetry" },
  { label: "图片", value: "image" },
  { label: "视频", value: "video" },
  { label: "音频", value: "audio" },
  { label: "事件", value: "event" },
  { label: "日志", value: "log" },
  { label: "混合", value: "mixed" }
];
const sourceTypeOptions: Array<{ label: string; value: DatasetSourceType }> = [
  { label: "设备", value: "device" },
  { label: "数据流", value: "data_stream" },
  { label: "文件", value: "file" }
];
const exportResourceTypeOptions: Array<{ label: string; value: ExportResourceType }> = [
  { label: "设备", value: "device" },
  { label: "数据流", value: "data_stream" },
  { label: "数据集", value: "dataset" },
  { label: "媒体", value: "media" }
];
const exportTypeOptions: Array<{ label: string; value: ExportType }> = [
  { label: "遥测 CSV", value: "telemetry_csv" },
  { label: "遥测 Excel", value: "telemetry_excel" },
  { label: "媒体 ZIP", value: "media_zip" },
  { label: "数据集 ZIP", value: "dataset_zip" }
];
const accessRoleOptions: Array<{ label: string; value: AccessGrantRoleCode }> = [
  { label: "项目经理", value: "project_manager" },
  { label: "站点操作员", value: "site_operator" },
  { label: "数据管理员", value: "data_manager" },
  { label: "研究员", value: "researcher" },
  { label: "只读", value: "viewer" },
  { label: "共享只读", value: "shared_viewer" },
  { label: "共享下载", value: "shared_downloader" },
  { label: "服务工程师", value: "service_engineer" }
];
const scopeTypeOptions: Array<{ label: string; value: AccessGrantScopeType }> = [
  { label: "工作区", value: "workspace" },
  { label: "项目", value: "project" },
  { label: "站点", value: "site" },
  { label: "设备", value: "device" },
  { label: "数据集", value: "dataset" }
];
export function ProjectsPage() {
  const { selectedWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [form, setForm] = useState({ name: "", description: "" });
  const query = useQuery({
    queryKey: ["projects", selectedWorkspaceId],
    queryFn: () => projectsApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });
  const create = useMutation({
    mutationFn: () =>
      projectsApi.create({
        workspace_id: selectedWorkspaceId,
        name: form.name.trim(),
        description: optional(form.description)
      }),
    onSuccess: () => {
      setForm({ name: "", description: "" });
      void queryClient.invalidateQueries({ queryKey: ["projects", selectedWorkspaceId] });
      void message.success("项目已创建");
    }
  });

  return (
    <ResourcePageFrame
      createError={create.error}
      description="按工作区组织研究任务和设备归属。"
      form={
        <form className="form-grid" onSubmit={(event) => submit(event, () => create.mutate())}>
          <TextInput label="项目名称" onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
          <TextInput
            label="描述"
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            value={form.description}
          />
          <FormSubmitButton disabled={create.isPending} />
        </form>
      }
      query={query}
      title="项目"
    >
      {(items: Project[]) => (
        <DataTable<Project>
          columns={[
            { key: "name", header: "项目", render: (item) => <NameCell name={item.name} detail={item.description} /> },
            { key: "status", header: "状态", render: (item) => <Badge tone={statusTone(item.status)}>{item.status}</Badge> },
            { key: "created", header: "创建时间", render: (item) => formatDateTime(item.created_at) },
            { key: "id", header: "ID", render: (item) => <CopyableId value={item.id} /> }
          ]}
          empty="暂无项目"
          getRowKey={(item) => item.id}
          items={items}
        />
      )}
    </ResourcePageFrame>
  );
}

export function SitesPage() {
  const { selectedWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [projectId, setProjectId] = useState("");
  const [form, setForm] = useState({ project_id: "", name: "", location_text: "", description: "" });
  const projects = useQuery({
    queryKey: ["projects", selectedWorkspaceId],
    queryFn: () => projectsApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });
  const query = useQuery({
    queryKey: ["sites", selectedWorkspaceId, projectId],
    queryFn: () => sitesApi.list({ workspace_id: selectedWorkspaceId, project_id: optional(projectId) }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const create = useMutation({
    mutationFn: () =>
      sitesApi.create({
        workspace_id: selectedWorkspaceId,
        project_id: form.project_id,
        name: form.name.trim(),
        location_text: optional(form.location_text),
        description: optional(form.description)
      }),
    onSuccess: () => {
      setForm({ project_id: "", name: "", location_text: "", description: "" });
      void queryClient.invalidateQueries({ queryKey: ["sites", selectedWorkspaceId] });
      void message.success("站点已创建");
    }
  });
  const projectOptions = useMemo(() => toOptions(projects.data?.items ?? [], "选择项目"), [projects.data?.items]);

  return (
    <ResourcePageFrame
      createError={create.error}
      description="站点用于承载项目下的设备和长期观测位置。"
      filters={<SelectField label="项目筛选" onChange={(event) => setProjectId(event.target.value)} options={projectOptions} value={projectId} />}
      form={
        <form className="form-grid" onSubmit={(event) => submit(event, () => create.mutate())}>
          <SelectField
            label="所属项目"
            onChange={(event) => setForm({ ...form, project_id: event.target.value })}
            options={projectOptions}
            required
            value={form.project_id}
          />
          <TextInput label="站点名称" onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
          <TextInput
            label="位置"
            onChange={(event) => setForm({ ...form, location_text: event.target.value })}
            value={form.location_text}
          />
          <TextInput label="描述" onChange={(event) => setForm({ ...form, description: event.target.value })} value={form.description} />
          <FormSubmitButton disabled={create.isPending} />
        </form>
      }
      query={query}
      title="站点"
    >
      {(items: Site[]) => (
        <DataTable<Site>
          columns={[
            { key: "name", header: "站点", render: (item) => <NameCell name={item.name} detail={item.location_text || item.description} /> },
            { key: "status", header: "状态", render: (item) => <Badge tone={statusTone(item.status)}>{item.status}</Badge> },
            { key: "project", header: "项目 ID", render: (item) => <CopyableId value={item.project_id} /> },
            { key: "created", header: "创建时间", render: (item) => formatDateTime(item.created_at) },
            { key: "id", header: "ID", render: (item) => <CopyableId value={item.id} /> }
          ]}
          empty="暂无站点"
          getRowKey={(item) => item.id}
          items={items}
        />
      )}
    </ResourcePageFrame>
  );
}

export function DevicesPage() {
  const { selectedWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [filters, setFilters] = useState({ project_id: "", site_id: "" });
  const projects = useQuery({
    queryKey: ["projects", selectedWorkspaceId],
    queryFn: () => projectsApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });
  const sites = useQuery({
    queryKey: ["sites", selectedWorkspaceId],
    queryFn: () => sitesApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const query = useQuery({
    queryKey: ["devices", selectedWorkspaceId, filters],
    queryFn: () =>
      devicesApi.list({
        workspace_id: selectedWorkspaceId,
        project_id: optional(filters.project_id),
        site_id: optional(filters.site_id)
      }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const unbind = useMutation({
    mutationFn: devicesApi.unbind,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["devices", selectedWorkspaceId] });
      void message.success("设备已解绑");
    }
  });
  const projectOptions = useMemo(() => toOptions(projects.data?.items ?? [], "全部项目"), [projects.data?.items]);
  const siteOptions = useMemo(() => toOptions(sites.data?.items ?? [], "全部站点"), [sites.data?.items]);
  const deviceColumns: TableColumnsType<Device> = [
    { key: "name", title: "设备", width: 220, render: (_, item) => <NameCell name={item.name} detail={item.serial_no} /> },
    { key: "status", title: "状态", width: 130, render: (_, item) => <Tag color={statusColor(item.status)}>{item.status}</Tag> },
    { key: "capabilities", title: "能力", width: 170, render: (_, item) => item.capabilities.join(", ") || "-" },
    { key: "site", title: "站点 ID", width: 240, render: (_, item) => copyableId(item.site_id) },
    { key: "id", title: "ID", width: 240, render: (_, item) => copyableId(item.id) },
    {
      key: "actions",
      title: "操作",
      width: 130,
      render: (_, item) => (
        <AntButton danger disabled={unbind.isPending} icon={<Trash2 size={15} />} onClick={() => unbind.mutate(item.id)}>
          解绑
        </AntButton>
      )
    }
  ];

  return (
    <ResourcePageFrame
      description="设备由系统管理员从设备库同步并分配到当前工作区。"
      filters={
        <>
          <Form.Item className="field" label="项目">
            <Select className="control" onChange={(value) => setFilters({ ...filters, project_id: value })} options={projectOptions} value={filters.project_id} />
          </Form.Item>
          <Form.Item className="field" label="站点">
            <Select className="control" onChange={(value) => setFilters({ ...filters, site_id: value })} options={siteOptions} value={filters.site_id} />
          </Form.Item>
        </>
      }
      query={query}
      title="设备"
    >
      {(items: Device[]) => (
        <Table<Device>
          className="data-table"
          columns={deviceColumns}
          dataSource={items}
          locale={{ emptyText: "暂无设备" }}
          pagination={false}
          rowKey={(item) => item.id}
          scroll={{ x: tableScrollX(deviceColumns) }}
          size="middle"
          tableLayout="fixed"
        />
      )}
    </ResourcePageFrame>
  );
}

export function DataStreamsPage() {
  const { selectedWorkspaceId } = useWorkspace();
  const [deviceId, setDeviceId] = useState("");
  const devices = useQuery({
    queryKey: ["devices", selectedWorkspaceId],
    queryFn: () => devicesApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const query = useQuery({
    queryKey: ["data-streams", deviceId],
    queryFn: () => dataStreamsApi.list(deviceId),
    enabled: Boolean(deviceId)
  });
  const deviceOptions = useMemo(() => toOptions(devices.data?.items ?? [], "选择设备", (item) => `${item.name} · ${item.serial_no}`), [devices.data?.items]);

  return (
    <Page description="数据流由系统同步生成，普通工作区用户只查看已分配设备的数据流。" title="数据流">
      <Section title="筛选">
        <form className="form-grid">
          <SelectField label="查看设备" onChange={(event) => setDeviceId(event.target.value)} options={deviceOptions} value={deviceId} />
        </form>
      </Section>
      <Section title="数据流列表">
        {!deviceId ? <p className="muted">选择设备后加载数据流。</p> : null}
        {query.isLoading ? <LoadingState /> : null}
        {query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.data ? (
          <DataTable<DataStream>
            columns={[
              { key: "name", header: "数据流", render: (item) => <NameCell name={item.name} detail={`${item.code} · ${item.type}`} /> },
              { key: "status", header: "状态", render: (item) => <Badge tone={statusTone(item.status)}>{item.status}</Badge> },
              { key: "unit", header: "单位", render: (item) => labelOrDash(item.unit) },
              { key: "id", header: "ID", render: (item) => <CopyableId value={item.id} /> }
            ]}
            empty="暂无数据流"
            getRowKey={(item) => item.id}
            items={query.data.items}
          />
        ) : null}
      </Section>
    </Page>
  );
}

export function DatasetsPage() {
  const { selectedWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [form, setForm] = useState({
    project_id: "",
    name: "",
    description: "",
    data_type: "telemetry" as DatasetDataType,
    time_start: "",
    time_end: "",
    source_type: "device" as DatasetSourceType,
    source_id: ""
  });
  const projects = useQuery({
    queryKey: ["projects", selectedWorkspaceId],
    queryFn: () => projectsApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });
  const query = useQuery({
    queryKey: ["datasets", selectedWorkspaceId],
    queryFn: () => datasetsApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const create = useMutation({
    mutationFn: () =>
      datasetsApi.create({
        workspace_id: selectedWorkspaceId,
        project_id: optional(form.project_id),
        name: form.name.trim(),
        description: optional(form.description),
        data_type: form.data_type,
        time_start: toIso(form.time_start),
        time_end: toIso(form.time_end),
        sources: [{ source_type: form.source_type, source_id: form.source_id.trim() }]
      }),
    onSuccess: () => {
      setForm({ project_id: "", name: "", description: "", data_type: "telemetry", time_start: "", time_end: "", source_type: "device", source_id: "" });
      void queryClient.invalidateQueries({ queryKey: ["datasets", selectedWorkspaceId] });
      void message.success("数据集已创建");
    }
  });
  const remove = useMutation({
    mutationFn: datasetsApi.delete,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["datasets", selectedWorkspaceId] });
      void message.success("数据集已删除");
    }
  });
  const projectOptions = useMemo(() => toOptions(projects.data?.items ?? [], "不绑定项目"), [projects.data?.items]);

  return (
    <ResourcePageFrame
      createError={create.error}
      description="数据集保存查询边界和源定义，大范围数据通过导出任务处理。"
      form={
        <form className="form-grid" onSubmit={(event) => submit(event, () => create.mutate())}>
          <TextInput label="名称" onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
          <SelectField label="项目" onChange={(event) => setForm({ ...form, project_id: event.target.value })} options={projectOptions} value={form.project_id} />
          <SelectField label="数据类型" onChange={(event) => setForm({ ...form, data_type: event.target.value as DatasetDataType })} options={datasetTypeOptions} value={form.data_type} />
          <TextInput label="开始时间" onChange={(event) => setForm({ ...form, time_start: event.target.value })} required type="datetime-local" value={form.time_start} />
          <TextInput label="结束时间" onChange={(event) => setForm({ ...form, time_end: event.target.value })} required type="datetime-local" value={form.time_end} />
          <SelectField label="源类型" onChange={(event) => setForm({ ...form, source_type: event.target.value as DatasetSourceType })} options={sourceTypeOptions} value={form.source_type} />
          <TextInput label="源 ID" onChange={(event) => setForm({ ...form, source_id: event.target.value })} required value={form.source_id} />
          <TextInput label="描述" onChange={(event) => setForm({ ...form, description: event.target.value })} value={form.description} />
          <FormSubmitButton disabled={create.isPending} />
        </form>
      }
      query={query}
      title="数据集"
    >
      {(items: Dataset[]) => (
        <DataTable<Dataset>
          columns={[
            { key: "name", header: "数据集", render: (item) => <NameCell name={item.name} detail={item.description || item.data_type} /> },
            { key: "status", header: "状态", render: (item) => <Badge tone={statusTone(item.status)}>{item.status}</Badge> },
            { key: "range", header: "时间范围", render: (item) => `${formatDateTime(item.time_start)} - ${formatDateTime(item.time_end)}` },
            { key: "sources", header: "源", render: (item) => item.sources.length },
            { key: "id", header: "ID", render: (item) => <CopyableId value={item.id} /> },
            {
              key: "actions",
              header: "操作",
              render: (item) => (
                <Button disabled={remove.isPending} icon={<Trash2 size={15} />} onClick={() => remove.mutate(item.id)} variant="danger">
                  删除
                </Button>
              )
            }
          ]}
          empty="暂无数据集"
          getRowKey={(item) => item.id}
          items={items}
        />
      )}
    </ResourcePageFrame>
  );
}

export function ExportJobsPage() {
  const { selectedWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [form, setForm] = useState({
    resource_type: "dataset" as ExportResourceType,
    resource_id: "",
    export_type: "dataset_zip" as ExportType,
    start_time: "",
    end_time: "",
    limit: "5000"
  });
  const query = useQuery({
    queryKey: ["export-jobs", selectedWorkspaceId],
    queryFn: () => exportJobsApi.list({ workspace_id: selectedWorkspaceId, limit: 100 }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const create = useMutation({
    mutationFn: () =>
      exportJobsApi.create({
        resource_type: form.resource_type,
        resource_id: form.resource_id.trim(),
        export_type: form.export_type,
        start_time: optionalIso(form.start_time),
        end_time: optionalIso(form.end_time),
        limit: Number(form.limit) || undefined
      }),
    onSuccess: () => {
      setForm({ resource_type: "dataset", resource_id: "", export_type: "dataset_zip", start_time: "", end_time: "", limit: "5000" });
      void queryClient.invalidateQueries({ queryKey: ["export-jobs", selectedWorkspaceId] });
      void message.success("导出任务已创建");
    }
  });
  const download = useMutation({
    mutationFn: exportJobsApi.prepareDownload,
    onSuccess: (result) => {
      window.open(result.url, "_blank", "noopener,noreferrer");
      void message.success("下载地址已打开");
    }
  });

  return (
    <ResourcePageFrame
      createError={create.error || download.error}
      description="导出任务异步生成文件，成功后可准备临时下载地址。"
      form={
        <form className="form-grid" onSubmit={(event) => submit(event, () => create.mutate())}>
          <SelectField label="资源类型" onChange={(event) => setForm({ ...form, resource_type: event.target.value as ExportResourceType })} options={exportResourceTypeOptions} value={form.resource_type} />
          <TextInput label="资源 ID" onChange={(event) => setForm({ ...form, resource_id: event.target.value })} required value={form.resource_id} />
          <SelectField label="导出类型" onChange={(event) => setForm({ ...form, export_type: event.target.value as ExportType })} options={exportTypeOptions} value={form.export_type} />
          <TextInput label="开始时间" onChange={(event) => setForm({ ...form, start_time: event.target.value })} type="datetime-local" value={form.start_time} />
          <TextInput label="结束时间" onChange={(event) => setForm({ ...form, end_time: event.target.value })} type="datetime-local" value={form.end_time} />
          <TextInput label="行数上限" min={1} onChange={(event) => setForm({ ...form, limit: event.target.value })} type="number" value={form.limit} />
          <FormSubmitButton disabled={create.isPending} />
        </form>
      }
      query={query}
      title="导出"
    >
      {(items: ExportJob[]) => (
        <DataTable<ExportJob>
          columns={[
            { key: "resource", header: "资源", render: (item) => <NameCell name={item.export_type} detail={`${item.resource_type} · ${item.resource_id}`} /> },
            { key: "status", header: "状态", render: (item) => <Badge tone={statusTone(item.status)}>{item.status}</Badge> },
            { key: "created", header: "创建时间", render: (item) => formatDateTime(item.created_at) },
            { key: "expires", header: "过期时间", render: (item) => formatDateTime(item.expires_at) },
            { key: "id", header: "ID", render: (item) => <CopyableId value={item.id} /> },
            {
              key: "download",
              header: "下载",
              render: (item) => (
                <Button disabled={item.status !== "success" || download.isPending} icon={<Download size={15} />} onClick={() => download.mutate(item.id)}>
                  准备
                </Button>
              )
            }
          ]}
          empty="暂无导出任务"
          getRowKey={(item) => item.id}
          items={items}
        />
      )}
    </ResourcePageFrame>
  );
}

export function AccessGrantsPage() {
  const { selectedWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [subjectKind, setSubjectKind] = useState<"email" | "phone" | "subject_user_id">("email");
  const [form, setForm] = useState({
    subject: "",
    role_code: "viewer" as AccessGrantRoleCode,
    scope_type: "workspace" as AccessGrantScopeType,
    scope_id: "",
    expires_at: "",
    allow_reshare: false,
    allow_api_access: false
  });
  const query = useQuery({
    queryKey: ["access-grants", selectedWorkspaceId],
    queryFn: () => accessGrantsApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });
  const mine = useQuery({ queryKey: ["access-grants", "mine"], queryFn: accessGrantsApi.listMine });
  const create = useMutation({
    mutationFn: () =>
      accessGrantsApi.create({
        [subjectKind]: form.subject.trim(),
        role_code: form.role_code,
        scope_type: form.scope_type,
        scope_id: form.scope_id.trim(),
        expires_at: optionalIso(form.expires_at),
        allow_reshare: form.allow_reshare,
        allow_api_access: form.allow_api_access
      }),
    onSuccess: () => {
      setForm({ subject: "", role_code: "viewer", scope_type: "workspace", scope_id: "", expires_at: "", allow_reshare: false, allow_api_access: false });
      void queryClient.invalidateQueries({ queryKey: ["access-grants"] });
      void message.success("授权已创建");
    }
  });
  const revoke = useMutation({
    mutationFn: accessGrantsApi.revoke,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["access-grants"] });
      void message.success("授权已撤销");
    }
  });

  return (
    <Page description="对注册用户授予受限资源访问权限。" title="授权">
      <Section title="创建授权">
        <form className="form-grid" onSubmit={(event) => submit(event, () => create.mutate())}>
          <SelectField
            label="对象类型"
            onChange={(event) => setSubjectKind(event.target.value as "email" | "phone" | "subject_user_id")}
            options={[
              { label: "邮箱", value: "email" },
              { label: "手机号", value: "phone" },
              { label: "用户 ID", value: "subject_user_id" }
            ]}
            value={subjectKind}
          />
          <TextInput label="对象" onChange={(event) => setForm({ ...form, subject: event.target.value })} required value={form.subject} />
          <SelectField label="角色" onChange={(event) => setForm({ ...form, role_code: event.target.value as AccessGrantRoleCode })} options={accessRoleOptions} value={form.role_code} />
          <SelectField label="范围类型" onChange={(event) => setForm({ ...form, scope_type: event.target.value as AccessGrantScopeType })} options={scopeTypeOptions} value={form.scope_type} />
          <TextInput label="范围 ID" onChange={(event) => setForm({ ...form, scope_id: event.target.value })} required value={form.scope_id} />
          <TextInput label="过期时间" onChange={(event) => setForm({ ...form, expires_at: event.target.value })} type="datetime-local" value={form.expires_at} />
          <Checkbox
            checked={form.allow_reshare}
            className="check-field"
            onChange={(event) => setForm({ ...form, allow_reshare: event.target.checked })}
          >
            允许再分享
          </Checkbox>
          <Checkbox
            checked={form.allow_api_access}
            className="check-field"
            onChange={(event) => setForm({ ...form, allow_api_access: event.target.checked })}
          >
            允许 API 访问
          </Checkbox>
          <FormSubmitButton disabled={create.isPending} />
        </form>
        {create.error || revoke.error ? <p className="form-error">{formatApiError(create.error || revoke.error)}</p> : null}
      </Section>
      <Section title="工作区授权">
        <GrantTable query={query} revoke={(id) => revoke.mutate(id)} />
      </Section>
      <Section title="授予我的资源">
        <GrantTable query={mine} revoke={null} />
      </Section>
    </Page>
  );
}

export function InvitationsPage() {
  const { selectedWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [targetKind, setTargetKind] = useState<"email" | "phone">("email");
  const [form, setForm] = useState({
    target: "",
    role_code: "viewer" as AccessGrantRoleCode,
    scope_type: "workspace" as AccessGrantScopeType,
    scope_id: "",
    expires_at: ""
  });
  const query = useQuery({
    queryKey: ["invitations", selectedWorkspaceId],
    queryFn: () => invitationsApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });
  const mine = useQuery({ queryKey: ["invitations", "mine"], queryFn: invitationsApi.listMine });
  const create = useMutation({
    mutationFn: () =>
      invitationsApi.create({
        [targetKind]: form.target.trim(),
        role_code: form.role_code,
        scope_type: form.scope_type,
        scope_id: form.scope_id.trim(),
        expires_at: optionalIso(form.expires_at)
      }),
    onSuccess: () => {
      setForm({ target: "", role_code: "viewer", scope_type: "workspace", scope_id: "", expires_at: "" });
      void queryClient.invalidateQueries({ queryKey: ["invitations"] });
      void message.success("邀请已创建");
    }
  });
  const accept = useMutation({
    mutationFn: invitationsApi.accept,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invitations"] });
      void queryClient.invalidateQueries({ queryKey: ["access-grants"] });
      void message.success("邀请已接受");
    }
  });
  const revoke = useMutation({
    mutationFn: invitationsApi.revoke,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invitations"] });
      void message.success("邀请已撤销");
    }
  });

  return (
    <Page description="向未注册邮箱或手机号发出资源邀请。" title="邀请">
      <Section title="创建邀请">
        <form className="form-grid" onSubmit={(event) => submit(event, () => create.mutate())}>
          <SelectField
            label="邀请方式"
            onChange={(event) => setTargetKind(event.target.value as "email" | "phone")}
            options={[
              { label: "邮箱", value: "email" },
              { label: "手机号", value: "phone" }
            ]}
            value={targetKind}
          />
          <TextInput label="邀请对象" onChange={(event) => setForm({ ...form, target: event.target.value })} required value={form.target} />
          <SelectField label="角色" onChange={(event) => setForm({ ...form, role_code: event.target.value as AccessGrantRoleCode })} options={accessRoleOptions} value={form.role_code} />
          <SelectField label="范围类型" onChange={(event) => setForm({ ...form, scope_type: event.target.value as AccessGrantScopeType })} options={scopeTypeOptions} value={form.scope_type} />
          <TextInput label="范围 ID" onChange={(event) => setForm({ ...form, scope_id: event.target.value })} required value={form.scope_id} />
          <TextInput label="过期时间" onChange={(event) => setForm({ ...form, expires_at: event.target.value })} type="datetime-local" value={form.expires_at} />
          <FormSubmitButton disabled={create.isPending} />
        </form>
        {create.error || accept.error || revoke.error ? (
          <p className="form-error">{formatApiError(create.error || accept.error || revoke.error)}</p>
        ) : null}
      </Section>
      <Section title="工作区邀请">
        <InvitationTable accept={null} query={query} revoke={(id) => revoke.mutate(id)} />
      </Section>
      <Section title="我的待处理邀请">
        <InvitationTable accept={(id) => accept.mutate(id)} query={mine} revoke={null} />
      </Section>
    </Page>
  );
}

export function AuditLogsPage() {
  const { selectedWorkspaceId } = useWorkspace();
  const [limit, setLimit] = useState("100");
  const query = useQuery({
    queryKey: ["audit-logs", selectedWorkspaceId, limit],
    queryFn: () => auditApi.list({ workspace_id: selectedWorkspaceId, limit: Number(limit) || 100 }),
    enabled: Boolean(selectedWorkspaceId)
  });

  return (
    <Page
      actions={<AntButton icon={<RefreshCcw size={16} />} onClick={() => void query.refetch()}>刷新</AntButton>}
      description="审计记录按最新时间排序。"
      title="审计"
    >
      <Section title="筛选">
        <div className="filter-grid">
          <TextInput label="数量上限" max={500} min={1} onChange={(event) => setLimit(event.target.value)} type="number" value={limit} />
        </div>
      </Section>
      <Section title="审计日志">
        {query.isLoading ? <LoadingState /> : null}
        {query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.data ? (
          <DataTable<AuditLog>
            columns={[
              { key: "action", header: "动作", render: (item) => <NameCell name={item.action} detail={item.reason || item.resource_type} /> },
              { key: "result", header: "结果", render: (item) => <Badge tone={statusTone(item.result)}>{item.result}</Badge> },
              { key: "actor", header: "Actor", render: (item) => item.actor_id ? <CopyableId value={item.actor_id} /> : item.actor_type },
              { key: "resource", header: "资源 ID", render: (item) => <CopyableId value={item.resource_id} /> },
              { key: "request", header: "Request", render: (item) => <CopyableId value={item.request_id} /> },
              { key: "created", header: "时间", render: (item) => formatDateTime(item.created_at) }
            ]}
            empty="暂无审计日志"
            getRowKey={(item) => item.id}
            items={query.data.items}
          />
        ) : null}
      </Section>
    </Page>
  );
}

function ResourcePageFrame<T>({
  children,
  createError,
  description,
  filters,
  form,
  query,
  title
}: {
  children: (items: T[]) => ReactNode;
  createError?: unknown;
  description: string;
  filters?: ReactNode;
  form?: ReactNode;
  query: {
    data?: { items: T[] };
    error: unknown;
    isLoading: boolean;
    refetch: () => unknown;
  };
  title: string;
}) {
  return (
    <Page actions={<AntButton icon={<RefreshCcw size={16} />} onClick={() => void query.refetch()}>刷新</AntButton>} description={description} title={title}>
      {filters ? (
        <Section title="筛选">
          <div className="filter-grid">{filters}</div>
        </Section>
      ) : null}
      {form ? <Section title={`创建${title}`}>{form}{createError ? <p className="form-error">{formatApiError(createError)}</p> : null}</Section> : null}
      <Section title={`${title}列表`}>
        {query.isLoading ? (
          <Space className="state state-inline">
            <Spin size="small" />
            <span>正在加载</span>
          </Space>
        ) : null}
        {query.error ? (
          <Result
            className="state state-error"
            extra={<AntButton onClick={() => void query.refetch()}>重试</AntButton>}
            status="warning"
            subTitle={<Alert message={formatApiError(query.error)} showIcon type="error" />}
            title="请求未完成"
          />
        ) : null}
        {query.data ? children(query.data.items) : null}
      </Section>
    </Page>
  );
}

function GrantTable({
  query,
  revoke
}: {
  query: { data?: { items: AccessGrant[] }; error: unknown; isLoading: boolean; refetch: () => unknown };
  revoke: ((id: string) => void) | null;
}) {
  if (query.isLoading) {
    return <LoadingState />;
  }
  if (query.error) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (!query.data) {
    return null;
  }
  return (
    <DataTable<AccessGrant>
      columns={[
        { key: "subject", header: "对象", render: (item) => <NameCell name={item.subject.name || item.subject.email || item.subject.phone || item.subject.id} detail={item.subject.type} /> },
        { key: "role", header: "角色", render: (item) => item.role.name || item.role.code },
        { key: "scope", header: "范围", render: (item) => `${item.scope_type} · ${item.scope_id}` },
        { key: "status", header: "状态", render: (item) => <Badge tone={statusTone(item.status)}>{item.status}</Badge> },
        { key: "expires", header: "过期时间", render: (item) => formatDateTime(item.expires_at) },
        { key: "id", header: "ID", render: (item) => <CopyableId value={item.id} /> },
        {
          key: "action",
          header: "操作",
          render: (item) =>
            revoke ? (
              <Button icon={<Trash2 size={15} />} onClick={() => revoke(item.id)} variant="danger">
                撤销
              </Button>
            ) : (
              "-"
            )
        }
      ]}
      empty="暂无授权"
      getRowKey={(item) => item.id}
      items={query.data.items}
    />
  );
}

function InvitationTable({
  accept,
  query,
  revoke
}: {
  accept: ((id: string) => void) | null;
  query: { data?: { items: Invitation[] }; error: unknown; isLoading: boolean; refetch: () => unknown };
  revoke: ((id: string) => void) | null;
}) {
  if (query.isLoading) {
    return <LoadingState />;
  }
  if (query.error) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (!query.data) {
    return null;
  }
  return (
    <DataTable<Invitation>
      columns={[
        { key: "target", header: "对象", render: (item) => item.invitee_email || item.invitee_phone || "-" },
        { key: "role", header: "角色", render: (item) => item.role.name || item.role.code },
        { key: "scope", header: "范围", render: (item) => `${item.scope_type} · ${item.scope_id}` },
        { key: "status", header: "状态", render: (item) => <Badge tone={statusTone(item.status)}>{item.status}</Badge> },
        { key: "expires", header: "过期时间", render: (item) => formatDateTime(item.expires_at) },
        { key: "id", header: "ID", render: (item) => <CopyableId value={item.id} /> },
        {
          key: "action",
          header: "操作",
          render: (item) => (
            <div className="row-actions">
              {accept ? <Button onClick={() => accept(item.id)} variant="primary">接受</Button> : null}
              {revoke ? (
                <Button icon={<Trash2 size={15} />} onClick={() => revoke(item.id)} variant="danger">
                  撤销
                </Button>
              ) : null}
            </div>
          )
        }
      ]}
      empty="暂无邀请"
      getRowKey={(item) => item.id}
      items={query.data.items}
    />
  );
}

function NameCell({ detail, name }: { detail?: string; name: string }) {
  return (
    <div className="table-primary">
      <strong>{name}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

function FormSubmitButton({ disabled }: { disabled?: boolean }) {
  return (
    <div className="form-actions align-end">
      <AntButton disabled={disabled} htmlType="submit" icon={<Plus size={16} />} type="primary">
        创建
      </AntButton>
    </div>
  );
}

function submit(event: FormEvent<HTMLFormElement>, action: () => void) {
  event.preventDefault();
  action();
}

function optional(value: string): string | undefined {
  return value.trim() || undefined;
}

function toIso(value: string): string {
  return new Date(value).toISOString();
}

function optionalIso(value: string): string | undefined {
  return value ? toIso(value) : undefined;
}

function toOptions<T extends { id: string; name: string }>(items: T[], emptyLabel: string, label?: (item: T) => string) {
  return [
    { label: emptyLabel, value: "" },
    ...items.map((item) => ({
      label: label ? label(item) : item.name,
      value: item.id
    }))
  ];
}
