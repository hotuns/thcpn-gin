import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
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
  Select,
  Space,
  Table,
  Tag,
} from "@thcpn/admin-ui";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { Badge, PageHeader, Panel, StateView } from "@thcpn/ui";

type SourceMode = "create" | "edit" | null;
type SyncAction = "single" | "full";
type THCPNSingleAction = "station" | "gateway";
type SourceFamily = "thcpn" | "carbon" | "lorawan_v2";
type SyncOutcome = { action: SyncAction; result: JsonRecord };

const string = (input: unknown, fallback: unknown = "—"): string =>
  input === undefined || input === null || input === ""
    ? String(fallback)
    : String(input);
const formatTime = (input: unknown) => input ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(input))) : "—";
const validateSecretRef = (_: unknown, input: unknown) => {
  const value = String(input ?? "").trim();
  if (!/^env:[A-Za-z_][A-Za-z0-9_]*$/.test(value))
    return Promise.reject(new Error("请输入环境变量引用，例如 env:THCPN_MYSQL_DSN"));
  return Promise.resolve();
};
const sourceFamilyOf = (source: JsonRecord): SourceFamily | null =>
  source.source_family === "thcpn" || source.source_family === "carbon" || source.source_family === "lorawan_v2"
    ? source.source_family
    : null;
const sourceFamilyLabel = (family: SourceFamily | null) =>
  family === "thcpn" ? "THCPN" : family === "carbon" ? "Carbon" : family === "lorawan_v2" ? "LoRa V2" : "未分类";

