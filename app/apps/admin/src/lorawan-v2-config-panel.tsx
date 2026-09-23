import { invalidateNodeNames } from "@thcpn/workspace";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Collapse,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from "@thcpn/admin-ui";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { StateView, NodeNameEditor } from "@thcpn/ui";

const text = (input: unknown, fallback = "—") =>
  input === undefined || input === null || input === ""
    ? fallback
    : String(input);
const payload = (input: JsonRecord | undefined) =>
  (input?.payload ?? input ?? {}) as JsonRecord;
const list = (input: JsonRecord | undefined) =>
  (payload(input).data ?? payload(input).items ?? []) as JsonRecord[];
const parseObject = (raw: string) => {
  const result = JSON.parse(raw);
  if (!result || Array.isArray(result) || typeof result !== "object")
    throw new Error("网关配置必须是 JSON 对象");
  return result as JsonRecord;
};
const parseArray = (raw: string) => {
  const result = JSON.parse(raw);
  if (!Array.isArray(result)) throw new Error("节点传感器配置必须是 JSON 数组");
  return result;
};
const managementLabel: Record<string, { label: string; color: string }> = {
  managed: { label: "平台已托管", color: "green" },
  matched: { label: "已匹配模板", color: "blue" },
  unmanaged: { label: "未托管", color: "orange" },
};

type ProtocolItem = {
  kind: "ad" | "485" | "sdi" | "iic";
  port?: number;
  command?: string;
  address?: string;
  model?: string;
  mappings: Array<{
    key: string;
    rule?: string;
    unit?: string;
    index?: string;
  }>;
};

const splitProtocolContent = (content: unknown[]): ProtocolItem[] =>
  content.flatMap<ProtocolItem>((raw) => {
    if (!Array.isArray(raw)) return [];
    const kind = raw[0] as ProtocolItem["kind"];
    const inner = Array.isArray(raw[1]) ? raw[1] : [];
    if (kind === "ad")
      return [
        {
          kind,
          port: Number(raw[2] ?? 0),
          mappings: inner.map((entry) => ({
            key: text(entry?.[0], ""),
            rule: text(entry?.[1], ""),
            unit: text(entry?.[2], ""),
          })),
        },
      ];
    if (kind === "485")
      return [
        {
          kind,
          command: text(inner[0], ""),
          mappings: (Array.isArray(inner[1]) ? inner[1] : []).map((entry) => ({
            key: text(entry?.[0], ""),
            rule: text(entry?.[1], ""),
            unit: text(entry?.[2], ""),
          })),
        },
      ];
    if (kind === "sdi")
      return [
        {
          kind,
          address: text(inner[0], ""),
          mappings: (Array.isArray(inner[1]) ? inner[1] : []).map((entry) => ({
            key: text(entry?.[0], ""),
            index: text(entry?.[1], ""),
          })),
        },
      ];
    if (kind === "iic")
      return [
        {
          kind,
          model: text(inner[0], ""),
          address: text(inner[1], ""),
          mappings: (Array.isArray(inner[2]) ? inner[2] : []).map((key) => ({
            key: text(key, ""),
          })),
        },
      ];
    return [];
  });

const buildProtocolContent = (items: ProtocolItem[]): unknown[] =>
  items.map((item) => {
    if (item.kind === "ad")
      return [
        "ad",
        item.mappings.map((entry) => [
          entry.key,
          entry.rule ?? "",
          entry.unit ?? "",
        ]),
        Number(item.port ?? 0),
      ];
    if (item.kind === "485")
      return [
        "485",
        [
          item.command ?? "",
          item.mappings.map((entry) => [
            entry.key,
            entry.rule ?? "",
            entry.unit ?? "",
          ]),
        ],
      ];
    if (item.kind === "sdi")
      return [
        "sdi",
        [
          item.address ?? "",
          item.mappings.map((entry) => [entry.key, entry.index ?? ""]),
        ],
      ];
    return [
      "iic",
      [
        item.model ?? "",
        item.address ?? "",
        item.mappings.map((entry) => entry.key),
      ],
    ];
  });

