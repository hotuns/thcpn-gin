import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tabs,
} from "@thcpn/admin-ui";
import {
  api,
  formatApiError,
  type SensorTemplateRequest,
  type THCPNSensorTemplate,
} from "@thcpn/api";
import { PageHeader, Panel, StateView } from "@thcpn/ui";

type EditorState =
  | { mode: "create"; source?: THCPNSensorTemplate }
  | { mode: "edit"; source: THCPNSensorTemplate }
  | null;

const initialValues = {
  sensor_type: "",
  description: "",
  port: "485",
  port_num: 0,
  driver: "modbusrtu",
  port_nums: [],
  status: "active",
  command: "",
  wait_time: 60,
  metrics: [],
  params_json: '{\n  "command": "",\n  "wait_time": 60,\n  "contents": []\n}',
  lora_enabled: false,
  lora_items: [],
  lora_content_json: "[]",
};

type JsonObject = Record<string, unknown>;

const knownParamKeys = new Set(["command", "wait_time", "contents"]);

function splitParams(params: JsonObject) {
  const extras = Object.fromEntries(
    Object.entries(params).filter(([key]) => !knownParamKeys.has(key)),
  );
  return {
    command: params.command ?? "",
    wait_time: params.wait_time ?? 60,
    metrics: Array.isArray(params.contents) ? params.contents : [],
    extras,
  };
}

function parseParamsJSON(raw: unknown): JsonObject {
  const parsed = JSON.parse(String(raw ?? "{}"));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("params must be an object");
  }
  return parsed as JsonObject;
}

type LoRaVisualItem = {
  kind: "ad" | "485" | "sdi" | "iic";
  port?: number;
  command?: string;
  address?: string;
  model?: string;
  mappings?: Array<{
    info?: JsonObject;
    key?: string;
    rule?: string;
    unit?: string;
    index?: string;
  }>;
};

function splitLoRaContent(content: unknown): LoRaVisualItem[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap<LoRaVisualItem>((raw) => {
    if (!Array.isArray(raw) || typeof raw[0] !== "string") return [];
    const kind = raw[0] as LoRaVisualItem["kind"];
    const inner = Array.isArray(raw[1]) ? raw[1] : [];
    if (kind === "ad")
      return [
        {
          kind,
          port: Number(raw[2] ?? 0),
          mappings: (Array.isArray(raw[1]) ? raw[1] : []).map((item) => ({
            key: item?.[0],
            rule: item?.[1],
            unit: item?.[2],
          })),
        },
      ];
    if (kind === "485")
      return [
        {
          kind,
          command: String(inner[0] ?? ""),
          mappings: (Array.isArray(inner[1]) ? inner[1] : []).map((item) => ({
            key: item?.[0],
            rule: item?.[1],
            unit: item?.[2],
          })),
        },
      ];
    if (kind === "sdi")
      return [
        {
          kind,
          address: String(inner[0] ?? ""),
          mappings: (Array.isArray(inner[1]) ? inner[1] : []).map((item) => ({
            key: item?.[0],
            index: String(item?.[1] ?? ""),
          })),
        },
      ];
    if (kind === "iic")
      return [
        {
          kind,
          model: String(inner[0] ?? ""),
          address: String(inner[1] ?? ""),
          mappings: (Array.isArray(inner[2]) ? inner[2] : []).map((key) => ({
            key: String(key),
          })),
        },
      ];
    return [];
  });
}

export function attachMetricInfo(items: LoRaVisualItem[], metrics: JsonObject[]): LoRaVisualItem[] {
  return items.map(item => ({ ...item, mappings: item.mappings?.map(mapping => {
    const metric = metrics.find(metric => metric.key === mapping.key);
    return { ...mapping, info: { ...((metric?.info ?? {}) as JsonObject), unit: mapping.unit ?? (metric?.info as JsonObject)?.unit ?? "" } };
  }) }));
}

export function collectMetricInfo(items: LoRaVisualItem[]): JsonObject[] {
  return items.flatMap(item => (item.mappings ?? []).map(mapping => ({
    key: mapping.key,
    info: { ...mapping.info, unit: mapping.info?.unit ?? "" },
  })));
}