export function AdminSourcesPage() {
  const query = useQuery({
    queryKey: ["admin", "sources"],
    queryFn: api.admin.sources,
  });
  const [keyword, setKeyword] = useState("");
  const [editingSource, setEditingSource] = useState<JsonRecord | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [syncSource, setSyncSource] = useState<JsonRecord | null>(null);
  const [syncAction, setSyncAction] = useState<SyncAction>("single");
  const [thcpnSingleAction, setTHCPNSingleAction] = useState<THCPNSingleAction>("station");
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState("");
  const [syncOutcome, setSyncOutcome] = useState<SyncOutcome | null>(null);
  const [loraSource, setLoraSource] = useState<JsonRecord | null>(null);
  const [sourceForm] = Form.useForm();
  const [syncForm] = Form.useForm();
  const syncFamily = syncSource ? sourceFamilyOf(syncSource) : null;
  const carbonDevices = useQuery({
    queryKey: ["admin", "sources", "carbon-devices", string(syncSource?.id, "")],
    queryFn: () => api.admin.carbonDevices(string(syncSource?.id, "")),
    enabled: Boolean(syncSource && syncFamily === "carbon" && syncAction === "single"),
  });
  const rows = useMemo(
    () =>
      (query.data?.items ?? []).filter((item) =>
        `${string(item.name)} ${string(item.type)} ${string(item.source_family, "")} ${string(item.id)}`
          .toLowerCase()
          .includes(keyword.toLowerCase()),
      ),
    [keyword, query.data],
  );
  const carbonOptions = useMemo(
    () =>
      (carbonDevices.data?.items ?? []).map((item) => ({
        value: Number(item.id),
        label: `${string(item.name)} · ${string(item.sn)} · #${string(item.id)}`,
      })),
    [carbonDevices.data],
  );

  const openSourceForm = (next: Exclude<SourceMode, null>, source?: JsonRecord) => {
    setEditingSource(source ?? null);
    setSourceMode(next);
    sourceForm.resetFields();
    if (next === "create") {
      sourceForm.setFieldsValue({
        name: "",
        type: "mysql",
        dsn_secret_ref: "env:",
        source_family: undefined,
      });
      return;
    }
    sourceForm.setFieldsValue({
      name: source?.name,
      type: source?.type,
      dsn_secret_ref: source?.dsn_secret_ref,
      source_family: source?.source_family ?? undefined,
      status: source?.status,
    });
  };
  const closeSourceForm = () => {
    setSourceMode(null);
    setEditingSource(null);
    sourceForm.resetFields();
  };
  const saveSource = async () => {
    setSourceBusy(true);
    setFeedback("");
    try {
      const values = await sourceForm.validateFields();
      const payload = {
        name: values.name,
        type: values.type,
        dsn_secret_ref: values.dsn_secret_ref,
        source_family: values.source_family || "",
      };
      if (sourceMode === "create") {
        await api.admin.createSource(payload);
        setFeedback("数据源已创建");
      } else if (editingSource) {
        await api.admin.updateSource(string(editingSource.id), {
          ...payload,
          status: values.status,
        });
        setFeedback("数据源已更新");
      }
      closeSourceForm();
      await query.refetch();
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) return;
      const detail = formatApiError(error);
      setFeedback(`${detail.message}${detail.requestId ? ` · request id ${detail.requestId}` : ""}`);
    } finally {
      setSourceBusy(false);
    }
  };

  const openSync = (source: JsonRecord) => {
    setSyncSource(source);
    setSyncAction("single");
    setTHCPNSingleAction("station");
    setSyncFeedback("");
    setSyncOutcome(null);
    syncForm.resetFields();
  };
  const closeSync = () => {
    setSyncSource(null);
    setSyncFeedback("");
    setSyncOutcome(null);
    syncForm.resetFields();
  };
  const changeSyncAction = (action: SyncAction) => {
    setSyncAction(action);
    setSyncFeedback("");
    setSyncOutcome(null);
    syncForm.resetFields();
  };
  const changeTHCPNSingleAction = (action: THCPNSingleAction) => {
    setTHCPNSingleAction(action);
    setSyncFeedback("");
    setSyncOutcome(null);
    syncForm.resetFields();
  };
  const runSync = async () => {
    if (!syncSource || !syncFamily) return;
    setSyncBusy(true);
    setSyncFeedback("");
    setSyncOutcome(null);
    try {
      const sourceID = string(syncSource.id);
      let result: JsonRecord;
      if (syncAction === "full") {
        result = syncFamily === "thcpn"
          ? await api.admin.syncAllDevices(sourceID)
          : await api.admin.syncAllCarbonDevices(sourceID);
      } else {
        const values = await syncForm.validateFields();
        if (syncFamily === "thcpn") {
          result = thcpnSingleAction === "station"
            ? await api.admin.syncStation(sourceID, { external_device_id: values.external_device_id })
            : await api.admin.syncGateway(sourceID, { external_gateway_id: values.external_gateway_id });
        } else {
          result = await api.admin.syncCarbonDevice(sourceID, {
            external_device_id: Number(values.external_device_id),
          });
        }
      }
      setSyncOutcome({ action: syncAction, result });
      setSyncFeedback("同步已完成");
      await query.refetch();
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) return;
      const detail = formatApiError(error);
      setSyncFeedback(`${detail.message}${detail.requestId ? ` · request id ${detail.requestId}` : ""}`);
    } finally {
      setSyncBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="System / sources"
        title="数据源"
        description="维护系统级连接，并同步已存在的源库设备。设备创建统一在系统设备页面完成。"
        actions={
          <Space>
            <Button icon={<RefreshCw size={14} />} onClick={() => void query.refetch()}>
              刷新
            </Button>
            <Button type="primary" icon={<Plus size={14} />} onClick={() => openSourceForm("create")}>
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
              placeholder="搜索名称、连接类型、业务类型或 ID"
            />
          </div>
          <Badge tone="info">{rows.length} 个数据源</Badge>
        </div>
        {feedback && <div className="admin-feedback">{feedback}</div>}
        {query.isLoading ? (
          <StateView type="loading" title="正在加载数据源" description="正在读取系统连接元数据。" />
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
                title: "连接",
                dataIndex: "type",
                width: 110,
                render: (value) => <Tag color={value === "mysql" ? "blue" : "default"}>{string(value)}</Tag>,
              },
              {
                title: "业务类型",
                width: 120,
                render: (_, record: JsonRecord) => {
                  const family = sourceFamilyOf(record);
                  return <Tag color={family ? "cyan" : "default"}>{sourceFamilyLabel(family)}</Tag>;
                },
              },
              {
                title: "Secret 引用",
                dataIndex: "dsn_secret_ref",
                render: (value) => <span className="mono">{string(value)}</span>,
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 100,
                render: (value) => <Tag color={value === "active" ? "green" : "default"}>{string(value)}</Tag>,
              },
              { title: "创建时间", dataIndex: "created_at", width: 180, render: formatTime },
              {
                title: "操作",
                width: 160,
                render: (_, record: JsonRecord) => {
                  const family = sourceFamilyOf(record);
                  const canSync = record.type === "mysql" && record.status === "active" && family !== null;
                  return <Space size={2}>
                    <Button type="link" onClick={() => openSourceForm("edit", record)}>编辑</Button>
                    {family === "lorawan_v2" ? <Button type="link" disabled={record.type !== "http_api" || record.status !== "active"} onClick={() => setLoraSource(record)}>LoRa 管理</Button> : null}
                    <Button type="link" disabled={!canSync} onClick={() => openSync(record)}>同步设备</Button>
                  </Space>;
                },
              },
            ]}
            pagination={{ pageSize: 12, showSizeChanger: false }}
            scroll={{ x: 1100 }}
          />
        ) : (
          <StateView type="empty" title="暂无数据源" description="创建第一个数据源后即可同步已有设备。" />
        )}
      </Panel>
      <Drawer
        title={sourceMode === "create" ? "新建数据源" : `编辑数据源 · ${string(editingSource?.name)}`}
        open={Boolean(sourceMode)}
        onClose={closeSourceForm}
        size={560}
        extra={<Space><Button onClick={closeSourceForm}>取消</Button><Button type="primary" loading={sourceBusy} onClick={() => void saveSource()}>保存</Button></Space>}
      >
        <Form form={sourceForm} layout="vertical">
          <SourceFields
            editing={sourceMode === "edit"}
            familyLocked={Boolean(editingSource?.source_family_locked)}
            onFamilyChange={(family) => {
              if (family === "lorawan_v2") sourceForm.setFieldValue("type", "http_api");
            }}
          />
        </Form>
        <div className="drawer-note"><Database size={15} />这里只保存 Secret 引用，例如 `env:THCPN_MYSQL_DSN`。业务类型决定可用的设备操作，前端不会读取明文 DSN。</div>
      </Drawer>
      <LoRaWANV2Drawer source={loraSource} onClose={() => setLoraSource(null)} />
      <Drawer
        title={`同步设备 · ${string(syncSource?.name)}`}
        open={Boolean(syncSource)}
        onClose={closeSync}
        size={620}
        extra={<Space><Button onClick={closeSync}>关闭</Button><Button type="primary" loading={syncBusy} onClick={() => void runSync()}>开始同步</Button></Space>}
      >
        <Form form={syncForm} layout="vertical">
          <Form.Item label="同步方式">
            <Select
              value={syncAction}
              onChange={changeSyncAction}
              options={[{ value: "single", label: "单设备同步" }, { value: "full", label: "全量同步" }]}
            />
          </Form.Item>
          {syncAction === "single" && syncFamily === "thcpn" ? (
            <>
              <Form.Item label="设备范围">
                <Select
                  value={thcpnSingleAction}
                  onChange={changeTHCPNSingleAction}
                  options={[{ value: "station", label: "标准站" }, { value: "gateway", label: "网关及节点拓扑" }]}
                />
              </Form.Item>
              {thcpnSingleAction === "station" ? <Form.Item name="external_device_id" label="外部设备 ID" rules={[{ required: true, message: "请输入外部设备 ID" }]}><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item> : <Form.Item name="external_gateway_id" label="外部网关 ID" rules={[{ required: true, message: "请输入外部网关 ID" }]}><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item>}
            </>
          ) : null}
          {syncAction === "single" && syncFamily === "carbon" ? (
            <>
              {carbonDevices.isLoading ? <StateView type="loading" title="正在读取 Carbon 设备" description="正在加载可同步的碳汇设备。" /> : null}
              {carbonDevices.error ? <StateView type="error" title="Carbon 设备加载失败" description={formatApiError(carbonDevices.error).message} requestId={formatApiError(carbonDevices.error).requestId} /> : null}
              {!carbonDevices.isLoading && !carbonDevices.error ? <Form.Item name="external_device_id" label="源库设备" rules={[{ required: true, message: "请选择源库设备" }]}><Select showSearch optionFilterProp="label" options={carbonOptions} placeholder="按名称、SN 或 ID 搜索" /></Form.Item> : null}
            </>
          ) : null}
        </Form>
        <div className="drawer-note">
          <Network size={15} />
          {syncAction === "full" ? "全量同步会更新源库中的已存在设备、配置和数据流；不会导入监控站。" : syncFamily === "thcpn" ? "标准站按设备 ID 同步；网关同步会同时处理其节点和拓扑。" : "选择一个 Carbon v2 源库设备后同步到平台。"}
        </div>
        {syncFeedback && <div className="admin-feedback">{syncFeedback}</div>}
        {syncOutcome ? (syncOutcome.action === "full" ? <FullSyncResult result={syncOutcome.result} /> : <SingleSyncResult result={syncOutcome.result} />) : null}
      </Drawer>
    </>
  );
}

