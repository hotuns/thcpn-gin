import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, RefreshCcw, Trash2 } from "lucide-react";
import {
  accessGrantsApi,
  auditApi,
  bindingsApi,
  dataSourcesApi,
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
  type DataSource,
  type DataSourceType,
  type DataStream,
  type DataStreamBinding,
  type DataStreamBindingAdapterCode,
  type DataStreamBindingPayloadType,
  type DataStreamType,
  type Dataset,
  type DatasetDataType,
  type DatasetSourceType,
  type Device,
  type DeviceCapabilityCode,
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
  TextArea,
  TextInput,
  statusTone,
  useToast
} from "../../components";

const dataStreamTypeOptions: Array<{ label: string; value: DataStreamType }> = [
  { label: "遥测", value: "telemetry" },
  { label: "图片", value: "image" },
  { label: "视频", value: "video" },
  { label: "音频", value: "audio" },
  { label: "事件", value: "event" },
  { label: "日志", value: "log" }
];
const dataSourceTypeOptions: Array<{ label: string; value: DataSourceType }> = [
  { label: "PostgreSQL", value: "postgres" },
  { label: "MySQL", value: "mysql" },
  { label: "ClickHouse", value: "clickhouse" },
  { label: "HTTP API", value: "http_api" },
  { label: "文件", value: "file" }
];
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
const payloadTypeOptions: Array<{ label: string; value: DataStreamBindingPayloadType }> = [
  { label: "列", value: "columns" },
  { label: "JSON", value: "json" },
  { label: "媒体", value: "media" }
];
const adapterOptions: Array<{ label: string; value: DataStreamBindingAdapterCode }> = [
  { label: "Generic Columns", value: "generic_columns" },
  { label: "Generic Media", value: "generic_media" },
  { label: "HTTP API", value: "http_api" },
  { label: "THCPN Legacy MySQL", value: "thcpn_legacy_mysql" }
];

export function ProjectsPage() {
  const { selectedWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
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
      pushToast("项目已创建");
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
  const { pushToast } = useToast();
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
      pushToast("站点已创建");
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
  const { pushToast } = useToast();
  const [filters, setFilters] = useState({ project_id: "", site_id: "" });
  const [form, setForm] = useState({ name: "", serial_no: "", product_id: "", project_id: "", site_id: "", capabilities: "telemetry" });
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
  const create = useMutation({
    mutationFn: () =>
      devicesApi.create({
        workspace_id: selectedWorkspaceId,
        project_id: optional(form.project_id),
        site_id: optional(form.site_id),
        product_id: optional(form.product_id),
        serial_no: form.serial_no.trim(),
        name: form.name.trim(),
        capabilities: parseCapabilities(form.capabilities)
      }),
    onSuccess: () => {
      setForm({ name: "", serial_no: "", product_id: "", project_id: "", site_id: "", capabilities: "telemetry" });
      void queryClient.invalidateQueries({ queryKey: ["devices", selectedWorkspaceId] });
      pushToast("设备已创建");
    }
  });
  const unbind = useMutation({
    mutationFn: devicesApi.unbind,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["devices", selectedWorkspaceId] });
      pushToast("设备已解绑");
    }
  });
  const projectOptions = useMemo(() => toOptions(projects.data?.items ?? [], "全部项目"), [projects.data?.items]);
  const siteOptions = useMemo(() => toOptions(sites.data?.items ?? [], "全部站点"), [sites.data?.items]);

  return (
    <ResourcePageFrame
      createError={create.error}
      description="设备资产承载数据流、媒体和远程操作能力。"
      filters={
        <>
          <SelectField label="项目" onChange={(event) => setFilters({ ...filters, project_id: event.target.value })} options={projectOptions} value={filters.project_id} />
          <SelectField label="站点" onChange={(event) => setFilters({ ...filters, site_id: event.target.value })} options={siteOptions} value={filters.site_id} />
        </>
      }
      form={
        <form className="form-grid" onSubmit={(event) => submit(event, () => create.mutate())}>
          <TextInput label="设备名称" onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
          <TextInput label="序列号" onChange={(event) => setForm({ ...form, serial_no: event.target.value })} required value={form.serial_no} />
          <TextInput label="产品 ID" onChange={(event) => setForm({ ...form, product_id: event.target.value })} value={form.product_id} />
          <SelectField label="项目" onChange={(event) => setForm({ ...form, project_id: event.target.value })} options={projectOptions} value={form.project_id} />
          <SelectField label="站点" onChange={(event) => setForm({ ...form, site_id: event.target.value })} options={siteOptions} value={form.site_id} />
          <TextInput
            label="能力"
            onChange={(event) => setForm({ ...form, capabilities: event.target.value })}
            value={form.capabilities}
          />
          <FormSubmitButton disabled={create.isPending} />
        </form>
      }
      query={query}
      title="设备"
    >
      {(items: Device[]) => (
        <DataTable<Device>
          columns={[
            { key: "name", header: "设备", render: (item) => <NameCell name={item.name} detail={item.serial_no} /> },
            { key: "status", header: "状态", render: (item) => <Badge tone={statusTone(item.status)}>{item.status}</Badge> },
            { key: "capabilities", header: "能力", render: (item) => item.capabilities.join(", ") || "-" },
            { key: "site", header: "站点 ID", render: (item) => <CopyableId value={item.site_id} /> },
            { key: "id", header: "ID", render: (item) => <CopyableId value={item.id} /> },
            {
              key: "actions",
              header: "操作",
              render: (item) => (
                <Button disabled={unbind.isPending} icon={<Trash2 size={15} />} onClick={() => unbind.mutate(item.id)} variant="danger">
                  解绑
                </Button>
              )
            }
          ]}
          empty="暂无设备"
          getRowKey={(item) => item.id}
          items={items}
        />
      )}
    </ResourcePageFrame>
  );
}

