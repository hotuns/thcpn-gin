import { nodeOptionLabel } from "@thcpn/api";
import { LoRaGatewayStatus } from "./lorawan-gateway-status";
import { confirmManualSync } from "./manual-sync-confirm";
import { useSearchParams } from "react-router-dom";
import { invalidateNodeNames } from "@thcpn/workspace";
import { validateSensorWaitTime } from "./sensor-config-wait-time";
import { useLocale } from "@thcpn/i18n";
import { describeNodeTimeSchedule, parseNodeTimeSchedule } from "@thcpn/api";
import { NodeSensorEditor, readNodeSensorDraft, serializeNodeSensorDraft } from './node-sensor-editor';
import { sensorConfigTargets, submitNodeSensorBatch, verifyNodeConfigTargets, type NodeConfigResult } from "./node-config-batch";
import { AdminNodeLocationEditor } from "./node-location-editor";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
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
import { StateView } from "@thcpn/ui";
import { AdminNodeNameEditor as NodeNameEditor } from "./node-name-editor";
import { LoRaWANV2GatewayConfigCopy, LoRaWANV2SensorConfigCopy, LoRaWANV2TimeConfigCopy } from "./lorawan-v2-config-copy";
import { configurationHistory } from "./lorawan-v2-config-copy-model";
export { configurationHistory } from "./lorawan-v2-config-copy-model";

const text = (input: unknown, fallback = "—") =>
  input === undefined || input === null || input === ""
    ? fallback
    : String(input);
const payload = (input: JsonRecord | undefined) =>
  (input?.payload ?? input ?? {}) as JsonRecord;
const list = configurationHistory;
export function formattedConfiguration(value: unknown): string {
  if (typeof value === "string") {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  return JSON.stringify(value, null, 2) ?? "";
}
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
const canonicalJSON = (value: unknown) => JSON.stringify(value, (_, entry) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  return Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]]));
});
const managementLabel: Record<string, { label: string; color: string }> = {
  managed: { label: "平台已托管", color: "green" },
  matched: { label: "已匹配模板", color: "blue" },
  unmanaged: { label: "未托管", color: "orange" },
};



export function LoRaWANV2ConfigPanel({ deviceId }: { deviceId: string }) {
  return <LoRaWANV2ConfigContent key={deviceId} deviceId={deviceId} />;
}