function SourceFields({ editing, familyLocked, onFamilyChange }: { editing: boolean; familyLocked: boolean; onFamilyChange: (family: SourceFamily | undefined) => void }) {
  return <>
    <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}><Input placeholder="例如 THCPN 生产库" /></Form.Item>
    <Form.Item name="type" label="连接类型" rules={[{ required: true }]}><Select options={["mysql", "postgres", "clickhouse", "http_api", "file"].map((value) => ({ value, label: value }))} /></Form.Item>
    <Form.Item name="source_family" label="业务类型"><Select allowClear disabled={familyLocked} onChange={onFamilyChange} placeholder="未分类（仅维护连接）" options={[{ value: "thcpn", label: "THCPN" }, { value: "carbon", label: "Carbon" }, { value: "lorawan_v2", label: "LoRa V2" }]} /></Form.Item>
    <Form.Item name="dsn_secret_ref" label="Secret 引用" rules={[{ required: true, message: "请输入 Secret 引用" }, { validator: validateSecretRef }]} validateFirst><Input placeholder="env:LORAWAN_V2_API_SECRET" /></Form.Item>
    {familyLocked ? <div className="drawer-note">已有来源关联或绑定，不能切换业务类型。</div> : null}
    {editing ? <Form.Item name="status" label="状态"><Select options={[{ value: "active", label: "启用" }, { value: "disabled", label: "停用" }, { value: "archived", label: "归档" }]} /></Form.Item> : null}
  </>;
}

