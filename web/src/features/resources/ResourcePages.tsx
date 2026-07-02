import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { CloudSyncOutlined } from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button as AntButton,
  Card,
  Checkbox,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Result,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography
} from "antd";
import type { TableColumnsType } from "antd";
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
  type Site,
  type THCPNStandardStationSyncResult
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
  statusTone
} from "../../components";
import { copyableId, statusColor, tableScrollX } from "../../app/ui";

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
      void message.success("设备已创建");
    }
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
      createError={create.error}
      description="设备资产承载数据流、媒体和远程操作能力。"
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
      form={
        <form className="form-grid" onSubmit={(event) => submit(event, () => create.mutate())}>
          <Form.Item className="field" label="设备名称" required>
            <Input className="control" onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
          </Form.Item>
          <Form.Item className="field" label="序列号" required>
            <Input className="control" onChange={(event) => setForm({ ...form, serial_no: event.target.value })} required value={form.serial_no} />
          </Form.Item>
          <Form.Item className="field" label="产品 ID">
            <Input className="control" onChange={(event) => setForm({ ...form, product_id: event.target.value })} value={form.product_id} />
          </Form.Item>
          <Form.Item className="field" label="项目">
            <Select className="control" onChange={(value) => setForm({ ...form, project_id: value })} options={projectOptions} value={form.project_id} />
          </Form.Item>
          <Form.Item className="field" label="站点">
            <Select className="control" onChange={(value) => setForm({ ...form, site_id: value })} options={siteOptions} value={form.site_id} />
          </Form.Item>
          <Form.Item className="field" label="能力">
            <Input className="control" onChange={(event) => setForm({ ...form, capabilities: event.target.value })} value={form.capabilities} />
          </Form.Item>
          <FormSubmitButton disabled={create.isPending} />
        </form>
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
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
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
      void message.success("数据流已创建");
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
      void message.success("绑定已创建");
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
  const { message } = AntApp.useApp();
  const [syncForm] = Form.useForm<THCPNSyncFormValues>();
  const [form, setForm] = useState({ name: "", type: "postgres" as DataSourceType, dsn_secret_ref: "" });
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [syncResult, setSyncResult] = useState<THCPNStandardStationSyncResult | null>(null);
  const query = useQuery({
    queryKey: ["data-sources", selectedWorkspaceId],
    queryFn: () => dataSourcesApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });
  const projects = useQuery({
    queryKey: ["projects", selectedWorkspaceId],
    queryFn: () => projectsApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });
  const sites = useQuery({
    queryKey: ["sites", selectedWorkspaceId, selectedProjectId],
    queryFn: () => sitesApi.list({ workspace_id: selectedWorkspaceId, project_id: optional(selectedProjectId) }),
    enabled: Boolean(selectedWorkspaceId && selectedProjectId)
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
      void message.success("数据源已创建");
    }
  });
  const syncTHCPN = useMutation({
    mutationFn: (values: THCPNSyncFormValues) =>
      dataSourcesApi.syncTHCPNStandardStationDevice(values.data_source_id, {
        target_workspace_id: selectedWorkspaceId,
        external_device_id: values.external_device_id,
        project_id: optional(values.project_id || ""),
        site_id: optional(values.site_id || ""),
        product_id: optional(values.product_id || ""),
        serial_no: optional(values.serial_no || ""),
        name: optional(values.name || "")
      }),
    onSuccess: (result) => {
      setSyncResult(result);
      void queryClient.invalidateQueries({ queryKey: ["devices", selectedWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["data-streams"] });
      void queryClient.invalidateQueries({ queryKey: ["data-stream-bindings"] });
      void queryClient.invalidateQueries({ queryKey: ["data-sources", selectedWorkspaceId] });
      void message.success("THCPN 标准站已同步");
    }
  });

  const activeMySQLSources = useMemo(
    () => (query.data?.items ?? []).filter((item) => item.type === "mysql" && item.status === "active"),
    [query.data?.items]
  );
  const activeMySQLSourceOptions = useMemo(
    () =>
      activeMySQLSources.map((item) => ({
        label: `${item.name} · ${item.dsn_secret_ref}`,
        value: item.id
      })),
    [activeMySQLSources]
  );
  const projectOptions = useMemo(
    () =>
      (projects.data?.items ?? []).map((item) => ({
        label: item.name,
        value: item.id
      })),
    [projects.data?.items]
  );
  const siteOptions = useMemo(
    () =>
      (sites.data?.items ?? []).map((item) => ({
        label: item.name,
        value: item.id
      })),
    [sites.data?.items]
  );

  return (
    <Page
      actions={<AntButton icon={<RefreshCcw size={16} />} onClick={() => void query.refetch()}>刷新</AntButton>}
      description="内部设备源实例配置。普通用户主导航不展示该页面。"
      title="数据源"
    >
      <Section description="数据源只保存外部 secret 引用，不展示原始 DSN。" title="创建数据源">
        <form className="form-grid" onSubmit={(event) => submit(event, () => create.mutate())}>
          <TextInput label="名称" onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
          <SelectField label="类型" onChange={(event) => setForm({ ...form, type: event.target.value as DataSourceType })} options={dataSourceTypeOptions} value={form.type} />
          <TextInput label="Secret 引用" onChange={(event) => setForm({ ...form, dsn_secret_ref: event.target.value })} required value={form.dsn_secret_ref} />
          <FormSubmitButton disabled={create.isPending} />
        </form>
        {create.error ? <Alert message={formatApiError(create.error)} showIcon type="error" /> : null}
      </Section>

      <Card
        className="section"
        title={
          <Space orientation="vertical" size={0}>
            <Typography.Text strong>THCPN 标准站接入</Typography.Text>
            <Typography.Text type="secondary">
              从 active MySQL 数据源读取外部设备和最新配置，自动生成平台设备、数据流和 thcpn_legacy_mysql 绑定。
            </Typography.Text>
          </Space>
        }
      >
        {query.isLoading ? <LoadingState label="正在加载数据源" /> : null}
        {!query.isLoading && activeMySQLSources.length === 0 ? (
          <Alert
            message="当前工作区没有 active MySQL 数据源"
            showIcon
            type="warning"
          />
        ) : null}
        <Form<THCPNSyncFormValues>
          form={syncForm}
          layout="vertical"
          onFinish={(values) => syncTHCPN.mutate(values)}
          onValuesChange={(changed) => {
            if ("project_id" in changed) {
              const nextProjectId = changed.project_id || "";
              setSelectedProjectId(nextProjectId);
              syncForm.setFieldValue("site_id", undefined);
            }
          }}
        >
          <div className="form-grid">
            <Form.Item label="数据源" name="data_source_id" rules={[{ required: true, message: "请选择 active MySQL 数据源" }]}>
              <Select disabled={activeMySQLSources.length === 0} options={activeMySQLSourceOptions} placeholder="选择 MySQL 数据源" />
            </Form.Item>
            <Form.Item label="外部设备 ID" name="external_device_id" rules={[{ required: true, message: "请输入外部设备 ID" }]}>
              <InputNumber min={1} precision={0} placeholder="1206" style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="项目" name="project_id">
              <Select allowClear loading={projects.isLoading} options={projectOptions} placeholder="可选" />
            </Form.Item>
            <Form.Item label="站点" name="site_id">
              <Select allowClear disabled={!selectedProjectId} loading={sites.isLoading} options={siteOptions} placeholder="先选择项目" />
            </Form.Item>
            <Form.Item label="产品 ID" name="product_id">
              <Input placeholder="默认 thcpn_standard_station" />
            </Form.Item>
            <Form.Item label="序列号" name="serial_no">
              <Input placeholder="默认外部 sn/uuid/thcpn-{id}" />
            </Form.Item>
            <Form.Item label="设备名称" name="name">
              <Input placeholder="默认外部设备名称" />
            </Form.Item>
            <div className="form-actions align-end">
              <AntButton
                disabled={activeMySQLSources.length === 0}
                htmlType="submit"
                icon={<CloudSyncOutlined />}
                loading={syncTHCPN.isPending}
                type="primary"
              >
                同步标准站
              </AntButton>
            </div>
          </div>
        </Form>
        {syncTHCPN.error ? <Alert message={formatApiError(syncTHCPN.error)} showIcon type="error" /> : null}
        {syncResult ? <THCPNSyncResultView result={syncResult} /> : null}
      </Card>

      <Section title="数据源列表">
        {query.isLoading ? <LoadingState /> : null}
        {query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.data ? (
          <DataTable<DataSource>
            columns={[
              { key: "name", header: "数据源", render: (item) => <NameCell name={item.name} detail={item.type} /> },
              { key: "secret", header: "Secret", render: (item) => item.dsn_secret_ref },
              { key: "status", header: "状态", render: (item) => <Badge tone={statusTone(item.status)}>{item.status}</Badge> },
              { key: "id", header: "ID", render: (item) => <CopyableId value={item.id} /> }
            ]}
            empty="暂无数据源"
            getRowKey={(item) => item.id}
            items={query.data.items}
          />
        ) : null}
      </Section>
    </Page>
  );
}

