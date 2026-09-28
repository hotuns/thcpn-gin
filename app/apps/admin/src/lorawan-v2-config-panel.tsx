import { invalidateNodeNames } from "@thcpn/workspace";
import { NodeSensorEditor, serializeNodeSensorDraft } from './node-sensor-editor';
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Collapse,
  Form,
  Input,
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
export function configurationHistory(input: unknown): JsonRecord[] {
  if (Array.isArray(input)) {
    return input.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }
  if (!input || typeof input !== "object") return [];
  const object = input as JsonRecord;
  return configurationHistory(object.payload ?? object.data ?? object.items);
}
const list = configurationHistory;
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



export function LoRaWANV2ConfigPanel({ deviceId }: { deviceId: string }) {
  return <LoRaWANV2ConfigContent key={deviceId} deviceId={deviceId} />;
}

function LoRaWANV2ConfigContent({ deviceId }: { deviceId: string }) {
  const [sensorForm] = Form.useForm();
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

  const [sensorJSON, setSensorJSON] = useState("[]");
  const [sensorMetricsJSON, setSensorMetricsJSON] = useState("[]");

  const [sensorDirty, setSensorDirty] = useState(false);
  const loadedSensorConfig = useRef("");

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
    const configKey = `${node}:${text(current.upstream_config_id ?? current.id, "")}:${JSON.stringify(content)}:${JSON.stringify(metrics)}`;
    if (loadedSensorConfig.current === configKey) return;
    loadedSensorConfig.current = configKey;
    setSensorJSON(JSON.stringify(content, null, 2));
    setSensorMetricsJSON(JSON.stringify(metrics, null, 2));

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
        await sensorForm.validateFields();
        const request = { mode: "advanced", wait_time: 0, content: parseArray(sensorJSON), metrics: parseArray(sensorMetricsJSON) };
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
                  <div className="lora-config-step"><span className="lora-config-step-number">2</span><div><strong>编辑配置草稿</strong><span>协议和指标在同一表单编辑；可导入模板作为起点，修改只应用于当前节点。</span></div></div>
                  <Form form={sensorForm} layout="vertical" onValuesChange={(_, values) => {
                    const draft = serializeNodeSensorDraft(values.lora_items ?? []);
                    setSensorJSON(draft.content); setSensorMetricsJSON(draft.metrics); setSensorDirty(true);
                  }}>
                    <NodeSensorEditor key={node} contentJSON={sensorJSON} metricsJSON={sensorMetricsJSON} templates={loraTemplates} onChange={(content, metrics) => {setSensorJSON(content); setSensorMetricsJSON(metrics); setSensorDirty(true);}} />
                    <div className="lora-config-step"><span className="lora-config-step-number">3</span><div><strong>确认并提交</strong><span>提交会写入源端；“已接受”不等于设备已应用。</span></div></div>
                    <Popconfirm title={`提交节点 ${node} 的传感器配置？`} description="配置将写入 LoRa V2 服务，设备是否应用需等待回报。" okText="确认提交" cancelText="取消" onConfirm={() => void run("sensor")}>
                      <Button type="primary"  loading={busy === "sensor"}>提交到 LoRa V2</Button>
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