function SingleSyncResult({ result }: { result: JsonRecord }) {
  const gateway = result.gateway as JsonRecord | undefined;
  const primary = gateway ?? result;
  const device = primary.device as JsonRecord | undefined;
  const nodes = (result.nodes as JsonRecord[] | undefined) ?? [];
  const streams = (primary.data_streams as JsonRecord[] | undefined) ?? [];
  const bindings = (primary.bindings as JsonRecord[] | undefined) ?? [];
  const warnings = (result.warnings as Array<{ code?: string; message?: string }> | undefined) ?? [];
  const deviceID = string(device?.id, "");
  return <section className="sync-result section-gap"><div className="panel-header"><div><h2 className="panel-title">同步结果</h2><div className="panel-kicker">{string(device?.name, "设备同步")} · {string(device?.serial_no, device?.id)}</div></div><Tag color={warnings.length ? "orange" : "green"}>{warnings.length ? `${warnings.length} 条警告` : "同步成功"}</Tag></div><div className="sync-result-metrics"><div><strong>{nodes.length || 1}</strong><span>{nodes.length ? "节点" : "设备"}</span></div><div><strong>{streams.length}</strong><span>DataStream</span></div><div><strong>{bindings.length}</strong><span>Binding</span></div><div><strong>{string(result.relations ? (result.relations as JsonRecord[]).length : 0)}</strong><span>拓扑关系</span></div></div>{deviceID ? <Link to={`/admin/devices/${encodeURIComponent(deviceID)}`}>查看设备详情</Link> : null}{nodes.length ? <div className="sync-node-list">{nodes.slice(0, 8).map((node, index) => { const item = node.device as JsonRecord | undefined; const id = string(item?.id, ""); return <div key={id || index}><span>{string(item?.name)}</span>{id ? <Link to={`/admin/devices/${encodeURIComponent(id)}`}>{string(item?.serial_no, id)}</Link> : <code>{string(item?.serial_no, item?.id)}</code>}</div>; })}</div> : null}{warnings.length ? <div className="sync-warnings">{warnings.map((warning, index) => <div key={`${warning.code}-${index}`}><strong>{warning.code ?? "warning"}</strong><span>{warning.message ?? "同步过程中返回警告"}</span></div>)}</div> : null}</section>;
}