function LoRaWANV2ConfigContent({ deviceId }: { deviceId: string }) {
  const {locale}=useLocale();
  const { message, modal } = AntApp.useApp();
  const [sensorForm] = Form.useForm();
  const queryClient = useQueryClient();
  const nodes = useQuery({
    queryKey: ["admin", "device", deviceId, "nodes"],
    queryFn: () => api.admin.deviceNodes(deviceId),
  });
  const [params,setParams] = useSearchParams();
  const [node, setNode] = useState(()=>Number(params.get("node_index"))||1);
 const selectNode=(index:number)=>{setNode(index);setParams(previous=>{const next=new URLSearchParams(previous);next.set("node_index",String(index));next.set("node",`gateway:${deviceId}:node:${index}`);return next;},{replace:true});};
 useEffect(()=>{const requested=Number(params.get("node_index"));if(requested>=1&&requested<=254)setNode(requested);},[params]);
  useEffect(() => {
    if (!nodes.data) return;
    const valid = nodes.data.items.filter(item => item.target.kind === "gateway_node" && item.bound);
    if (!valid.some(item => item.target.kind === "gateway_node" && item.target.node_index === node)) {
      const first = valid[0]?.target;
      if (first?.kind === "gateway_node") setNode(first.node_index);
    }
  }, [nodes.data, node]);

  const [gatewayJSON, setGatewayJSON] = useState("{}");

  const [sensorJSON, setSensorJSON] = useState("[]");
  const [sensorMetricsJSON, setSensorMetricsJSON] = useState("[]");

  const [sensorDirty, setSensorDirty] = useState(false);
  const [sensorWaitTime,setSensorWaitTime]=useState<number|null>(0);
  const [loadedSensorConfig, setLoadedSensorConfig] = useState<{ node: number; key: string; content: string; metrics: string; waitTime: number } | null>(null);
  useEffect(() => {
    setLoadedSensorConfig(null);
    setSensorJSON("[]");
    setSensorMetricsJSON("[]");
    setSensorWaitTime(0);
    setSensorDirty(false);
  }, [deviceId, node]);

  const [timeContent, setTimeContent] = useState("");
  const timeConfig = useQuery({ queryKey: ["admin",deviceId,node,"time-config"], queryFn: () => api.admin.nodeTimeConfig(deviceId,node), enabled: Boolean(nodes.data?.items.some(item=>item.bound && item.target.kind==="gateway_node" && item.target.node_index===node)), retry: false });
  const timeHistory = useQuery({ queryKey: ["admin",deviceId,node,"time-configs"], queryFn: () => api.admin.nodeTimeConfigs(deviceId,node), enabled: Boolean(nodes.data?.items.some(item=>item.bound && item.target.kind==="gateway_node" && item.target.node_index===node)), retry: false });
  const reportedInfo = useQuery({ queryKey: ["admin",deviceId,"lorawan-info"], queryFn: () => api.admin.lorawanInfo(deviceId), retry: false });
  const [busy, setBusy] = useState("");
  const [applyToOthers, setApplyToOthers] = useState(false);
  const [selectedOtherNodes, setSelectedOtherNodes] = useState<number[]>([]);
  const [sensorResults, setSensorResults] = useState<NodeConfigResult[]>([]);
  const sensorNodeOptions = (nodes.data?.items ?? []).flatMap(item => item.target.kind === "gateway_node" && item.bound ? [{ value: item.target.node_index, label: nodeOptionLabel(item) }] : []);
  const nodeSetKey = sensorNodeOptions.map(item => item.value).sort((a,b) => a-b).join(",");
  useEffect(() => {
    setSelectedOtherNodes(nodeSetKey.split(",").filter(Boolean).map(Number).filter(index => index !== node));
    setApplyToOthers(false);
    setSensorResults([]);
  }, [deviceId, node, nodeSetKey]);
  const sensorTargets = sensorConfigTargets(node, selectedOtherNodes, sensorNodeOptions.map(item => item.value), applyToOthers);
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
    if (!latest.data || sensorDirty) return;
    const current = payload(latest.data);
    const content = Array.isArray(current.content) ? current.content : [];
    const metrics = Array.isArray(current.metrics) ? current.metrics : [];
    const waitTime=Number(current.wait_time ?? 0);
    const originalContent = canonicalJSON(content);
    const originalMetrics = canonicalJSON(metrics);
    const configKey = `${node}:${text(current.upstream_config_id ?? current.id, "")}:${originalContent}:${originalMetrics}:${waitTime}`;
    if (loadedSensorConfig?.key === configKey) return;
    setLoadedSensorConfig({ node, key: configKey, content: originalContent, metrics: originalMetrics, waitTime });
    setSensorJSON(JSON.stringify(content, null, 2));
    setSensorMetricsJSON(JSON.stringify(metrics, null, 2));
    setSensorWaitTime(waitTime);

    setSensorDirty(false);
  }, [latest.data, loadedSensorConfig?.key, node, sensorDirty]);
  const canSaveSensor = !busy && latest.isSuccess && loadedSensorConfig?.node === node && sensorTargets.length > 0;
  const buildSensorRequest = () => {
    const content = parseArray(sensorJSON);
    const metrics = parseArray(sensorMetricsJSON);
    const waitTime = validateSensorWaitTime(sensorWaitTime);
    const nativeUnchanged = loadedSensorConfig?.node === node && loadedSensorConfig.waitTime === waitTime && loadedSensorConfig.content === canonicalJSON(content);
    // A batch can still explicitly apply the existing full configuration to other nodes.
    if (content.length > 0 && nativeUnchanged && (sensorTargets.length === 1 || loadedSensorConfig.metrics !== canonicalJSON(metrics))) {
      return { mode: "metrics", metrics };
    }
    return { mode: "advanced", wait_time: waitTime, content, metrics };
  };
  const refreshPlatformCatalog = async () => {
    if (!await confirmManualSync({reason:needsRecovery?"recovery":"external",title:"重新读取节点配置？",scope:"读取网关及全部节点的源端配置，刷新平台指标目录，不重新下发配置。"})) return;
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
  const run = async (kind: "gateway" | "sensor" | "time", sensorRequest?: JsonRecord) => {
    if (busy) return;
    setBusy(kind);
    setFeedback("");
    try {
      let result: JsonRecord = {};
      if (kind === "gateway") {
        const content = parseObject(gatewayJSON);
        result = await api.admin.updateDeviceSourceConfig(
          deviceId,
          "gateway",
          content.content && typeof content.content === "object" ? content.content as JsonRecord : content,
        );
        await gateways.refetch();
      }
      if (kind === "sensor") {
        if (!sensorRequest) return;
        const results = await submitNodeSensorBatch(deviceId, sensorTargets, sensorRequest, setSensorResults);
        setNeedsRecovery(results.some(item => item.status === "sync_failed"));
        const failed = results.filter(item => item.status === "failed").length;
        const pendingSync = results.filter(item => item.status === "sync_failed").length;
        const platformOnly = results.filter(item => item.status === "synced" && item.source === "unchanged").length;
        const synced = results.filter(item => item.status === "synced" && item.source === "accepted").length;
        const sent = results.some(item => item.source === "accepted");
        const summary = [platformOnly ? `${platformOnly} 个仅保存平台指标` : "", synced ? `${synced} 个源端已接受且平台已同步` : "", pendingSync ? `${pendingSync} 个待恢复平台同步` : "", failed ? `${failed} 个失败` : ""].filter(Boolean).join("，");
        setFeedback(`${summary}。${sent ? "设备是否应用需等待回报。" : sensorRequest.mode === "metrics" ? "未下发设备配置。" : ""}`);
        for (const item of results) {
          if (item.source === "accepted") void queryClient.invalidateQueries({ queryKey: ["admin",deviceId,item.node,"sensor-configs"] });
          void queryClient.invalidateQueries({ queryKey: ["admin",deviceId,item.node,"sensor-config-latest"] });
        }
        await Promise.all([
          sensors.refetch(),
          latest.refetch(),
          nodes.refetch(),
        ]);
        if (results.find(item => item.node === node)?.status !== "failed") setSensorDirty(false);
        return;
      }
      if (kind === "time") {
        await verifyNodeConfigTargets(deviceId,[node]);
        result = await api.admin.updateDeviceSourceConfig(
          deviceId,
          "time",
          { content: timeContent },
          node,
        );
      }
      const state = result.write_state as JsonRecord | undefined;
      if (kind==="time") { await timeConfig.refetch(); await timeHistory.refetch(); }
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
  const confirmSensorSave = async () => {
    if (!canSaveSensor) return;
    try {
      await sensorForm.validateFields();
      const request = buildSensorRequest();
      const metricsOnly = request.mode === "metrics";
      const multiple = sensorTargets.length > 1;
      const description = metricsOnly
        ? "仅保存平台指标。每个节点保留原有协议配置和等待时间。"
        : "只向原生配置有变化的节点提交配置；设备是否应用需等待回报。";
      if (!multiple && metricsOnly) {
        await run("sensor", request);
        return;
      }
      modal.confirm({
        title: multiple ? "确认同时应用到其他节点？" : `保存节点 ${node} 的传感器配置？`,
        content: <div><p>{description}</p>{multiple ? <ul>{sensorTargets.map(index => <li key={index}>{sensorNodeOptions.find(item => item.value === index)?.label ?? `节点 ${index}`}</li>)}</ul> : null}</div>,
        okText: multiple ? `应用到 ${sensorTargets.length} 个节点` : "确认保存",
        cancelText: "取消",
        autoFocusButton: "cancel",
        onOk: () => run("sensor", request),
      });
    } catch (error) {
      if (error instanceof Error) setFeedback(error instanceof SyntaxError ? "JSON 格式不正确" : error.message);
    }
  };
  const columns = [
    { title: "配置 ID", dataIndex: "id", width: 110 },
    { title: "创建时间", dataIndex: "created_at", width: 200 },
    {
      title: "配置内容",
      render: (_: unknown, item: JsonRecord) => (
        <div className="lora-history-content"><Button size="small" onClick={async () => { try { await navigator.clipboard.writeText(formattedConfiguration(item.config_content ?? item.content ?? item)); void message.success("JSON 已复制"); } catch { void message.error("复制失败，请展开 JSON 后手动复制"); } }}>复制 JSON</Button><details className="lora-history-json"><summary>查看 JSON</summary><pre>{formattedConfiguration(item.config_content ?? item.content ?? item)}</pre></details></div>
      ),
    },
  ];
  const hasSensorConfig = Array.isArray(payload(latest.data).content);
  const currentManagement = hasSensorConfig
    ? managementLabel[text(payload(latest.data).management_status, "unmanaged")] ?? managementLabel.unmanaged
    : null;
  return (
    <div className="admin-device-detail-content">

      <Alert type="info" showIcon message="设备上报信息" description={reportedInfo.isLoading ? "正在读取设备上报信息" : reportedInfo.error ? formatApiError(reportedInfo.error).message : `设备上报 ICCID：${reportedInfo.data?.iccid || "未上报"} · 固件版本：${reportedInfo.data?.firmware_version || "未上报"}`} />
      <section className="admin-detail-section">
        <div className="admin-detail-section-head">
          <div>
            <h2>LoRa V2 配置</h2>
            <span>配置按网关和序号保存；更换节点沿用原配置，硬件是否应用需设备回报。</span>
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
            有配置尚未同步到平台。请使用右上角“重新读取节点配置”。
          </div>
        ) : null}
        {failure ? (
          <StateView
            type="error"
            title="配置读取失败"
            description={formatApiError(failure).message}
            requestId={formatApiError(failure).requestId}
            action={failure === latest.error && <Button size="small" loading={latest.isFetching} onClick={() => void latest.refetch()}>重试读取当前节点</Button>}
          />
        ) : null}
        <Tabs
          activeKey={["gateway","sensor","time"].includes(params.get("config_tab")??"")?params.get("config_tab")!:"gateway"}
          onChange={key=>setParams(previous=>{const next=new URLSearchParams(previous);next.set("config_tab",key);return next;},{replace:true})}
          items={[
            {
              key: "gateway",
              label: "网关配置",
              children: (
                <>
                  <Alert className="lora-config-intro" type="info" showIcon message="网关配置" description="编辑网关的原生 JSON，确认内容后提交到 LoRa V2 服务。下方可查看历史记录。" />
                  <LoRaWANV2GatewayConfigCopy deviceId={deviceId} disabled={Boolean(busy)} onCopy={setGatewayJSON} />
                  <Form layout="vertical">
                    <Form.Item label="新增配置（JSON 对象）">
                      <Input.TextArea
                        rows={8}
                        value={gatewayJSON}
                        onChange={(event) => setGatewayJSON(event.target.value)}
                        spellCheck={false}
                      />
                    </Form.Item>
                    <Button style={{marginRight:8}} onClick={() => { try { setGatewayJSON(JSON.stringify(parseObject(gatewayJSON),null,2)); } catch { setFeedback("JSON 格式不正确"); } }}>格式化 JSON</Button>
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
                  <div className="lora-config-step"><span className="lora-config-step-number">1</span><div><strong>选择节点</strong><span>查看所选节点的配置，以此为草稿；提交时可同时应用到其他节点。</span></div></div>
                  <Space className="lora-config-node" wrap>
                    <Select
                      value={sensorNodeOptions.some(item=>item.value===node)?node:undefined}
                      placeholder="请先选择已绑定节点"
                      aria-label="选择配置节点"
                      disabled={Boolean(busy)}
                      options={(nodes.data?.items ?? [])
                        .filter((item) => item.target.kind === "gateway_node")
                        .map((item) => ({
                          value:
                            item.target.kind === "gateway_node"
                              ? item.target.node_index
                              : 0,
                          label: nodeOptionLabel(item),
                        }))}
                      onChange={(next) => {
                        if (
                          (sensorDirty || timeContent) &&
                          !window.confirm(
                            "切换节点将清除未提交的编辑，是否继续？",
                          )
                        )
                          return;
                        selectNode(next);
                        setTimeContent("");
                      }}
                    />
                    {nodes.data?.items.some(item => item.target.kind === "gateway_node" && item.target.node_index === node) && <NodeNameEditor name={nodes.data?.items.find(item => item.target.kind === "gateway_node" && item.target.node_index === node)?.custom_name ?? ""} onSave={async name => {await api.admin.renameNode(deviceId, node, name); await invalidateNodeNames(queryClient);}}/>}
                    {nodes.data?.items.filter(item => item.target.kind === "gateway_node" && item.target.node_index === node).map(item => <AdminNodeLocationEditor key={item.key} deviceId={deviceId} node={item}/>)}
                    {currentManagement ? <Tag color={currentManagement.color}>{currentManagement.label}</Tag> : null}
                  </Space>
                  {hasSensorConfig
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
                  <div className="lora-config-step"><span className="lora-config-step-number">2</span><div><strong>编辑配置草稿</strong><span>协议和指标在同一表单编辑；可选择将同一份配置应用到其他节点。</span></div></div>
                  <LoRaWANV2SensorConfigCopy key={`sensor-copy-${deviceId}-${node}`} deviceId={deviceId} node={node}
                    disabled={!canSaveSensor}
                    onCopy={draft => { setSensorJSON(draft.content); setSensorMetricsJSON(draft.metrics); setSensorWaitTime(draft.waitTime); setSensorDirty(true); setSensorResults([]); }} />
                  <Form form={sensorForm} layout="vertical" disabled={!canSaveSensor} onValuesChange={(_, values) => {
                    const draft = serializeNodeSensorDraft(values.lora_items ?? []);
                    // The visual editor normalizes the protocol. Preserve its original JSON when only labels or other platform fields change.
                    const original = serializeNodeSensorDraft(readNodeSensorDraft(sensorJSON, sensorMetricsJSON));
                    if (draft.content !== original.content) setSensorJSON(draft.content);
                    setSensorMetricsJSON(draft.metrics);
                    setSensorDirty(true);
                  }}>
                    <NodeSensorEditor key={node} contentJSON={sensorJSON} metricsJSON={sensorMetricsJSON} templates={loraTemplates} onChange={(content, metrics) => {setSensorJSON(content); setSensorMetricsJSON(metrics); setSensorDirty(true);}} />
                    <Form.Item label="等待时间（wait_time）" required extra="单位：秒，范围 0–65535。只修改平台指标时，保留各节点原有等待时间。">
                      <InputNumber aria-label="等待时间（秒）" min={0} max={65535} precision={0} step={1} value={sensorWaitTime} onChange={value=>{setSensorWaitTime(value);setSensorDirty(true);}} addonAfter="秒" style={{width:240,maxWidth:"100%"}} />
                    </Form.Item>
                    <div className="lora-config-step"><span className="lora-config-step-number">3</span><div><strong>保存配置</strong><span>只有协议配置或等待时间变化才会下发。</span></div></div>
                    <div className="lora-config-apply-nodes">
                      <Checkbox checked={applyToOthers && sensorNodeOptions.length > 1} disabled={Boolean(busy) || sensorNodeOptions.length < 2} onChange={event => setApplyToOthers(event.target.checked)}>同时应用到其他节点</Checkbox>
                      {applyToOthers && sensorNodeOptions.length > 1 ? <Checkbox.Group aria-label="同时应用的节点" disabled={Boolean(busy)} options={sensorNodeOptions.filter(item => item.value !== node)} value={selectedOtherNodes} onChange={values => setSelectedOtherNodes(values.map(Number))} /> : null}
                      <span>应用范围：{sensorTargets.map(index => sensorNodeOptions.find(item => item.value === index)?.label ?? `节点 ${index}`).join("、")}</span>
                    </div>
                    <Button type="primary" disabled={!canSaveSensor} loading={busy === "sensor"} onClick={() => void confirmSensorSave()}>保存配置</Button>
                  </Form>
                  {sensorResults.length ? <Table size="small" rowKey="node" pagination={false} dataSource={sensorResults} columns={[{title:"节点",dataIndex:"node",width:90},{title:"提交状态",dataIndex:"status",width:140,render:(status:NodeConfigResult["status"]) => <Tag color={status === "synced" ? "green" : status === "submitting" ? "blue" : status === "sync_failed" ? "orange" : "red"}>{{submitting:"提交中",synced:"平台已同步",sync_failed:"待恢复同步",failed:"提交失败"}[status]}</Tag>},{title:"结果说明",dataIndex:"detail"}]} /> : null}
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
                      value={sensorNodeOptions.some(item=>item.value===node)?node:undefined}
                      placeholder="请先选择已绑定节点"
                      aria-label="选择时间配置节点"
                      options={(nodes.data?.items ?? [])
                        .filter((item) => item.target.kind === "gateway_node")
                        .map((item) => ({
                          value:
                            item.target.kind === "gateway_node"
                              ? item.target.node_index
                              : 0,
                          label: nodeOptionLabel(item),
                        }))}
                      onChange={(next) => {
                        if (
                          (sensorDirty || timeContent) &&
                          !window.confirm(
                            "切换节点将清除未提交的编辑，是否继续？",
                          )
                        )
                          return;
                        selectNode(next);
                        setTimeContent("");
                      }}
                    />
                  </Space>
                  <Form.Item label="时间配置文本" required extra="格式：分钟列表 小时列表。* 表示所有分钟或小时；10,20,30 * 表示每小时第 10、20、30 分启动，* * 表示全天每分钟启动。按设备时钟执行。">
                    <LoRaWANV2TimeConfigCopy key={`time-copy-${deviceId}-${node}`} deviceId={deviceId} node={node}
                      disabled={Boolean(busy) || nodes.isLoading || !sensorNodeOptions.some(item => item.value === node)} onCopy={setTimeContent} />
                    {timeConfig.isLoading ? <p>正在读取时间配置</p> : timeConfig.error ? <Alert type="warning" showIcon message={formatApiError(timeConfig.error).message}/> : timeConfig.data ? <Alert type="info" message="当前源端时间配置" description={<><p>{describeNodeTimeSchedule(timeConfig.data.content,locale)}</p><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{timeConfig.data.content}</pre><span>更新时间：{new Date(timeConfig.data.updated_at ?? timeConfig.data.created_at).toLocaleString()}</span><Button size="small" onClick={() => setTimeContent(timeConfig.data!.content)}>载入编辑</Button><p>源端保存的配置不等于设备已应用。</p></>}/> : <p>暂无时间配置</p>}
                    <Input.TextArea
                      rows={8}
                      value={timeContent}
                      placeholder="10,20 10"
                      onChange={(event) => setTimeContent(event.target.value)}
                    />
                  </Form.Item>
                  <Popconfirm title={`提交节点 ${node} 的时间配置？`} description="配置将写入 LoRa V2 服务，设备是否应用需等待回报。" okText="确认提交" cancelText="取消" onConfirm={() => void run("time")}>
                    <Button type="primary" disabled={Boolean(busy) || !timeContent.trim() || !sensorNodeOptions.some(item=>item.value===node)} loading={busy === "time"}>提交到 LoRa V2</Button>
                  </Popconfirm>
                  {timeContent.trim() ? <Alert type={parseNodeTimeSchedule(timeContent).valid ? "info" : "warning"} showIcon message={describeNodeTimeSchedule(timeContent,locale)}/> : null}
                  {timeHistory.error ? <Alert type="warning" message={formatApiError(timeHistory.error).message}/> : <Collapse items={(timeHistory.data ?? []).map(item => ({key:String(item.id),label:`配置 ${item.id} · ${new Date(item.created_at).toLocaleString()}`,children:<><p>{describeNodeTimeSchedule(item.content,locale)}</p><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{item.content}</pre></>}))}/>}
                </Form>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}
