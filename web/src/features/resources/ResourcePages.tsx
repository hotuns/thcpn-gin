import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { LineChart as EChartsLineChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use } from "echarts/core";
import type { EChartsOption } from "echarts";
import { CanvasRenderer } from "echarts/renderers";
import { ChartLine, Download, Eye, FileArchive, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  App as AntApp,
  Button as AntButton,
  Checkbox,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Form,
  InputNumber,
  Modal,
  Result,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography
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
  permissionsApi,
  projectsApi,
  sitesApi,
  type AccessGrant,
  type AccessGrantScopeType,
  type AuditLog,
  type DataStream,
  type Dataset,
  type DatasetDataType,
  type DatasetSourceInput,
  type DatasetTelemetryQueryResponse,
  type DatasetTelemetrySeries,
  type Device,
  type DeviceChild,
  type DeviceLifecycleStatus,
  type ExportJob,
  type ExportResourceType,
  type ExportType,
  type Invitation,
  type PermissionCode,
  type PermissionCatalogResponse,
  type Project,
  type Site
} from "../../api";
import { useWorkspace } from "../../app/WorkspaceProvider";
import { formatDateTime, labelOrDash } from "../../app/format";
import { accessRoleMeta, roleLabel } from "../settings/roleMeta";
import { PermissionPicker, PermissionSummary } from "../settings/PermissionPicker";
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

use([EChartsLineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);

const DATASET_PREVIEW_LIMIT = 500;
type DeviceTopologyFilter = "all" | "gateway" | "gateway_node" | "camera" | "standalone";

const datasetTypeOptions: Array<{ label: string; value: DatasetDataType }> = [
  { label: "遥测", value: "telemetry" },
  { label: "图片", value: "image" },
  { label: "视频", value: "video" },
  { label: "音频", value: "audio" },
  { label: "事件", value: "event" },
  { label: "日志", value: "log" },
  { label: "混合", value: "mixed" }
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
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ project_id: "", site_id: "" });
  const [topologyFilter, setTopologyFilter] = useState<DeviceTopologyFilter>("all");
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
  const allDevices = query.data?.items ?? [];
  const topologyCounts = useMemo(
    () => ({
      all: allDevices.length,
      gateway: allDevices.filter((item) => item.topology_role === "gateway").length,
      gateway_node: allDevices.filter((item) => item.topology_role === "gateway_node").length,
      camera: allDevices.filter((item) => item.topology_role === "camera").length,
      standalone: allDevices.filter((item) => item.topology_role === "standalone").length
    }),
    [allDevices]
  );
  const deviceColumns: TableColumnsType<Device> = [
    {
      key: "name",
      title: "设备",
      width: 260,
      render: (_, item) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{item.name}</Typography.Text>
          <Typography.Text type="secondary" ellipsis title={item.serial_no}>
            {item.serial_no}
          </Typography.Text>
        </Space>
      )
    },
    { key: "topology", title: "类型", width: 150, render: (_, item) => deviceTopologyTag(item) },
    { key: "lifecycle", title: "生命周期", width: 120, render: (_, item) => deviceLifecycleTag(item.lifecycle_status) },
    { key: "status", title: "状态", width: 130, render: (_, item) => <Tag color={statusColor(item.status)}>{item.status}</Tag> },
    {
      key: "capabilities",
      title: "能力",
      width: 190,
      render: (_, item) => (
        <Space size={[4, 4]} wrap>
          {item.capabilities.length > 0 ? item.capabilities.map((capability) => <Tag key={capability}>{capability}</Tag>) : "-"}
        </Space>
      )
    },
    { key: "site", title: "站点 ID", width: 240, render: (_, item) => copyableId(item.site_id) },
    { key: "id", title: "ID", width: 240, render: (_, item) => copyableId(item.id) },
    {
      key: "actions",
      title: "操作",
      fixed: "right",
      width: 250,
      render: (_, item) => (
        <Space size={8} wrap>
          <AntButton icon={<ChartLine size={15} />} onClick={() => navigate(`/device-data?device_id=${encodeURIComponent(item.id)}`)} type="primary">
            {item.topology_role === "gateway"
              ? "网关数据"
              : item.topology_role === "gateway_node"
                ? "节点数据"
                : item.topology_role === "camera"
                  ? "实时视频"
                  : "查看数据"}
          </AntButton>
          <AntButton danger disabled={unbind.isPending} icon={<Trash2 size={15} />} onClick={() => unbind.mutate(item.id)}>
            解绑
          </AntButton>
        </Space>
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
      {(items: Device[]) => {
        const filteredItems = topologyFilter === "all" ? items : items.filter((item) => item.topology_role === topologyFilter);
        return (
          <div className="device-asset-workspace">
            <div className="device-topology-summary">
              <DeviceTopologySummary label="全部设备" value={topologyCounts.all} />
              <DeviceTopologySummary label="组网站" value={topologyCounts.gateway} tone="gateway" />
              <DeviceTopologySummary label="节点" value={topologyCounts.gateway_node} tone="node" />
              <DeviceTopologySummary label="相机" value={topologyCounts.camera} tone="camera" />
              <DeviceTopologySummary label="普通设备" value={topologyCounts.standalone} tone="standalone" />
            </div>
            <Tabs
              activeKey={topologyFilter}
              items={[
                { key: "all", label: `全部 (${topologyCounts.all})` },
                { key: "gateway", label: `组网站 (${topologyCounts.gateway})` },
                { key: "gateway_node", label: `节点 (${topologyCounts.gateway_node})` },
                { key: "camera", label: `相机 (${topologyCounts.camera})` },
                { key: "standalone", label: `普通设备 (${topologyCounts.standalone})` }
              ]}
              onChange={(key) => setTopologyFilter(key as DeviceTopologyFilter)}
            />
            <Table<Device>
              className="data-table"
              columns={deviceColumns}
              dataSource={filteredItems}
              expandable={{
                expandedRowRender: (item) => <WorkspaceDeviceChildrenTable deviceId={item.id} />,
                rowExpandable: (item) => item.topology_role === "gateway" && (item.child_count ?? 0) > 0
              }}
              locale={{ emptyText: "暂无设备" }}
              pagination={false}
              rowKey={(item) => item.id}
              scroll={{ x: tableScrollX(deviceColumns) }}
              size="middle"
              tableLayout="fixed"
            />
          </div>
        );
      }}
    </ResourcePageFrame>
  );
}

function DeviceTopologySummary({
  label,
  tone = "all",
  value
}: {
  label: string;
  tone?: "all" | "gateway" | "node" | "camera" | "standalone";
  value: number;
}) {
  return (
    <div className={`device-topology-summary-item is-${tone}`}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Title level={3}>{value}</Typography.Title>
    </div>
  );
}