function FullSyncResult({ result }: { result: JsonRecord }) {
  const failures = (result.failures as Array<{ external_device_id?: number; error?: string }> | undefined) ?? [];
  const partial = Number(result.failed ?? 0) > 0 || Number(result.topology_failed ?? 0) > 0;
  return <section className="sync-result section-gap"><div className="panel-header"><div><h2 className="panel-title">全量同步结果</h2><div className="panel-kicker">已处理源库 devices 表中的设备</div></div><Tag color={partial ? "orange" : "green"}>{partial ? "部分完成" : "同步成功"}</Tag></div><div className="sync-result-metrics"><div><strong>{string(result.total, 0)}</strong><span>发现设备</span></div><div><strong>{string(result.synced, 0)}</strong><span>已同步</span></div><div><strong>{string(result.created, 0)}</strong><span>新增</span></div><div><strong>{string(result.updated, 0)}</strong><span>更新</span></div><div><strong>{string(result.unconfigured, 0)}</strong><span>无配置</span></div><div><strong>{string(result.failed, 0)}</strong><span>失败</span></div><div><strong>{string(result.relations, 0)}</strong><span>拓扑关系</span></div><div><strong>{string(result.topology_failed, 0)}</strong><span>拓扑失败</span></div></div>{failures.length ? <div className="sync-warnings">{failures.slice(0, 20).map((failure, index) => <div key={`${failure.external_device_id}-${index}`}><strong>外部设备 {failure.external_device_id}</strong><span>{failure.error ?? "同步失败"}</span></div>)}</div> : null}</section>;
}

type LoRaOperation =
  | "health" | "list_gateways" | "create_gateway" | "get_gateway" | "sync_gateway" | "sync_all"
  | "list_firmwares" | "create_firmware" | "get_firmware" | "delete_firmware"
  | "list_gateway_configs" | "create_gateway_config" | "get_gateway_config"
  | "list_node_configs" | "create_node_config" | "latest_node_config" | "get_node_config" | "create_time_config"
  | "list_logs" | "list_node_data" | "list_gateway_infos";