export function DataStreamsPage() {
  const { selectedWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [deviceId, setDeviceId] = useState("");
  const [selectedStreamId, setSelectedStreamId] = useState("");
  const [form, setForm] = useState({ device_id: "", code: "", name: "", type: "telemetry" as DataStreamType, unit: "" });
  const [bindingForm, setBindingForm] = useState({
    data_source_id: "",
    adapter_code: "generic_columns" as DataStreamBindingAdapterCode,
    database_name: "",
    schema_name: "",
    table_name: "",
    device_key_field: "device_id",
    device_key_value: "",
    time_field: "ts",
    value_field: "value",
    payload_type: "columns" as DataStreamBindingPayloadType,
    adapter_config: "{}"
  });
  const devices = useQuery({
    queryKey: ["devices", selectedWorkspaceId],
    queryFn: () => devicesApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const dataSources = useQuery({
    queryKey: ["data-sources", selectedWorkspaceId],
    queryFn: () => dataSourcesApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });
  const query = useQuery({
    queryKey: ["data-streams", deviceId],
    queryFn: () => dataStreamsApi.list(deviceId),
    enabled: Boolean(deviceId)
  });
  const bindings = useQuery({
    queryKey: ["data-stream-bindings", selectedStreamId],
    queryFn: () => bindingsApi.list(selectedStreamId),
    enabled: Boolean(selectedStreamId)
  });
  const create = useMutation({
    mutationFn: () =>
      dataStreamsApi.create({
        device_id: form.device_id,
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type,
        unit: optional(form.unit)
      }),
    onSuccess: () => {
      setForm({ device_id: "", code: "", name: "", type: "telemetry", unit: "" });
      void queryClient.invalidateQueries({ queryKey: ["data-streams"] });
      pushToast("数据流已创建");
    }
  });
  const createBinding = useMutation({
    mutationFn: () =>
      bindingsApi.create({
        data_stream_id: selectedStreamId,
        data_source_id: bindingForm.data_source_id,
        adapter_code: bindingForm.adapter_code,
        database_name: optional(bindingForm.database_name),
        schema_name: optional(bindingForm.schema_name),
        table_name: optional(bindingForm.table_name),
        device_key_field: optional(bindingForm.device_key_field),
        device_key_value: optional(bindingForm.device_key_value),
        time_field: optional(bindingForm.time_field),
        value_field: optional(bindingForm.value_field),
        payload_type: bindingForm.payload_type,
        adapter_config: parseJSONRecord(bindingForm.adapter_config)
      }),
    onSuccess: () => {
      setBindingForm({
        data_source_id: "",
        adapter_code: "generic_columns",
        database_name: "",
        schema_name: "",
        table_name: "",
        device_key_field: "device_id",
        device_key_value: "",
        time_field: "ts",
        value_field: "value",
        payload_type: "columns",
        adapter_config: "{}"
      });
      void queryClient.invalidateQueries({ queryKey: ["data-stream-bindings", selectedStreamId] });
      pushToast("绑定已创建");
    }
  });
  const deviceOptions = useMemo(() => toOptions(devices.data?.items ?? [], "选择设备", (item) => `${item.name} · ${item.serial_no}`), [devices.data?.items]);
  const sourceOptions = useMemo(() => toOptions(dataSources.data?.items ?? [], "选择数据源"), [dataSources.data?.items]);
  const bindingRequiresMapping = bindingForm.adapter_code === "generic_columns" || bindingForm.adapter_code === "generic_media";
  const bindingRequiresValueField = bindingForm.adapter_code === "generic_columns";
  const updateBindingAdapter = (adapterCode: DataStreamBindingAdapterCode) => {
    setBindingForm({
      ...bindingForm,
      adapter_code: adapterCode,
      payload_type: defaultPayloadForAdapter(adapterCode),
      value_field: adapterCode === "generic_media" ? "" : bindingForm.value_field || "value",
      adapter_config: defaultAdapterConfigForAdapter(adapterCode)
    });
  };

  return (
    <Page description="数据流定义设备的遥测、媒体、事件或日志输出。" title="数据流">
      <Section title="筛选与创建">
        <form className="form-grid" onSubmit={(event) => submit(event, () => create.mutate())}>
          <SelectField label="查看设备" onChange={(event) => setDeviceId(event.target.value)} options={deviceOptions} value={deviceId} />
          <SelectField label="创建设备" onChange={(event) => setForm({ ...form, device_id: event.target.value })} options={deviceOptions} required value={form.device_id} />
          <TextInput label="编码" onChange={(event) => setForm({ ...form, code: event.target.value })} required value={form.code} />
          <TextInput label="名称" onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
          <SelectField label="类型" onChange={(event) => setForm({ ...form, type: event.target.value as DataStreamType })} options={dataStreamTypeOptions} value={form.type} />
          <TextInput label="单位" onChange={(event) => setForm({ ...form, unit: event.target.value })} value={form.unit} />
          <FormSubmitButton disabled={create.isPending} />
        </form>
        {create.error ? <p className="form-error">{formatApiError(create.error)}</p> : null}
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
              { key: "id", header: "ID", render: (item) => <CopyableId value={item.id} /> },
              {
                key: "select",
                header: "绑定",
                render: (item) => (
                  <Button onClick={() => setSelectedStreamId(item.id)} variant={selectedStreamId === item.id ? "primary" : "secondary"}>
                    查看绑定
                  </Button>
                )
              }
            ]}
            empty="暂无数据流"
            getRowKey={(item) => item.id}
            items={query.data.items}
          />
        ) : null}
      </Section>
      <Section description="绑定保存受控查询元数据，遥测查询不会接收表名或 SQL。" title="数据流绑定">
        {!selectedStreamId ? <p className="muted">在数据流列表选择一项后管理绑定。</p> : null}
        {selectedStreamId ? (
          <form className="form-grid" onSubmit={(event) => submit(event, () => createBinding.mutate())}>
            <SelectField label="数据源" onChange={(event) => setBindingForm({ ...bindingForm, data_source_id: event.target.value })} options={sourceOptions} required value={bindingForm.data_source_id} />
            <SelectField
              label="Adapter"
              onChange={(event) => updateBindingAdapter(event.target.value as DataStreamBindingAdapterCode)}
              options={adapterOptions}
              required
              value={bindingForm.adapter_code}
            />
            <TextInput label="数据库" onChange={(event) => setBindingForm({ ...bindingForm, database_name: event.target.value })} value={bindingForm.database_name} />
            <TextInput label="Schema" onChange={(event) => setBindingForm({ ...bindingForm, schema_name: event.target.value })} value={bindingForm.schema_name} />
            <TextInput label="表名" onChange={(event) => setBindingForm({ ...bindingForm, table_name: event.target.value })} required={bindingRequiresMapping} value={bindingForm.table_name} />
            <TextInput label="设备字段" onChange={(event) => setBindingForm({ ...bindingForm, device_key_field: event.target.value })} required={bindingRequiresMapping} value={bindingForm.device_key_field} />
            <TextInput label="设备值" onChange={(event) => setBindingForm({ ...bindingForm, device_key_value: event.target.value })} required={bindingRequiresMapping} value={bindingForm.device_key_value} />
            <TextInput label="时间字段" onChange={(event) => setBindingForm({ ...bindingForm, time_field: event.target.value })} required={bindingRequiresMapping} value={bindingForm.time_field} />
            <TextInput label="值字段" onChange={(event) => setBindingForm({ ...bindingForm, value_field: event.target.value })} required={bindingRequiresValueField} value={bindingForm.value_field} />
            <SelectField
              label="Payload"
              disabled={bindingForm.adapter_code === "generic_columns" || bindingForm.adapter_code === "generic_media"}
              onChange={(event) => setBindingForm({ ...bindingForm, payload_type: event.target.value as DataStreamBindingPayloadType })}
              options={payloadTypeOptions}
              value={bindingForm.payload_type}
            />
            <TextArea label="Adapter 配置 JSON" onChange={(event) => setBindingForm({ ...bindingForm, adapter_config: event.target.value })} required value={bindingForm.adapter_config} />
            <FormSubmitButton disabled={createBinding.isPending} />
          </form>
        ) : null}
        {createBinding.error ? <p className="form-error">{formatApiError(createBinding.error)}</p> : null}
        {bindings.isLoading ? <LoadingState /> : null}
        {bindings.data ? (
          <DataTable<DataStreamBinding>
            columns={[
              { key: "source", header: "数据源 ID", render: (item) => <CopyableId value={item.data_source_id} /> },
              { key: "adapter", header: "Adapter", render: (item) => item.adapter_code },
              { key: "table", header: "表", render: (item) => labelOrDash(item.table_name) },
              { key: "payload", header: "Payload", render: (item) => item.payload_type },
              { key: "status", header: "状态", render: (item) => <Badge tone={statusTone(item.status)}>{item.status}</Badge> },
              { key: "id", header: "ID", render: (item) => <CopyableId value={item.id} /> }
            ]}
            empty="暂无绑定"
            getRowKey={(item) => item.id}
            items={bindings.data.items}
          />
        ) : null}
      </Section>
    </Page>
  );
}

