import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { CloudSyncOutlined, DatabaseOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Transfer,
  Typography
} from "antd";
import type { TableColumnsType, TransferProps } from "antd";
import {
  adminCamerasApi,
  adminDeviceCapabilityDefinitionsApi,
  adminDevicesApi,
  adminDataSourcesApi,
  adminProjectsApi,
  adminSitesApi,
  adminSystemRolesApi,
  adminWorkspacesApi,
  formatApiError,
  type DataSource,
  type DataSourceStatus,
  type DataSourceType,
  type Device,
  type CameraBindingStatus,
  type CameraQuality,
  type DeviceCapabilityCode,
  type DeviceCapabilityDefinition,
  type DeviceCapabilityDefinitionStatus,
  type DeviceChild,
  type DeviceLifecycleEvent,
  type DeviceLifecycleStatus,
  type SystemRoleDefinition,
  type THCPNGatewaySyncResult,
  type THCPNStandardStationSyncResult
} from "../../api";
import { formatDateTime, labelOrDash } from "../../app/format";
import { copyableId, statusColor, tableScrollX } from "../../app/ui";

const dataSourceTypeOptions: Array<{ label: string; value: DataSourceType }> = [
  { label: "MySQL", value: "mysql" },
  { label: "PostgreSQL", value: "postgres" },
  { label: "ClickHouse", value: "clickhouse" },
  { label: "HTTP API", value: "http_api" },
  { label: "文件", value: "file" }
];

const lifecycleOptions: Array<{ label: string; value: DeviceLifecycleStatus }> = [
  { label: "入库", value: "inbound" },
  { label: "安装", value: "installed" },
  { label: "上线", value: "online" },
  { label: "维护", value: "maintenance" },
  { label: "维修", value: "repairing" },
  { label: "报废", value: "retired" }
];

const deviceStatusOptions: Array<{ label: string; value: Device["status"] }> = [
  { label: "active", value: "active" },
  { label: "disabled", value: "disabled" },
  { label: "retired", value: "retired" }
];

const cameraQualityOptions: Array<{ label: string; value: CameraQuality }> = [
  { label: "流畅", value: "fluent" },
  { label: "标清", value: "standard" },
  { label: "高清", value: "hd" },
  { label: "超清", value: "ultra_hd" }
];

const emptyDevices: Device[] = [];

interface CreateDataSourceValues {
  name: string;
  type: DataSourceType;
  dsn_secret_ref: string;
}

interface SyncTHCPNValues {
  data_source_id: string;
  external_device_id: number;
  product_id?: string;
  serial_no?: string;
  name?: string;
}

interface SyncTHCPNGatewayValues {
  data_source_id: string;
  external_gateway_id: number;
  target_workspace_id?: string;
  project_id?: string;
  site_id?: string;
  assign_nodes?: boolean;
  product_id?: string;
  serial_no?: string;
  name?: string;
}

interface AssignDeviceValues {
  target_workspace_id: string;
  project_id?: string;
  site_id?: string;
  assign_children?: boolean;
}

interface EditDeviceValues {
  product_id?: string;
  serial_no: string;
  name: string;
  status: Device["status"];
  device_type: Device["device_type"];
  capabilities: DeviceCapabilityCode[];
}

interface CreateCameraValues {
  product_id?: string;
  serial_no: string;
  name: string;
  device_serial: string;
  channel_no?: number;
  default_quality?: CameraQuality;
  is_encrypted?: boolean;
  validate_code_secret_ref?: string;
  target_workspace_id?: string;
  project_id?: string;
  site_id?: string;
}

interface CameraBindingValues {
  device_serial: string;
  channel_no: number;
  default_quality: CameraQuality;
  is_encrypted: boolean;
  validate_code_secret_ref?: string;
  status: CameraBindingStatus;
}

interface LifecycleValues {
  lifecycle_status: DeviceLifecycleStatus;
  occurred_at?: Dayjs;
  note?: string;
}

interface CapabilityValues {
  capabilities: DeviceCapabilityCode[];
}

interface CapabilityDefinitionValues {
  code: string;
  name: string;
  status: DeviceCapabilityDefinitionStatus;
  sort_order: number;
}

interface SystemRoleValues {
  name: string;
}

type DeviceTopologyFilter = "all" | "gateway" | "gateway_node" | "standalone" | "camera";

interface TopologyTransferItem {
  key: string;
  title: string;
  description: string;
  searchText: string;
  device: Device;
  externalChildDeviceId?: number;
}

export function AdminOverviewPage() {
  const dataSources = useQuery({ queryKey: ["admin", "data-sources"], queryFn: adminDataSourcesApi.list });
  const workspaces = useQuery({ queryKey: ["admin", "workspaces"], queryFn: adminWorkspacesApi.list });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Typography.Title level={2}>后台总览</Typography.Title>
        </div>
      </div>
      <Row gutter={[16, 16]}>
        <Col md={8} xs={24}>
          <Card>
            <Space orientation="vertical" size={4}>
              <Typography.Text strong>系统数据源</Typography.Text>
              <Typography.Title level={2}>{dataSources.data?.items.length ?? "-"}</Typography.Title>
            </Space>
          </Card>
        </Col>
        <Col md={8} xs={24}>
          <Card>
            <Space orientation="vertical" size={4}>
              <Typography.Text strong>目标工作区</Typography.Text>
              <Typography.Title level={2}>{workspaces.data?.items.length ?? "-"}</Typography.Title>
            </Space>
          </Card>
        </Col>
        <Col md={8} xs={24}>
          <Card>
            <Space orientation="vertical" size={4}>
              <Typography.Text strong>接入主路径</Typography.Text>
              <Typography.Title level={2}>THCPN</Typography.Title>
            </Space>
          </Card>
        </Col>
      </Row>
      {(dataSources.error || workspaces.error) && (
        <Alert
          message={formatApiError(dataSources.error || workspaces.error)}
          showIcon
          type="error"
        />
      )}
    </div>
  );
}