const loraOperationOptions: Array<{ value: LoRaOperation; label: string }> = [
  { value: "health", label: "连通性检查" }, { value: "list_gateways", label: "网关列表" }, { value: "create_gateway", label: "创建网关并同步" }, { value: "get_gateway", label: "网关详情" }, { value: "sync_gateway", label: "同步单个网关" }, { value: "sync_all", label: "全量同步网关" },
  { value: "list_firmwares", label: "固件列表" }, { value: "create_firmware", label: "新增网关固件" }, { value: "get_firmware", label: "固件详情" }, { value: "delete_firmware", label: "删除固件" },
  { value: "list_gateway_configs", label: "网关配置历史" }, { value: "create_gateway_config", label: "新增网关配置" }, { value: "get_gateway_config", label: "网关配置详情" },
  { value: "list_node_configs", label: "节点传感器配置历史" }, { value: "create_node_config", label: "新增节点传感器配置" }, { value: "latest_node_config", label: "节点最新传感器配置" }, { value: "get_node_config", label: "节点传感器配置详情" }, { value: "create_time_config", label: "新增节点时间配置" },
  { value: "list_logs", label: "网关日志" }, { value: "list_node_data", label: "节点数据" }, { value: "list_gateway_infos", label: "网关数据" },
];

function LoRaWANV2Drawer({ source, onClose }: { source: JsonRecord | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const operation = (Form.useWatch("operation", form) ?? "health") as LoRaOperation;
  const sourceID = string(source?.id, "");
  const requiresGateway = ["get_gateway", "sync_gateway", "create_firmware", "list_gateway_configs", "create_gateway_config", "get_gateway_config", "list_node_configs", "create_node_config", "latest_node_config", "get_node_config", "create_time_config", "list_logs", "list_node_data", "list_gateway_infos"].includes(operation);
  const requiresNode = ["list_node_configs", "create_node_config", "latest_node_config", "get_node_config", "create_time_config", "list_node_data"].includes(operation);
  const requiresConfigID = ["get_gateway_config", "get_node_config"].includes(operation);
  const requiresFirmwareID = ["get_firmware", "delete_firmware"].includes(operation);
  const requiresPayload = ["create_firmware", "create_gateway_config", "create_node_config", "create_time_config"].includes(operation);
  const run = async () => {
    setBusy(true); setFeedback(""); setResult(null);
    try {
      const values = await form.validateFields();
      const query = parseLoRaJSONObject(values.query_json, "查询参数");
      const payload = requiresPayload ? parseLoRaJSONObject(values.payload_json, "请求内容") : {};
      let response: unknown;
      switch (operation) {
        case "health": response = await api.admin.loraWANV2Health(sourceID); break;
        case "list_gateways": response = await api.admin.loraWANV2Gateways(sourceID, query); break;
        case "create_gateway": response = await api.admin.createLoRaWANV2Gateway(sourceID, { sn: values.gateway_sn, node_count: Number(values.node_count) }); break;
        case "get_gateway": response = await api.admin.loraWANV2Gateway(sourceID, values.gateway_sn); break;
        case "sync_gateway": response = await api.admin.syncLoRaWANV2Gateway(sourceID, values.gateway_sn); break;
        case "sync_all": response = await api.admin.syncAllLoRaWANV2Gateways(sourceID); break;
        case "list_firmwares": response = await api.admin.loraWANV2Firmwares(sourceID, query); break;
        case "create_firmware": response = await api.admin.createLoRaWANV2Firmware(sourceID, values.gateway_sn, payload); break;
        case "get_firmware": response = await api.admin.loraWANV2Firmware(sourceID, values.firmware_id); break;
        case "delete_firmware": await api.admin.deleteLoRaWANV2Firmware(sourceID, values.firmware_id); response = { deleted: true }; break;
        case "list_gateway_configs": response = await api.admin.loraWANV2GatewayConfigs(sourceID, values.gateway_sn, query); break;
        case "create_gateway_config": response = await api.admin.createLoRaWANV2GatewayConfig(sourceID, values.gateway_sn, payload); break;
        case "get_gateway_config": response = await api.admin.loraWANV2GatewayConfig(sourceID, values.gateway_sn, values.config_id); break;
        case "list_node_configs": response = await api.admin.loraWANV2NodeSensorConfigs(sourceID, values.gateway_sn, Number(values.node_index), query); break;
        case "create_node_config": response = await api.admin.createLoRaWANV2NodeSensorConfig(sourceID, values.gateway_sn, Number(values.node_index), payload); break;
        case "latest_node_config": response = await api.admin.latestLoRaWANV2NodeSensorConfig(sourceID, values.gateway_sn, Number(values.node_index)); break;
        case "get_node_config": response = await api.admin.loraWANV2NodeSensorConfig(sourceID, values.gateway_sn, Number(values.node_index), values.config_id); break;
        case "create_time_config": response = await api.admin.createLoRaWANV2NodeTimeConfig(sourceID, values.gateway_sn, Number(values.node_index), payload); break;
        case "list_logs": response = await api.admin.loraWANV2GatewayLogs(sourceID, values.gateway_sn, query); break;
        case "list_node_data": response = await api.admin.loraWANV2NodeData(sourceID, values.gateway_sn, Number(values.node_index), query); break;
        case "list_gateway_infos": response = await api.admin.loraWANV2GatewayInfos(sourceID, values.gateway_sn, query); break;
      }
      setResult(response); setFeedback("操作已完成");
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) return;
      setFeedback(formatApiError(error).message);
    } finally { setBusy(false); }
  };
  return <Drawer title={`LoRa V2 管理 · ${string(source?.name)}`} open={Boolean(source)} onClose={onClose} size={720} extra={<Space><Button onClick={onClose}>关闭</Button><Button type="primary" loading={busy} onClick={() => void run()}>执行</Button></Space>}>
    <Form form={form} layout="vertical" initialValues={{ operation: "health", query_json: "{}", payload_json: "{}", node_count: 1, node_index: 1 }}>
      <Form.Item name="operation" label="操作"><Select options={loraOperationOptions} /></Form.Item>
      {requiresGateway || operation === "create_gateway" ? <Form.Item name="gateway_sn" label="网关 SN" rules={[{ required: true, message: "请输入网关 SN" }]}><Input /></Form.Item> : null}
      {operation === "create_gateway" ? <Form.Item name="node_count" label="节点数" rules={[{ required: true, message: "请输入节点数" }]}><InputNumber min={1} max={254} precision={0} style={{ width: "100%" }} /></Form.Item> : null}
      {requiresNode ? <Form.Item name="node_index" label="节点索引" rules={[{ required: true, message: "请输入节点索引" }]}><InputNumber min={1} max={255} precision={0} style={{ width: "100%" }} /></Form.Item> : null}
      {requiresConfigID ? <Form.Item name="config_id" label="配置 ID" rules={[{ required: true, message: "请输入配置 ID" }]}><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item> : null}
      {requiresFirmwareID ? <Form.Item name="firmware_id" label="固件 ID" rules={[{ required: true, message: "请输入固件 ID" }]}><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item> : null}
      {requiresPayload ? <Form.Item name="payload_json" label={operation === "create_time_config" ? "时间配置 JSON" : "请求 JSON"} rules={[{ required: true, message: "请输入有效 JSON" }]}><Input.TextArea rows={8} spellCheck={false} /></Form.Item> : null}
      {["list_gateways", "list_firmwares", "list_gateway_configs", "list_node_configs", "list_logs", "list_node_data", "list_gateway_infos"].includes(operation) ? <Form.Item name="query_json" label="查询参数 JSON"><Input.TextArea rows={4} spellCheck={false} placeholder={'{"page":1,"page_size":10}'} /></Form.Item> : null}
    </Form>
    <div className="drawer-note"><Network size={15} />配置提交只表示服务已接受。节点作为网关属性处理；节点索引从 1 开始。LoRa 数据源 Secret 内容是包含 base_url、username 和 password 的环境变量 JSON。</div>
    {feedback ? <div className="admin-feedback section-gap">{feedback}</div> : null}
    {result !== null ? <pre className="admin-json-output">{JSON.stringify(result, null, 2)}</pre> : null}
  </Drawer>;
}

function parseLoRaJSONObject(raw: unknown, label: string): JsonRecord {
  try {
    const value = JSON.parse(String(raw ?? "{}"));
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error();
    return value as JsonRecord;
  } catch { throw new Error(`${label}必须是 JSON 对象`); }
}