function WorkspaceDeviceChildrenTable({ deviceId }: { deviceId: string }) {
  const navigate = useNavigate();
  const children = useQuery({
    queryKey: ["device-children", deviceId],
    queryFn: () => devicesApi.children(deviceId)
  });
  const columns: TableColumnsType<DeviceChild> = [
    {
      key: "device",
      title: "节点设备",
      width: 260,
      render: (_, item) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{item.device.name}</Typography.Text>
          <Typography.Text type="secondary" ellipsis title={item.device.serial_no}>
            {item.device.serial_no}
          </Typography.Text>
        </Space>
      )
    },
    {
      key: "status",
      title: "状态",
      width: 120,
      render: (_, item) => <Tag color={statusColor(item.device.status)}>{item.device.status}</Tag>
    },
    {
      key: "assignment",
      title: "站点 ID",
      width: 220,
      render: (_, item) => copyableId(item.device.site_id)
    },
    {
      key: "id",
      title: "设备 ID",
      width: 240,
      render: (_, item) => copyableId(item.device.id)
    },
    {
      key: "actions",
      title: "操作",
      fixed: "right",
      width: 140,
      render: (_, item) => (
        <AntButton icon={<ChartLine size={15} />} onClick={() => navigate(`/device-data?device_id=${encodeURIComponent(item.device.id)}`)} type="primary">
          节点数据
        </AntButton>
      )
    }
  ];

  if (children.error) {
    return <Alert message={formatApiError(children.error)} showIcon type="error" />;
  }
  return (
    <Table<DeviceChild>
      className="data-table nested-device-table"
      columns={columns}
      dataSource={children.data?.items ?? []}
      loading={children.isLoading}
      locale={{ emptyText: "当前账号没有可查看的节点，或节点尚未分配到当前工作区" }}
      pagination={false}
      rowKey={(item) => item.relation.id}
      scroll={{ x: tableScrollX(columns) }}
      size="small"
      tableLayout="fixed"
    />
  );
}

function deviceTopologyTag(device: Device) {
  if (device.topology_role === "gateway") {
    return <Tag color="purple">组网站 · {device.child_count ?? 0} 节点</Tag>;
  }
  if (device.topology_role === "gateway_node") {
    return <Tag color="cyan">节点</Tag>;
  }
  if (device.topology_role === "camera") {
    return <Tag color="magenta">相机</Tag>;
  }
  return <Tag>普通设备</Tag>;
}