export function AdminDataSourcesPage() {
  const [createForm] = Form.useForm<CreateDataSourceValues>();
  const [syncForm] = Form.useForm<SyncTHCPNValues>();
  const [gatewayForm] = Form.useForm<SyncTHCPNGatewayValues>();
  const [syncResult, setSyncResult] = useState<THCPNStandardStationSyncResult | null>(null);
  const [gatewayResult, setGatewayResult] = useState<THCPNGatewaySyncResult | null>(null);
  const [gatewayWorkspaceId, setGatewayWorkspaceId] = useState("");
  const [gatewayProjectId, setGatewayProjectId] = useState("");
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const dataSources = useQuery({
    queryKey: ["admin", "data-sources"],
    queryFn: adminDataSourcesApi.list
  });
  const workspaces = useQuery({
    queryKey: ["admin", "workspaces"],
    queryFn: adminWorkspacesApi.list
  });
  const gatewayProjects = useQuery({
    queryKey: ["admin", "projects", gatewayWorkspaceId],
    queryFn: () => adminProjectsApi.list(gatewayWorkspaceId),
    enabled: Boolean(gatewayWorkspaceId)
  });
  const gatewaySites = useQuery({
    queryKey: ["admin", "sites", gatewayWorkspaceId, gatewayProjectId],
    queryFn: () => adminSitesApi.list({ workspace_id: gatewayWorkspaceId, project_id: gatewayProjectId || undefined }),
    enabled: Boolean(gatewayWorkspaceId && gatewayProjectId)
  });

  const createDataSource = useMutation({
    mutationFn: (values: CreateDataSourceValues) =>
      adminDataSourcesApi.create({
        name: values.name.trim(),
        type: values.type,
        dsn_secret_ref: values.dsn_secret_ref.trim()
      }),
    onSuccess: () => {
      createForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ["admin", "data-sources"] });
      void message.success("系统数据源已创建");
    }
  });

  const updateDataSourceStatus = useMutation({
    mutationFn: (input: { dataSourceId: string; status: DataSourceStatus }) =>
      adminDataSourcesApi.update(input.dataSourceId, { status: input.status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "data-sources"] });
      void message.success("数据源状态已更新");
    }
  });

  const syncTHCPN = useMutation({
    mutationFn: (values: SyncTHCPNValues) =>
      adminDataSourcesApi.syncTHCPNStandardStationDevice(values.data_source_id, {
        external_device_id: values.external_device_id,
        product_id: optional(values.product_id),
        serial_no: optional(values.serial_no),
        name: optional(values.name)
      }),
    onSuccess: (result) => {
      setSyncResult(result);
      void queryClient.invalidateQueries({ queryKey: ["admin", "devices"] });
      void queryClient.invalidateQueries({ queryKey: ["data-streams"] });
      void queryClient.invalidateQueries({ queryKey: ["data-stream-bindings"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "data-sources"] });
      void message.success("THCPN 标准站已同步到设备管理");
    }
  });
  const syncGateway = useMutation({
    mutationFn: (values: SyncTHCPNGatewayValues) =>
      adminDataSourcesApi.syncTHCPNGateway(values.data_source_id, {
        external_gateway_id: values.external_gateway_id,
        target_workspace_id: optional(values.target_workspace_id),
        project_id: optional(values.project_id),
        site_id: optional(values.site_id),
        assign_nodes: Boolean(values.assign_nodes),
        product_id: optional(values.product_id),
        serial_no: optional(values.serial_no),
        name: optional(values.name)
      }),
    onSuccess: (result) => {
      setGatewayResult(result);
      void queryClient.invalidateQueries({ queryKey: ["admin", "devices"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "device-children"] });
      void queryClient.invalidateQueries({ queryKey: ["data-streams"] });
      void queryClient.invalidateQueries({ queryKey: ["data-stream-bindings"] });
      void message.success("THCPN 组网站拓扑已同步");
    }
  });

  const activeMySQLSources = useMemo(
    () => (dataSources.data?.items ?? []).filter((item) => item.type === "mysql" && item.status === "active"),
    [dataSources.data?.items]
  );
  const sourceOptions = useMemo(
    () =>
      activeMySQLSources.map((item) => ({
        label: `${item.name} · ${item.dsn_secret_ref}`,
        value: item.id
      })),
    [activeMySQLSources]
  );
  const workspaceOptions = useMemo(
    () =>
      (workspaces.data?.items ?? []).map((item) => ({
        label: item.name,
        value: item.id
      })),
    [workspaces.data?.items]
  );
  const gatewayProjectOptions = useMemo(
    () =>
      (gatewayProjects.data?.items ?? []).map((item) => ({
        label: item.name,
        value: item.id
      })),
    [gatewayProjects.data?.items]
  );
  const gatewaySiteOptions = useMemo(
    () =>
      (gatewaySites.data?.items ?? []).map((item) => ({
        label: item.name,
        value: item.id
      })),
    [gatewaySites.data?.items]
  );

  const columns: TableColumnsType<DataSource> = [
    {
      key: "name",
      title: "数据源",
      width: 240,
      render: (_, item) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{item.name}</Typography.Text>
          <Typography.Text type="secondary">{item.type}</Typography.Text>
        </Space>
      )
    },
    { dataIndex: "dsn_secret_ref", key: "secret", title: "Secret 引用", width: 260 },
    {
      dataIndex: "status",
      key: "status",
      title: "状态",
      width: 120,
      render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag>
    },
    { dataIndex: "created_at", key: "created", title: "创建时间", width: 180, render: formatDateTime },
    { key: "id", title: "ID", width: 240, render: (_, item) => copyableId(item.id) },
    {
      key: "actions",
      title: "操作",
      fixed: "right",
      width: 130,
      render: (_, item) => {
        const nextStatus: DataSourceStatus = item.status === "active" ? "disabled" : "active";
        return (
          <Button
            loading={updateDataSourceStatus.isPending}
            onClick={() => updateDataSourceStatus.mutate({ dataSourceId: item.id, status: nextStatus })}
            size="small"
          >
            {item.status === "active" ? "禁用" : "启用"}
          </Button>
        );
      }
    }
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Typography.Title level={2}>THCPN 数据源</Typography.Title>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void dataSources.refetch()}>
          刷新
        </Button>
      </div>

      <Card title="创建系统级数据源">
        <Form<CreateDataSourceValues>
          form={createForm}
          initialValues={{ type: "mysql" }}
          layout="vertical"
          onFinish={(values) => createDataSource.mutate(values)}
        >
          <div className="form-grid">
            <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入数据源名称" }]}>
              <Input placeholder="THCPN 生产 MySQL" />
            </Form.Item>
            <Form.Item label="类型" name="type" rules={[{ required: true, message: "请选择类型" }]}>
              <Select options={dataSourceTypeOptions} />
            </Form.Item>
            <Form.Item label="Secret 引用" name="dsn_secret_ref" rules={[{ required: true, message: "请输入 Secret 引用" }]}>
              <Input placeholder="THCPN_LEGACY_MYSQL_DSN" />
            </Form.Item>
            <div className="form-actions align-end">
              <Button htmlType="submit" icon={<PlusOutlined />} loading={createDataSource.isPending} type="primary">
                创建
              </Button>
            </div>
          </div>
        </Form>
        {createDataSource.error ? <Alert message={formatApiError(createDataSource.error)} showIcon type="error" /> : null}
      </Card>

      <Card title="系统数据源列表">
        {dataSources.error ? <Alert message={formatApiError(dataSources.error)} showIcon type="error" /> : null}
        <Table<DataSource>
          columns={columns}
          dataSource={dataSources.data?.items ?? []}
          loading={dataSources.isLoading}
          pagination={false}
          rowKey="id"
          scroll={{ x: tableScrollX(columns) }}
          size="small"
        />
      </Card>

      <Card title={<Typography.Text strong>同步 THCPN 标准站</Typography.Text>}>
        {!dataSources.isLoading && activeMySQLSources.length === 0 ? (
          <Alert message="没有 active 的系统级 MySQL 数据源，先创建并启用 THCPN 数据源。" showIcon type="warning" />
        ) : null}
        <Form<SyncTHCPNValues>
          form={syncForm}
          layout="vertical"
          onFinish={(values) => syncTHCPN.mutate(values)}
        >
          <div className="form-grid">
            <Form.Item label="数据源" name="data_source_id" rules={[{ required: true, message: "请选择 THCPN MySQL 数据源" }]}>
              <Select disabled={activeMySQLSources.length === 0} loading={dataSources.isLoading} options={sourceOptions} placeholder="选择系统级 MySQL 数据源" />
            </Form.Item>
            <Form.Item label="外部设备 ID" name="external_device_id" rules={[{ required: true, message: "请输入外部设备 ID" }]}>
              <InputNumber min={1} precision={0} placeholder="1206" style={{ width: "100%" }} />
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
              <Button
                disabled={activeMySQLSources.length === 0}
                htmlType="submit"
                icon={<CloudSyncOutlined />}
                loading={syncTHCPN.isPending}
                type="primary"
              >
                同步标准站
              </Button>
            </div>
          </div>
        </Form>
        {syncTHCPN.error ? <Alert message={formatApiError(syncTHCPN.error)} showIcon type="error" /> : null}
        {syncResult ? <THCPNSyncResultView result={syncResult} /> : null}
      </Card>

      <Card title={<Typography.Text strong>同步 THCPN 组网站网关</Typography.Text>}>
        {!dataSources.isLoading && activeMySQLSources.length === 0 ? (
          <Alert message="没有 active 的系统级 MySQL 数据源，先创建并启用 THCPN 数据源。" showIcon type="warning" />
        ) : null}
        <Form<SyncTHCPNGatewayValues>
          form={gatewayForm}
          initialValues={{ assign_nodes: false }}
          layout="vertical"
          onFinish={(values) => syncGateway.mutate(values)}
          onValuesChange={(changed) => {
            if ("target_workspace_id" in changed) {
              const nextWorkspaceId = changed.target_workspace_id || "";
              setGatewayWorkspaceId(nextWorkspaceId);
              setGatewayProjectId("");
              gatewayForm.setFieldsValue({ project_id: undefined, site_id: undefined });
            }
            if ("project_id" in changed) {
              const nextProjectId = changed.project_id || "";
              setGatewayProjectId(nextProjectId);
              gatewayForm.setFieldValue("site_id", undefined);
            }
          }}
        >
          <div className="form-grid">
            <Form.Item label="数据源" name="data_source_id" rules={[{ required: true, message: "请选择 THCPN MySQL 数据源" }]}>
              <Select disabled={activeMySQLSources.length === 0} loading={dataSources.isLoading} options={sourceOptions} placeholder="选择系统级 MySQL 数据源" />
            </Form.Item>
            <Form.Item label="外部网关 ID" name="external_gateway_id" rules={[{ required: true, message: "请输入外部网关 ID" }]}>
              <InputNumber min={1} precision={0} placeholder="1206" style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="目标工作区" name="target_workspace_id">
              <Select allowClear loading={workspaces.isLoading} options={workspaceOptions} placeholder="可选；不选则只同步系统资产" showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item label="项目" name="project_id">
              <Select allowClear disabled={!gatewayWorkspaceId} loading={gatewayProjects.isLoading} options={gatewayProjectOptions} placeholder="可选" showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item label="站点" name="site_id">
              <Select allowClear disabled={!gatewayProjectId} loading={gatewaySites.isLoading} options={gatewaySiteOptions} placeholder="先选择项目" showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item label="产品 ID" name="product_id">
              <Input placeholder="默认 thcpn_standard_station" />
            </Form.Item>
            <Form.Item label="序列号" name="serial_no">
              <Input placeholder="默认外部 sn/uuid/thcpn-{id}" />
            </Form.Item>
            <Form.Item label="网关名称" name="name">
              <Input placeholder="默认外部设备名称" />
            </Form.Item>
            <Form.Item label="级联分配节点" name="assign_nodes" valuePropName="checked">
              <Switch disabled={!gatewayWorkspaceId} />
            </Form.Item>
            <div className="form-actions align-end">
              <Button
                disabled={activeMySQLSources.length === 0}
                htmlType="submit"
                icon={<CloudSyncOutlined />}
                loading={syncGateway.isPending}
                type="primary"
              >
                同步组网站
              </Button>
            </div>
          </div>
        </Form>
        {workspaces.error ? <Alert message={formatApiError(workspaces.error)} showIcon type="error" /> : null}
        {gatewayProjects.error ? <Alert message={formatApiError(gatewayProjects.error)} showIcon type="error" /> : null}
        {gatewaySites.error ? <Alert message={formatApiError(gatewaySites.error)} showIcon type="error" /> : null}
        {syncGateway.error ? <Alert message={formatApiError(syncGateway.error)} showIcon type="error" /> : null}
        {gatewayResult ? <THCPNGatewaySyncResultView result={gatewayResult} /> : null}
      </Card>
    </div>
  );
}

