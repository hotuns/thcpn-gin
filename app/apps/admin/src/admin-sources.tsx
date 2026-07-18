import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Database,
  Network,
  Plus,
  RefreshCw,
  Search,
  ServerCog,
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

const string = (input: unknown, fallback: unknown = "—"): string =>
  input === undefined || input === null || input === ""
    ? String(fallback)
    : String(input);
type Mode = "create" | "edit" | "station" | "gateway" | null;
const formatTime = (input: unknown) => input ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(input))) : "—";
const validateSecretRef = (_: unknown, input: unknown) => {
  const value = String(input ?? "").trim();
  if (!/^[a-z][a-z0-9+.-]*:(?:\/\/)?\S+$/i.test(value)) return Promise.reject(new Error("请输入 Secret 引用，例如 env:THCPN_MYSQL_DSN"));
  if (/^(mysql|postgres|postgresql|clickhouse|http|https):\/\//i.test(value)) return Promise.reject(new Error("不能填写明文 DSN 或连接地址，请使用 Secret 引用"));
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
        dsn_secret_ref: "env://",
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
        target_workspace_id: "",
        project_id: "",
        site_id: "",
        product_id: "",
        serial_no: "",
        name: "",
      });
    else
      form.setFieldsValue({
        external_gateway_id: undefined,
        target_workspace_id: "",
        project_id: "",
        site_id: "",
        assign_nodes: false,
      });
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
      if (mode === "station" || mode === "gateway")
        setSyncResult(response as JsonRecord);
      setFeedback(
        mode === "station" || mode === "gateway"
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
                width: 260,
                render: (_, record: JsonRecord) => (
                  <Space size={2}>
                    <Button type="link" onClick={() => open("edit", record)}>
                      编辑
                    </Button>
                    <Button
                      type="link"
                      disabled={record.type !== "mysql"}
                      onClick={() => open("station", record)}
                    >
                      同步设备
                    </Button>
                    <Button
                      type="link"
                      disabled={record.type !== "mysql"}
                      onClick={() => open("gateway", record)}
                    >
                      同步网关
                    </Button>
                  </Space>
                ),
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
      {syncResult && <SyncResultSummary result={syncResult} />}
      <Drawer
        title={drawerTitle(mode, selected)}
        open={Boolean(mode)}
        onClose={close}
        size={560}
        extra={
          <Space>
            <Button onClick={close}>取消</Button>
            <Button type="primary" loading={busy} onClick={() => void submit()}>
              {mode === "station" || mode === "gateway" ? "开始同步" : "保存"}
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          {mode === "create" || mode === "edit" ? (
            <SourceFields editing={mode === "edit"} />
          ) : mode === "station" ? (
            <StationFields form={form} />
          ) : (
            <GatewayFields form={form} />
          )}
        </Form>
        <div className="drawer-note">
          {mode === "station" || mode === "gateway" ? (
            <>
              <Network size={15} />
              同步会读取外部 THCPN
              数据库并更新平台设备、数据流和绑定。建议先不指定
              工作区，确认资产后再单独分配。
            </>
          ) : (
            <>
              <Database size={15} />
              这里只保存 Secret 引用，例如
              `env://THCPN_MYSQL_DSN`。前端不会读取或保存明文 DSN。
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

function drawerTitle(mode: Mode, selected: JsonRecord | null) {
  if (mode === "create") return "新建数据源";
  if (mode === "edit") return `编辑数据源 · ${string(selected?.name)}`;
  if (mode === "station") return `同步标准站设备 · ${string(selected?.name)}`;
  return `同步组网站 · ${string(selected?.name)}`;
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
        <Input placeholder="env://THCPN_MYSQL_DSN" />
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
function PlacementFields({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  const workspaceId = Form.useWatch("target_workspace_id", form);
  const projectId = Form.useWatch("project_id", form);
  const workspaces = useQuery({ queryKey: ["admin", "workspaces", "source-sync"], queryFn: api.workspaces.adminList });
  const projects = useQuery({ queryKey: ["admin", "projects", workspaceId], queryFn: () => api.projects.adminList(workspaceId), enabled: Boolean(workspaceId) });
  const sites = useQuery({ queryKey: ["admin", "sites", workspaceId, projectId], queryFn: () => api.sites.adminList(workspaceId, projectId), enabled: Boolean(workspaceId) });
  return (
    <>
      <Form.Item name="target_workspace_id" label="目标工作区">
        <Select allowClear showSearch optionFilterProp="label" loading={workspaces.isLoading} placeholder="可选，留空则只同步系统资产" options={(workspaces.data?.items ?? []).map((item) => ({ value: string(item.id, ""), label: string(item.name, item.id) }))} onChange={() => form.setFieldsValue({ project_id: undefined, site_id: undefined })} />
      </Form.Item>
      <div className="drawer-grid">
        <Form.Item name="project_id" label="项目">
          <Select allowClear showSearch optionFilterProp="label" disabled={!workspaceId} loading={projects.isLoading} options={(projects.data?.items ?? []).map((item) => ({ value: string(item.id, ""), label: string(item.name, item.id) }))} onChange={() => form.setFieldValue("site_id", undefined)} />
        </Form.Item>
        <Form.Item name="site_id" label="站点">
          <Select allowClear showSearch optionFilterProp="label" disabled={!workspaceId} loading={sites.isLoading} options={(sites.data?.items ?? []).map((item) => ({ value: string(item.id, ""), label: string(item.name, item.id) }))} />
        </Form.Item>
      </div>
    </>
  );
}
function StationFields({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  return (
    <>
      <Form.Item
        name="external_device_id"
        label="外部设备 ID"
        rules={[{ required: true, message: "请输入外部设备 ID" }]}
      >
        <InputNumber min={1} precision={0} style={{ width: "100%" }} />
      </Form.Item>
      <PlacementFields form={form} />
      <div className="drawer-grid">
        <Form.Item name="product_id" label="产品 ID">
          <Input />
        </Form.Item>
        <Form.Item name="serial_no" label="序列号">
          <Input />
        </Form.Item>
      </div>
      <Form.Item name="name" label="设备名称">
        <Input />
      </Form.Item>
    </>
  );
}
function GatewayFields({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  return (
    <>
      <Form.Item
        name="external_gateway_id"
        label="外部网关 ID"
        rules={[{ required: true, message: "请输入外部网关 ID" }]}
      >
        <InputNumber min={1} precision={0} style={{ width: "100%" }} />
      </Form.Item>
      <PlacementFields form={form} />
      <Form.Item name="assign_nodes" label="节点分配策略">
        <Select
          options={[
            { value: false, label: "仅分配网关" },
            { value: true, label: "网关和节点一起分配" },
          ]}
        />
      </Form.Item>
    </>
  );
}