function buildLoRaContent(items: LoRaVisualItem[]): unknown[] {
  return (items ?? []).map((item) => {
    const mappings = item.mappings ?? [];
    if (item.kind === "ad")
      return [
        "ad",
        mappings.map((entry) => [entry.key, entry.rule, entry.info?.unit ?? entry.unit ?? ""]),
        Number(item.port ?? 0),
      ];
    if (item.kind === "485")
      return [
        "485",
        [
          item.command ?? "",
          mappings.map((entry) => [entry.key, entry.rule, entry.info?.unit ?? entry.unit ?? ""]),
        ],
      ];
    if (item.kind === "sdi")
      return [
        "sdi",
        [
          item.address ?? "",
          mappings.map((entry) => [entry.key, entry.index ?? ""]),
        ],
      ];
    return [
      "iic",
      [
        item.model ?? "",
        item.address ?? "",
        mappings.map((entry) => entry.key),
      ],
    ];
  });
}

export function AdminSensorsPage({ version = "v1" }: { version?: "v1" | "v2" }) {
  const isV2 = version === "v2";
  const title = `传感器模板 ${version.toUpperCase()}`;
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<string>();
  const [editor, setEditor] = useState<EditorState>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importSource, setImportSource] = useState<string>();
  const [paramsMode, setParamsMode] = useState("visual");
  const [paramExtras, setParamExtras] = useState<JsonObject>({});
  const [form] = Form.useForm();
  const query = useQuery({
    queryKey: ["admin", "sensor-templates", version, keyword, status, page],
    queryFn: () =>
      api.admin.platformSensorTemplates({
        q: keyword,
        source_family: isV2 ? "lorawan_v2" : "thcpn",
        status: status ?? "",
        page,
        page_size: 20,
      }),
  });
  const sources = useQuery({
    queryKey: ["admin", "data-sources", "sensor-import"],
    queryFn: api.admin.sources,
    enabled: importOpen,
  });

  const openEditor = (
    mode: "create" | "edit",
    source?: THCPNSensorTemplate,
  ) => {
    const item = source;
    const params = (item?.params ?? {}) as JsonObject;
    const visual = splitParams(params);
    const variants = ((item as unknown as JsonObject)?.variants ??
      {}) as JsonObject;
    const lora = (variants.lorawan_v2 ?? {}) as JsonObject;
    const loraContent = Array.isArray(lora.content) ? lora.content : [];
    const loraItems = attachMetricInfo(splitLoRaContent(loraContent), visual.metrics);
    form.setFieldsValue(
      item
        ? {
            sensor_type: item.sensor_type,
            description: item.description ?? "",
            port: item.port ?? "",
            port_num: item.port_num,
            driver: item.driver ?? "",
            port_nums: item.port_nums.map(String),
            status: item.status,
            command: visual.command,
            wait_time: visual.wait_time,
            metrics: visual.metrics,
            params_json: JSON.stringify(params, null, 2),
            lora_enabled: isV2,
            lora_items: loraItems,
            lora_content_json: JSON.stringify(loraContent, null, 2),
          }
        : { ...initialValues, lora_enabled: isV2 },
    );
    setParamExtras(item ? visual.extras : {});
    setParamsMode(isV2 && loraItems.length !== loraContent.length ? "json" : "visual");
    setEditor(
      mode === "edit" && item
        ? { mode, source: item }
        : { mode: "create", source: item },
    );
    setFeedback("");
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      let params: Record<string, unknown>;
      if (paramsMode === "json") {
        try {
          params = parseParamsJSON(values.params_json);
        } catch {
          form.setFields([
            { name: "params_json", errors: ["参数必须是有效的 JSON 对象"] },
          ]);
          return;
        }
      } else {
        params = {
          ...paramExtras,
          command: values.command ?? "",
          wait_time: values.wait_time ?? 0,
          contents: isV2 ? collectMetricInfo(values.lora_items ?? []) : values.metrics ?? [],
        };
      }
      let loraContent: unknown[] = [];
      if (isV2) {
        try {
          loraContent =
            paramsMode === "json"
              ? JSON.parse(String(values.lora_content_json ?? "[]"))
              : buildLoRaContent(values.lora_items ?? []);
        } catch {
          setFeedback("LoRaWAN V2 配置不是有效的 JSON 数组");
          return;
        }
        if (!Array.isArray(loraContent) || !loraContent.length) {
          setFeedback("请至少添加一个 LoRaWAN V2 协议项");
          return;
        }
      }
      const payload: SensorTemplateRequest = {
        sensor_type: values.sensor_type.trim(),
        description: values.description?.trim() ?? "",
        port: isV2 ? "" : values.port?.trim() ?? "",
        port_num: isV2 ? 0 : values.port_num ?? 0,
        driver: isV2 ? "" : values.driver?.trim() ?? "",
        port_nums: (isV2 ? [] : values.port_nums ?? [])
          .map((value: string | number) => Number(value))
          .filter(Number.isInteger),
        params: isV2 ? { contents: params.contents ?? [] } : params,
        metrics: (Array.isArray(params.contents)
          ? params.contents
          : []) as JsonObject[],
        variants: isV2 ? {
          lorawan_v2: { content: loraContent },
        } : {
          thcpn: {
            port: values.port?.trim() ?? "",
            port_num: values.port_num ?? 0,
            port_nums: (values.port_nums ?? [])
              .map(Number)
              .filter(Number.isInteger),
            driver: values.driver?.trim() ?? "",
            params,
          },
        },
        status: values.status,
      };
      setBusy(true);
      if (editor?.mode === "edit") {
        await api.admin.updateSensorTemplate(editor.source.id, payload);
      } else {
        await api.admin.createSensorTemplate(payload);
      }
      setEditor(null);
      form.resetFields();
      await query.refetch();
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) return;
      const detail = formatApiError(error);
      setFeedback(
        `${detail.message}${detail.requestId ? ` · request id ${detail.requestId}` : ""}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const changeParamsMode = (nextMode: string) => {
    if (nextMode === paramsMode) return;
    if (nextMode === "json") {
      const values = form.getFieldsValue(true);
      const params = {
        ...paramExtras,
        ...(!isV2 ? { command: values.command ?? "", wait_time: values.wait_time ?? 0 } : {}),
        contents: values.metrics ?? [],
      };
      if (isV2) form.setFieldValue("lora_content_json", JSON.stringify(buildLoRaContent(values.lora_items ?? []), null, 2));
      form.setFieldValue("params_json", JSON.stringify(params, null, 2));
      form.setFields([{ name: "params_json", errors: [] }]);
      setParamsMode("json");
      return;
    }
    try {
      const params = parseParamsJSON(form.getFieldValue("params_json"));
      const visual = splitParams(params);
      let loraItems: LoRaVisualItem[] = [];
      if (isV2) {
        const content = JSON.parse(String(form.getFieldValue("lora_content_json") ?? "[]"));
        if (!Array.isArray(content)) throw new Error("Invalid protocol array");
        loraItems = attachMetricInfo(splitLoRaContent(content), visual.metrics);
        if (loraItems.length !== content.length) throw new Error("Unsupported protocol");
      }
      form.setFieldsValue({
        ...(isV2 ? { lora_items: loraItems } : {}),
        command: visual.command,
        wait_time: visual.wait_time,
        metrics: visual.metrics,
      });
      form.setFields([{ name: "params_json", errors: [] }]);
      setParamExtras(visual.extras);
      setParamsMode("visual");
    } catch {
      form.setFields([
        {
          name: "params_json",
          errors: ["请先修正 JSON，才能切换到可视化编辑"],
        },
      ]);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.admin.deleteSensorTemplate(id);
      await query.refetch();
    } catch (error) {
      const detail = formatApiError(error);
      setFeedback(detail.message);
    }
  };

  const importTemplates = async () => {
    if (!importSource) return;
    setBusy(true);
    try {
      const result = await api.admin.importSensorTemplates(importSource);
      setFeedback(
        `导入 ${result.imported} 个，跳过重复 ${result.skipped} 个，无效 ${result.invalid} 个`,
      );
      setImportOpen(false);
      setImportSource(undefined);
      await query.refetch();
    } catch (error) {
      const detail = formatApiError(error);
      setFeedback(detail.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Assets / sensor templates"
        title={title}
        description={isV2 ? "用于 LoRaWAN V2 的独立协议与指标模板。修改仅影响后续配置。" : "用于旧版设备的传感器协议与指标模板。修改仅影响后续配置。"}
        actions={
          <Space>
            {!isV2 && <Button
              icon={<Download size={14} />}
              onClick={() => setImportOpen(true)}
            >
              从数据源导入
            </Button>}
            <Button
              type="primary"
              icon={<Plus size={14} />}
              onClick={() => openEditor("create")}
            >
              新增模板
            </Button>
          </Space>
        }
      />
      <Panel>
        <div className="admin-list-toolbar">
          <Input
            allowClear
            prefix={<Search size={14} />}
            value={keyword}
            placeholder="搜索型号、说明或驱动"
            onChange={(event) => {
              setKeyword(event.target.value);
              setPage(1);
            }}
          />
          <Select
            allowClear
            value={status}
            placeholder="全部状态"
            options={[
              { value: "active", label: "启用" },
              { value: "disabled", label: "停用" },
            ]}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            style={{ width: 140 }}
          />
          <Button
            icon={<RefreshCw size={14} />}
            onClick={() => void query.refetch()}
          >
            刷新
          </Button>
        </div>
        {feedback && (
          <Alert
            type="error"
            showIcon
            message={feedback}
            closable
            onClose={() => setFeedback("")}
          />
        )}
        {query.error ? (
          <StateView
            type="error"
            title="传感器模板加载失败"
            description={formatApiError(query.error).message}
            requestId={formatApiError(query.error).requestId}
          />
        ) : (
          <Table
            rowKey="id"
            size="small"
            loading={query.isLoading}
            dataSource={query.data?.items ?? []}
            pagination={{
              current: page,
              pageSize: 20,
              total: query.data?.total ?? 0,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 个模板`,
              onChange: setPage,
            }}
            scroll={{ x: 980 }}
            columns={[
              {
                title: "传感器",
                render: (_, item) => (
                  <div>
                    <strong>{item.sensor_type}</strong>
                    <div className="cell-sub">{item.description || "—"}</div>
                  </div>
                ),
              },
              ...(!isV2 ? [{ title: "驱动", dataIndex: "driver", width: 140 },
              {
                title: "端口",
                width: 120,
                render: (_: unknown, item: THCPNSensorTemplate) => `${item.port || "—"} · ${item.port_num}`,
              },
              {
                title: "可选编号",
                width: 170,
                render: (_: unknown, item: THCPNSensorTemplate) =>
                  item.port_nums.length ? item.port_nums.join(", ") : "—",
              }] : []),
              {
                title: "指标",
                render: (_, item) => (
                  <Space size={[4, 4]} wrap>
                    {item.metrics.slice(0, 6).map((metric) => (
                      <Tag key={`${item.id}-${metric.key}`}>
                        {metric.name || metric.key}
                      </Tag>
                    ))}
                    {item.metrics.length > 6 && (
                      <Tag>+{item.metrics.length - 6}</Tag>
                    )}
                    {!item.metrics.length && "—"}
                  </Space>
                ),
              },
              {
                title: "数据源协议",
                width: 170,
                render: (_, item) => {
                  const variants = item.variants as Record<string, unknown>;
                  return (
                    <Space size={4} wrap>
                      {variants.thcpn ? <Tag>THCPN</Tag> : null}
                      {variants.lorawan_v2 ? (
                        <Tag color="cyan">LoRa V2</Tag>
                      ) : null}
                    </Space>
                  );
                },
              },
              {
                title: "状态",
                width: 80,
                render: (_, item) => (
                  <Tag color={item.status === "active" ? "green" : "default"}>
                    {item.status === "active" ? "启用" : "停用"}
                  </Tag>
                ),
              },
              {
                title: "操作",
                width: 210,
                fixed: "right",
                render: (_, item) => (
                  <Space size={2}>
                    <Button
                      type="link"
                      size="small"
                      icon={<Pencil size={13} />}
                      onClick={() => openEditor("edit", item)}
                    >
                      编辑
                    </Button>
                    <Button
                      type="link"
                      size="small"
                      icon={<Copy size={13} />}
                      onClick={() => openEditor("create", item)}
                    >
                      复制
                    </Button>
                    <Popconfirm
                      title="删除传感器模板？"
                      description="已有设备配置不会受影响。"
                      onConfirm={() => void remove(item.id)}
                    >
                      <Button
                        type="link"
                        danger
                        size="small"
                        icon={<Trash2 size={13} />}
                      >
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Panel>
      <Drawer
        title={`${editor?.mode === "edit" ? "编辑" : "新增"}${title}`}
        open={Boolean(editor)}
        width={920}
        onClose={() => setEditor(null)}
        extra={
          <Space>
            <Button onClick={() => setEditor(null)}>取消</Button>
            <Button type="primary" loading={busy} onClick={() => void save()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" initialValues={initialValues}>
          <Form.Item
            name="sensor_type"
            label="传感器型号"
            rules={[{ required: true, message: "请输入传感器型号" }]}
          >
            <Input placeholder="例如 HCD6818" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} />
          </Form.Item>
          <div className="admin-form-grid">
            {!isV2 && <><Form.Item name="driver" label="驱动 / 协议">
              <Input placeholder="modbusrtu" />
            </Form.Item>
            <Form.Item name="port" label="端口">
              <Input placeholder="485" />
            </Form.Item>
            <Form.Item name="port_num" label="默认端口编号">
              <InputNumber style={{ width: "100%" }} />
            </Form.Item></>}
            <Form.Item name="status" label="状态">
              <Select
                options={[
                  { value: "active", label: "启用" },
                  { value: "disabled", label: "停用" },
                ]}
              />
            </Form.Item>
          </div>
          {!isV2 && <Form.Item
            name="port_nums"
            label="可选端口编号"
            extra="输入编号后回车；设备配置时将从这些编号中选择。"
          >
            <Select mode="tags" tokenSeparators={[",", " "]} />
          </Form.Item>}
          <div className="sensor-template-params">
            <div className="visual-subsection-head">
              <div>
                <strong>{isV2 ? "协议与指标" : "V1 协议与指标"}</strong>
                <span>
                  {isV2 ? "在协议项中直接添加指标，并配置名称、单位和解析规则。" : "配置旧版设备的指标、命令、解码和端口。"}
                </span>
              </div>
            </div>
            <Tabs
              activeKey={paramsMode}
              onChange={changeParamsMode}
              items={[
                {
                  key: "visual",
                  label: "可视化编辑",
                  children: (
                    <>
                      {!isV2 && <div className="config-form-grid config-form-grid-2">
                        <Form.Item name="command" label="协议命令">
                          <Input className="code-input" />
                        </Form.Item>
                        <Form.Item name="wait_time" label="等待时间">
                          <InputNumber min={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </div>}
                      {!isV2 && <><div className="visual-subsection-head">
                        <div>
                          <strong>数据指标</strong>
                          <span>
                            {isV2 ? "配置 Key、名称、类型、单位和范围" : "配置 Key、名称、类型、单位、范围和解码规则"}
                          </span>
                        </div>
                      </div>
                      <Form.List name="metrics">
                        {(fields, { add, remove, move }) => (
                          <div className="metric-editor-list">
                            {fields.map((field, index) => (
                              <div
                                className="metric-editor-row"
                                key={field.key}
                              >
                                <div className="metric-editor-index">
                                  {index + 1}
                                </div>
                                <div className="metric-editor-fields">
                                  <Form.Item
                                    name={[field.name, "key"]}
                                    label="Key"
                                    rules={[
                                      { required: true, message: "必填" },
                                    ]}
                                  >
                                    <Input />
                                  </Form.Item>
                                  <Form.Item
                                    name={[field.name, "info", "name"]}
                                    label="名称"
                                    rules={[
                                      { required: true, message: "必填" },
                                    ]}
                                  >
                                    <Input />
                                  </Form.Item>
                                  <Form.Item
                                    name={[field.name, "info", "type"]}
                                    label="类型"
                                  >
                                    <Input />
                                  </Form.Item>
                                  <Form.Item
                                    name={[field.name, "info", "unit"]}
                                    label="单位"
                                  >
                                    <Input />
                                  </Form.Item>
                                  <Form.Item
                                    name={[field.name, "info", "index"]}
                                    label="索引"
                                  >
                                    <InputNumber
                                      precision={0}
                                      style={{ width: "100%" }}
                                    />
                                  </Form.Item>
                                  <Form.Item
                                    name={[field.name, "info", "min"]}
                                    label="最小值"
                                  >
                                    <InputNumber style={{ width: "100%" }} />
                                  </Form.Item>
                                  <Form.Item
                                    name={[field.name, "info", "max"]}
                                    label="最大值"
                                  >
                                    <InputNumber style={{ width: "100%" }} />
                                  </Form.Item>
                                  {!isV2 && <Form.Item
                                    name={[field.name, "decode"]}
                                    label="Decode"
                                  >
                                    <Input className="code-input" />
                                  </Form.Item>}
                                </div>
                                <Space orientation="vertical" size={0}>
                                  <Button
                                    type="text"
                                    icon={<ChevronUp size={13} />}
                                    disabled={index === 0}
                                    onClick={() => move(index, index - 1)}
                                  />
                                  <Button
                                    type="text"
                                    icon={<ChevronDown size={13} />}
                                    disabled={index === fields.length - 1}
                                    onClick={() => move(index, index + 1)}
                                  />
                                  <Button
                                    type="text"
                                    danger
                                    icon={<Trash2 size={13} />}
                                    onClick={() => remove(index)}
                                  />
                                </Space>
                              </div>
                            ))}
                            <Button
                              block
                              type="dashed"
                              icon={<Plus size={14} />}
                              onClick={() =>
                                add({
                                  key: "",
                                  info: {
                                    name: "",
                                    type: "",
                                    unit: "",
                                    index: fields.length,
                                  },
                                  decode: "",
                                })
                              }
                            >
                              添加指标
                            </Button>
                          </div>
                        )}
                      </Form.List></>}
                      {isV2 && <>
                        <div className="visual-subsection-head"><strong>协议配置</strong></div>
                                <Form.Item noStyle shouldUpdate>
                                  {({ getFieldValue }) => {
                                    return (
                                      <Form.List name="lora_items">
                                        {(fields, { add, remove, move }) => (
                                          <div className="lora-protocol-list">
                                            {fields.map((field, index) => {
                                              const kind = getFieldValue([
                                                "lora_items",
                                                field.name,
                                                "kind",
                                              ]) as LoRaVisualItem["kind"];
                                              return (
                                                <div
                                                  className="lora-protocol-item"
                                                  key={field.key}
                                                >
                                                  <div className="lora-protocol-item-head">
                                                    <strong>
                                                      协议项 {index + 1}
                                                    </strong>
                                                    <Space size={2}>
                                                      <Button
                                                        type="text"
                                                        icon={
                                                          <ChevronUp
                                                            size={13}
                                                          />
                                                        }
                                                        disabled={index === 0}
                                                        onClick={() =>
                                                          move(index, index - 1)
                                                        }
                                                      />
                                                      <Button
                                                        type="text"
                                                        icon={
                                                          <ChevronDown
                                                            size={13}
                                                          />
                                                        }
                                                        disabled={
                                                          index ===
                                                          fields.length - 1
                                                        }
                                                        onClick={() =>
                                                          move(index, index + 1)
                                                        }
                                                      />
                                                      <Button
                                                        type="text"
                                                        danger
                                                        icon={
                                                          <Trash2 size={13} />
                                                        }
                                                        onClick={() =>
                                                          remove(index)
                                                        }
                                                      />
                                                    </Space>
                                                  </div>
                                                  <div className="config-form-grid config-form-grid-3">
                                                    <Form.Item
                                                      name={[
                                                        field.name,
                                                        "kind",
                                                      ]}
                                                      label="协议类型"
                                                      rules={[
                                                        {
                                                          required: true,
                                                          message: "请选择协议",
                                                        },
                                                      ]}
                                                    >
                                                      <Select
                                                        options={[
                                                          {
                                                            value: "ad",
                                                            label: "AD 模拟量",
                                                          },
                                                          {
                                                            value: "485",
                                                            label: "RS-485",
                                                          },
                                                          {
                                                            value: "sdi",
                                                            label: "SDI-12",
                                                          },
                                                          {
                                                            value: "iic",
                                                            label: "IIC",
                                                          },
                                                        ]}
                                                      />
                                                    </Form.Item>
                                                    {kind === "ad" ? (
                                                      <Form.Item
                                                        name={[
                                                          field.name,
                                                          "port",
                                                        ]}
                                                        label="AD 端口"
                                                        rules={[
                                                          {
                                                            required: true,
                                                            message:
                                                              "请输入端口",
                                                          },
                                                        ]}
                                                      >
                                                        <InputNumber
                                                          min={0}
                                                          precision={0}
                                                          style={{
                                                            width: "100%",
                                                          }}
                                                        />
                                                      </Form.Item>
                                                    ) : null}
                                                    {kind === "485" ? (
                                                      <Form.Item
                                                        name={[
                                                          field.name,
                                                          "command",
                                                        ]}
                                                        label="请求命令"
                                                        rules={[
                                                          {
                                                            required: true,
                                                            message:
                                                              "请输入命令",
                                                          },
                                                        ]}
                                                      >
                                                        <Input className="code-input" />
                                                      </Form.Item>
                                                    ) : null}
                                                    {kind === "sdi" ? (
                                                      <Form.Item
                                                        name={[
                                                          field.name,
                                                          "address",
                                                        ]}
                                                        label="SDI 地址"
                                                        rules={[
                                                          {
                                                            required: true,
                                                            message:
                                                              "请输入地址",
                                                          },
                                                        ]}
                                                      >
                                                        <Input />
                                                      </Form.Item>
                                                    ) : null}
                                                    {kind === "iic" ? (
                                                      <>
                                                        <Form.Item
                                                          name={[
                                                            field.name,
                                                            "model",
                                                          ]}
                                                          label="IIC 型号"
                                                          rules={[
                                                            {
                                                              required: true,
                                                              message:
                                                                "请输入型号",
                                                            },
                                                          ]}
                                                        >
                                                          <Input />
                                                        </Form.Item>
                                                        <Form.Item
                                                          name={[
                                                            field.name,
                                                            "address",
                                                          ]}
                                                          label="IIC 地址"
                                                          rules={[
                                                            {
                                                              required: true,
                                                              message:
                                                                "请输入地址",
                                                            },
                                                          ]}
                                                        >
                                                          <Input placeholder="例如 0x44" />
                                                        </Form.Item>
                                                      </>
                                                    ) : null}
                                                  </div>
                                                  {kind ? (
                                                    <Form.List
                                                      name={[
                                                        field.name,
                                                        "mappings",
                                                      ]}
                                                    >
                                                      {(
                                                        mappingFields,
                                                        actions,
                                                      ) => (
                                                        <div className="lora-mapping-list">
                                                          {mappingFields.map(
                                                            (mapping) => (
                                                              <div
                                                                className="lora-template-metric-row"
                                                                key={
                                                                  mapping.key
                                                                }
                                                              >
                                                                <Form.Item
                                                                  name={[
                                                                    mapping.name,
                                                                    "key",
                                                                  ]}
                                                                  label="Key"
                                                                  rules={[{ required: true, message: "请输入 Key" }]}
                                                                >
                                                                  <Input />
                                                                </Form.Item>
                                                                <Form.Item name={[mapping.name, "info", "name"]} label="名称" rules={[{ required: true, message: "请输入名称" }]}><Input /></Form.Item>
                                                                <Form.Item name={[mapping.name, "info", "type"]} label="类型"><Input /></Form.Item>
                                                                <Form.Item name={[mapping.name, "info", "unit"]} label="单位"><Input /></Form.Item>
                                                                <Form.Item name={[mapping.name, "info", "min"]} label="最小值"><InputNumber style={{ width: "100%" }} /></Form.Item>
                                                                <Form.Item name={[mapping.name, "info", "max"]} label="最大值"><InputNumber style={{ width: "100%" }} /></Form.Item>
                                                                {kind ===
                                                                  "ad" ||
                                                                kind ===
                                                                  "485" ? (
                                                                  <>
                                                                    <Form.Item
                                                                      name={[
                                                                        mapping.name,
                                                                        "rule",
                                                                      ]}
                                                                      label="解析规则"
                                                                      rules={[
                                                                        {
                                                                          required: true,
                                                                          message:
                                                                            "请输入规则",
                                                                        },
                                                                      ]}
                                                                    >
                                                                      <Input className="code-input" />
                                                                    </Form.Item>

                                                                  </>
                                                                ) : null}
                                                                {kind ===
                                                                "sdi" ? (
                                                                  <Form.Item
                                                                    name={[
                                                                      mapping.name,
                                                                      "index",
                                                                    ]}
                                                                    label="返回索引"
                                                                    rules={[
                                                                      {
                                                                        required: true,
                                                                        message:
                                                                          "请输入索引",
                                                                      },
                                                                    ]}
                                                                  >
                                                                    <Input />
                                                                  </Form.Item>
                                                                ) : null}
                                                                <Button
                                                                  type="text"
                                                                  danger
                                                                  icon={
                                                                    <Trash2
                                                                      size={13}
                                                                    />
                                                                  }
                                                                  onClick={() =>
                                                                    actions.remove(
                                                                      mapping.name,
                                                                    )
                                                                  }
                                                                />
                                                              </div>
                                                            ),
                                                          )}
                                                          <Button
                                                            type="dashed"
                                                            block
                                                            onClick={() =>
                                                              actions.add({
                                                                key: "",
                                                                rule: "",
                                                                info: { name: "", type: "", unit: "" },
                                                                index: "",
                                                              })
                                                            }
                                                          >
                                                            添加指标
                                                          </Button>
                                                        </div>
                                                      )}
                                                    </Form.List>
                                                  ) : (
                                                    <Alert
                                                      type="info"
                                                      message="请先选择协议类型"
                                                    />
                                                  )}
                                                </div>
                                              );
                                            })}
                                            <Button
                                              type="dashed"
                                              block
                                              icon={<Plus size={14} />}
                                              onClick={() =>
                                                add({
                                                  kind: "485",
                                                  command: "",
                                                  mappings: [],
                                                })
                                              }
                                            >
                                              添加协议项
                                            </Button>
                                          </div>
                                        )}
                                      </Form.List>
                                    );
                                  }}
                                </Form.Item>
                      </>}
                      {Object.keys(paramExtras).length > 0 && (
                        <Alert
                          type="info"
                          showIcon
                          message={`已保留 ${Object.keys(paramExtras).length} 个扩展参数`}
                          description="扩展参数不会丢失，可在 JSON 编辑中查看和修改。"
                        />
                      )}
                    </>
                  ),
                },
                {
                  key: "json",
                  label: "JSON 编辑",
                  children: (
                    <>
                    <Form.Item
                      label={isV2 ? "数据指标 JSON" : undefined}
                      name="params_json"
                      extra={isV2 ? "维护 contents 中的指标 Key、名称和单位。" : "完整维护 command、wait_time、contents 和其他厂商扩展字段。"}
                      rules={[{ required: true, message: "请输入参数 JSON" }]}
                    >
                      <Input.TextArea
                        rows={24}
                        className="mono"
                        spellCheck={false}
                      />
                    </Form.Item>
                    {isV2 && (
                                <Form.Item
                                  name="lora_content_json"
                                  label="LoRaWAN V2 原生配置"
                                  rules={[
                                    { required: true },
                                    {
                                      validator: async (_, value) => {
                                        const parsed = JSON.parse(
                                          String(value ?? "[]"),
                                        );
                                        if (
                                          !Array.isArray(parsed) ||
                                          !parsed.length
                                        )
                                          throw new Error("必须是非空数组");
                                      },
                                    },
                                  ]}
                                >
                                  <Input.TextArea
                                    rows={12}
                                    className="mono"
                                    spellCheck={false}
                                  />
                                </Form.Item>
                    )}
                    </>
                  ),
                },
              ]}
            />

          </div>
        </Form>
      </Drawer>
      <Modal
        title="从 THCPN 数据源导入模板"
        open={importOpen}
        okText="开始导入"
        confirmLoading={busy}
        okButtonProps={{ disabled: !importSource }}
        onOk={() => void importTemplates()}
        onCancel={() => setImportOpen(false)}
      >
        <Alert
          type="info"
          showIcon
          message="这是一次显式迁移操作"
          description="读取所选源库的 sensors 表并写入平台模板库。相同型号、端口、驱动和参数的模板会跳过；导入后请在本页面继续维护。"
          style={{ marginBottom: 16 }}
        />
        <Select
          style={{ width: "100%" }}
          loading={sources.isLoading}
          value={importSource}
          placeholder="选择 THCPN 数据源"
          options={(
            (sources.data?.items ?? []) as Array<{
              id: string;
              name: string;
              status?: string;
            }>
          ).map((source) => ({
            value: source.id,
            label: `${source.name}${source.status === "disabled" ? "（已停用）" : ""}`,
          }))}
          onChange={setImportSource}
        />
      </Modal>
    </>
  );
}