function ProtocolEditor({
  content,
  metrics,
  onChange,
}: {
  content: unknown[];
  metrics: JsonRecord[];
  onChange: (content: unknown[]) => void;
}) {
  const [items, setItems] = useState<ProtocolItem[]>(() =>
    splitProtocolContent(content),
  );
  const commit = (next: ProtocolItem[]) => {
    setItems(next);
    onChange(buildProtocolContent(next));
  };
  const updateItem = (index: number, patch: Partial<ProtocolItem>) =>
    commit(
      items.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    );
  const updateMapping = (
    itemIndex: number,
    mappingIndex: number,
    patch: Partial<ProtocolItem["mappings"][number]>,
  ) =>
    updateItem(itemIndex, {
      mappings: items[itemIndex].mappings.map((mapping, position) =>
        position === mappingIndex ? { ...mapping, ...patch } : mapping,
      ),
    });
  const metricOptions = metrics
    .map((metric) => ({
      value: text(metric.key, ""),
      label: text(metric.name, text(metric.key)),
    }))
    .filter((item) => item.value);
  return (
    <div className="lora-node-protocol-list">
      {items.map((item, itemIndex) => (
        <div className="lora-node-protocol-item" key={itemIndex}>
          <div className="lora-node-protocol-head">
            <strong>协议项 {itemIndex + 1}</strong>
            <Button
              size="small"
              danger
              onClick={() =>
                commit(items.filter((_, index) => index !== itemIndex))
              }
            >
              删除
            </Button>
          </div>
          <div className="config-form-grid config-form-grid-3">
            <label>
              <span>协议类型</span>
              <Select
                value={item.kind}
                options={[
                  { value: "ad", label: "AD 模拟量" },
                  { value: "485", label: "RS-485" },
                  { value: "sdi", label: "SDI-12" },
                  { value: "iic", label: "IIC" },
                ]}
                onChange={(kind) =>
                  updateItem(itemIndex, { kind, mappings: item.mappings })
                }
              />
            </label>
            {item.kind === "ad" ? (
              <label>
                <span>AD 端口</span>
                <InputNumber
                  min={0}
                  precision={0}
                  value={item.port}
                  onChange={(port) =>
                    updateItem(itemIndex, { port: Number(port ?? 0) })
                  }
                />
              </label>
            ) : null}
            {item.kind === "485" ? (
              <label>
                <span>请求命令</span>
                <Input
                  value={item.command}
                  onChange={(event) =>
                    updateItem(itemIndex, { command: event.target.value })
                  }
                />
              </label>
            ) : null}
            {item.kind === "sdi" ? (
              <label>
                <span>SDI 地址</span>
                <Input
                  value={item.address}
                  onChange={(event) =>
                    updateItem(itemIndex, { address: event.target.value })
                  }
                />
              </label>
            ) : null}
            {item.kind === "iic" ? (
              <>
                <label>
                  <span>IIC 型号</span>
                  <Input
                    value={item.model}
                    onChange={(event) =>
                      updateItem(itemIndex, { model: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>IIC 地址</span>
                  <Input
                    value={item.address}
                    onChange={(event) =>
                      updateItem(itemIndex, { address: event.target.value })
                    }
                  />
                </label>
              </>
            ) : null}
          </div>
          <div className="lora-node-mapping-list">
            {item.mappings.map((mapping, mappingIndex) => (
              <div className="lora-node-mapping-row" key={mappingIndex}>
                <label>
                  <span>指标</span>
                  <Select
                    value={mapping.key}
                    options={metricOptions}
                    onChange={(key) =>
                      updateMapping(itemIndex, mappingIndex, { key })
                    }
                  />
                </label>
                {item.kind === "ad" || item.kind === "485" ? (
                  <>
                    <label>
                      <span>解析规则</span>
                      <Input
                        value={mapping.rule}
                        onChange={(event) =>
                          updateMapping(itemIndex, mappingIndex, {
                            rule: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>单位</span>
                      <Input
                        value={mapping.unit}
                        onChange={(event) =>
                          updateMapping(itemIndex, mappingIndex, {
                            unit: event.target.value,
                          })
                        }
                      />
                    </label>
                  </>
                ) : null}
                {item.kind === "sdi" ? (
                  <label>
                    <span>返回索引</span>
                    <Input
                      value={mapping.index}
                      onChange={(event) =>
                        updateMapping(itemIndex, mappingIndex, {
                          index: event.target.value,
                        })
                      }
                    />
                  </label>
                ) : null}
                <Button
                  size="small"
                  danger
                  onClick={() =>
                    updateItem(itemIndex, {
                      mappings: item.mappings.filter(
                        (_, index) => index !== mappingIndex,
                      ),
                    })
                  }
                >
                  删除
                </Button>
              </div>
            ))}
            <Button
              type="dashed"
              block
              onClick={() =>
                updateItem(itemIndex, {
                  mappings: [
                    ...item.mappings,
                    {
                      key: metricOptions[0]?.value ?? "",
                      rule: "",
                      unit: "",
                      index: "",
                    },
                  ],
                })
              }
            >
              添加指标映射
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="dashed"
        block
        onClick={() =>
          commit([...items, { kind: "485", command: "", mappings: [] }])
        }
      >
        添加协议项
      </Button>
    </div>
  );
}

export function LoRaWANV2ConfigPanel({ deviceId }: { deviceId: string }) {
  return <LoRaWANV2ConfigContent key={deviceId} deviceId={deviceId} />;
}

function LoRaWANV2ConfigContent({ deviceId }: { deviceId: string }) {
  const queryClient = useQueryClient();
  const nodes = useQuery({
    queryKey: ["admin", "device", deviceId, "nodes"],
    queryFn: () => api.admin.deviceNodes(deviceId),
  });
  const [node, setNode] = useState(1);
  useEffect(() => {
    if (!nodes.data) return;
    const valid = nodes.data.items.filter(item => item.target.kind === "gateway_node");
    if (!valid.some(item => item.target.kind === "gateway_node" && item.target.node_index === node)) {
      const first = valid[0]?.target;
      if (first?.kind === "gateway_node") setNode(first.node_index);
    }
  }, [nodes.data, node]);

  const [gatewayJSON, setGatewayJSON] = useState("{}");
  const [waitTime, setWaitTime] = useState(0);
  const [sensorJSON, setSensorJSON] = useState("[]");
  const [sensorMetricsJSON, setSensorMetricsJSON] = useState("[]");
  const [sensorMode, setSensorMode] = useState("templates");
  const [sensorDirty, setSensorDirty] = useState(false);
  const loadedSensorConfig = useRef("");
  const templateInstanceSequence = useRef(0);
  const [templateInstances, setTemplateInstances] = useState<
    Array<{
      instance_id: string;
      template_id: number;
      sensor_type: string;
      content: unknown[];
    }>
  >([]);
  const [timeContent, setTimeContent] = useState("");
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const gateways = useQuery({
    queryKey: ["admin", deviceId, "gateway-configs"],
    queryFn: () =>
      api.admin.deviceSourceConfig(deviceId, "gateway", {
        page: 1,
        page_size: 50,
      }),
  });
  const sensors = useQuery({
    queryKey: ["admin", deviceId, node, "sensor-configs"],
    enabled: Boolean(
      nodes.data?.items.some(
        (item) =>
          item.target.kind === "gateway_node" &&
          item.target.node_index === node,
      ),
    ),
    queryFn: () =>
      api.admin.deviceSourceConfig(deviceId, "sensor", {
        node_index: node,
        page: 1,
        page_size: 50,
      }),
  });
  const latest = useQuery({
    queryKey: ["admin", deviceId, node, "sensor-config-latest"],
    queryFn: () =>
      api.admin.deviceSourceConfig(deviceId, "sensor", {
        node_index: node,
        latest: true,
      }),
    enabled: Boolean(
      nodes.data?.items.some(
        (item) =>
          item.target.kind === "gateway_node" &&
          item.target.node_index === node,
      ),
    ),
    retry: false,
  });
  const templates = useQuery({
    queryKey: ["admin", "lorawan-v2", "sensor-templates"],
    queryFn: async () => {
      const first = await api.admin.platformSensorTemplates({
        status: "active",
        source_family: "lorawan_v2",
        page: 1,
        page_size: 100,
      });
      const items = [...first.items];
      const pages = Math.ceil(first.total / first.page_size);
      for (let page = 2; page <= pages; page += 1) {
        const next = await api.admin.platformSensorTemplates({
          status: "active",
          source_family: "lorawan_v2",
          page,
          page_size: 100,
        });
        items.push(...next.items);
      }
      return { ...first, items };
    },
  });
  const loraTemplates = useMemo(
    () =>
      (templates.data?.items ?? []).filter((item) =>
        Boolean((item.variants as JsonRecord | undefined)?.lorawan_v2),
      ),
    [templates.data],
  );
  const failure =
    nodes.error ?? gateways.error ?? sensors.error ?? latest.error;
  const [needsRecovery, setNeedsRecovery] = useState(false);
  useEffect(() => {
    if (!latest.data) return;
    const current = payload(latest.data);
    const content = Array.isArray(current.content) ? current.content : [];
    const metrics = Array.isArray(current.metrics) ? current.metrics : [];
    const instances = Array.isArray(current.template_instances)
      ? (current.template_instances as JsonRecord[])
      : [];
    const configKey = `${node}:${text(current.upstream_config_id ?? current.id, "")}:${JSON.stringify(content)}`;
    if (loadedSensorConfig.current === configKey) return;
    loadedSensorConfig.current = configKey;
    setSensorJSON(JSON.stringify(content, null, 2));
    setSensorMetricsJSON(JSON.stringify(metrics, null, 2));
    setWaitTime(Number(current.wait_time ?? 0));
    setTemplateInstances(
      instances
        .map((item) => ({
          instance_id: `loaded-${node}-${templateInstanceSequence.current++}`,
          template_id: Number(item.template_id),
          sensor_type: text(item.sensor_type, "传感器"),
          content: Array.isArray(item.content) ? item.content : [],
        }))
        .filter((item) => Number.isInteger(item.template_id)),
    );
    setSensorMode(instances.length ? "templates" : "advanced");
    setSensorDirty(false);
  }, [latest.data, node]);
  const refreshPlatformCatalog = async () => {
    setBusy("recover");
    setFeedback("");
    try {
      await api.admin.reconcileDeviceConfig(deviceId);
      setNeedsRecovery(false);
      setFeedback("已重新读取网关及全部节点配置，并刷新平台指标目录。");
      await Promise.all([
        nodes.refetch(),
        gateways.refetch(),
        sensors.refetch(),
        latest.refetch(),
      ]);
    } catch (error) {
      const detail = formatApiError(error);
      setFeedback(
        `${detail.message}${detail.requestId ? ` · request id ${detail.requestId}` : ""}`,
      );
    } finally {
      setBusy("");
    }
  };
  const run = async (kind: "gateway" | "sensor" | "time") => {
    setBusy(kind);
    setFeedback("");
    try {
      let result: JsonRecord = {};
      if (kind === "gateway") {
        result = await api.admin.updateDeviceSourceConfig(
          deviceId,
          "gateway",
          parseObject(gatewayJSON),
        );
        await gateways.refetch();
      }
      if (kind === "sensor") {
        const request =
          sensorMode === "templates"
            ? {
                mode: "templates",
                wait_time: waitTime,
                template_instances: templateInstances.map(
                  ({ template_id, sensor_type, content }) => ({
                    template_id,
                    sensor_type,
                    content,
                  }),
                ),
              }
            : {
                mode: "advanced",
                wait_time: waitTime,
                content: parseArray(sensorJSON),
                metrics: parseArray(sensorMetricsJSON),
              };
        result = await api.admin.updateDeviceSourceConfig(
          deviceId,
          "sensor",
          request,
          node,
        );
        await Promise.all([
          sensors.refetch(),
          latest.refetch(),
          nodes.refetch(),
        ]);
        setSensorDirty(false);
      }
      if (kind === "time")
        result = await api.admin.updateDeviceSourceConfig(
          deviceId,
          "time",
          { content: timeContent },
          node,
        );
      const state = result.write_state as JsonRecord | undefined;
      const partial = state?.platform === "failed";
      setNeedsRecovery(partial);
      setFeedback(
        partial
          ? "源端已接受，平台同步失败。请恢复同步，不要重复提交。"
          : "源端已接受，平台已同步；设备是否应用尚未确认。",
      );
    } catch (error) {
      const detail =
        error instanceof SyntaxError
          ? { message: "JSON 格式不正确", requestId: "" }
          : error instanceof Error && !("status" in error)
            ? { message: error.message, requestId: "" }
            : formatApiError(error);
      setFeedback(
        `${detail.message}${detail.requestId ? ` · request id ${detail.requestId}` : ""}`,
      );
    } finally {
      setBusy("");
    }
  };
  const columns = [
    { title: "配置 ID", dataIndex: "id", width: 110 },
    { title: "创建时间", dataIndex: "created_at", width: 200 },
    {
      title: "配置内容",
      render: (_: unknown, item: JsonRecord) => (
        <code>{JSON.stringify(item.content ?? item)}</code>
      ),
    },
  ];
  const currentManagement = latest.data
    ? managementLabel[text(payload(latest.data).management_status, "unmanaged")] ?? managementLabel.unmanaged
    : null;
  return (
    <div className="admin-device-detail-content">
      <section className="admin-detail-section">
        <div className="admin-detail-section-head">
          <div>
            <h2>LoRa V2 配置</h2>
            <span>配置提交到 LoRa V2 服务后，设备是否应用仍需等待设备回报。</span>
          </div>
          <Space>
            <Tag color="cyan">LoRa V2</Tag>
            <Button
              loading={busy === "recover"}
              onClick={() => void refreshPlatformCatalog()}
            >
              重新读取节点配置
            </Button>
          </Space>
        </div>
        {feedback ? <div className="admin-feedback">{feedback}</div> : null}
        {needsRecovery ? (
          <div className="admin-feedback">
            上次配置已被源端接受，但平台指标目录尚未刷新。请使用右上角“重新读取节点配置”。
          </div>
        ) : null}
        {failure ? (
          <StateView
            type="error"
            title="配置读取失败"
            description={formatApiError(failure).message}
            requestId={formatApiError(failure).requestId}
          />
        ) : null}
        <Tabs
          items={[
            {
              key: "gateway",
              label: "网关配置",
              children: (
                <>
                  <Alert className="lora-config-intro" type="info" showIcon message="网关配置" description="编辑网关的原生 JSON，确认内容后提交到 LoRa V2 服务。下方可查看历史记录。" />
                  <Form layout="vertical">
                    <Form.Item label="新增配置（JSON 对象）">
                      <Input.TextArea
                        rows={8}
                        value={gatewayJSON}
                        onChange={(event) => setGatewayJSON(event.target.value)}
                        spellCheck={false}
                      />
                    </Form.Item>
                    <Popconfirm title="提交网关配置？" description="配置将写入 LoRa V2 服务，设备是否应用需等待回报。" okText="确认提交" cancelText="取消" onConfirm={() => void run("gateway")}>
                      <Button type="primary" loading={busy === "gateway"}>提交到 LoRa V2</Button>
                    </Popconfirm>
                  </Form>
                  <Collapse className="lora-config-history" items={[{ key: "history", label: `历史配置（${list(gateways.data).length}）`, children: <Table rowKey={(item) => text(item.id)} size="small" dataSource={list(gateways.data)} columns={columns} pagination={false} /> }]} />
                </>
              ),
            },
            {
              key: "sensor",
              label: "节点传感器配置",
              children: (
                <>
                  <div className="lora-config-step"><span className="lora-config-step-number">1</span><div><strong>选择节点</strong><span>以下查看和编辑操作只作用于所选节点。</span></div></div>
                  <Space className="lora-config-node" wrap>
                    <Select
                      value={node}
                      aria-label="选择配置节点"
                      options={(nodes.data?.items ?? [])
                        .filter((item) => item.target.kind === "gateway_node")
                        .map((item) => ({
                          value:
                            item.target.kind === "gateway_node"
                              ? item.target.node_index
                              : 0,
                          label: item.name,
                        }))}
                      onChange={(next) => {
                        if (
                          (sensorDirty || timeContent) &&
                          !window.confirm(
                            "切换节点将清除未提交的编辑，是否继续？",
                          )
                        )
                          return;
                        setNode(next);
                        loadedSensorConfig.current = "";
                        setSensorJSON("[]");
                        setSensorMetricsJSON("[]");
                        setTemplateInstances([]);
                        setWaitTime(0);
                        setTimeContent("");
                        setSensorDirty(false);
                      }}
                    />
                    {nodes.data?.items.some(item => item.target.kind === "gateway_node" && item.target.node_index === node) && <NodeNameEditor name={nodes.data?.items.find(item => item.target.kind === "gateway_node" && item.target.node_index === node)?.custom_name ?? ""} onSave={async name => {await api.admin.renameNode(deviceId, node, name); await invalidateNodeNames(queryClient);}}/>}
                    {currentManagement ? <Tag color={currentManagement.color}>{currentManagement.label}</Tag> : null}
                  </Space>
                  {latest.data
                    ? (() => {
                        const current = payload(latest.data);
                        const metrics = Array.isArray(current.metrics)
                          ? (current.metrics as JsonRecord[])
                          : [];
                        const instances = Array.isArray(
                          current.template_instances,
                        )
                          ? (current.template_instances as JsonRecord[])
                          : [];
                        return (
                          <section className="lora-current-config" aria-label="源端当前配置">
                            <div className="lora-current-config-grid">
                              <div>
                                <small>源端当前配置 ID</small>
                                <strong>
                                  {text(
                                    current.upstream_config_id ?? current.id,
                                  )}
                                </strong>
                              </div>
                              <div>
                                <small>已配置传感器</small>
                                <div className="lora-current-tags">
                                  {instances.length ? (
                                    instances.map((item, index) => (
                                      <Tag
                                        key={`${text(item.template_id)}-${index}`}
                                      >
                                        {text(item.sensor_type)}
                                      </Tag>
                                    ))
                                  ) : (
                                    <em>未关联模板</em>
                                  )}
                                </div>
                              </div>
                              <div>
                                <small>平台已识别指标</small>
                                <div className="lora-current-tags">
                                  {metrics.length ? (
                                    metrics.map((item, index) => (
                                      <Tag key={`${text(item.key)}-${index}`}>
                                        {text(item.name, text(item.key))}
                                        {item.unit
                                          ? ` · ${text(item.unit)}`
                                          : ""}
                                      </Tag>
                                    ))
                                  ) : (
                                    <em>尚未补全指标语义</em>
                                  )}
                                </div>
                              </div>
                            </div>
                          </section>
                        );
                      })()
                    : null}
                  <div className="lora-config-step"><span className="lora-config-step-number">2</span><div><strong>编辑配置草稿</strong><span>推荐使用模板；提交时只会使用当前选中的编辑方式，未提交的修改不会自动保存。</span></div></div>
                  <Form layout="vertical">
                    <Tabs
                      className="lora-config-mode-tabs"
                      activeKey={sensorMode}
                      onChange={(mode) => {
                        if (mode === "advanced" && sensorMode === "templates") {
                          const content = templateInstances.flatMap(
                            (instance) => instance.content,
                          );
                          const metrics = templateInstances.flatMap(
                            (instance) => {
                              const template = loraTemplates.find(
                                (item) => item.id === instance.template_id,
                              );
                              return (template?.metrics ?? []).map(
                                (metric) => ({
                                  key: metric.key,
                                  name: metric.name || metric.key,
                                  type: metric.type ?? "",
                                  unit: metric.unit ?? "",
                                }),
                              );
                            },
                          );
                          const current = latest.data
                            ? payload(latest.data)
                            : {};
                          const fallbackMetrics = Array.isArray(current.metrics)
                            ? current.metrics
                            : [];
                          setSensorJSON(JSON.stringify(content, null, 2));
                          setSensorMetricsJSON(
                            JSON.stringify(
                              metrics.length ? metrics : fallbackMetrics,
                              null,
                              2,
                            ),
                          );
                        }
                        setSensorMode(mode);
                        setSensorDirty(true);
                      }}
                      items={[
                        {
                          key: "templates",
                          label: "使用模板（推荐）",
                          children: (
                            <>
                              <Alert
                                type="info"
                                showIcon
                                message="一个节点可以配置多个传感器"
                                description="逐个添加传感器实例；同一模板可以重复添加。实例顺序就是提交给上游的协议配置顺序。"
                              />
                              <Form.Item
                                className="lora-template-add"
                                label="添加传感器"
                                extra={
                                  loraTemplates.length
                                    ? "只显示已经维护 LoRaWAN V2 协议配置的模板。"
                                    : "暂无可用模板，请先到「传感器模板 V2」中新建模板。"
                                }
                              >
                                <Select
                                  value={undefined}
                                  placeholder="选择一个模板并添加"
                                  loading={templates.isLoading}
                                  disabled={!loraTemplates.length}
                                  options={loraTemplates.map((item) => ({
                                    value: item.id,
                                    label: `${item.sensor_type} · ${item.metrics.map((metric) => metric.name || metric.key).join("、")}`,
                                  }))}
                                  onChange={(id: number) => {
                                    const template = loraTemplates.find(
                                      (item) => item.id === id,
                                    );
                                    if (!template) return;
                                    const variant = ((
                                      template.variants as JsonRecord
                                    ).lorawan_v2 ?? {}) as JsonRecord;
                                    const next = [
                                      ...templateInstances,
                                      {
                                        instance_id: `new-${templateInstanceSequence.current++}`,
                                        template_id: id,
                                        sensor_type: template.sensor_type,
                                        content: (variant.content ??
                                          []) as unknown[],
                                      },
                                    ];
                                    setTemplateInstances(next);
                                    setSensorDirty(true);
                                    const suggested = next.map((item) => {
                                      const source = loraTemplates.find(
                                        (candidate) =>
                                          candidate.id === item.template_id,
                                      );
                                      return Number(
                                        (
                                          (
                                            source?.variants as
                                              JsonRecord | undefined
                                          )?.lorawan_v2 as
                                            JsonRecord | undefined
                                        )?.wait_time ?? 0,
                                      );
                                    });
                                    setWaitTime(Math.max(0, ...suggested));
                                  }}
                                />
                              </Form.Item>
                              {templateInstances.map((instance, index) => (
                                <div
                                  className="lora-template-instance"
                                  key={instance.instance_id}
                                >
                                  <div className="lora-template-instance-head">
                                    <div>
                                      <span>传感器实例 {index + 1}</span>
                                      <strong>{instance.sensor_type}</strong>
                                    </div>
                                    <Space size={4}>
                                      <Button
                                        size="small"
                                        disabled={index === 0}
                                        onClick={() =>
                                          setTemplateInstances((items) => {
                                            const next = [...items];
                                            [next[index - 1], next[index]] = [
                                              next[index],
                                              next[index - 1],
                                            ];
                                            setSensorDirty(true);
                                            return next;
                                          })
                                        }
                                      >
                                        上移
                                      </Button>
                                      <Button
                                        size="small"
                                        disabled={
                                          index === templateInstances.length - 1
                                        }
                                        onClick={() =>
                                          setTemplateInstances((items) => {
                                            const next = [...items];
                                            [next[index], next[index + 1]] = [
                                              next[index + 1],
                                              next[index],
                                            ];
                                            setSensorDirty(true);
                                            return next;
                                          })
                                        }
                                      >
                                        下移
                                      </Button>
                                      <Button
                                        size="small"
                                        danger
                                        onClick={() => {
                                          setTemplateInstances((items) =>
                                            items.filter(
                                              (item) =>
                                                item.instance_id !==
                                                instance.instance_id,
                                            ),
                                          );
                                          setSensorDirty(true);
                                        }}
                                      >
                                        删除
                                      </Button>
                                    </Space>
                                  </div>
                                  <div className="lora-template-instance-metrics">
                                    {(
                                      loraTemplates.find(
                                        (item) =>
                                          item.id === instance.template_id,
                                      )?.metrics ?? []
                                    ).map((metric) => (
                                      <Tag
                                        key={`${instance.instance_id}-${metric.key}`}
                                      >
                                        {metric.name || metric.key}
                                        {metric.unit ? ` · ${metric.unit}` : ""}
                                      </Tag>
                                    ))}
                                  </div>
                                  <ProtocolEditor
                                    content={instance.content}
                                    metrics={
                                      (loraTemplates.find(
                                        (item) =>
                                          item.id === instance.template_id,
                                      )?.metrics ?? []) as JsonRecord[]
                                    }
                                    onChange={(content) => {
                                      setTemplateInstances((items) =>
                                        items.map((item) =>
                                          item.instance_id ===
                                          instance.instance_id
                                            ? { ...item, content }
                                            : item,
                                        ),
                                      );
                                      setSensorDirty(true);
                                    }}
                                  />
                                </div>
                              ))}
                            </>
                          ),
                        },
                        {
                          key: "advanced",
                          label: "手动编辑 JSON",
                          children: (
                            <>
                              <Alert
                                type="warning"
                                showIcon
                                message="高级模式不会关联模板"
                                description="必须为原生配置中的每一个指标 Key 提供中文名称；平台不会根据相似 Key 猜测。"
                              />
                              <Form.Item
                                label="上游原生 content"
                                extra="必须符合 ad / 485 / sdi / iic 数组格式。"
                              >
                                <Input.TextArea
                                  rows={10}
                                  value={sensorJSON}
                                  onChange={(event) => {
                                    setSensorJSON(event.target.value);
                                    setSensorDirty(true);
                                  }}
                                  spellCheck={false}
                                />
                              </Form.Item>
                              <Form.Item
                                label="指标语义"
                                extra="每项必须包含 key 和中文 name，可附带 type、unit。"
                              >
                                <Input.TextArea
                                  rows={8}
                                  value={sensorMetricsJSON}
                                  onChange={(event) => {
                                    setSensorMetricsJSON(event.target.value);
                                    setSensorDirty(true);
                                  }}
                                  spellCheck={false}
                                />
                              </Form.Item>
                            </>
                          ),
                        },
                      ]}
                    />
                    <div className="lora-config-step"><span className="lora-config-step-number">3</span><div><strong>确认并提交</strong><span>提交会写入源端；“已接受”不等于设备已应用。</span></div></div>
                    <Form.Item label="等待时间（秒）">
                      <InputNumber
                        min={0}
                        max={65535}
                        precision={0}
                        value={waitTime}
                        onChange={(item) => {
                          setWaitTime(Number(item ?? 0));
                          setSensorDirty(true);
                        }}
                      />
                    </Form.Item>
                    <Popconfirm title={`提交节点 ${node} 的传感器配置？`} description="配置将写入 LoRa V2 服务，设备是否应用需等待回报。" okText="确认提交" cancelText="取消" onConfirm={() => void run("sensor")}>
                      <Button type="primary" disabled={sensorMode === "templates" && !templateInstances.length} loading={busy === "sensor"}>提交到 LoRa V2</Button>
                    </Popconfirm>
                  </Form>
                  <Collapse className="lora-config-history" items={[{ key: "history", label: `节点 ${node} 历史配置（${list(sensors.data).length}）`, children: <Table rowKey={(item) => text(item.id)} size="small" dataSource={list(sensors.data)} columns={columns} pagination={false} /> }]} />
                </>
              ),
            },
            {
              key: "time",
              label: "节点时间配置",
              children: (
                <Form layout="vertical">
                  <Alert className="lora-config-intro" type="info" showIcon message="节点时间配置" description="先选择节点，再填写上游要求的时间配置文本。提交后设备是否应用仍需等待回报。" />
                  <Space className="lora-config-node">
                    <span>选择节点</span>
                    <Select
                      value={node}
                      aria-label="选择时间配置节点"
                      options={(nodes.data?.items ?? [])
                        .filter((item) => item.target.kind === "gateway_node")
                        .map((item) => ({
                          value:
                            item.target.kind === "gateway_node"
                              ? item.target.node_index
                              : 0,
                          label: item.name,
                        }))}
                      onChange={(next) => {
                        if (
                          (sensorDirty || timeContent) &&
                          !window.confirm(
                            "切换节点将清除未提交的编辑，是否继续？",
                          )
                        )
                          return;
                        setNode(next);
                        loadedSensorConfig.current = "";
                        setSensorJSON("[]");
                        setWaitTime(0);
                        setTimeContent("");
                        setSensorDirty(false);
                      }}
                    />
                  </Space>
                  <Form.Item label="时间配置文本" required>
                    <Input.TextArea
                      rows={8}
                      value={timeContent}
                      onChange={(event) => setTimeContent(event.target.value)}
                    />
                  </Form.Item>
                  <Popconfirm title={`提交节点 ${node} 的时间配置？`} description="配置将写入 LoRa V2 服务，设备是否应用需等待回报。" okText="确认提交" cancelText="取消" onConfirm={() => void run("time")}>
                    <Button type="primary" disabled={!timeContent} loading={busy === "time"}>提交到 LoRa V2</Button>
                  </Popconfirm>
                </Form>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}