interface THCPNSyncFormValues {
  data_source_id: string;
  external_device_id: number;
  project_id?: string;
  site_id?: string;
  product_id?: string;
  serial_no?: string;
  name?: string;
}

function THCPNSyncResultView({ result }: { result: THCPNStandardStationSyncResult }) {
  type StreamRow = THCPNStandardStationSyncResult["data_streams"][number];
  type BindingRow = THCPNStandardStationSyncResult["bindings"][number];

  const streamColumns: TableColumnsType<StreamRow> = [
    { key: "name", title: "数据流", render: (_, item) => <NameCell name={item.name} detail={`${item.code} · ${item.type}`} /> },
    { dataIndex: "unit", key: "unit", title: "单位", render: (value?: string) => labelOrDash(value) },
    { dataIndex: "status", key: "status", title: "状态", render: (value: string) => <Badge tone={statusTone(value)}>{value}</Badge> },
    { key: "id", title: "ID", render: (_, item) => <CopyableId value={item.id} /> }
  ];
  const bindingColumns: TableColumnsType<BindingRow> = [
    { dataIndex: "adapter_code", key: "adapter", title: "Adapter" },
    { dataIndex: "payload_type", key: "payload", title: "Payload" },
    { dataIndex: "status", key: "status", title: "状态", render: (value: string) => <Badge tone={statusTone(value)}>{value}</Badge> },
    { key: "config", title: "Adapter 配置", render: (_, item) => <JSONSummary value={item.adapter_config} /> },
    { key: "id", title: "ID", render: (_, item) => <CopyableId value={item.id} /> }
  ];

  return (
    <div className="sync-result">
      <Descriptions bordered column={{ xs: 1, md: 2 }} size="small" title="同步结果">
        <Descriptions.Item label="平台设备">{result.device.name}</Descriptions.Item>
        <Descriptions.Item label="平台设备 ID">
          <CopyableId value={result.device.id} />
        </Descriptions.Item>
        <Descriptions.Item label="序列号">{result.device.serial_no}</Descriptions.Item>
        <Descriptions.Item label="状态">
          <Badge tone={statusTone(result.device.status)}>{result.device.status}</Badge>
        </Descriptions.Item>
        <Descriptions.Item label="外部设备">{result.external_device.name}</Descriptions.Item>
        <Descriptions.Item label="外部设备 ID">{result.external_device.id}</Descriptions.Item>
        <Descriptions.Item label="外部 SN">{labelOrDash(result.external_device.sn)}</Descriptions.Item>
        <Descriptions.Item label="外部 UUID">{labelOrDash(result.external_device.uuid)}</Descriptions.Item>
        <Descriptions.Item label="SourceRef">
          <CopyableId value={result.source_ref.id} />
        </Descriptions.Item>
        <Descriptions.Item label="SourceRef 状态">
          <Badge tone={statusTone(result.source_ref.status)}>{result.source_ref.status}</Badge>
        </Descriptions.Item>
        <Descriptions.Item label="Config ID">{result.config_snapshot.external_config_id}</Descriptions.Item>
        <Descriptions.Item label="Config 版本">{labelOrDash(result.config_snapshot.version)}</Descriptions.Item>
        <Descriptions.Item label="传感器数量">{Array.isArray(result.config_snapshot.data_json) ? result.config_snapshot.data_json.length : 0}</Descriptions.Item>
        <Descriptions.Item label="相机数量">{Array.isArray(result.config_snapshot.image_json) ? result.config_snapshot.image_json.length : 0}</Descriptions.Item>
        <Descriptions.Item label="同步时间">{formatDateTime(result.source_ref.synced_at)}</Descriptions.Item>
      </Descriptions>

      <div className="result-table-block">
        <Typography.Text strong>生成的数据流</Typography.Text>
        <Table<StreamRow>
          columns={streamColumns}
          dataSource={result.data_streams}
          pagination={false}
          rowKey="id"
          scroll={{ x: "max-content" }}
          size="small"
        />
      </div>

      <div className="result-table-block">
        <Typography.Text strong>生成的 DataStreamBindings</Typography.Text>
        <Table<BindingRow>
          columns={bindingColumns}
          dataSource={result.bindings}
          pagination={false}
          rowKey="id"
          scroll={{ x: "max-content" }}
          size="small"
        />
      </div>
    </div>
  );
}

function JSONSummary({ value }: { value: Record<string, unknown> }) {
  const text = JSON.stringify(value);
  return (
    <Typography.Text className="mono json-summary" copyable={{ text }} title={text}>
      {text}
    </Typography.Text>
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
    <Page actions={<AntButton icon={<RefreshCcw size={16} />} onClick={() => void query.refetch()}>刷新</AntButton>} description={description} title={title}>
      {filters ? (
        <Section title="筛选">
          <div className="filter-grid">{filters}</div>
        </Section>
      ) : null}
      <Section title={`创建${title}`}>{form}{createError ? <p className="form-error">{formatApiError(createError)}</p> : null}</Section>
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
  if (adapterCode === "thcpn_legacy_mysql") {
    return JSON.stringify(
      {
        external_device_id: 1206,
        row_type: "data",
        json_key: "temp",
        value_path: '$."temp".value',
        table_index: "device_data_index",
        table_name_field: "tb_name",
        index_start_field: "start_at",
        index_end_field: "end_at",
        time_field: "ts"
      },
      null,
      2
    );
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
