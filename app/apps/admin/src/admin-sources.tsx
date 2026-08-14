import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Database,
  Network,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "@thcpn/admin-ui";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { Badge, PageHeader, Panel, StateView } from "@thcpn/ui";

const string = (input: unknown, fallback: unknown = "—"): string =>
  input === undefined || input === null || input === ""
    ? String(fallback)
    : String(input);
const isCarbonSource = (source: JsonRecord) =>
  string(source.dsn_secret_ref, "").toUpperCase().includes("CARBON_SINK");
type Mode = "create" | "edit" | "station" | "gateway" | "camera" | null;
const formatTime = (input: unknown) => input ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(input))) : "—";
const validateSecretRef = (_: unknown, input: unknown) => {
  const value = String(input ?? "").trim();
  if (!/^env:[A-Za-z_][A-Za-z0-9_]*$/.test(value))
    return Promise.reject(new Error("请输入环境变量引用，例如 env:THCPN_MYSQL_DSN"));
  return Promise.resolve();
};

export function AdminSourcesPage() {
  const query = useQuery({
    queryKey: ["admin", "sources"],
    queryFn: api.admin.sources,
  });
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<JsonRecord | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [syncResult, setSyncResult] = useState<JsonRecord | null>(null);
  const [fullSyncSource, setFullSyncSource] = useState<JsonRecord | null>(null);
  const [fullSyncBusy, setFullSyncBusy] = useState(false);
  const [carbonSyncSource, setCarbonSyncSource] = useState<JsonRecord | null>(null);
  const [carbonSyncBusy, setCarbonSyncBusy] = useState(false);
  const [form] = Form.useForm();
  const rows = useMemo(
    () =>
      (query.data?.items ?? []).filter((item) =>
        `${string(item.name)} ${string(item.type)} ${string(item.id)}`
          .toLowerCase()
          .includes(keyword.toLowerCase()),
      ),
    [keyword, query.data],
  );
  const open = (next: Exclude<Mode, null>, record?: JsonRecord) => {
    const source = record ?? selected;
    setSelected(source ?? null);
    setMode(next);
    if (next === "create")
      form.setFieldsValue({
        name: "",
        type: "mysql",
        dsn_secret_ref: "env:",
      });
    else if (next === "edit")
      form.setFieldsValue({
        name: source?.name,
        type: source?.type,
        dsn_secret_ref: source?.dsn_secret_ref,
        status: source?.status,
      });
    else if (next === "station")
      form.setFieldsValue({
        external_device_id: undefined,
      });
    else if (next === "gateway")
      form.setFieldsValue({
        external_gateway_id: undefined,
      });
    else
      form.setFieldsValue({
        external_camera_id: undefined,
      });
  };
  const syncAll = async () => {
    if (!fullSyncSource) return;
    setFullSyncBusy(true);
    setFeedback("");
    setSyncResult(null);
    try {
      const response = await api.admin.syncAllDevices(string(fullSyncSource.id));
      setSyncResult(response);
      setFullSyncSource(null);
      setFeedback("全量同步已完成");
      await query.refetch();
    } catch (error) {
      const detail = formatApiError(error);
      setFeedback(`${detail.message}${detail.requestId ? ` · request id ${detail.requestId}` : ""}`);
    } finally {
      setFullSyncBusy(false);
    }
  };
  const syncAllCarbon = async () => {
    if (!carbonSyncSource) return;
    setCarbonSyncBusy(true);
    setFeedback("");
    setSyncResult(null);
    try {
      const response = await api.admin.syncAllCarbonDevices(string(carbonSyncSource.id));
      setSyncResult(response);
      setCarbonSyncSource(null);
      setFeedback("Carbon v2 全量同步已完成");
      await query.refetch();
    } catch (error) {
      const detail = formatApiError(error);
      setFeedback(`${detail.message}${detail.requestId ? ` · request id ${detail.requestId}` : ""}`);
    } finally {
      setCarbonSyncBusy(false);
    }
  };
  const close = () => {
    setMode(null);
    form.resetFields();
  };
  const submit = async () => {
    setBusy(true);
    setFeedback("");
    setSyncResult(null);
    try {
      const payload = await form.validateFields();
      let response: unknown;
      if (mode === "create") response = await api.admin.createSource({ name: payload.name, type: payload.type, dsn_secret_ref: payload.dsn_secret_ref });
      else if (!selected) throw new Error("请先选择数据源");
      else if (mode === "edit")
        response = await api.admin.updateSource(string(selected.id), payload);
      else if (mode === "station")
        response = await api.admin.syncStation(string(selected.id), payload);
      else if (mode === "gateway")
        response = await api.admin.syncGateway(string(selected.id), payload);
      else if (mode === "camera")
        response = await api.admin.syncCamera(string(selected.id), payload);
      if (mode === "station" || mode === "gateway" || mode === "camera")
        setSyncResult(response as JsonRecord);
      setFeedback(
        mode === "station" || mode === "gateway" || mode === "camera"
          ? "同步任务已完成"
          : mode === "create"
            ? "数据源已创建"
            : "数据源已更新",
      );
      close();
      await query.refetch();
    } catch (error) {
      if ((error as any)?.errorFields) return;
      const detail = formatApiError(error);
      setFeedback(
        `${detail.message}${detail.requestId ? ` · request id ${detail.requestId}` : ""}`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="System / sources"
        title="数据源"
        description="管理系统级连接元数据，并从兼容的 THCPN MySQL 数据源同步设备资产。明文 DSN 不进入前端。"
        actions={
          <Space>
            <Button
              icon={<RefreshCw size={14} />}
              onClick={() => void query.refetch()}
            >
              刷新
            </Button>
            <Button
              type="primary"
              icon={<Plus size={14} />}
              onClick={() => open("create")}
            >
              新建数据源
            </Button>
          </Space>
        }
      />
      <Panel>
        <div className="admin-list-toolbar">
          <div className="admin-search">
            <Search size={15} />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索名称、类型或 ID"
            />
          </div>
          <Badge tone="info">{rows.length} 个数据源</Badge>
        </div>
        {feedback && <div className="admin-feedback">{feedback}</div>}
        {query.isLoading ? (
          <StateView
            type="loading"
            title="正在加载数据源"
            description="正在读取系统连接元数据。"
          />
        ) : query.error ? (
          <StateView
            type="error"
            title="数据源加载失败"
            description={formatApiError(query.error).message}
            requestId={formatApiError(query.error).requestId}
          />
        ) : rows.length ? (
          <Table
            rowKey="id"
            dataSource={rows}
            rowClassName={(record) =>
              record.id === selected?.id ? "admin-selected-row" : ""
            }
            columns={[
              {
                title: "数据源",
                dataIndex: "name",
                render: (_, record: JsonRecord) => (
                  <div>
                    <div className="cell-title">{string(record.name)}</div>
                    <div className="cell-sub mono">{string(record.id)}</div>
                  </div>
                ),
              },
              {
                title: "类型",
                dataIndex: "type",
                width: 120,
                render: (item) => (
                  <Tag color={item === "mysql" ? "blue" : "default"}>
                    {item}
                  </Tag>
                ),
              },
              {
                title: "Secret 引用",
                dataIndex: "dsn_secret_ref",
                render: (item) => <span className="mono">{string(item)}</span>,
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 110,
                render: (item) => (
                  <Tag color={item === "active" ? "green" : "default"}>
                    {item}
                  </Tag>
                ),
              },
              { title: "创建时间", dataIndex: "created_at", width: 180, render: formatTime },
              {
                title: "操作",
                width: 360,
                render: (_, record: JsonRecord) => {
                  const carbonSource = isCarbonSource(record);
                  return <Space size={2}>
                    <Button type="link" onClick={() => open("edit", record)}>
                      编辑
                    </Button>
                    {!carbonSource ? <Button
                      type="link"
                      disabled={record.type !== "mysql"}
                      onClick={() => open("station", record)}
                    >
                      同步标准站
                    </Button> : null}
                    {!carbonSource ? <Button
                      type="link"
                      disabled={record.type !== "mysql"}
                      onClick={() => setFullSyncSource(record)}
                    >
                      全量同步
                    </Button> : null}
                    {!carbonSource ? <Button
                      type="link"
                      disabled={record.type !== "mysql"}
                      onClick={() => open("gateway", record)}
                    >
                      同步网关及节点
                    </Button> : null}
                    {!carbonSource ? <Button
                      type="link"
                      disabled={record.type !== "mysql"}
                      onClick={() => open("camera", record)}
                    >
                      同步监控站
                    </Button> : null}
                    {carbonSource ? <Button
                      type="link"
                      disabled={record.type !== "mysql"}
                      onClick={() => setCarbonSyncSource(record)}
                    >
                      同步碳汇设备
                    </Button> : null}
                  </Space>;
                },
              },
            ]}
            pagination={{ pageSize: 12, showSizeChanger: false }}
            scroll={{ x: 1040 }}
          />
        ) : (
          <StateView
            type="empty"
            title="暂无数据源"
            description="创建第一个数据源后即可同步系统设备。"
          />
        )}
      </Panel>
      {syncResult && (syncResult.total !== undefined ? <FullSyncSummary result={syncResult} /> : <SyncResultSummary result={syncResult} />)}
      <Modal
        title={`全量同步设备 · ${string(fullSyncSource?.name)}`}
        open={Boolean(fullSyncSource)}
        confirmLoading={fullSyncBusy}
        okText="开始全量同步"
        cancelText="取消"
        onOk={() => void syncAll()}
        onCancel={() => { if (!fullSyncBusy) setFullSyncSource(null); }}
      >
        <p>将读取外部 <code>devices</code>、<code>gate_node</code> 和 <code>cameras</code>，同步设备、配置、DataStream、绑定、拓扑及监控站。</p>
        <p>设备不会自动分配到工作区；已经同步的设备将更新，缺少配置的设备会单独记录失败原因。</p>
      </Modal>
      <Modal
        title={`同步 Carbon v2 设备 · ${string(carbonSyncSource?.name)}`}
        open={Boolean(carbonSyncSource)}
        confirmLoading={carbonSyncBusy}
        okText="开始同步"
        cancelText="取消"
        onOk={() => void syncAllCarbon()}
        onCancel={() => { if (!carbonSyncBusy) setCarbonSyncSource(null); }}
      >
        <p>只读取 <code>devices.device_type = carbon-sink-v2</code>，一个采集器同步为一个平台设备，节点数量保存为设备资料。</p>
        <p>数据查询使用 Carbon 专属页面，原始采样以 <code>device_data_next_YYYYMM</code> 为准，通量以 <code>carbon_flux_YYYYMM</code> 为准。</p>
      </Modal>
      <Drawer
        title={drawerTitle(mode, selected)}
        open={Boolean(mode)}
        onClose={close}
        size={560}
        extra={
          <Space>
            <Button onClick={close}>取消</Button>
            <Button type="primary" loading={busy} onClick={() => void submit()}>
              {mode === "station" || mode === "gateway" || mode === "camera" ? "开始同步" : "保存"}
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          {mode === "create" || mode === "edit" ? (
            <SourceFields editing={mode === "edit"} />
          ) : mode === "station" ? (
            <StationFields />
          ) : mode === "gateway" ? (
            <GatewayFields />
          ) : (
            <CameraFields />
          )}
        </Form>
        <div className="drawer-note">
          {mode === "station" || mode === "gateway" || mode === "camera" ? (
            <>
              <Network size={15} />
              同步会读取外部 THCPN
              数据库并更新系统设备、数据流、绑定和拓扑。同步完成后再到设备管理中分配工作区。
            </>
          ) : (
            <>
              <Database size={15} />
              这里只保存 Secret 引用，例如
              `env:THCPN_MYSQL_DSN`。前端不会读取或保存明文 DSN。
            </>
          )}
        </div>
      </Drawer>
    </>
  );
}

function SyncResultSummary({ result }: { result: JsonRecord }) {
  const gateway = result.gateway as JsonRecord | undefined;
  const primary = gateway ?? result;
  const device = primary.device as JsonRecord | undefined;
  const nodes = (result.nodes as JsonRecord[] | undefined) ?? [];
  const streams = (primary.data_streams as JsonRecord[] | undefined) ?? [];
  const bindings = (primary.bindings as JsonRecord[] | undefined) ?? [];
  const nodeStreams = nodes.reduce((count, node) => count + (((node.data_streams as JsonRecord[] | undefined) ?? []).length), 0);
  const nodeBindings = nodes.reduce((count, node) => count + (((node.bindings as JsonRecord[] | undefined) ?? []).length), 0);
  const relations = (result.relations as JsonRecord[] | undefined) ?? [];
  const warnings = (result.warnings as Array<{ code?: string; message?: string }> | undefined) ?? [];
  return <Panel className="section-gap sync-result"><div className="panel-header"><div><h2 className="panel-title">最近同步结果</h2><div className="panel-kicker">{string(device?.name, "设备同步")} · {string(device?.serial_no, device?.id)}</div></div><Tag color={warnings.length ? "orange" : "green"}>{warnings.length ? `${warnings.length} 条警告` : "同步成功"}</Tag></div><div className="sync-result-metrics"><div><strong>{nodes.length || 1}</strong><span>{nodes.length ? "节点" : "设备"}</span></div><div><strong>{streams.length + nodeStreams}</strong><span>DataStream</span></div><div><strong>{bindings.length + nodeBindings}</strong><span>Binding</span></div><div><strong>{relations.length}</strong><span>拓扑关系</span></div></div>{nodes.length ? <div className="sync-node-list">{nodes.slice(0, 8).map((node, index) => { const item = node.device as JsonRecord | undefined; return <div key={string(item?.id, index)}><span>{string(item?.name)}</span><code>{string(item?.serial_no, item?.id)}</code></div>; })}</div> : null}{warnings.length ? <div className="sync-warnings">{warnings.map((warning, index) => <div key={`${warning.code}-${index}`}><strong>{warning.code ?? "warning"}</strong><span>{warning.message ?? "同步过程中返回警告"}</span></div>)}</div> : null}</Panel>;
}

function FullSyncSummary({ result }: { result: JsonRecord }) {
  const failures = (result.failures as Array<{ external_device_id?: number; error?: string }> | undefined) ?? [];
  return (
    <Panel className="section-gap sync-result">
      <div className="panel-header">
        <div><h2 className="panel-title">最近全量同步结果</h2><div className="panel-kicker">已处理外部 devices 表中的设备</div></div>
        <Tag color={Number(result.failed ?? 0) || Number(result.topology_failed ?? 0) ? "orange" : "green"}>{Number(result.failed ?? 0) || Number(result.topology_failed ?? 0) ? "部分完成" : "同步成功"}</Tag>
      </div>
      <div className="sync-result-metrics">
        <div><strong>{string(result.total, 0)}</strong><span>发现设备</span></div>
        <div><strong>{string(result.synced, 0)}</strong><span>已同步</span></div>
        <div><strong>{string(result.created, 0)}</strong><span>新增</span></div>
        <div><strong>{string(result.updated, 0)}</strong><span>更新</span></div>
        <div><strong>{string(result.unconfigured, 0)}</strong><span>无配置</span></div>
        <div><strong>{string(result.failed, 0)}</strong><span>失败</span></div>
        <div><strong>{string(result.relations, 0)}</strong><span>拓扑关系</span></div>
        <div><strong>{string(result.topology_failed, 0)}</strong><span>拓扑失败</span></div>
        <div><strong>{string(result.cameras_synced, 0)}</strong><span>监控站</span></div>
        <div><strong>{string(result.cameras_failed, 0)}</strong><span>监控站失败</span></div>
      </div>
      {failures.length ? <div className="sync-warnings">{failures.slice(0, 20).map((failure, index) => <div key={`${failure.external_device_id}-${index}`}><strong>外部设备 {failure.external_device_id}</strong><span>{failure.error ?? "同步失败"}</span></div>)}</div> : null}
    </Panel>
  );
}

function drawerTitle(mode: Mode, selected: JsonRecord | null) {
  if (mode === "create") return "新建数据源";
  if (mode === "edit") return `编辑数据源 · ${string(selected?.name)}`;
  if (mode === "station") return `同步标准站设备 · ${string(selected?.name)}`;
  if (mode === "gateway") return `同步网关及节点 · ${string(selected?.name)}`;
  return `同步监控站 · ${string(selected?.name)}`;
}
function SourceFields({ editing }: { editing: boolean }) {
  return (
    <>
      <Form.Item
        name="name"
        label="名称"
        rules={[{ required: true, message: "请输入名称" }]}
      >
        <Input placeholder="例如 THCPN 生产库" />
      </Form.Item>
      <Form.Item name="type" label="连接类型" rules={[{ required: true }]}>
        <Select
          options={["mysql", "postgres", "clickhouse", "http_api", "file"].map(
            (item) => ({ value: item, label: item }),
          )}
        />
      </Form.Item>
      <Form.Item
        name="dsn_secret_ref"
        label="Secret 引用"
        rules={[{ required: true, message: "请输入 Secret 引用" }, { validator: validateSecretRef }]}
        validateFirst
      >
        <Input placeholder="env:THCPN_MYSQL_DSN" />
      </Form.Item>
      {editing && (
        <Form.Item name="status" label="状态">
          <Select
            options={[
              { value: "active", label: "启用" },
              { value: "disabled", label: "停用" },
              { value: "archived", label: "归档" },
            ]}
          />
        </Form.Item>
      )}
    </>
  );
}
function StationFields() {
  return (
    <>
      <Form.Item
        name="external_device_id"
        label="外部设备 ID"
        rules={[{ required: true, message: "请输入外部设备 ID" }]}
      >
        <InputNumber min={1} precision={0} style={{ width: "100%" }} />
      </Form.Item>
      <div className="drawer-note">名称、序列号和产品 ID 将优先读取外部设备；缺失时由平台自动生成。同步不会自动分配工作区。</div>
    </>
  );
}
function GatewayFields() {
  return (
    <>
      <Form.Item
        name="external_gateway_id"
        label="外部网关 ID"
        rules={[{ required: true, message: "请输入外部网关 ID" }]}
      >
        <InputNumber min={1} precision={0} style={{ width: "100%" }} />
      </Form.Item>
      <div className="drawer-note">将同步网关、其全部有效节点及网关节点拓扑；不会分配到工作区。</div>
    </>
  );
}

function CameraFields() {
  return (
    <>
      <Form.Item
        name="external_camera_id"
        label="外部监控站 ID"
        rules={[{ required: true, message: "请输入外部 cameras.id" }]}
      >
        <InputNumber min={1} precision={0} style={{ width: "100%" }} />
      </Form.Item>
      <div className="drawer-note">将读取 cameras 表并同步监控站名称、萤石设备序列号和通道；不会分配到工作区。</div>
    </>
  );
}
