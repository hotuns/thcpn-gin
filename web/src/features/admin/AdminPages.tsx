import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudSyncOutlined, DatabaseOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from "antd";
import type { TableColumnsType } from "antd";
import {
  adminDataSourcesApi,
  adminProjectsApi,
  adminSitesApi,
  adminWorkspacesApi,
  formatApiError,
  type DataSource,
  type DataSourceStatus,
  type DataSourceType,
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

interface CreateDataSourceValues {
  name: string;
  type: DataSourceType;
  dsn_secret_ref: string;
}

interface SyncTHCPNValues {
  data_source_id: string;
  target_workspace_id: string;
  external_device_id: number;
  project_id?: string;
  site_id?: string;
  product_id?: string;
  serial_no?: string;
  name?: string;
}

export function AdminOverviewPage() {
  const dataSources = useQuery({ queryKey: ["admin", "data-sources"], queryFn: adminDataSourcesApi.list });
  const workspaces = useQuery({ queryKey: ["admin", "workspaces"], queryFn: adminWorkspacesApi.list });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Typography.Title level={2}>后台总览</Typography.Title>
          <Typography.Text type="secondary">系统级设备源和 THCPN 设备同步只在后台维护。</Typography.Text>
        </div>
      </div>
      <Row gutter={[16, 16]}>
        <Col md={8} xs={24}>
          <Card>
            <Space orientation="vertical" size={4}>
              <Typography.Text type="secondary">系统数据源</Typography.Text>
              <Typography.Title level={2}>{dataSources.data?.items.length ?? "-"}</Typography.Title>
            </Space>
          </Card>
        </Col>
        <Col md={8} xs={24}>
          <Card>
            <Space orientation="vertical" size={4}>
              <Typography.Text type="secondary">目标工作区</Typography.Text>
              <Typography.Title level={2}>{workspaces.data?.items.length ?? "-"}</Typography.Title>
            </Space>
          </Card>
        </Col>
        <Col md={8} xs={24}>
          <Card>
            <Space orientation="vertical" size={4}>
              <Typography.Text type="secondary">接入主路径</Typography.Text>
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
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [syncResult, setSyncResult] = useState<THCPNStandardStationSyncResult | null>(null);
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
        target_workspace_id: values.target_workspace_id,
        external_device_id: values.external_device_id,
        project_id: optional(values.project_id),
        site_id: optional(values.site_id),
        product_id: optional(values.product_id),
        serial_no: optional(values.serial_no),
        name: optional(values.name)
      }),
    onSuccess: (result, values) => {
      setSyncResult(result);
      void queryClient.invalidateQueries({ queryKey: ["devices", values.target_workspace_id] });
      void queryClient.invalidateQueries({ queryKey: ["data-streams"] });
      void queryClient.invalidateQueries({ queryKey: ["data-stream-bindings"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "data-sources"] });
      void message.success("THCPN 标准站已同步到目标工作区");
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
    { dataIndex: "scope", key: "scope", title: "范围", width: 120, render: (value: string) => <Tag color="blue">{value}</Tag> },
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
          <Typography.Text type="secondary">
            系统管理员维护 THCPN MySQL 设备源，并把外部标准站同步到指定工作区。
          </Typography.Text>
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

      <Card
        title={
          <Space orientation="vertical" size={0}>
            <Typography.Text strong>同步 THCPN 标准站</Typography.Text>
            <Typography.Text type="secondary">
              读取外部设备和最新配置，在目标工作区创建或更新设备、数据流和绑定。
            </Typography.Text>
          </Space>
        }
      >
        {!dataSources.isLoading && activeMySQLSources.length === 0 ? (
          <Alert message="没有 active 的系统级 MySQL 数据源，先创建并启用 THCPN 数据源。" showIcon type="warning" />
        ) : null}
        <Form<SyncTHCPNValues>
          form={syncForm}
          layout="vertical"
          onFinish={(values) => syncTHCPN.mutate(values)}
          onValuesChange={(changed) => {
            if ("target_workspace_id" in changed) {
              const nextWorkspaceId = changed.target_workspace_id || "";
              setSelectedWorkspaceId(nextWorkspaceId);
              setSelectedProjectId("");
              syncForm.setFieldsValue({ project_id: undefined, site_id: undefined });
            }
            if ("project_id" in changed) {
              const nextProjectId = changed.project_id || "";
              setSelectedProjectId(nextProjectId);
              syncForm.setFieldValue("site_id", undefined);
            }
          }}
        >
          <div className="form-grid">
            <Form.Item label="数据源" name="data_source_id" rules={[{ required: true, message: "请选择 THCPN MySQL 数据源" }]}>
              <Select disabled={activeMySQLSources.length === 0} loading={dataSources.isLoading} options={sourceOptions} placeholder="选择系统级 MySQL 数据源" />
            </Form.Item>
            <Form.Item label="目标工作区" name="target_workspace_id" rules={[{ required: true, message: "请选择目标工作区" }]}>
              <Select loading={workspaces.isLoading} options={workspaceOptions} placeholder="选择设备归属工作区" showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item label="项目" name="project_id">
              <Select allowClear disabled={!selectedWorkspaceId} loading={projects.isLoading} options={projectOptions} placeholder="可选" showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item label="站点" name="site_id">
              <Select allowClear disabled={!selectedProjectId} loading={sites.isLoading} options={siteOptions} placeholder="先选择项目" showSearch optionFilterProp="label" />
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
        {workspaces.error ? <Alert message={formatApiError(workspaces.error)} showIcon type="error" /> : null}
        {projects.error ? <Alert message={formatApiError(projects.error)} showIcon type="error" /> : null}
        {sites.error ? <Alert message={formatApiError(sites.error)} showIcon type="error" /> : null}
        {syncTHCPN.error ? <Alert message={formatApiError(syncTHCPN.error)} showIcon type="error" /> : null}
        {syncResult ? <THCPNSyncResultView result={syncResult} /> : null}
      </Card>
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
        <Descriptions.Item label="目标工作区">{copyableId(result.device.workspace_id)}</Descriptions.Item>
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