function deviceLifecycleTag(status: DeviceLifecycleStatus) {
  const label: Record<DeviceLifecycleStatus, string> = {
    inbound: "入库",
    installed: "安装",
    online: "上线",
    maintenance: "维护",
    repairing: "维修",
    retired: "报废"
  };
  const color: Record<DeviceLifecycleStatus, string> = {
    inbound: "default",
    installed: "blue",
    online: "green",
    maintenance: "gold",
    repairing: "orange",
    retired: "red"
  };
  return <Tag color={color[status]}>{label[status]}</Tag>;
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
  type SourceMode = "device" | "data_stream";
  const [previewDataset, setPreviewDataset] = useState<Dataset | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyDatasetForm);
  const projects = useQuery({
    queryKey: ["projects", selectedWorkspaceId],
    queryFn: () => projectsApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });
  const devices = useQuery({
    queryKey: ["devices", selectedWorkspaceId],
    queryFn: () => devicesApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const streamQueries = useQueries({
    queries: form.stream_device_ids.map((deviceId) => ({
      enabled: Boolean(deviceId),
      queryFn: () => dataStreamsApi.list(deviceId),
      queryKey: ["data-streams", deviceId]
    }))
  });
  const query = useQuery({
    queryKey: ["datasets", selectedWorkspaceId],
    queryFn: () => datasetsApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const devicesByID = useMemo(() => new Map((devices.data?.items ?? []).map((device) => [device.id, device])), [devices.data?.items]);
  const deviceOptions = useMemo(
    () =>
      (devices.data?.items ?? []).map((device) => ({
        label: `${device.name} · ${device.serial_no}`,
        value: device.id
      })),
    [devices.data?.items]
  );
  const activeDataStreams = useMemo(
    () =>
      streamQueries.flatMap((streamQuery) =>
        (streamQuery.data?.items ?? []).filter((stream) => stream.status === "active" && (stream.type === "telemetry" || stream.type === "image"))
      ),
    [streamQueries]
  );
  const dataStreamOptions = useMemo(
    () =>
      activeDataStreams.map((stream) => ({
        label: `${devicesByID.get(stream.device_id)?.name || "设备"} · ${stream.name} · ${stream.code}`,
        value: stream.id
      })),
    [activeDataStreams, devicesByID]
  );

  useEffect(() => {
    if (form.source_mode === "device" && form.data_type !== "mixed") {
      setForm((current) => ({ ...current, data_type: "mixed" }));
    }
  }, [form.source_mode, form.data_type]);

  useEffect(() => {
    if (form.source_mode !== "data_stream" || form.data_stream_ids.length === 0) {
      return;
    }
    const selectedTypes = new Set(activeDataStreams.filter((stream) => form.data_stream_ids.includes(stream.id)).map((stream) => stream.type));
    if (selectedTypes.size === 1) {
      const [onlyType] = Array.from(selectedTypes);
      if ((onlyType === "telemetry" || onlyType === "image") && form.data_type !== onlyType) {
        setForm((current) => ({ ...current, data_type: onlyType }));
      }
    } else if (selectedTypes.size > 1 && form.data_type !== "mixed") {
      setForm((current) => ({ ...current, data_type: "mixed" }));
    }
  }, [activeDataStreams, form.data_stream_ids, form.data_type, form.source_mode]);

  const selectedSources = useMemo<DatasetSourceInput[]>(
    () =>
      form.source_mode === "device"
        ? form.source_device_ids.map((sourceId) => ({ source_type: "device", source_id: sourceId }))
        : form.data_stream_ids.map((sourceId) => ({ source_type: "data_stream", source_id: sourceId })),
    [form.data_stream_ids, form.source_device_ids, form.source_mode]
  );
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
        sources: selectedSources
      }),
    onSuccess: () => {
      setCreateOpen(false);
      setForm(emptyDatasetForm());
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
  const exportDataset = useMutation({
    mutationFn: (datasetId: string) => datasetsApi.exportDataset(datasetId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["export-jobs", selectedWorkspaceId] });
      void message.success("导出任务已创建");
    }
  });
  const projectOptions = useMemo(() => toOptions(projects.data?.items ?? [], "不绑定项目"), [projects.data?.items]);
  const streamLoading = streamQueries.some((streamQuery) => streamQuery.isLoading);
  const streamError = streamQueries.find((streamQuery) => streamQuery.error)?.error;

  function handleCreateDataset() {
    if (selectedSources.length === 0) {
      void message.warning(form.source_mode === "device" ? "请选择至少一台设备" : "请选择至少一条数据流");
      return;
    }
    create.mutate();
  }

  function closeCreateModal() {
    if (create.isPending) {
      return;
    }
    setCreateOpen(false);
  }

  return (
    <>
      <ResourcePageFrame
        actions={
          <AntButton icon={<Plus size={16} />} onClick={() => setCreateOpen(true)} type="primary">
            创建数据集
          </AntButton>
        }
        description="数据集保存查询边界和源定义，大范围数据通过导出任务处理。"
        query={query}
        title="数据集"
      >
        {(items: Dataset[]) => (
          <DataTable<Dataset>
            columns={[
              { key: "name", header: "数据集", render: (item) => <NameCell name={item.name} detail={item.description || datasetTypeLabel(item.data_type)} /> },
              { key: "status", header: "状态", render: (item) => <Badge tone={statusTone(item.status)}>{item.status}</Badge> },
              { key: "range", header: "时间范围", render: (item) => `${formatDateTime(item.time_start)} - ${formatDateTime(item.time_end)}` },
              { key: "sources", header: "源", render: (item) => <DatasetSourcesCell dataset={item} /> },
              { key: "id", header: "ID", render: (item) => <CopyableId value={item.id} /> },
              {
                key: "actions",
                header: "操作",
                width: 280,
                render: (item) => (
                  <div className="row-actions">
                    <Button icon={<Eye size={15} />} onClick={() => setPreviewDataset(item)} variant="primary">
                      查看数据
                    </Button>
                    <Button disabled={exportDataset.isPending} icon={<FileArchive size={15} />} onClick={() => exportDataset.mutate(item.id)}>
                      导出 ZIP
                    </Button>
                    <Button disabled={remove.isPending} icon={<Trash2 size={15} />} onClick={() => remove.mutate(item.id)} variant="danger">
                      删除
                    </Button>
                  </div>
                )
              }
            ]}
            empty="暂无数据集"
            getRowKey={(item) => item.id}
            items={items}
          />
        )}
      </ResourcePageFrame>
      <Modal
        destroyOnHidden
        footer={null}
        onCancel={closeCreateModal}
        open={createOpen}
        title="创建数据集"
        width={880}
      >
        <form className="dataset-create-form" onSubmit={(event) => submit(event, handleCreateDataset)}>
          <div className="dataset-form-section">
            <div className="dataset-form-section-title">
              <strong>基本信息</strong>
            </div>
            <div className="form-grid dataset-form-grid">
              <TextInput label="名称" onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
              <SelectField label="项目" onChange={(event) => setForm({ ...form, project_id: event.target.value })} options={projectOptions} value={form.project_id} />
              <SelectField label="数据类型" onChange={(event) => setForm({ ...form, data_type: event.target.value as DatasetDataType })} options={datasetTypeOptions} value={form.data_type} />
            </div>
          </div>

          <div className="dataset-form-section">
            <div className="dataset-form-section-title">
              <strong>时间范围</strong>
            </div>
            <div className="form-grid dataset-form-grid two-columns">
              <TextInput label="开始时间" onChange={(event) => setForm({ ...form, time_start: event.target.value })} required type="datetime-local" value={form.time_start} />
              <TextInput label="结束时间" onChange={(event) => setForm({ ...form, time_end: event.target.value })} required type="datetime-local" value={form.time_end} />
            </div>
          </div>

          <div className="dataset-form-section">
            <div className="dataset-form-section-title">
              <strong>数据来源</strong>
            </div>
            <div className="dataset-source-builder">
              <Form.Item className="field dataset-source-mode" label="数据来源方式" required>
                <Select
                  className="control"
                  onChange={(value: SourceMode) =>
                    setForm({
                      ...form,
                      data_type: value === "device" ? "mixed" : form.data_type,
                      source_mode: value,
                      source_device_ids: value === "device" ? form.source_device_ids : [],
                      stream_device_ids: value === "data_stream" ? form.stream_device_ids : [],
                      data_stream_ids: value === "data_stream" ? form.data_stream_ids : []
                    })
                  }
                  options={[
                    { label: "按设备", value: "device" },
                    { label: "按数据流", value: "data_stream" }
                  ]}
                  value={form.source_mode}
                />
              </Form.Item>
              {form.source_mode === "device" ? (
                <Form.Item className="field dataset-source-picker" label="选择设备" required>
                  <Select
                    className="control"
                    loading={devices.isLoading}
                    mode="multiple"
                    onChange={(values: string[]) => setForm({ ...form, source_device_ids: values })}
                    optionFilterProp="label"
                    options={deviceOptions}
                    placeholder="选择一台或多台设备"
                    showSearch
                    value={form.source_device_ids}
                  />
                </Form.Item>
              ) : (
                <>
                  <Form.Item className="field dataset-source-picker" label="选择设备" required>
                    <Select
                      className="control"
                      loading={devices.isLoading}
                      mode="multiple"
                      onChange={(values: string[]) =>
                        setForm({
                          ...form,
                          stream_device_ids: values,
                          data_stream_ids: form.data_stream_ids.filter((streamId) => activeDataStreams.some((stream) => values.includes(stream.device_id) && stream.id === streamId))
                        })
                      }
                      optionFilterProp="label"
                      options={deviceOptions}
                      placeholder="先选择包含目标数据流的设备"
                      showSearch
                      value={form.stream_device_ids}
                    />
                  </Form.Item>
                  <Form.Item className="field dataset-source-picker" label="选择数据流" required>
                    <Select
                      className="control"
                      disabled={form.stream_device_ids.length === 0}
                      loading={streamLoading}
                      mode="multiple"
                      onChange={(values: string[]) => setForm({ ...form, data_stream_ids: values })}
                      optionFilterProp="label"
                      options={dataStreamOptions}
                      placeholder="选择具体设备下的空气温度、图片等数据流"
                      showSearch
                      value={form.data_stream_ids}
                    />
                  </Form.Item>
                </>
              )}
            </div>
          </div>

          <div className="dataset-form-section">
            <div className="dataset-form-section-title">
              <strong>说明</strong>
            </div>
            <TextInput label="描述" onChange={(event) => setForm({ ...form, description: event.target.value })} value={form.description} />
          </div>
          <FormSubmitButton disabled={create.isPending} />
          {create.error || devices.error || streamError ? <p className="form-error">{formatApiError(create.error || devices.error || streamError)}</p> : null}
        </form>
      </Modal>
      <DatasetDataDrawer
        dataset={previewDataset}
        exportPending={exportDataset.isPending}
        onClose={() => setPreviewDataset(null)}
        onExport={(dataset) => exportDataset.mutate(dataset.id)}
      />
    </>
  );

  function emptyDatasetForm() {
    return {
      project_id: "",
      name: "",
      description: "",
      data_type: "mixed" as DatasetDataType,
      time_start: "",
      time_end: "",
      source_mode: "device" as SourceMode,
      source_device_ids: [] as string[],
      stream_device_ids: [] as string[],
      data_stream_ids: [] as string[]
    };
  }
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
    limit: "5000",
    stream_device_id: ""
  });
  const query = useQuery({
    queryKey: ["export-jobs", selectedWorkspaceId],
    queryFn: () => exportJobsApi.list({ workspace_id: selectedWorkspaceId, limit: 100 }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const datasets = useQuery({
    queryKey: ["datasets", selectedWorkspaceId],
    queryFn: () => datasetsApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const devices = useQuery({
    queryKey: ["devices", selectedWorkspaceId],
    queryFn: () => devicesApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const exportStreams = useQuery({
    queryKey: ["data-streams", form.stream_device_id],
    queryFn: () => dataStreamsApi.list(form.stream_device_id),
    enabled: Boolean(selectedWorkspaceId && form.stream_device_id && (form.resource_type === "data_stream" || form.resource_type === "media"))
  });
  const datasetOptions = useMemo(
    () => (datasets.data?.items ?? []).map((dataset) => ({ label: `${dataset.name} · ${datasetTypeLabel(dataset.data_type)}`, value: dataset.id })),
    [datasets.data?.items]
  );
  const deviceOptions = useMemo(
    () => (devices.data?.items ?? []).map((device) => ({ label: `${device.name} · ${device.serial_no}`, value: device.id })),
    [devices.data?.items]
  );
  const exportableStreams = useMemo(
    () =>
      (exportStreams.data?.items ?? []).filter((stream) =>
        form.resource_type === "media" ? isMediaStreamType(stream.type) : stream.type === "telemetry" || isMediaStreamType(stream.type)
      ),
    [exportStreams.data?.items, form.resource_type]
  );
  const selectedExportStream = useMemo(
    () => exportableStreams.find((stream) => stream.id === form.resource_id),
    [exportableStreams, form.resource_id]
  );
  const dataStreamOptions = useMemo(
    () =>
      exportableStreams.map((stream) => ({
        label: `${streamTypeLabel(stream.type)} · ${stream.name} · ${stream.code}`,
        value: stream.id
      })),
    [exportableStreams]
  );
  const allowedExportTypeOptions = useMemo(
    () => buildExportTypeOptions(form.resource_type, selectedExportStream),
    [form.resource_type, selectedExportStream]
  );
  const requiresTimeRange = exportTypeRequiresTime(form.export_type);

  useEffect(() => {
    if (allowedExportTypeOptions.length === 0) {
      return;
    }
    if (!allowedExportTypeOptions.some((option) => option.value === form.export_type)) {
      setForm((current) => ({ ...current, export_type: allowedExportTypeOptions[0].value }));
    }
  }, [allowedExportTypeOptions, form.export_type]);

  const create = useMutation({
    mutationFn: () =>
      exportJobsApi.create({
        resource_type: form.resource_type,
        resource_id: form.resource_id.trim(),
        export_type: form.export_type,
        start_time: requiresTimeRange ? optionalIso(form.start_time) : undefined,
        end_time: requiresTimeRange ? optionalIso(form.end_time) : undefined,
        limit: requiresTimeRange ? Number(form.limit) || undefined : undefined
      }),
    onSuccess: () => {
      setForm((current) => ({
        ...current,
        resource_id: "",
        export_type: defaultExportType(current.resource_type),
        start_time: "",
        end_time: "",
        limit: "5000",
        stream_device_id: ""
      }));
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

  function handleResourceTypeChange(resourceType: ExportResourceType) {
    setForm({
      resource_type: resourceType,
      resource_id: "",
      export_type: defaultExportType(resourceType),
      start_time: "",
      end_time: "",
      limit: "5000",
      stream_device_id: ""
    });
  }

  function handleCreateExport() {
    if (!form.resource_id.trim()) {
      void message.warning("请选择导出资源");
      return;
    }
    if (requiresTimeRange && (!form.start_time || !form.end_time)) {
      void message.warning("请选择导出时间范围");
      return;
    }
    create.mutate();
  }

  return (
    <ResourcePageFrame
      createError={create.error || download.error || datasets.error || devices.error || exportStreams.error}
      description="导出任务异步生成文件，成功后可准备临时下载地址。"
      form={
        <form className="export-create-form" onSubmit={(event) => submit(event, handleCreateExport)}>
          <div className="form-grid export-form-grid">
            <Form.Item className="field" label="资源类型" required>
              <Select className="control" onChange={handleResourceTypeChange} options={exportResourceTypeOptions} value={form.resource_type} />
            </Form.Item>
            {form.resource_type === "dataset" ? (
              <Form.Item className="field" label="数据集" required>
                <Select
                  className="control"
                  loading={datasets.isLoading}
                  onChange={(value) => setForm({ ...form, resource_id: value })}
                  optionFilterProp="label"
                  options={datasetOptions}
                  placeholder="选择数据集"
                  showSearch
                  value={form.resource_id || undefined}
                />
              </Form.Item>
            ) : null}
            {form.resource_type === "device" ? (
              <Form.Item className="field" label="设备" required>
                <Select
                  className="control"
                  loading={devices.isLoading}
                  onChange={(value) => setForm({ ...form, resource_id: value })}
                  optionFilterProp="label"
                  options={deviceOptions}
                  placeholder="选择设备"
                  showSearch
                  value={form.resource_id || undefined}
                />
              </Form.Item>
            ) : null}
            {form.resource_type === "data_stream" || form.resource_type === "media" ? (
              <>
                <Form.Item className="field" label="设备" required>
                  <Select
                    className="control"
                    loading={devices.isLoading}
                    onChange={(value) => setForm({ ...form, resource_id: "", stream_device_id: value })}
                    optionFilterProp="label"
                    options={deviceOptions}
                    placeholder="先选择设备"
                    showSearch
                    value={form.stream_device_id || undefined}
                  />
                </Form.Item>
                <Form.Item className="field" label={form.resource_type === "media" ? "媒体数据流" : "数据流"} required>
                  <Select
                    className="control"
                    disabled={!form.stream_device_id}
                    loading={exportStreams.isLoading}
                    onChange={(value) => setForm({ ...form, resource_id: value })}
                    optionFilterProp="label"
                    options={dataStreamOptions}
                    placeholder={form.resource_type === "media" ? "选择图片、视频或音频流" : "选择遥测或媒体数据流"}
                    showSearch
                    value={form.resource_id || undefined}
                  />
                </Form.Item>
              </>
            ) : null}
            <Form.Item className="field" label="导出类型" required>
              <Select
                className="control"
                disabled={allowedExportTypeOptions.length === 0}
                onChange={(value: ExportType) => setForm({ ...form, export_type: value })}
                options={allowedExportTypeOptions}
                value={form.export_type}
              />
            </Form.Item>
            {requiresTimeRange ? (
              <>
                <TextInput label="开始时间" onChange={(event) => setForm({ ...form, start_time: event.target.value })} required type="datetime-local" value={form.start_time} />
                <TextInput label="结束时间" onChange={(event) => setForm({ ...form, end_time: event.target.value })} required type="datetime-local" value={form.end_time} />
                <TextInput label="行数上限" min={1} onChange={(event) => setForm({ ...form, limit: event.target.value })} type="number" value={form.limit} />
              </>
            ) : null}
          </div>
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
    template_code: "viewer",
    permission_codes: [] as PermissionCode[],
    scope_type: "workspace" as AccessGrantScopeType,
    scope_id: "",
    expires_at: "",
    allow_reshare: false,
    allow_api_access: false
  });
  const projects = useQuery({
    queryKey: ["projects", selectedWorkspaceId],
    queryFn: () => projectsApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });
  const sites = useQuery({
    queryKey: ["sites", selectedWorkspaceId, "all"],
    queryFn: () => sitesApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const devices = useQuery({
    queryKey: ["devices", selectedWorkspaceId],
    queryFn: () => devicesApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const datasets = useQuery({
    queryKey: ["datasets", selectedWorkspaceId],
    queryFn: () => datasetsApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const query = useQuery({
    queryKey: ["access-grants", selectedWorkspaceId],
    queryFn: () => accessGrantsApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });
  const mine = useQuery({ queryKey: ["access-grants", "mine"], queryFn: accessGrantsApi.listMine });
  const catalog = useQuery({
    queryKey: ["permissions-catalog"],
    queryFn: permissionsApi.catalog
  });
  const allowedScopeOptions = useMemo(
    () => scopeTypeOptions.filter((option) => accessGrantAllowedScopes(form.template_code).includes(option.value)),
    [form.template_code]
  );
  const scopeOptions = useMemo(
    () => buildScopeResourceOptions(form.scope_type, selectedWorkspaceId, projects.data?.items ?? [], sites.data?.items ?? [], devices.data?.items ?? [], datasets.data?.items ?? []),
    [datasets.data?.items, devices.data?.items, form.scope_type, projects.data?.items, selectedWorkspaceId, sites.data?.items]
  );
  const scopeLabels = useMemo(
    () => buildScopeLabelMap(selectedWorkspaceId, projects.data?.items ?? [], sites.data?.items ?? [], devices.data?.items ?? [], datasets.data?.items ?? []),
    [datasets.data?.items, devices.data?.items, projects.data?.items, selectedWorkspaceId, sites.data?.items]
  );

  useEffect(() => {
    if (form.scope_type === "workspace" && selectedWorkspaceId && form.scope_id !== selectedWorkspaceId) {
      setForm((current) => ({ ...current, scope_id: selectedWorkspaceId }));
    }
  }, [form.scope_id, form.scope_type, selectedWorkspaceId]);
  useEffect(() => {
    if (catalog.data && form.permission_codes.length === 0) {
      setForm((current) => ({ ...current, permission_codes: templatePermissionCodes(catalog.data, current.template_code) }));
    }
  }, [catalog.data, form.permission_codes.length, form.template_code]);
  const create = useMutation({
    mutationFn: () =>
      accessGrantsApi.create({
        [subjectKind]: form.subject.trim(),
        template_code: form.template_code,
        permission_codes: form.permission_codes,
        scope_type: form.scope_type,
        scope_id: form.scope_id.trim(),
        expires_at: optionalIso(form.expires_at),
        allow_reshare: form.allow_reshare,
        allow_api_access: form.allow_api_access
      }),
    onSuccess: () => {
      setForm({
        subject: "",
        template_code: "viewer",
        permission_codes: templatePermissionCodes(catalog.data, "viewer"),
        scope_type: "workspace",
        scope_id: "",
        expires_at: "",
        allow_reshare: false,
        allow_api_access: false
      });
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

  function handleTemplateChange(templateCode: string) {
    const allowedScopes = accessGrantAllowedScopes(templateCode);
    const scopeType = allowedScopes.includes(form.scope_type) ? form.scope_type : allowedScopes[0];
    setForm({
      ...form,
      template_code: templateCode,
      permission_codes: templateCode === "custom" ? form.permission_codes : templatePermissionCodes(catalog.data, templateCode),
      scope_type: scopeType,
      scope_id: scopeType === "workspace" ? selectedWorkspaceId : ""
    });
  }

  function handleScopeTypeChange(scopeType: AccessGrantScopeType) {
    setForm({ ...form, scope_type: scopeType, scope_id: scopeType === "workspace" ? selectedWorkspaceId : "" });
  }

  function handleCreateGrant() {
    if (form.template_code === "service_engineer") {
      if (form.scope_type !== "device" && form.scope_type !== "site") {
        void message.warning("服务工程师只能授权到设备或站点");
        return;
      }
      if (!form.expires_at) {
        void message.warning("服务工程师授权必须设置过期时间");
        return;
      }
    }
    if (!form.scope_id.trim()) {
      void message.warning("请选择或填写授权范围");
      return;
    }
    if (!form.permission_codes.length) {
      void message.warning("请选择权限");
      return;
    }
    create.mutate();
  }

  return (
    <Page description="资源授权用于外部协作者、临时售后或单个资源分享；长期内部人员请加入工作区成员。" title="资源授权">
      <Section title="创建资源授权">
        <form className="form-grid" onSubmit={(event) => submit(event, handleCreateGrant)}>
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
          <Form.Item className="field" label="范围类型">
            <Select className="control" onChange={handleScopeTypeChange} options={allowedScopeOptions} value={form.scope_type} />
          </Form.Item>
          <Form.Item className="field" label="选择范围" required>
            <Select
              className="control"
              disabled={form.scope_type === "workspace"}
              loading={projects.isLoading || sites.isLoading || devices.isLoading || datasets.isLoading}
              onChange={(value) => setForm({ ...form, scope_id: value })}
              optionFilterProp="label"
              options={scopeOptions}
              placeholder="从资源列表选择"
              showSearch
              value={form.scope_id || undefined}
            />
          </Form.Item>
          <TextInput label="或粘贴范围 ID" onChange={(event) => setForm({ ...form, scope_id: event.target.value })} required value={form.scope_id} />
          <TextInput label={form.template_code === "service_engineer" ? "过期时间 (必填)" : "过期时间"} onChange={(event) => setForm({ ...form, expires_at: event.target.value })} required={form.template_code === "service_engineer"} type="datetime-local" value={form.expires_at} />
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
          <FormSubmitButton disabled={create.isPending || !form.permission_codes.length} />
        </form>
        <PermissionPicker
          catalog={catalog.data}
          mode="grant"
          onChange={(permissionCodes) => setForm((current) => ({ ...current, permission_codes: permissionCodes }))}
          onTemplateChange={handleTemplateChange}
          templateCode={form.template_code}
          value={form.permission_codes}
        />
        {create.error || revoke.error ? <p className="form-error">{formatApiError(create.error || revoke.error)}</p> : null}
      </Section>
      <Section title="工作区授权">
        <GrantTable catalog={catalog.data} query={query} revoke={(id) => revoke.mutate(id)} scopeLabels={scopeLabels} />
      </Section>
      <Section title="授予我的资源">
        <GrantTable catalog={catalog.data} query={mine} revoke={null} scopeLabels={scopeLabels} />
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
    template_code: "viewer",
    permission_codes: [] as PermissionCode[],
    scope_type: "workspace" as AccessGrantScopeType,
    scope_id: "",
    expires_at: ""
  });
  const projects = useQuery({
    queryKey: ["projects", selectedWorkspaceId],
    queryFn: () => projectsApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });
  const sites = useQuery({
    queryKey: ["sites", selectedWorkspaceId, "all"],
    queryFn: () => sitesApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const devices = useQuery({
    queryKey: ["devices", selectedWorkspaceId],
    queryFn: () => devicesApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const datasets = useQuery({
    queryKey: ["datasets", selectedWorkspaceId],
    queryFn: () => datasetsApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const query = useQuery({
    queryKey: ["invitations", selectedWorkspaceId],
    queryFn: () => invitationsApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });
  const mine = useQuery({ queryKey: ["invitations", "mine"], queryFn: invitationsApi.listMine });
  const catalog = useQuery({
    queryKey: ["permissions-catalog"],
    queryFn: permissionsApi.catalog
  });
  const allowedScopeOptions = useMemo(
    () => scopeTypeOptions.filter((option) => accessGrantAllowedScopes(form.template_code).includes(option.value)),
    [form.template_code]
  );
  const scopeOptions = useMemo(
    () => buildScopeResourceOptions(form.scope_type, selectedWorkspaceId, projects.data?.items ?? [], sites.data?.items ?? [], devices.data?.items ?? [], datasets.data?.items ?? []),
    [datasets.data?.items, devices.data?.items, form.scope_type, projects.data?.items, selectedWorkspaceId, sites.data?.items]
  );
  const scopeLabels = useMemo(
    () => buildScopeLabelMap(selectedWorkspaceId, projects.data?.items ?? [], sites.data?.items ?? [], devices.data?.items ?? [], datasets.data?.items ?? []),
    [datasets.data?.items, devices.data?.items, projects.data?.items, selectedWorkspaceId, sites.data?.items]
  );

  useEffect(() => {
    if (form.scope_type === "workspace" && selectedWorkspaceId && form.scope_id !== selectedWorkspaceId) {
      setForm((current) => ({ ...current, scope_id: selectedWorkspaceId }));
    }
  }, [form.scope_id, form.scope_type, selectedWorkspaceId]);
  useEffect(() => {
    if (catalog.data && form.permission_codes.length === 0) {
      setForm((current) => ({ ...current, permission_codes: templatePermissionCodes(catalog.data, current.template_code) }));
    }
  }, [catalog.data, form.permission_codes.length, form.template_code]);

  const create = useMutation({
    mutationFn: () =>
      invitationsApi.create({
        [targetKind]: form.target.trim(),
        template_code: form.template_code,
        permission_codes: form.permission_codes,
        scope_type: form.scope_type,
        scope_id: form.scope_id.trim(),
        expires_at: optionalIso(form.expires_at)
      }),
    onSuccess: () => {
      setForm({
        target: "",
        template_code: "viewer",
        permission_codes: templatePermissionCodes(catalog.data, "viewer"),
        scope_type: "workspace",
        scope_id: "",
        expires_at: ""
      });
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

  function handleTemplateChange(templateCode: string) {
    const allowedScopes = accessGrantAllowedScopes(templateCode);
    const scopeType = allowedScopes.includes(form.scope_type) ? form.scope_type : allowedScopes[0];
    setForm({
      ...form,
      template_code: templateCode,
      permission_codes: templateCode === "custom" ? form.permission_codes : templatePermissionCodes(catalog.data, templateCode),
      scope_type: scopeType,
      scope_id: scopeType === "workspace" ? selectedWorkspaceId : ""
    });
  }

  function handleScopeTypeChange(scopeType: AccessGrantScopeType) {
    setForm({ ...form, scope_type: scopeType, scope_id: scopeType === "workspace" ? selectedWorkspaceId : "" });
  }

  function handleCreateInvitation() {
    if (form.template_code === "service_engineer") {
      if (form.scope_type !== "device" && form.scope_type !== "site") {
        void message.warning("服务工程师只能邀请到设备或站点范围");
        return;
      }
      if (!form.expires_at) {
        void message.warning("服务工程师邀请必须设置过期时间");
        return;
      }
    }
    if (!form.scope_id.trim()) {
      void message.warning("请选择或填写邀请范围");
      return;
    }
    if (!form.permission_codes.length) {
      void message.warning("请选择权限");
      return;
    }
    create.mutate();
  }

  return (
    <Page description="邀请用于把资源分享给尚未加入平台或未注册的邮箱/手机号。" title="邀请">
      <Section title="创建资源邀请">
        <form className="form-grid" onSubmit={(event) => submit(event, handleCreateInvitation)}>
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
          <Form.Item className="field" label="范围类型">
            <Select className="control" onChange={handleScopeTypeChange} options={allowedScopeOptions} value={form.scope_type} />
          </Form.Item>
          <Form.Item className="field" label="选择范围" required>
            <Select
              className="control"
              disabled={form.scope_type === "workspace"}
              loading={projects.isLoading || sites.isLoading || devices.isLoading || datasets.isLoading}
              onChange={(value) => setForm({ ...form, scope_id: value })}
              optionFilterProp="label"
              options={scopeOptions}
              placeholder="从资源列表选择"
              showSearch
              value={form.scope_id || undefined}
            />
          </Form.Item>
          <TextInput label="或粘贴范围 ID" onChange={(event) => setForm({ ...form, scope_id: event.target.value })} required value={form.scope_id} />
          <TextInput label={form.template_code === "service_engineer" ? "过期时间 (必填)" : "过期时间"} onChange={(event) => setForm({ ...form, expires_at: event.target.value })} required={form.template_code === "service_engineer"} type="datetime-local" value={form.expires_at} />
          <FormSubmitButton disabled={create.isPending || !form.permission_codes.length} />
        </form>
        <PermissionPicker
          catalog={catalog.data}
          mode="grant"
          onChange={(permissionCodes) => setForm((current) => ({ ...current, permission_codes: permissionCodes }))}
          onTemplateChange={handleTemplateChange}
          templateCode={form.template_code}
          value={form.permission_codes}
        />
        {create.error || accept.error || revoke.error ? (
          <p className="form-error">{formatApiError(create.error || accept.error || revoke.error)}</p>
        ) : null}
      </Section>
      <Section title="工作区邀请">
        <InvitationTable accept={null} catalog={catalog.data} query={query} revoke={(id) => revoke.mutate(id)} scopeLabels={scopeLabels} />
      </Section>
      <Section title="我的待处理邀请">
        <InvitationTable accept={(id) => accept.mutate(id)} catalog={catalog.data} query={mine} revoke={null} scopeLabels={scopeLabels} />
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

interface DatasetTelemetryQueryInput {
  datasetId: string;
  startTime: string;
  endTime: string;
  limit: number;
}

interface DatasetTelemetryRow {
  key: string;
  sourceType: string;
  sourceID: string;
  dataStreamID: string;
  deviceID: string;
  streamName: string;
  streamCode: string;
  timestamp: string;
  value: number;
  unit?: string;
  quality: string;
}

function DatasetDataDrawer({
  dataset,
  exportPending,
  onClose,
  onExport
}: {
  dataset: Dataset | null;
  exportPending: boolean;
  onClose: () => void;
  onExport: (dataset: Dataset) => void;
}) {
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [limit, setLimit] = useState(DATASET_PREVIEW_LIMIT);
  const canPreviewTelemetry = Boolean(dataset && canViewDatasetTelemetry(dataset));
  const telemetry = useMutation({
    mutationFn: (input: DatasetTelemetryQueryInput) =>
      datasetsApi.queryTelemetry(input.datasetId, {
        start_time: input.startTime,
        end_time: input.endTime,
        limit: input.limit
      })
  });
  const rows = useMemo(() => flattenDatasetTelemetryRows(telemetry.data), [telemetry.data]);
  const warnings = useMemo(() => collectDatasetWarnings(telemetry.data), [telemetry.data]);
  const columns = useMemo<TableColumnsType<DatasetTelemetryRow>>(
    () => [
      {
        key: "stream",
        title: "数据流",
        width: 220,
        render: (_, row) => <NameCell name={row.streamName} detail={row.streamCode} />
      },
      {
        key: "source",
        title: "来源",
        width: 150,
        render: (_, row) => <Tag>{sourceTypeLabel(row.sourceType)}</Tag>
      },
      {
        key: "device",
        title: "设备 ID",
        width: 240,
        render: (_, row) => <CopyableId value={row.deviceID} />
      },
      {
        key: "time",
        title: "时间",
        width: 200,
        render: (_, row) => <Typography.Text className="mono">{formatDateTime(row.timestamp)}</Typography.Text>
      },
      {
        key: "value",
        title: "值",
        width: 140,
        render: (_, row) => <Typography.Text strong>{formatTelemetryValue(row.value)}</Typography.Text>
      },
      {
        key: "unit",
        title: "单位",
        width: 100,
        render: (_, row) => row.unit || "-"
      },
      {
        key: "quality",
        title: "质量",
        width: 120,
        render: (_, row) => <Tag color={row.quality === "valid" ? "success" : "warning"}>{row.quality}</Tag>
      },
      {
        key: "data_stream_id",
        title: "DataStream ID",
        width: 240,
        render: (_, row) => <CopyableId value={row.dataStreamID} />
      }
    ],
    []
  );

  useEffect(() => {
    if (!dataset) {
      setRange(null);
      setLimit(DATASET_PREVIEW_LIMIT);
      telemetry.reset();
      return;
    }
    const nextRange: [Dayjs, Dayjs] = [dayjs(dataset.time_start), dayjs(dataset.time_end)];
    setRange(nextRange);
    setLimit(DATASET_PREVIEW_LIMIT);
    telemetry.reset();
    if (canViewDatasetTelemetry(dataset)) {
      telemetry.mutate({
        datasetId: dataset.id,
        startTime: nextRange[0].toISOString(),
        endTime: nextRange[1].toISOString(),
        limit: DATASET_PREVIEW_LIMIT
      });
    }
  }, [dataset?.id]);

  function handleQuery() {
    if (!dataset || !range) {
      return;
    }
    telemetry.mutate({
      datasetId: dataset.id,
      startTime: range[0].toISOString(),
      endTime: range[1].toISOString(),
      limit
    });
  }

  return (
    <Drawer
      className="dataset-preview-drawer"
      extra={
        dataset ? (
          <Space size={8} wrap>
            <AntButton icon={<FileArchive size={15} />} loading={exportPending} onClick={() => onExport(dataset)}>
              导出 ZIP
            </AntButton>
            <AntButton disabled={!canPreviewTelemetry || !range} icon={<ChartLine size={15} />} loading={telemetry.isPending} onClick={handleQuery} type="primary">
              查询
            </AntButton>
          </Space>
        ) : null
      }
      onClose={onClose}
      open={Boolean(dataset)}
      title={dataset ? <NameCell name={dataset.name} detail={dataset.description || datasetTypeLabel(dataset.data_type)} /> : "数据集数据"}
      width={1040}
    >
      {dataset ? (
        <div className="dataset-preview-body">
          <Descriptions bordered column={{ lg: 3, md: 2, sm: 1, xs: 1 }} size="small">
            <Descriptions.Item label="状态">
              <Badge tone={statusTone(dataset.status)}>{dataset.status}</Badge>
            </Descriptions.Item>
            <Descriptions.Item label="数据类型">{datasetTypeLabel(dataset.data_type)}</Descriptions.Item>
            <Descriptions.Item label="来源">{describeDatasetSources(dataset)}</Descriptions.Item>
            <Descriptions.Item label="时间范围" span={2}>
              {formatDateTime(dataset.time_start)} - {formatDateTime(dataset.time_end)}
            </Descriptions.Item>
            <Descriptions.Item label="数据集 ID">
              <CopyableId value={dataset.id} />
            </Descriptions.Item>
          </Descriptions>

          <div className="dataset-preview-sources">
            {dataset.sources.slice(0, 6).map((source) => (
              <div className="dataset-preview-source" key={source.id}>
                <span>{sourceTypeLabel(source.source_type)}</span>
                <CopyableId value={source.source_id} />
              </div>
            ))}
            {dataset.sources.length > 6 ? <span className="dataset-preview-more">+{dataset.sources.length - 6}</span> : null}
          </div>

          {canPreviewTelemetry ? (
            <>
              <div className="dataset-preview-toolbar">
                <Form.Item className="field dataset-preview-range" label="时间范围" required>
                  <DatePicker.RangePicker
                    className="control"
                    onChange={(value) => setRange(value && value[0] && value[1] ? [value[0], value[1]] : null)}
                    showTime
                    value={range}
                  />
                </Form.Item>
                <Form.Item className="field dataset-preview-limit" label="结果上限">
                  <InputNumber className="control" max={5000} min={1} onChange={(value) => setLimit(Number(value || DATASET_PREVIEW_LIMIT))} value={limit} />
                </Form.Item>
              </div>

              {telemetry.error ? <Alert message={formatApiError(telemetry.error)} showIcon type="error" /> : null}
              {warnings.length > 0 ? (
                <div className="warning-stack">
                  {warnings.map((warning) => (
                    <Alert key={`${warning.code}-${warning.message}`} message={warning.message} showIcon type="warning" />
                  ))}
                </div>
              ) : null}

              <Tabs
                className="result-tabs"
                items={[
                  {
                    children: telemetry.data ? (
                      <DatasetTelemetryCharts result={telemetry.data} />
                    ) : (
                      <Empty description="提交查询后显示数据图表" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ),
                    key: "charts",
                    label: `图表 (${telemetry.data?.series.length ?? 0})`
                  },
                  {
                    children: telemetry.data ? (
                      <Table<DatasetTelemetryRow>
                        className="data-table telemetry-result-table"
                        columns={columns}
                        dataSource={rows}
                        loading={telemetry.isPending}
                        locale={{ emptyText: "这个时间范围内没有可显示的遥测记录" }}
                        pagination={{ pageSize: 50, showSizeChanger: true }}
                        rowKey={(row) => row.key}
                        scroll={{ x: tableScrollX(columns) }}
                        size="middle"
                        tableLayout="fixed"
                      />
                    ) : (
                      <Empty description="提交查询后显示明细表" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ),
                    key: "detail",
                    label: `明细 (${rows.length})`
                  }
                ]}
              />
            </>
          ) : (
            <Alert
              message="当前仅支持遥测数据在线查看"
              description="图片、视频、音频、事件和日志数据集请使用导出 ZIP 获取完整数据。"
              showIcon
              type="info"
            />
          )}
        </div>
      ) : null}
    </Drawer>
  );
}

function DatasetTelemetryCharts({ result }: { result: DatasetTelemetryQueryResponse }) {
  if (result.series.length === 0) {
    return <Empty description="这个时间范围内没有可绘制的数据流" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <div className="telemetry-chart-list">
      {result.series.map((series) => (
        <div className="telemetry-series-panel" key={`${series.source_type}-${series.source_id}-${series.data_stream_id}`}>
          <div className="telemetry-series-header">
            <div className="telemetry-series-title">
              <Typography.Text strong>{series.name}</Typography.Text>
              <Typography.Text className="mono" type="secondary">
                {series.code}
              </Typography.Text>
            </div>
            <Space className="telemetry-series-meta" size={[6, 6]} wrap>
              <Tag>{sourceTypeLabel(series.source_type)}</Tag>
              {series.unit ? <Tag color="processing">{series.unit}</Tag> : null}
              <Tag>{series.points.length} 条记录</Tag>
            </Space>
          </div>
          <DatasetTelemetrySeriesChart series={series} />
        </div>
      ))}
    </div>
  );
}

function DatasetTelemetrySeriesChart({ series }: { series: DatasetTelemetrySeries }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const hasPoints = series.points.length > 0;

  useEffect(() => {
    if (!chartRef.current || !hasPoints) {
      return undefined;
    }

    const chart = init(chartRef.current, undefined, { renderer: "canvas" });
    chart.setOption(buildDatasetTelemetryChartOption(series), true);

    const resize = () => chart.resize();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
    observer?.observe(chartRef.current);
    window.addEventListener("resize", resize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [hasPoints, series]);

  if (!hasPoints) {
    return <Empty className="telemetry-chart-empty" description="这个时间范围内没有可绘制的遥测记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return <div aria-label={`${series.name}趋势图`} className="telemetry-chart" ref={chartRef} />;
}

function ScopeCell({ scopeID, scopeLabels, scopeType }: { scopeID: string; scopeLabels: Map<string, string>; scopeType: AccessGrantScopeType }) {
  return (
    <div className="scope-cell">
      <strong>{scopeLabels.get(scopeKey(scopeType, scopeID)) || `${scopeTypeLabel(scopeType)} · 未命名资源`}</strong>
      <CopyableId value={scopeID} />
    </div>
  );
}

function accessGrantAllowedScopes(templateCode: string): AccessGrantScopeType[] {
  return accessRoleMeta[templateCode as keyof typeof accessRoleMeta]?.allowedScopes ?? ["workspace", "project", "site", "device", "dataset"];
}

function templatePermissionCodes(catalog: PermissionCatalogResponse | undefined, templateCode: string): PermissionCode[] {
  return catalog?.templates.find((template) => template.code === templateCode)?.permission_codes ?? [];
}

function buildScopeResourceOptions(
  scopeType: AccessGrantScopeType,
  workspaceID: string,
  projects: Project[],
  sites: Site[],
  devices: Device[],
  datasets: Dataset[]
) {
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

function scopeKey(scopeType: AccessGrantScopeType, scopeID: string) {
  return `${scopeType}:${scopeID}`;
}

function scopeTypeLabel(scopeType: AccessGrantScopeType) {
  return scopeTypeOptions.find((option) => option.value === scopeType)?.label || scopeType;
}

function ResourcePageFrame<T>({
  actions,
  children,
  createError,
  description,
  filters,
  form,
  query,
  title
}: {
  actions?: ReactNode;
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
    <Page
      actions={
        <Space size={8} wrap>
          {actions}
          <AntButton icon={<RefreshCcw size={16} />} onClick={() => void query.refetch()}>
            刷新
          </AntButton>
        </Space>
      }
      description={description}
      title={title}
    >
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
  catalog,
  query,
  revoke,
  scopeLabels
}: {
  catalog?: PermissionCatalogResponse;
  query: { data?: { items: AccessGrant[] }; error: unknown; isLoading: boolean; refetch: () => unknown };
  revoke: ((id: string) => void) | null;
  scopeLabels: Map<string, string>;
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
        { key: "permissions", header: "权限", render: (item) => <PermissionSummary catalog={catalog} codes={item.permission_codes} /> },
        { key: "template", header: "模板", render: (item) => <Tag>{item.template_name || roleLabel(item.template_code)}</Tag> },
        { key: "scope", header: "范围", render: (item) => <ScopeCell scopeID={item.scope_id} scopeLabels={scopeLabels} scopeType={item.scope_type} /> },
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
  catalog,
  query,
  revoke,
  scopeLabels
}: {
  accept: ((id: string) => void) | null;
  catalog?: PermissionCatalogResponse;
  query: { data?: { items: Invitation[] }; error: unknown; isLoading: boolean; refetch: () => unknown };
  revoke: ((id: string) => void) | null;
  scopeLabels: Map<string, string>;
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
        { key: "permissions", header: "权限", render: (item) => <PermissionSummary catalog={catalog} codes={item.permission_codes} /> },
        { key: "template", header: "模板", render: (item) => <Tag>{item.template_name || roleLabel(item.template_code)}</Tag> },
        { key: "scope", header: "范围", render: (item) => <ScopeCell scopeID={item.scope_id} scopeLabels={scopeLabels} scopeType={item.scope_type} /> },
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

function DatasetSourcesCell({ dataset }: { dataset: Dataset }) {
  const deviceCount = dataset.sources.filter((source) => source.source_type === "device").length;
  const streamCount = dataset.sources.filter((source) => source.source_type === "data_stream").length;
  const fileCount = dataset.sources.filter((source) => source.source_type === "file").length;
  const parts = [
    deviceCount ? `设备 ${deviceCount} 个` : "",
    streamCount ? `数据流 ${streamCount} 条` : "",
    fileCount ? `文件 ${fileCount} 个` : ""
  ].filter(Boolean);

  return (
    <div className="dataset-source-cell">
      <strong>{parts.join(" · ") || "无来源"}</strong>
      <div className="dataset-source-ids">
        {dataset.sources.slice(0, 2).map((source) => (
          <CopyableId key={source.id} value={source.source_id} />
        ))}
        {dataset.sources.length > 2 ? <span>+{dataset.sources.length - 2}</span> : null}
      </div>
    </div>
  );
}

function describeDatasetSources(dataset: Dataset): string {
  const deviceCount = dataset.sources.filter((source) => source.source_type === "device").length;
  const streamCount = dataset.sources.filter((source) => source.source_type === "data_stream").length;
  const fileCount = dataset.sources.filter((source) => source.source_type === "file").length;
  return [
    deviceCount ? `设备 ${deviceCount}` : "",
    streamCount ? `数据流 ${streamCount}` : "",
    fileCount ? `文件 ${fileCount}` : ""
  ].filter(Boolean).join(" · ") || "无来源";
}

function canViewDatasetTelemetry(dataset: Dataset): boolean {
  return dataset.data_type === "telemetry" || dataset.data_type === "mixed";
}

function buildDatasetTelemetryChartOption(series: DatasetTelemetrySeries): EChartsOption {
  return {
    animation: false,
    color: ["#0e7c86"],
    dataZoom: [
      { type: "inside", throttle: 80 },
      { bottom: 0, height: 24, type: "slider" }
    ],
    grid: { bottom: 48, containLabel: true, left: 18, right: 18, top: 20 },
    series: [
      {
        data: series.points.map((point) => [point.ts, point.value]),
        name: `${series.name}${series.unit ? ` (${series.unit})` : ""}`,
        showSymbol: false,
        smooth: true,
        type: "line"
      }
    ],
    tooltip: {
      axisPointer: { type: "cross" },
      trigger: "axis"
    },
    xAxis: {
      axisLabel: { hideOverlap: true },
      type: "time"
    },
    yAxis: {
      name: series.unit || undefined,
      nameGap: 14,
      scale: true,
      type: "value"
    }
  };
}

function flattenDatasetTelemetryRows(result?: DatasetTelemetryQueryResponse): DatasetTelemetryRow[] {
  if (!result) {
    return [];
  }
  return result.series.flatMap((series) =>
    series.points.map((point, index) => ({
      key: `${series.source_type}-${series.source_id}-${series.data_stream_id}-${point.ts}-${index}`,
      sourceType: series.source_type,
      sourceID: series.source_id,
      dataStreamID: series.data_stream_id,
      deviceID: series.device_id,
      streamName: series.name,
      streamCode: series.code,
      timestamp: point.ts,
      value: point.value,
      unit: series.unit,
      quality: point.quality
    }))
  );
}

function collectDatasetWarnings(result?: DatasetTelemetryQueryResponse) {
  const seen = new Set<string>();
  const warnings: Array<{ code: string; message: string; count?: number }> = [];
  for (const series of result?.series ?? []) {
    for (const warning of series.warnings ?? []) {
      const key = `${warning.code}:${warning.message}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      warnings.push(warning);
    }
  }
  return warnings;
}

function formatTelemetryValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function datasetTypeLabel(value: DatasetDataType): string {
  return datasetTypeOptions.find((option) => option.value === value)?.label || value;
}

function sourceTypeLabel(value: string): string {
  switch (value) {
    case "device":
      return "设备";
    case "data_stream":
      return "数据流";
    case "file":
      return "文件";
    default:
      return value;
  }
}

function streamTypeLabel(value: DataStream["type"]): string {
  switch (value) {
    case "telemetry":
      return "遥测";
    case "image":
      return "图片";
    case "video":
      return "视频";
    case "audio":
      return "音频";
    case "event":
      return "事件";
    case "log":
      return "日志";
    default:
      return value;
  }
}

function isMediaStreamType(value: DataStream["type"]): boolean {
  return value === "image" || value === "video" || value === "audio";
}

function defaultExportType(resourceType: ExportResourceType): ExportType {
  switch (resourceType) {
    case "dataset":
      return "dataset_zip";
    case "media":
      return "media_zip";
    default:
      return "telemetry_csv";
  }
}

function buildExportTypeOptions(resourceType: ExportResourceType, stream?: DataStream): Array<{ label: string; value: ExportType }> {
  let allowed: ExportType[];
  if (resourceType === "dataset") {
    allowed = ["dataset_zip"];
  } else if (resourceType === "device") {
    allowed = ["telemetry_csv", "telemetry_excel", "media_zip"];
  } else if (resourceType === "media") {
    allowed = ["media_zip"];
  } else if (!stream) {
    allowed = [];
  } else if (stream.type === "telemetry") {
    allowed = ["telemetry_csv", "telemetry_excel"];
  } else if (isMediaStreamType(stream.type)) {
    allowed = ["media_zip"];
  } else {
    allowed = [];
  }
  return exportTypeOptions.filter((option) => allowed.includes(option.value));
}

function exportTypeRequiresTime(exportType: ExportType): boolean {
  return exportType === "telemetry_csv" || exportType === "telemetry_excel" || exportType === "media_zip";
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