export function AdminDeviceAssetsPage() {
  const [editForm] = Form.useForm<EditDeviceValues>();
  const [cameraForm] = Form.useForm<CreateCameraValues>();
  const [cameraBindingForm] = Form.useForm<CameraBindingValues>();
  const [assignForm] = Form.useForm<AssignDeviceValues>();
  const [lifecycleForm] = Form.useForm<LifecycleValues>();
  const [capabilityForm] = Form.useForm<CapabilityValues>();
  const [selectedEditDevice, setSelectedEditDevice] = useState<Device | null>(null);
  const [selectedAssignDevice, setSelectedAssignDevice] = useState<Device | null>(null);
  const [selectedTopologyDevice, setSelectedTopologyDevice] = useState<Device | null>(null);
  const [selectedLifecycleDevice, setSelectedLifecycleDevice] = useState<Device | null>(null);
  const [selectedCapabilityDevice, setSelectedCapabilityDevice] = useState<Device | null>(null);
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const [topologyTargetKeys, setTopologyTargetKeys] = useState<string[]>([]);
  const [topologyFilter, setTopologyFilter] = useState<DeviceTopologyFilter>("all");
  const [deviceSearch, setDeviceSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Device["status"]>("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<"all" | DeviceLifecycleStatus>("all");
  const [assignmentFilter, setAssignmentFilter] = useState<"all" | "assigned" | "unassigned">("all");
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [batchStatus, setBatchStatus] = useState<Device["status"]>("active");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [cameraWorkspaceId, setCameraWorkspaceId] = useState("");
  const [cameraProjectId, setCameraProjectId] = useState("");
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const workspaces = useQuery({
    queryKey: ["admin", "workspaces"],
    queryFn: adminWorkspacesApi.list
  });
  const devices = useQuery({
    queryKey: ["admin", "devices"],
    queryFn: adminDevicesApi.list
  });
  const capabilityDefinitions = useQuery({
    queryKey: ["admin", "device-capability-definitions"],
    queryFn: adminDeviceCapabilityDefinitionsApi.list
  });
  const topologyChildren = useQuery({
    queryKey: ["admin", "device-children", selectedTopologyDevice?.id],
    queryFn: () => adminDevicesApi.children(selectedTopologyDevice?.id ?? ""),
    enabled: Boolean(selectedTopologyDevice)
  });
  const lifecycle = useQuery({
    queryKey: ["admin", "device-lifecycle", selectedLifecycleDevice?.id],
    queryFn: () => adminDevicesApi.lifecycle(selectedLifecycleDevice?.id ?? ""),
    enabled: Boolean(selectedLifecycleDevice)
  });
  const capabilities = useQuery({
    queryKey: ["admin", "device-capabilities", selectedCapabilityDevice?.id],
    queryFn: () => adminDevicesApi.capabilities(selectedCapabilityDevice?.id ?? ""),
    enabled: Boolean(selectedCapabilityDevice)
  });
  const editCamera = useQuery({
    queryKey: ["admin", "camera", selectedEditDevice?.id],
    queryFn: () => adminCamerasApi.get(selectedEditDevice?.id ?? ""),
    enabled: selectedEditDevice?.device_type === "camera"
  });
  const projects = useQuery({
    queryKey: ["admin", "projects", selectedWorkspaceId],
    queryFn: () => adminProjectsApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });
  const sites = useQuery({
    queryKey: ["admin", "sites", selectedWorkspaceId, selectedProjectId],
    queryFn: () => adminSitesApi.list({ workspace_id: selectedWorkspaceId, project_id: selectedProjectId || undefined }),
    enabled: Boolean(selectedWorkspaceId && selectedProjectId)
  });
  const cameraProjects = useQuery({
    queryKey: ["admin", "projects", cameraWorkspaceId],
    queryFn: () => adminProjectsApi.list(cameraWorkspaceId),
    enabled: Boolean(cameraWorkspaceId)
  });
  const cameraSites = useQuery({
    queryKey: ["admin", "sites", cameraWorkspaceId, cameraProjectId],
    queryFn: () => adminSitesApi.list({ workspace_id: cameraWorkspaceId, project_id: cameraProjectId || undefined }),
    enabled: Boolean(cameraWorkspaceId && cameraProjectId)
  });

  const updateDevice = useMutation({
    mutationFn: (values: EditDeviceValues) => {
      if (!selectedEditDevice) {
        throw new Error("missing selected device");
      }
      return adminDevicesApi.update(selectedEditDevice.id, {
        product_id: values.product_id?.trim() ?? "",
        serial_no: values.serial_no,
        name: values.name,
        status: values.status,
        device_type: values.device_type,
        capabilities: values.capabilities ?? []
      });
    },
    onSuccess: () => {
      setSelectedEditDevice(null);
      editForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ["admin", "devices"] });
      void message.success("设备信息已更新");
    }
  });

  const createCamera = useMutation({
    mutationFn: (values: CreateCameraValues) =>
      adminCamerasApi.create({
        product_id: optional(values.product_id),
        serial_no: values.serial_no,
        name: values.name,
        device_serial: values.device_serial,
        channel_no: Number(values.channel_no || 1),
        default_quality: values.default_quality || "hd",
        is_encrypted: Boolean(values.is_encrypted),
        validate_code_secret_ref: optional(values.validate_code_secret_ref),
        target_workspace_id: optional(values.target_workspace_id),
        project_id: optional(values.project_id),
        site_id: optional(values.site_id)
      }),
    onSuccess: () => {
      setCameraModalOpen(false);
      setCameraWorkspaceId("");
      setCameraProjectId("");
      cameraForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ["admin", "devices"] });
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
      void message.success("相机已保存");
    }
  });

  const updateCameraBinding = useMutation({
    mutationFn: (values: CameraBindingValues) => {
      if (!selectedEditDevice) {
        throw new Error("missing selected camera");
      }
      return adminCamerasApi.update(selectedEditDevice.id, {
        device_serial: values.device_serial,
        channel_no: Number(values.channel_no || 1),
        default_quality: values.default_quality,
        is_encrypted: Boolean(values.is_encrypted),
        validate_code_secret_ref: optional(values.validate_code_secret_ref),
        status: values.status
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "devices"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "camera", selectedEditDevice?.id] });
      void message.success("相机接入已更新");
    }
  });

  const assignDevice = useMutation({
    mutationFn: (values: AssignDeviceValues) => {
      if (!selectedAssignDevice) {
        throw new Error("missing selected device");
      }
      return adminDevicesApi.assign(selectedAssignDevice.id, {
        target_workspace_id: values.target_workspace_id,
        project_id: optional(values.project_id),
        site_id: optional(values.site_id),
        assign_children: Boolean(values.assign_children)
      });
    },
    onSuccess: (device) => {
      setSelectedAssignDevice(null);
      assignForm.resetFields();
      setSelectedWorkspaceId("");
      setSelectedProjectId("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "devices"] });
      if (device.workspace_id) {
        void queryClient.invalidateQueries({ queryKey: ["devices", device.workspace_id] });
      }
      void message.success("设备分配已更新");
    }
  });

  const updateLifecycle = useMutation({
    mutationFn: (values: LifecycleValues) => {
      if (!selectedLifecycleDevice) {
        throw new Error("missing selected device");
      }
      return adminDevicesApi.updateLifecycle(selectedLifecycleDevice.id, {
        lifecycle_status: values.lifecycle_status,
        occurred_at: values.occurred_at?.toISOString(),
        note: optional(values.note)
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "devices"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "device-lifecycle", selectedLifecycleDevice?.id] });
      void message.success("生命周期已更新");
    }
  });

  const updateCapabilities = useMutation({
    mutationFn: (values: CapabilityValues) => {
      if (!selectedCapabilityDevice) {
        throw new Error("missing selected device");
      }
      return adminDevicesApi.updateCapabilities(selectedCapabilityDevice.id, {
        capabilities: values.capabilities ?? []
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "devices"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "device-capabilities", selectedCapabilityDevice?.id] });
      void message.success("设备能力已更新");
    }
  });

  const unassignDevice = useMutation({
    mutationFn: (deviceId: string) => adminDevicesApi.unassign(deviceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "devices"] });
      void message.success("设备分配已移除");
    }
  });
  const batchUpdateStatus = useMutation({
    mutationFn: async (status: Device["status"]) => {
      const targets = [...selectedDeviceIds];
      for (const deviceId of targets) {
        await adminDevicesApi.update(deviceId, { status });
      }
      return targets.length;
    },
    onSuccess: (count) => {
      setSelectedDeviceIds([]);
      void queryClient.invalidateQueries({ queryKey: ["admin", "devices"] });
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
      void message.success(`已更新 ${count} 台设备`);
    },
    onError: (error) => {
      void message.error(formatApiError(error));
    }
  });
  const batchUnassignDevices = useMutation({
    mutationFn: async () => {
      const targets = allDevices.filter((item) => selectedDeviceIds.includes(item.id) && item.workspace_id);
      for (const device of targets) {
        await adminDevicesApi.unassign(device.id);
      }
      return targets.length;
    },
    onSuccess: (count) => {
      setSelectedDeviceIds([]);
      void queryClient.invalidateQueries({ queryKey: ["admin", "devices"] });
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
      void message.success(`已移除 ${count} 台设备分配`);
    },
    onError: (error) => {
      void message.error(formatApiError(error));
    }
  });
  const saveTopologyChildren = useMutation({
    mutationFn: async (nextChildDeviceIds: string[]) => {
      if (!selectedTopologyDevice) {
        throw new Error("missing selected topology device");
      }
      const currentChildIds = new Set((topologyChildren.data?.items ?? []).map((item) => item.device.id));
      const nextChildIdSet = new Set(nextChildDeviceIds);
      const childIdsToAdd = nextChildDeviceIds.filter((id) => !currentChildIds.has(id));
      const childIdsToRemove = [...currentChildIds].filter((id) => !nextChildIdSet.has(id));

      for (const childDeviceId of childIdsToAdd) {
        await adminDevicesApi.addChild(selectedTopologyDevice.id, { child_device_id: childDeviceId });
      }
      for (const childDeviceId of childIdsToRemove) {
        await adminDevicesApi.removeChild(selectedTopologyDevice.id, childDeviceId);
      }

      return { added: childIdsToAdd.length, removed: childIdsToRemove.length };
    },
    onSuccess: (result) => {
      setSelectedTopologyDevice(null);
      setTopologyTargetKeys([]);
      void queryClient.invalidateQueries({ queryKey: ["admin", "devices"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "device-children", selectedTopologyDevice?.id] });
      void message.success(`拓扑已保存：新增 ${result.added} 个，移除 ${result.removed} 个`);
    }
  });

  const workspaceOptions = useMemo(
    () =>
      (workspaces.data?.items ?? []).map((item) => ({
        label: item.name,
        value: item.id
      })),
    [workspaces.data?.items]
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
  const cameraProjectOptions = useMemo(
    () =>
      (cameraProjects.data?.items ?? []).map((item) => ({
        label: item.name,
        value: item.id
      })),
    [cameraProjects.data?.items]
  );
  const cameraSiteOptions = useMemo(
    () =>
      (cameraSites.data?.items ?? []).map((item) => ({
        label: item.name,
        value: item.id
      })),
    [cameraSites.data?.items]
  );
  const capabilityOptions = useMemo(
    () =>
      (capabilityDefinitions.data?.items ?? []).map((item) => ({
        label: item.name,
        value: item.code
      })),
    [capabilityDefinitions.data?.items]
  );
  const selectedDeviceCanAssignChildren =
    selectedAssignDevice?.topology_role === "gateway" && (selectedAssignDevice.child_count ?? 0) > 0;
  const allDevices = devices.data?.items ?? emptyDevices;
  const selectedDevices = useMemo(
    () => allDevices.filter((item) => selectedDeviceIds.includes(item.id)),
    [allDevices, selectedDeviceIds]
  );
  const selectedAssignedDevices = useMemo(
    () => selectedDevices.filter((item) => item.workspace_id),
    [selectedDevices]
  );
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
  const filteredDevices = useMemo(() => {
    const keyword = deviceSearch.trim().toLocaleLowerCase();
    return allDevices.filter((item) => {
      if (topologyFilter !== "all" && item.topology_role !== topologyFilter) {
        return false;
      }
      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }
      if (lifecycleFilter !== "all" && item.lifecycle_status !== lifecycleFilter) {
        return false;
      }
      if (assignmentFilter === "assigned" && !item.workspace_id) {
        return false;
      }
      if (assignmentFilter === "unassigned" && item.workspace_id) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const haystack = [
        item.id,
        item.name,
        item.serial_no,
        item.product_id,
        item.workspace_id,
        item.project_id,
        item.site_id,
        item.status,
        item.lifecycle_status,
        item.topology_role,
        item.device_type,
        ...item.capabilities
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(keyword);
    });
  }, [allDevices, assignmentFilter, deviceSearch, lifecycleFilter, statusFilter, topologyFilter]);
  const currentTopologyChildren = useMemo(
    () => topologyChildren.data?.items ?? [],
    [topologyChildren.data?.items]
  );
  const currentTopologyChildIds = useMemo(
    () => currentTopologyChildren.map((item) => item.device.id),
    [currentTopologyChildren]
  );
  useEffect(() => {
    if (selectedEditDevice) {
      editForm.setFieldsValue({
        product_id: selectedEditDevice.product_id ?? "",
        serial_no: selectedEditDevice.serial_no,
        name: selectedEditDevice.name,
        status: selectedEditDevice.status,
        device_type: selectedEditDevice.device_type,
        capabilities: selectedEditDevice.capabilities
      });
    }
  }, [editForm, selectedEditDevice]);
  useEffect(() => {
    if (editCamera.data) {
      cameraBindingForm.setFieldsValue({
        device_serial: editCamera.data.binding.device_serial,
        channel_no: editCamera.data.binding.channel_no,
        default_quality: editCamera.data.binding.default_quality,
        is_encrypted: editCamera.data.binding.is_encrypted,
        validate_code_secret_ref: editCamera.data.binding.validate_code_secret_ref ?? "",
        status: editCamera.data.binding.status
      });
    }
  }, [cameraBindingForm, editCamera.data]);
  useEffect(() => {
    if (selectedTopologyDevice && !topologyChildren.isLoading) {
      setTopologyTargetKeys(currentTopologyChildIds);
    }
  }, [currentTopologyChildIds, selectedTopologyDevice, topologyChildren.isLoading]);
  useEffect(() => {
    if (selectedLifecycleDevice) {
      lifecycleForm.setFieldsValue({
        lifecycle_status: lifecycle.data?.device.lifecycle_status ?? selectedLifecycleDevice.lifecycle_status,
        occurred_at: dayjs(),
        note: ""
      });
    }
  }, [lifecycle.data?.device.lifecycle_status, lifecycleForm, selectedLifecycleDevice]);
  useEffect(() => {
    if (selectedCapabilityDevice) {
      capabilityForm.setFieldsValue({
        capabilities: capabilities.data?.capabilities ?? selectedCapabilityDevice.capabilities
      });
    }
  }, [capabilities.data?.capabilities, capabilityForm, selectedCapabilityDevice]);
  useEffect(() => {
    const deviceIds = new Set(allDevices.map((item) => item.id));
    setSelectedDeviceIds((current) => current.filter((id) => deviceIds.has(id)));
  }, [allDevices]);
  const topologyTransferItems = useMemo<TopologyTransferItem[]>(() => {
    const itemsById = new Map<string, TopologyTransferItem>();
    for (const child of currentTopologyChildren) {
      itemsById.set(child.device.id, topologyTransferItem(child.device, child.relation.external_child_device_id));
    }
    for (const device of allDevices) {
      if (device.id === selectedTopologyDevice?.id || device.topology_role !== "standalone") {
        continue;
      }
      if (!itemsById.has(device.id)) {
        itemsById.set(device.id, topologyTransferItem(device));
      }
    }
    return [...itemsById.values()];
  }, [allDevices, currentTopologyChildren, selectedTopologyDevice?.id]);
  const topologyHasChanges = useMemo(() => {
    const current = new Set(currentTopologyChildIds);
    const next = new Set(topologyTargetKeys);
    return current.size !== next.size || topologyTargetKeys.some((id) => !current.has(id));
  }, [currentTopologyChildIds, topologyTargetKeys]);

  const deviceColumns: TableColumnsType<Device> = [
    {
      key: "device",
      title: "系统设备",
      width: 260,
      render: (_, item) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{item.name}</Typography.Text>
          <Typography.Text type="secondary">{item.serial_no}</Typography.Text>
        </Space>
      )
    },
    {
      key: "topology",
      title: "拓扑",
      width: 140,
      render: (_, item) => topologyTag(item)
    },
    {
      key: "lifecycle",
      title: "生命周期",
      width: 120,
      render: (_, item) => lifecycleTag(item.lifecycle_status)
    },
    {
      key: "assignment",
      title: "当前分配",
      width: 260,
      render: (_, item) =>
        item.workspace_id ? (
          <Space orientation="vertical" size={0}>
            <Typography.Text>{workspaceName(item.workspace_id, workspaces.data?.items ?? [])}</Typography.Text>
            <Typography.Text type="secondary">{copyableId(item.workspace_id)}</Typography.Text>
          </Space>
        ) : (
          <Tag>未分配</Tag>
        )
    },
    { dataIndex: "project_id", key: "project", title: "项目", width: 220, render: (value?: string) => (value ? copyableId(value) : "-") },
    { dataIndex: "site_id", key: "site", title: "站点", width: 220, render: (value?: string) => (value ? copyableId(value) : "-") },
    {
      dataIndex: "status",
      key: "status",
      title: "状态",
      width: 110,
      render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag>
    },
    { dataIndex: "created_at", key: "created", title: "创建时间", width: 180, render: formatDateTime },
    { key: "id", title: "设备 ID", width: 240, render: (_, item) => copyableId(item.id) },
    {
      key: "actions",
      title: "操作",
      fixed: "right",
      width: 370,
      render: (_, item) => (
        <Space>
          <Button
            onClick={() => {
              setSelectedEditDevice(item);
            }}
            size="small"
            type="link"
          >
            编辑
          </Button>
          {item.topology_role !== "gateway_node" ? (
            <Button
              onClick={() => {
                setSelectedTopologyDevice(item);
                setTopologyTargetKeys([]);
              }}
              size="small"
              type="link"
            >
              拓扑
            </Button>
          ) : null}
          <Button
            onClick={() => {
              setSelectedLifecycleDevice(item);
            }}
            size="small"
            type="link"
          >
            生命周期
          </Button>
          <Button
            onClick={() => {
              setSelectedCapabilityDevice(item);
            }}
            size="small"
            type="link"
          >
            能力
          </Button>
          <Button
            onClick={() => {
              setSelectedAssignDevice(item);
              setSelectedWorkspaceId(item.workspace_id ?? "");
              setSelectedProjectId(item.project_id ?? "");
              assignForm.setFieldsValue({
                target_workspace_id: item.workspace_id,
                project_id: item.project_id,
                site_id: item.site_id,
                assign_children: false
              });
            }}
            size="small"
            type="link"
          >
            分配
          </Button>
          {item.workspace_id ? (
            <Popconfirm
              okText="移除"
              onConfirm={() => unassignDevice.mutate(item.id)}
              title="移除此设备的当前工作区分配？"
            >
              <Button danger loading={unassignDevice.isPending} size="small" type="link">
                移除
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      )
    }
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Typography.Title level={2}>设备管理</Typography.Title>
        </div>
        <Space>
          <Button
            icon={<PlusOutlined />}
            onClick={() => {
              setCameraWorkspaceId("");
              setCameraProjectId("");
              cameraForm.setFieldsValue({
                channel_no: 1,
                default_quality: "hd",
                is_encrypted: false
              });
              setCameraModalOpen(true);
            }}
            type="primary"
          >
            添加相机
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void devices.refetch()}>
            刷新
          </Button>
        </Space>
      </div>

      <Card title={<Typography.Text strong>设备列表</Typography.Text>}>
        {workspaces.error ? <Alert message={formatApiError(workspaces.error)} showIcon type="error" /> : null}
        {devices.error ? <Alert message={formatApiError(devices.error)} showIcon type="error" /> : null}
        <Space className="admin-device-toolbar" wrap>
          <Input.Search
            allowClear
            onChange={(event) => setDeviceSearch(event.target.value)}
            placeholder="搜索设备"
            style={{ width: 260 }}
            value={deviceSearch}
          />
          <Select
            onChange={setStatusFilter}
            options={[
              { label: "全部状态", value: "all" },
              ...deviceStatusOptions
            ]}
            style={{ width: 136 }}
            value={statusFilter}
          />
          <Select
            onChange={setLifecycleFilter}
            options={[
              { label: "全部生命周期", value: "all" },
              ...lifecycleOptions
            ]}
            style={{ width: 156 }}
            value={lifecycleFilter}
          />
          <Select
            onChange={setAssignmentFilter}
            options={[
              { label: "全部分配", value: "all" },
              { label: "已分配", value: "assigned" },
              { label: "未分配", value: "unassigned" }
            ]}
            style={{ width: 132 }}
            value={assignmentFilter}
          />
          <Tag color={selectedDeviceIds.length ? "blue" : "default"}>{`已选 ${selectedDeviceIds.length}`}</Tag>
          <Select
            disabled={!selectedDeviceIds.length || batchUpdateStatus.isPending}
            onChange={setBatchStatus}
            options={deviceStatusOptions}
            style={{ width: 124 }}
            value={batchStatus}
          />
          <Button
            disabled={!selectedDeviceIds.length}
            loading={batchUpdateStatus.isPending}
            onClick={() => batchUpdateStatus.mutate(batchStatus)}
          >
            批量改状态
          </Button>
          <Popconfirm
            okText="移除"
            onConfirm={() => batchUnassignDevices.mutate()}
            title={`移除 ${selectedAssignedDevices.length} 台设备的当前分配？`}
          >
            <Button
              danger
              disabled={!selectedAssignedDevices.length}
              loading={batchUnassignDevices.isPending}
            >
              批量移除分配
            </Button>
          </Popconfirm>
          <Button
            disabled={
              !deviceSearch &&
              statusFilter === "all" &&
              lifecycleFilter === "all" &&
              assignmentFilter === "all" &&
              !selectedDeviceIds.length
            }
            onClick={() => {
              setDeviceSearch("");
              setStatusFilter("all");
              setLifecycleFilter("all");
              setAssignmentFilter("all");
              setSelectedDeviceIds([]);
            }}
          >
            重置
          </Button>
        </Space>
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
          columns={deviceColumns}
          dataSource={filteredDevices}
          expandable={{
            expandedRowRender: (item) => <AdminDeviceChildrenTable deviceId={item.id} />,
            rowExpandable: (item) => item.topology_role === "gateway" && (item.child_count ?? 0) > 0
          }}
          loading={devices.isLoading}
          pagination={{ pageSize: 10 }}
          rowSelection={{
            preserveSelectedRowKeys: true,
            selectedRowKeys: selectedDeviceIds,
            onChange: (keys) => setSelectedDeviceIds(keys.map(String))
          }}
          rowKey="id"
          scroll={{ x: tableScrollX(deviceColumns) }}
          size="small"
        />
      </Card>

      <Modal
        confirmLoading={createCamera.isPending}
        destroyOnHidden
        okText="保存相机"
        onCancel={() => {
          setCameraModalOpen(false);
          setCameraWorkspaceId("");
          setCameraProjectId("");
          cameraForm.resetFields();
        }}
        onOk={() => cameraForm.submit()}
        open={cameraModalOpen}
        title="添加相机"
        width="min(760px, calc(100vw - 24px))"
      >
        <Form<CreateCameraValues>
          form={cameraForm}
          layout="vertical"
          onFinish={(values) => createCamera.mutate(values)}
          onValuesChange={(changed) => {
            if ("target_workspace_id" in changed) {
              const nextWorkspaceId = changed.target_workspace_id || "";
              setCameraWorkspaceId(nextWorkspaceId);
              setCameraProjectId("");
              cameraForm.setFieldsValue({ project_id: undefined, site_id: undefined });
            }
            if ("project_id" in changed) {
              const nextProjectId = changed.project_id || "";
              setCameraProjectId(nextProjectId);
              cameraForm.setFieldValue("site_id", undefined);
            }
          }}
        >
          <Row gutter={12}>
            <Col md={12} xs={24}>
              <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col md={12} xs={24}>
              <Form.Item label="序列号" name="serial_no" rules={[{ required: true, message: "请输入序列号" }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col md={12} xs={24}>
              <Form.Item label="产品 ID" name="product_id">
                <Input />
              </Form.Item>
            </Col>
            <Col md={12} xs={24}>
              <Form.Item label="萤石设备序列号" name="device_serial" rules={[{ required: true, message: "请输入萤石设备序列号" }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col md={12} xs={24}>
              <Form.Item label="通道号" name="channel_no" rules={[{ required: true, message: "请输入通道号" }]}>
                <InputNumber min={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col md={12} xs={24}>
              <Form.Item label="默认清晰度" name="default_quality" rules={[{ required: true, message: "请选择默认清晰度" }]}>
                <Select options={cameraQualityOptions} />
              </Form.Item>
            </Col>
            <Col md={12} xs={24}>
              <Form.Item label="加密设备" name="is_encrypted" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col md={12} xs={24}>
              <Form.Item label="验证码 Secret Ref" name="validate_code_secret_ref">
                <Input />
              </Form.Item>
            </Col>
            <Col md={24} xs={24}>
              <Form.Item label="目标工作区" name="target_workspace_id">
                <Select allowClear loading={workspaces.isLoading} options={workspaceOptions} showSearch optionFilterProp="label" />
              </Form.Item>
            </Col>
            <Col md={12} xs={24}>
              <Form.Item label="项目" name="project_id">
                <Select allowClear disabled={!cameraWorkspaceId} loading={cameraProjects.isLoading} options={cameraProjectOptions} showSearch optionFilterProp="label" />
              </Form.Item>
            </Col>
            <Col md={12} xs={24}>
              <Form.Item label="站点" name="site_id">
                <Select allowClear disabled={!cameraProjectId} loading={cameraSites.isLoading} options={cameraSiteOptions} showSearch optionFilterProp="label" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
        {cameraProjects.error ? <Alert message={formatApiError(cameraProjects.error)} showIcon type="error" /> : null}
        {cameraSites.error ? <Alert message={formatApiError(cameraSites.error)} showIcon type="error" /> : null}
        {createCamera.error ? <Alert message={formatApiError(createCamera.error)} showIcon type="error" /> : null}
      </Modal>

      <Drawer
        className="topology-drawer"
        destroyOnHidden
        footer={
          <Space className="drawer-footer-actions">
            <Button
              onClick={() => {
                setSelectedTopologyDevice(null);
                setTopologyTargetKeys([]);
              }}
            >
              取消
            </Button>
            <Button
              disabled={!topologyHasChanges || topologyChildren.isLoading}
              loading={saveTopologyChildren.isPending}
              onClick={() => saveTopologyChildren.mutate(topologyTargetKeys)}
              type="primary"
            >
              保存拓扑
            </Button>
          </Space>
        }
        onClose={() => {
          setSelectedTopologyDevice(null);
          setTopologyTargetKeys([]);
        }}
        open={Boolean(selectedTopologyDevice)}
        placement="right"
        title="设置网关节点拓扑"
        width="min(1180px, calc(100vw - 24px))"
      >
        {selectedTopologyDevice ? (
          <div className="topology-drawer-content">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="网关设备">{selectedTopologyDevice.name}</Descriptions.Item>
              <Descriptions.Item label="序列号">{selectedTopologyDevice.serial_no}</Descriptions.Item>
              <Descriptions.Item label="当前拓扑">{topologyTag(selectedTopologyDevice)}</Descriptions.Item>
            </Descriptions>
            <Transfer<TopologyTransferItem>
              actions={["加入节点", "移出节点"]}
              className="topology-transfer"
              dataSource={topologyTransferItems}
              disabled={topologyChildren.isLoading || saveTopologyChildren.isPending}
              filterOption={filterTopologyTransferItem}
              locale={{
                itemUnit: "台",
                itemsUnit: "台",
                notFoundContent: "没有设备",
                searchPlaceholder: "过滤名称、序列号、设备 ID 或外部 ID"
              }}
              onChange={(nextTargetKeys) => setTopologyTargetKeys(nextTargetKeys.map(String))}
              render={(item) => ({
                label: <TopologyTransferLabel item={item} />,
                value: item.title
              })}
              showSearch
              targetKeys={topologyTargetKeys}
              titles={["普通设备候选", `组网站节点 (${topologyTargetKeys.length})`]}
            />
            {topologyTransferItems.length === currentTopologyChildIds.length ? (
              <Alert title="没有可添加的普通设备。节点或已有组网站不能作为新节点添加。" showIcon type="info" />
            ) : null}
            {topologyHasChanges ? (
              <Alert
                title={`待保存：新增 ${topologyTargetKeys.filter((id) => !currentTopologyChildIds.includes(id)).length} 个，移除 ${currentTopologyChildIds.filter((id) => !topologyTargetKeys.includes(id)).length} 个。`}
                showIcon
                type="info"
              />
            ) : null}
            {saveTopologyChildren.error ? <Alert title={formatApiError(saveTopologyChildren.error)} showIcon type="error" /> : null}
            {topologyChildren.error ? <Alert title={formatApiError(topologyChildren.error)} showIcon type="error" /> : null}
          </div>
        ) : null}
      </Drawer>

      <Drawer
        destroyOnHidden
        footer={
          <Space className="drawer-footer-actions">
            <Button
              onClick={() => {
                setSelectedEditDevice(null);
                editForm.resetFields();
              }}
            >
              取消
            </Button>
            <Button loading={updateDevice.isPending} onClick={() => editForm.submit()} type="primary">
              保存设备
            </Button>
          </Space>
        }
        onClose={() => {
          setSelectedEditDevice(null);
          editForm.resetFields();
        }}
        open={Boolean(selectedEditDevice)}
        placement="right"
        title="编辑设备"
        width="min(680px, calc(100vw - 24px))"
      >
        {selectedEditDevice ? (
          <div className="drawer-stack">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="设备 ID">{copyableId(selectedEditDevice.id)}</Descriptions.Item>
            </Descriptions>
            <Form<EditDeviceValues> form={editForm} layout="vertical" onFinish={(values) => updateDevice.mutate(values)}>
              <Form.Item label="产品 ID" name="product_id">
                <Input />
              </Form.Item>
              <Form.Item label="序列号" name="serial_no" rules={[{ required: true, message: "请输入序列号" }]}>
                <Input />
              </Form.Item>
              <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
                <Input />
              </Form.Item>
              <Form.Item label="状态" name="status" rules={[{ required: true, message: "请选择状态" }]}>
                <Select
                  options={deviceStatusOptions}
                />
              </Form.Item>
              <Form.Item label="设备类型" name="device_type" rules={[{ required: true, message: "请选择设备类型" }]}>
                <Select
                  options={[
                    { label: "普通设备", value: "standalone" },
                    { label: "网关", value: "gateway" },
                    { label: "节点", value: "gateway_node" },
                    { label: "相机", value: "camera" }
                  ]}
                />
              </Form.Item>
              <Form.Item label="设备能力" name="capabilities">
                <Select
                  allowClear
                  loading={capabilityDefinitions.isLoading}
                  mode="multiple"
                  optionFilterProp="label"
                  options={capabilityOptions}
                  placeholder="选择设备能力"
                />
              </Form.Item>
            </Form>
            {selectedEditDevice.device_type === "camera" ? (
              <Card size="small" title={<Typography.Text strong>相机接入</Typography.Text>}>
                <Form<CameraBindingValues>
                  form={cameraBindingForm}
                  layout="vertical"
                  onFinish={(values) => updateCameraBinding.mutate(values)}
                >
                  <Form.Item label="萤石设备序列号" name="device_serial" rules={[{ required: true, message: "请输入萤石设备序列号" }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item label="通道号" name="channel_no" rules={[{ required: true, message: "请输入通道号" }]}>
                    <InputNumber min={1} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item label="默认清晰度" name="default_quality" rules={[{ required: true, message: "请选择默认清晰度" }]}>
                    <Select options={cameraQualityOptions} />
                  </Form.Item>
                  <Form.Item label="加密设备" name="is_encrypted" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item label="验证码 Secret Ref" name="validate_code_secret_ref">
                    <Input />
                  </Form.Item>
                  <Form.Item label="接入状态" name="status" rules={[{ required: true, message: "请选择接入状态" }]}>
                    <Select
                      options={[
                        { label: "active", value: "active" },
                        { label: "disabled", value: "disabled" }
                      ]}
                    />
                  </Form.Item>
                  <Button loading={updateCameraBinding.isPending} onClick={() => cameraBindingForm.submit()} type="primary">
                    保存相机接入
                  </Button>
                </Form>
                {editCamera.error ? <Alert message={formatApiError(editCamera.error)} showIcon type="error" /> : null}
                {updateCameraBinding.error ? <Alert message={formatApiError(updateCameraBinding.error)} showIcon type="error" /> : null}
              </Card>
            ) : null}
            {updateDevice.error ? <Alert message={formatApiError(updateDevice.error)} showIcon type="error" /> : null}
          </div>
        ) : null}
      </Drawer>

      <Drawer
        destroyOnHidden
        footer={
          <Space className="drawer-footer-actions">
            <Button
              onClick={() => {
                setSelectedLifecycleDevice(null);
                lifecycleForm.resetFields();
              }}
            >
              取消
            </Button>
            <Button loading={updateLifecycle.isPending} onClick={() => lifecycleForm.submit()} type="primary">
              保存生命周期
            </Button>
          </Space>
        }
        onClose={() => {
          setSelectedLifecycleDevice(null);
          lifecycleForm.resetFields();
        }}
        open={Boolean(selectedLifecycleDevice)}
        placement="right"
        title="设备生命周期"
        width="min(720px, calc(100vw - 24px))"
      >
        {selectedLifecycleDevice ? (
          <div className="drawer-stack">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="设备">{selectedLifecycleDevice.name}</Descriptions.Item>
              <Descriptions.Item label="序列号">{selectedLifecycleDevice.serial_no}</Descriptions.Item>
              <Descriptions.Item label="当前生命周期">{lifecycleTag(lifecycle.data?.device.lifecycle_status ?? selectedLifecycleDevice.lifecycle_status)}</Descriptions.Item>
            </Descriptions>
            <Form<LifecycleValues> form={lifecycleForm} layout="vertical" onFinish={(values) => updateLifecycle.mutate(values)}>
              <Form.Item label="生命周期" name="lifecycle_status" rules={[{ required: true, message: "请选择生命周期" }]}>
                <Select options={lifecycleOptions} />
              </Form.Item>
              <Form.Item label="发生时间" name="occurred_at">
                <DatePicker showTime style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label="备注" name="note">
                <Input.TextArea autoSize={{ minRows: 3, maxRows: 5 }} />
              </Form.Item>
            </Form>
            {updateLifecycle.error ? <Alert message={formatApiError(updateLifecycle.error)} showIcon type="error" /> : null}
            {lifecycle.error ? <Alert message={formatApiError(lifecycle.error)} showIcon type="error" /> : null}
            <Table<DeviceLifecycleEvent>
              columns={[
                { key: "to", title: "状态", width: 120, render: (_, item) => lifecycleTag(item.to_status) },
                { dataIndex: "occurred_at", key: "occurred", title: "发生时间", width: 180, render: formatDateTime },
                { dataIndex: "note", key: "note", title: "备注", render: (value?: string) => labelOrDash(value) }
              ]}
              dataSource={lifecycle.data?.events ?? []}
              loading={lifecycle.isLoading}
              pagination={false}
              rowKey="id"
              scroll={{ x: 560 }}
              size="small"
            />
          </div>
        ) : null}
      </Drawer>

      <Drawer
        destroyOnHidden
        footer={
          <Space className="drawer-footer-actions">
            <Button
              onClick={() => {
                setSelectedCapabilityDevice(null);
                capabilityForm.resetFields();
              }}
            >
              取消
            </Button>
            <Button loading={updateCapabilities.isPending} onClick={() => capabilityForm.submit()} type="primary">
              保存能力
            </Button>
          </Space>
        }
        onClose={() => {
          setSelectedCapabilityDevice(null);
          capabilityForm.resetFields();
        }}
        open={Boolean(selectedCapabilityDevice)}
        placement="right"
        title="设备能力"
        width="min(620px, calc(100vw - 24px))"
      >
        {selectedCapabilityDevice ? (
          <div className="drawer-stack">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="设备">{selectedCapabilityDevice.name}</Descriptions.Item>
              <Descriptions.Item label="序列号">{selectedCapabilityDevice.serial_no}</Descriptions.Item>
            </Descriptions>
            <Form<CapabilityValues> form={capabilityForm} layout="vertical" onFinish={(values) => updateCapabilities.mutate(values)}>
              <Form.Item label="能力" name="capabilities">
                <Select
                  allowClear
                  loading={capabilities.isLoading}
                  mode="multiple"
                  optionFilterProp="label"
                  options={capabilityOptions}
                  placeholder="选择设备能力"
                />
              </Form.Item>
            </Form>
            {capabilities.error ? <Alert message={formatApiError(capabilities.error)} showIcon type="error" /> : null}
            {updateCapabilities.error ? <Alert message={formatApiError(updateCapabilities.error)} showIcon type="error" /> : null}
          </div>
        ) : null}
      </Drawer>

      <Modal
        confirmLoading={assignDevice.isPending}
        okText="保存分配"
        onCancel={() => {
          setSelectedAssignDevice(null);
          assignForm.resetFields();
          setSelectedWorkspaceId("");
          setSelectedProjectId("");
        }}
        onOk={() => assignForm.submit()}
        open={Boolean(selectedAssignDevice)}
        title="分配系统设备"
      >
        <Form<AssignDeviceValues>
          form={assignForm}
          layout="vertical"
          onFinish={(values) => assignDevice.mutate(values)}
          onValuesChange={(changed) => {
            if ("target_workspace_id" in changed) {
              const nextWorkspaceId = changed.target_workspace_id || "";
              setSelectedWorkspaceId(nextWorkspaceId);
              setSelectedProjectId("");
              assignForm.setFieldsValue({ project_id: undefined, site_id: undefined });
            }
            if ("project_id" in changed) {
              const nextProjectId = changed.project_id || "";
              setSelectedProjectId(nextProjectId);
              assignForm.setFieldValue("site_id", undefined);
            }
          }}
        >
          <Form.Item label="目标工作区" name="target_workspace_id" rules={[{ required: true, message: "请选择目标工作区" }]}>
            <Select loading={workspaces.isLoading} options={workspaceOptions} placeholder="选择设备使用工作区" showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item label="项目" name="project_id">
            <Select allowClear disabled={!selectedWorkspaceId} loading={projects.isLoading} options={projectOptions} placeholder="可选" showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item label="站点" name="site_id">
            <Select allowClear disabled={!selectedProjectId} loading={sites.isLoading} options={siteOptions} placeholder="先选择项目" showSearch optionFilterProp="label" />
          </Form.Item>
          {selectedDeviceCanAssignChildren ? (
            <Form.Item label="同时分配节点" name="assign_children" valuePropName="checked">
              <Switch />
            </Form.Item>
          ) : null}
        </Form>
        {projects.error ? <Alert message={formatApiError(projects.error)} showIcon type="error" /> : null}
        {sites.error ? <Alert message={formatApiError(sites.error)} showIcon type="error" /> : null}
        {assignDevice.error ? <Alert message={formatApiError(assignDevice.error)} showIcon type="error" /> : null}
      </Modal>
    </div>
  );
}

function THCPNSyncResultView({ result }: { result: THCPNStandardStationSyncResult }) {
  type StreamRow = THCPNStandardStationSyncResult["data_streams"][number];
  type BindingRow = THCPNStandardStationSyncResult["bindings"][number];

  const streamColumns: TableColumnsType<StreamRow> = [
    {
      key: "name",
      title: "数据流",
      width: 240,
      render: (_, item) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{item.name}</Typography.Text>
          <Typography.Text type="secondary">{`${item.code} · ${item.type}`}</Typography.Text>
        </Space>
      )
    },
    { dataIndex: "unit", key: "unit", title: "单位", width: 110, render: (value?: string) => labelOrDash(value) },
    {
      dataIndex: "status",
      key: "status",
      title: "状态",
      width: 120,
      render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag>
    },
    { key: "id", title: "ID", width: 240, render: (_, item) => copyableId(item.id) }
  ];
  const bindingColumns: TableColumnsType<BindingRow> = [
    { dataIndex: "adapter_code", key: "adapter", title: "Adapter", width: 170 },
    { dataIndex: "payload_type", key: "payload", title: "Payload", width: 120 },
    {
      dataIndex: "status",
      key: "status",
      title: "状态",
      width: 120,
      render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag>
    },
    { key: "config", title: "Adapter 配置", width: 360, render: (_, item) => <JSONSummary value={item.adapter_config} /> },
    { key: "id", title: "ID", width: 240, render: (_, item) => copyableId(item.id) }
  ];

  return (
    <div className="sync-result">
      <Descriptions bordered column={{ xs: 1, md: 2 }} size="small" title="同步结果">
        <Descriptions.Item label="平台设备">{result.device.name}</Descriptions.Item>
        <Descriptions.Item label="平台设备 ID">{copyableId(result.device.id)}</Descriptions.Item>
        <Descriptions.Item label="分配工作区">{result.device.workspace_id ? copyableId(result.device.workspace_id) : "未分配"}</Descriptions.Item>
        <Descriptions.Item label="Assignment">{result.device.assignment_id ? copyableId(result.device.assignment_id) : "未分配"}</Descriptions.Item>
        <Descriptions.Item label="序列号">{result.device.serial_no}</Descriptions.Item>
        <Descriptions.Item label="状态">
          <Tag color={statusColor(result.device.status)}>{result.device.status}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="外部设备">{result.external_device.name}</Descriptions.Item>
        <Descriptions.Item label="外部设备 ID">{result.external_device.id}</Descriptions.Item>
        <Descriptions.Item label="外部 SN">{labelOrDash(result.external_device.sn)}</Descriptions.Item>
        <Descriptions.Item label="外部 UUID">{labelOrDash(result.external_device.uuid)}</Descriptions.Item>
        <Descriptions.Item label="SourceRef">{copyableId(result.source_ref.id)}</Descriptions.Item>
        <Descriptions.Item label="SourceRef 状态">
          <Tag color={statusColor(result.source_ref.status)}>{result.source_ref.status}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Config ID">{result.config_snapshot.external_config_id}</Descriptions.Item>
        <Descriptions.Item label="Config 版本">{labelOrDash(result.config_snapshot.version)}</Descriptions.Item>
        <Descriptions.Item label="传感器数量">{Array.isArray(result.config_snapshot.data_json) ? result.config_snapshot.data_json.length : 0}</Descriptions.Item>
        <Descriptions.Item label="相机数量">{Array.isArray(result.config_snapshot.image_json) ? result.config_snapshot.image_json.length : 0}</Descriptions.Item>
        <Descriptions.Item label="同步时间">{formatDateTime(result.source_ref.synced_at)}</Descriptions.Item>
      </Descriptions>

      <div className="result-table-block">
        <Space size={8}>
          <DatabaseOutlined />
          <Typography.Text strong>生成的数据流</Typography.Text>
        </Space>
        <Table<StreamRow>
          columns={streamColumns}
          dataSource={result.data_streams}
          pagination={false}
          rowKey="id"
          scroll={{ x: tableScrollX(streamColumns) }}
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
          scroll={{ x: tableScrollX(bindingColumns) }}
          size="small"
        />
      </div>
    </div>
  );
}

function THCPNGatewaySyncResultView({ result }: { result: THCPNGatewaySyncResult }) {
  type NodeRow = THCPNGatewaySyncResult["nodes"][number];
  type RelationRow = THCPNGatewaySyncResult["relations"][number];

  const nodeColumns: TableColumnsType<NodeRow> = [
    {
      key: "device",
      title: "节点设备",
      width: 260,
      render: (_, item) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{item.device.name}</Typography.Text>
          <Typography.Text type="secondary">{item.device.serial_no}</Typography.Text>
        </Space>
      )
    },
    { key: "external", title: "外部 ID", width: 120, render: (_, item) => item.external_device.id },
    { key: "streams", title: "数据流", width: 100, render: (_, item) => item.data_streams.length },
    { key: "bindings", title: "Bindings", width: 100, render: (_, item) => item.bindings.length },
    { key: "assignment", title: "分配", width: 220, render: (_, item) => (item.device.workspace_id ? copyableId(item.device.workspace_id) : "未分配") },
    { key: "id", title: "设备 ID", width: 240, render: (_, item) => copyableId(item.device.id) }
  ];
  const relationColumns: TableColumnsType<RelationRow> = [
    { dataIndex: "external_parent_device_id", key: "parent", title: "外部网关", width: 120 },
    { dataIndex: "external_child_device_id", key: "child", title: "外部节点", width: 120 },
    {
      dataIndex: "status",
      key: "status",
      title: "状态",
      width: 100,
      render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag>
    },
    { dataIndex: "synced_at", key: "synced", title: "同步时间", width: 180, render: formatDateTime },
    { key: "id", title: "Relation ID", width: 240, render: (_, item) => copyableId(item.id) }
  ];

  return (
    <div className="sync-result">
      <Descriptions bordered column={{ xs: 1, md: 2 }} size="small" title="组网站同步结果">
        <Descriptions.Item label="网关">{result.gateway.device.name}</Descriptions.Item>
        <Descriptions.Item label="网关设备 ID">{copyableId(result.gateway.device.id)}</Descriptions.Item>
        <Descriptions.Item label="外部网关 ID">{result.gateway.external_device.id}</Descriptions.Item>
        <Descriptions.Item label="节点数量">{result.nodes.length}</Descriptions.Item>
        <Descriptions.Item label="关系数量">{result.relations.length}</Descriptions.Item>
        <Descriptions.Item label="移除关系">{result.removed_relations?.length ?? 0}</Descriptions.Item>
        <Descriptions.Item label="分配工作区">{result.gateway.device.workspace_id ? copyableId(result.gateway.device.workspace_id) : "未分配"}</Descriptions.Item>
        <Descriptions.Item label="同步时间">{formatDateTime(result.gateway.source_ref.synced_at)}</Descriptions.Item>
      </Descriptions>
      {result.warnings?.map((warning) => (
        <Alert key={warning.code} message={warning.message} showIcon type="warning" />
      ))}
      <div className="result-table-block">
        <Typography.Text strong>节点设备</Typography.Text>
        <Table<NodeRow>
          columns={nodeColumns}
          dataSource={result.nodes}
          pagination={false}
          rowKey={(item) => item.device.id}
          scroll={{ x: tableScrollX(nodeColumns) }}
          size="small"
        />
      </div>
      <div className="result-table-block">
        <Typography.Text strong>拓扑关系</Typography.Text>
        <Table<RelationRow>
          columns={relationColumns}
          dataSource={result.relations}
          pagination={false}
          rowKey="id"
          scroll={{ x: tableScrollX(relationColumns) }}
          size="small"
        />
      </div>
    </div>
  );
}

export function AdminMetadataPage() {
  const [capabilityDefinitionForm] = Form.useForm<CapabilityDefinitionValues>();
  const [roleForm] = Form.useForm<SystemRoleValues>();
  const [selectedCapabilityDefinition, setSelectedCapabilityDefinition] = useState<DeviceCapabilityDefinition | null>(null);
  const [selectedRole, setSelectedRole] = useState<SystemRoleDefinition | null>(null);
  const [capabilityDefinitionModalOpen, setCapabilityDefinitionModalOpen] = useState(false);
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const capabilityDefinitions = useQuery({
    queryKey: ["admin", "device-capability-definitions"],
    queryFn: adminDeviceCapabilityDefinitionsApi.list
  });
  const systemRoles = useQuery({
    queryKey: ["admin", "system-roles"],
    queryFn: adminSystemRolesApi.list
  });

  const saveCapabilityDefinition = useMutation({
    mutationFn: (values: CapabilityDefinitionValues) => {
      const body = {
        name: values.name,
        status: values.status,
        sort_order: Number(values.sort_order ?? 0)
      };
      if (selectedCapabilityDefinition) {
        return adminDeviceCapabilityDefinitionsApi.update(selectedCapabilityDefinition.code, body);
      }
      return adminDeviceCapabilityDefinitionsApi.create({
        code: values.code,
        ...body
      });
    },
    onSuccess: () => {
      setCapabilityDefinitionModalOpen(false);
      setSelectedCapabilityDefinition(null);
      capabilityDefinitionForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ["admin", "device-capability-definitions"] });
      void message.success("设备能力已保存");
    }
  });

  const updateRole = useMutation({
    mutationFn: (values: SystemRoleValues) => {
      if (!selectedRole) {
        throw new Error("missing selected role");
      }
      return adminSystemRolesApi.update(selectedRole.code, { name: values.name });
    },
    onSuccess: () => {
      setSelectedRole(null);
      roleForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ["admin", "system-roles"] });
      void message.success("预置角色已保存");
    }
  });

  const capabilityDefinitionColumns: TableColumnsType<DeviceCapabilityDefinition> = [
    { dataIndex: "code", key: "code", title: "Code", width: 180 },
    { dataIndex: "name", key: "name", title: "名称", width: 180 },
    {
      dataIndex: "status",
      key: "status",
      title: "状态",
      width: 120,
      render: (value: DeviceCapabilityDefinitionStatus) => <Tag color={value === "active" ? "green" : "default"}>{value}</Tag>
    },
    { dataIndex: "sort_order", key: "sort", title: "排序", width: 100 },
    {
      key: "actions",
      title: "操作",
      fixed: "right",
      width: 90,
      render: (_, item) => (
        <Button
          onClick={() => {
            setSelectedCapabilityDefinition(item);
            capabilityDefinitionForm.setFieldsValue({
              code: item.code,
              name: item.name,
              status: item.status,
              sort_order: item.sort_order
            });
            setCapabilityDefinitionModalOpen(true);
          }}
          size="small"
          type="link"
        >
          编辑
        </Button>
      )
    }
  ];

  const roleColumns: TableColumnsType<SystemRoleDefinition> = [
    { dataIndex: "code", key: "code", title: "Code", width: 220 },
    { dataIndex: "name", key: "name", title: "名称", width: 220 },
    { dataIndex: "updated_at", key: "updated", title: "更新时间", width: 180, render: formatDateTime },
    {
      key: "actions",
      title: "操作",
      fixed: "right",
      width: 90,
      render: (_, item) => (
        <Button
          onClick={() => {
            setSelectedRole(item);
            roleForm.setFieldsValue({ name: item.name });
          }}
          size="small"
          type="link"
        >
          编辑
        </Button>
      )
    }
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Typography.Title level={2}>元数据管理</Typography.Title>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void capabilityDefinitions.refetch()}>
            刷新能力
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void systemRoles.refetch()}>
            刷新角色
          </Button>
        </Space>
      </div>

      <Card
        title={<Typography.Text strong>设备能力</Typography.Text>}
        extra={
          <Button
            onClick={() => {
              setSelectedCapabilityDefinition(null);
              capabilityDefinitionForm.setFieldsValue({ code: "", name: "", status: "active", sort_order: 1000 });
              setCapabilityDefinitionModalOpen(true);
            }}
            type="primary"
          >
            新增能力
          </Button>
        }
      >
        {capabilityDefinitions.error ? <Alert message={formatApiError(capabilityDefinitions.error)} showIcon type="error" /> : null}
        <Table<DeviceCapabilityDefinition>
          columns={capabilityDefinitionColumns}
          dataSource={capabilityDefinitions.data?.items ?? []}
          loading={capabilityDefinitions.isLoading}
          pagination={false}
          rowKey="code"
          scroll={{ x: tableScrollX(capabilityDefinitionColumns) }}
          size="small"
        />
      </Card>

      <Card title={<Typography.Text strong>预置角色</Typography.Text>}>
        {systemRoles.error ? <Alert message={formatApiError(systemRoles.error)} showIcon type="error" /> : null}
        <Table<SystemRoleDefinition>
          columns={roleColumns}
          dataSource={systemRoles.data?.items ?? []}
          loading={systemRoles.isLoading}
          pagination={false}
          rowKey="code"
          scroll={{ x: tableScrollX(roleColumns) }}
          size="small"
        />
      </Card>

      <Modal
        confirmLoading={saveCapabilityDefinition.isPending}
        destroyOnHidden
        okText="保存"
        onCancel={() => {
          setCapabilityDefinitionModalOpen(false);
          setSelectedCapabilityDefinition(null);
          capabilityDefinitionForm.resetFields();
        }}
        onOk={() => capabilityDefinitionForm.submit()}
        open={capabilityDefinitionModalOpen}
        title={selectedCapabilityDefinition ? "编辑设备能力" : "新增设备能力"}
      >
        <Form<CapabilityDefinitionValues>
          form={capabilityDefinitionForm}
          layout="vertical"
          onFinish={(values) => saveCapabilityDefinition.mutate(values)}
        >
          <Form.Item label="Code" name="code" rules={[{ required: true, message: "请输入 Code" }]}>
            <Input disabled={Boolean(selectedCapabilityDefinition)} />
          </Form.Item>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
            <Input />
          </Form.Item>
          <Form.Item label="状态" name="status" rules={[{ required: true, message: "请选择状态" }]}>
            <Select
              options={[
                { label: "active", value: "active" },
                { label: "disabled", value: "disabled" }
              ]}
            />
          </Form.Item>
          <Form.Item label="排序" name="sort_order" rules={[{ required: true, message: "请输入排序" }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
        {saveCapabilityDefinition.error ? <Alert message={formatApiError(saveCapabilityDefinition.error)} showIcon type="error" /> : null}
      </Modal>

      <Modal
        confirmLoading={updateRole.isPending}
        destroyOnHidden
        okText="保存"
        onCancel={() => {
          setSelectedRole(null);
          roleForm.resetFields();
        }}
        onOk={() => roleForm.submit()}
        open={Boolean(selectedRole)}
        title="编辑预置角色"
      >
        {selectedRole ? (
          <div className="drawer-stack">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Code">{selectedRole.code}</Descriptions.Item>
            </Descriptions>
            <Form<SystemRoleValues> form={roleForm} layout="vertical" onFinish={(values) => updateRole.mutate(values)}>
              <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
                <Input />
              </Form.Item>
            </Form>
            {updateRole.error ? <Alert message={formatApiError(updateRole.error)} showIcon type="error" /> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function AdminDeviceChildrenTable({ deviceId }: { deviceId: string }) {
  const children = useQuery({
    queryKey: ["admin", "device-children", deviceId],
    queryFn: () => adminDevicesApi.children(deviceId)
  });
  const columns: TableColumnsType<DeviceChild> = [
    {
      key: "device",
      title: "节点设备",
      width: 260,
      render: (_, item) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{item.device.name}</Typography.Text>
          <Typography.Text type="secondary">{item.device.serial_no}</Typography.Text>
        </Space>
      )
    },
    { key: "external", title: "外部节点 ID", width: 130, render: (_, item) => item.relation.external_child_device_id },
    {
      key: "assignment",
      title: "当前分配",
      width: 220,
      render: (_, item) => (item.device.workspace_id ? copyableId(item.device.workspace_id) : <Tag>未分配</Tag>)
    },
    {
      key: "status",
      title: "状态",
      width: 100,
      render: (_, item) => <Tag color={statusColor(item.device.status)}>{item.device.status}</Tag>
    },
    { key: "id", title: "设备 ID", width: 240, render: (_, item) => copyableId(item.device.id) }
  ];

  if (children.error) {
    return <Alert message={formatApiError(children.error)} showIcon type="error" />;
  }
  return (
    <Table<DeviceChild>
      columns={columns}
      dataSource={children.data?.items ?? []}
      loading={children.isLoading}
      pagination={false}
      rowKey={(item) => item.relation.id}
      scroll={{ x: tableScrollX(columns) }}
      size="small"
    />
  );
}

function topologyTransferItem(device: Device, externalChildDeviceId?: number): TopologyTransferItem {
  const title = device.name || device.serial_no || device.id;
  const descriptionParts = [
    device.serial_no,
    device.id,
    externalChildDeviceId ? `外部 ${externalChildDeviceId}` : undefined
  ].filter(Boolean);
  return {
    key: device.id,
    title,
    description: descriptionParts.join(" · "),
    searchText: [title, ...descriptionParts].join(" ").toLocaleLowerCase(),
    device,
    externalChildDeviceId
  };
}

const filterTopologyTransferItem: TransferProps<TopologyTransferItem>["filterOption"] = (inputValue, item) =>
  item.searchText.includes(inputValue.trim().toLocaleLowerCase());

function TopologyTransferLabel({ item }: { item: TopologyTransferItem }) {
  return (
    <span className="topology-transfer-item">
      <Typography.Text strong ellipsis title={item.title}>
        {item.title}
      </Typography.Text>
      <Typography.Text className="topology-transfer-item-meta" type="secondary" ellipsis title={item.description}>
        {item.description}
      </Typography.Text>
    </span>
  );
}

function JSONSummary({ value }: { value: Record<string, unknown> }) {
  const text = JSON.stringify(value);
  return (
    <Typography.Text className="mono json-summary" copyable={{ text, tooltips: ["复制配置", "已复制"] }} title={text}>
      {text}
    </Typography.Text>
  );
}

function optional(value?: string): string | undefined {
  return value?.trim() || undefined;
}

function topologyTag(device: Device) {
  if (device.topology_role === "gateway") {
    return <Tag color="geekblue">组网站 · {device.child_count} 节点</Tag>;
  }
  if (device.topology_role === "gateway_node") {
    return <Tag color="cyan">节点</Tag>;
  }
  if (device.topology_role === "camera") {
    return <Tag color="magenta">相机</Tag>;
  }
  return <Tag>普通设备</Tag>;
}

function lifecycleTag(status: DeviceLifecycleStatus) {
  const label = lifecycleOptions.find((item) => item.value === status)?.label ?? status;
  const color: Record<DeviceLifecycleStatus, string> = {
    inbound: "default",
    installed: "blue",
    online: "green",
    maintenance: "gold",
    repairing: "orange",
    retired: "red"
  };
  return <Tag color={color[status]}>{label}</Tag>;
}

function workspaceName(workspaceId: string, workspaces: Array<{ id: string; name: string }>): string {
  return workspaces.find((item) => item.id === workspaceId)?.name ?? "未知工作区";
}