export function DataSourcesPage() {
  const { selectedWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [form, setForm] = useState({ name: "", type: "postgres" as DataSourceType, dsn_secret_ref: "" });
  const query = useQuery({
    queryKey: ["data-sources", selectedWorkspaceId],
    queryFn: () => dataSourcesApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });
  const create = useMutation({
    mutationFn: () =>
      dataSourcesApi.create({
        workspace_id: selectedWorkspaceId,
        name: form.name.trim(),
        type: form.type,
        dsn_secret_ref: form.dsn_secret_ref.trim()
      }),
    onSuccess: () => {
      setForm({ name: "", type: "postgres", dsn_secret_ref: "" });
      void queryClient.invalidateQueries({ queryKey: ["data-sources", selectedWorkspaceId] });
      pushToast("数据源已创建");
    }
  });

  return (
    <ResourcePageFrame
      createError={create.error}
      description="数据源只保存外部 secret 引用，不展示原始 DSN。"
      form={
        <form className="form-grid" onSubmit={(event) => submit(event, () => create.mutate())}>
          <TextInput label="名称" onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
          <SelectField label="类型" onChange={(event) => setForm({ ...form, type: event.target.value as DataSourceType })} options={dataSourceTypeOptions} value={form.type} />
          <TextInput label="Secret 引用" onChange={(event) => setForm({ ...form, dsn_secret_ref: event.target.value })} required value={form.dsn_secret_ref} />
          <FormSubmitButton disabled={create.isPending} />
        </form>
      }
      query={query}
      title="数据源"
    >
      {(items: DataSource[]) => (
        <DataTable<DataSource>
          columns={[
            { key: "name", header: "数据源", render: (item) => <NameCell name={item.name} detail={item.type} /> },
            { key: "secret", header: "Secret", render: (item) => item.dsn_secret_ref },
            { key: "status", header: "状态", render: (item) => <Badge tone={statusTone(item.status)}>{item.status}</Badge> },
            { key: "id", header: "ID", render: (item) => <CopyableId value={item.id} /> }
          ]}
          empty="暂无数据源"
          getRowKey={(item) => item.id}
          items={items}
        />
      )}
    </ResourcePageFrame>
  );
}

export function DatasetsPage() {
  const { selectedWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
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
      pushToast("数据集已创建");
    }
  });
  const remove = useMutation({
    mutationFn: datasetsApi.delete,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["datasets", selectedWorkspaceId] });
      pushToast("数据集已删除");
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
  const { pushToast } = useToast();
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
      pushToast("导出任务已创建");
    }
  });
  const download = useMutation({
    mutationFn: exportJobsApi.prepareDownload,
    onSuccess: (result) => {
      window.open(result.url, "_blank", "noopener,noreferrer");
      pushToast("下载地址已打开");
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
  const { pushToast } = useToast();
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
      pushToast("授权已创建");
    }
  });
  const revoke = useMutation({
    mutationFn: accessGrantsApi.revoke,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["access-grants"] });
      pushToast("授权已撤销");
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
          <label className="check-field">
            <input checked={form.allow_reshare} onChange={(event) => setForm({ ...form, allow_reshare: event.target.checked })} type="checkbox" />
            <span>允许再分享</span>
          </label>
          <label className="check-field">
            <input checked={form.allow_api_access} onChange={(event) => setForm({ ...form, allow_api_access: event.target.checked })} type="checkbox" />
            <span>允许 API 访问</span>
          </label>
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
  const { pushToast } = useToast();
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
      pushToast("邀请已创建");
    }
  });
  const accept = useMutation({
    mutationFn: invitationsApi.accept,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invitations"] });
      void queryClient.invalidateQueries({ queryKey: ["access-grants"] });
      pushToast("邀请已接受");
    }
  });
  const revoke = useMutation({
    mutationFn: invitationsApi.revoke,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invitations"] });
      pushToast("邀请已撤销");
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
      actions={<Button icon={<RefreshCcw size={16} />} onClick={() => void query.refetch()}>刷新</Button>}
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
  form: ReactNode;
  query: {
    data?: { items: T[] };
    error: unknown;
    isLoading: boolean;
    refetch: () => unknown;
  };
  title: string;
}) {
  return (
    <Page actions={<Button icon={<RefreshCcw size={16} />} onClick={() => void query.refetch()}>刷新</Button>} description={description} title={title}>
      {filters ? (
        <Section title="筛选">
          <div className="filter-grid">{filters}</div>
        </Section>
      ) : null}
      <Section title={`创建${title}`}>{form}{createError ? <p className="form-error">{formatApiError(createError)}</p> : null}</Section>
      <Section title={`${title}列表`}>
        {query.isLoading ? <LoadingState /> : null}
        {query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
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
      <Button disabled={disabled} icon={<Plus size={16} />} type="submit" variant="primary">
        创建
      </Button>
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

function defaultPayloadForAdapter(adapterCode: DataStreamBindingAdapterCode): DataStreamBindingPayloadType {
  if (adapterCode === "generic_media") {
    return "media";
  }
  return "columns";
}

function defaultAdapterConfigForAdapter(adapterCode: DataStreamBindingAdapterCode): string {
  if (adapterCode === "generic_media") {
    return JSON.stringify({ object_key_field: "object_key" }, null, 2);
  }
  return "{}";
}

function parseJSONRecord(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Adapter 配置必须是 JSON object");
  }
  return parsed as Record<string, unknown>;
}

function toIso(value: string): string {
  return new Date(value).toISOString();
}

function optionalIso(value: string): string | undefined {
  return value ? toIso(value) : undefined;
}

function parseCapabilities(value: string): DeviceCapabilityCode[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as DeviceCapabilityCode[];
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
