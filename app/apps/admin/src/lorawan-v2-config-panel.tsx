import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Form, Input, InputNumber, Select, Space, Table, Tabs, Tag } from "@thcpn/admin-ui";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { StateView } from "@thcpn/ui";

const text = (input: unknown, fallback = "—") => input === undefined || input === null || input === "" ? fallback : String(input);
const payload = (input: JsonRecord | undefined) => (input?.payload ?? input ?? {}) as JsonRecord;
const list = (input: JsonRecord | undefined) => ((payload(input).data ?? payload(input).items ?? []) as JsonRecord[]);
const parseObject = (raw: string) => { const result = JSON.parse(raw); if (!result || Array.isArray(result) || typeof result !== "object") throw new Error("网关配置必须是 JSON 对象"); return result as JsonRecord; };
const parseArray = (raw: string) => { const result = JSON.parse(raw); if (!Array.isArray(result)) throw new Error("节点传感器配置必须是 JSON 数组"); return result; };

export function LoRaWANV2ConfigPanel({ deviceId }: { deviceId: string }) {
  return <LoRaWANV2ConfigContent key={deviceId} deviceId={deviceId} />;
}

function LoRaWANV2ConfigContent({ deviceId }: { deviceId: string }) {
  const nodes = useQuery({ queryKey: ["admin", "device", deviceId, "nodes"], queryFn: () => api.admin.deviceNodes(deviceId) });
  const [node, setNode] = useState(1);
  const [gatewayJSON, setGatewayJSON] = useState("{}");
  const [waitTime, setWaitTime] = useState(0);
  const [sensorJSON, setSensorJSON] = useState("[]");
  const [timeContent, setTimeContent] = useState("");
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const gateways = useQuery({ queryKey: ["admin", deviceId, "gateway-configs"], queryFn: () => api.admin.deviceSourceConfig(deviceId, "gateway", { page: 1, page_size: 50 }) });
  const sensors = useQuery({ queryKey: ["admin", deviceId, node, "sensor-configs"], enabled: Boolean(nodes.data?.items.some((item) => item.target.kind === "gateway_node" && item.target.node_index === node)), queryFn: () => api.admin.deviceSourceConfig(deviceId, "sensor", { node_index: node, page: 1, page_size: 50 }) });
  const latest = useQuery({ queryKey: ["admin", deviceId, node, "sensor-config-latest"], queryFn: () => api.admin.deviceSourceConfig(deviceId, "sensor", { node_index: node, latest: true }), enabled: Boolean(nodes.data?.items.some((item) => item.target.kind === "gateway_node" && item.target.node_index === node)), retry: false });
  const failure = nodes.error ?? gateways.error ?? sensors.error ?? latest.error;
  const [needsRecovery, setNeedsRecovery] = useState(false);
  const run = async (kind: "gateway" | "sensor" | "time") => {
    setBusy(kind); setFeedback("");
    try {
      let result: JsonRecord = {};
      if (kind === "gateway") { result = await api.admin.updateDeviceSourceConfig(deviceId, "gateway", parseObject(gatewayJSON)); await gateways.refetch(); }
      if (kind === "sensor") { result = await api.admin.updateDeviceSourceConfig(deviceId, "sensor", { wait_time: waitTime, content: parseArray(sensorJSON) }, node); await Promise.all([sensors.refetch(), latest.refetch()]); }
      if (kind === "time") result = await api.admin.updateDeviceSourceConfig(deviceId, "time", { content: timeContent }, node);
      const state = result.write_state as JsonRecord | undefined;
      const partial = state?.platform === "failed";
      setNeedsRecovery(partial);
      setFeedback(partial ? "源端已接受，平台同步失败。请恢复同步，不要重复提交。" : "源端已接受，平台已同步；设备是否应用尚未确认。");
    } catch (error) { const detail = error instanceof SyntaxError ? { message: "JSON 格式不正确", requestId: "" } : error instanceof Error && !('status' in error) ? { message: error.message, requestId: "" } : formatApiError(error); setFeedback(`${detail.message}${detail.requestId ? ` · request id ${detail.requestId}` : ""}`); }
    finally { setBusy(""); }
  };
  const columns = [{ title: "配置 ID", dataIndex: "id", width: 110 }, { title: "创建时间", dataIndex: "created_at", width: 200 }, { title: "配置内容", render: (_: unknown, item: JsonRecord) => <code>{JSON.stringify(item.content ?? item)}</code> }];
  return <div className="admin-device-detail-content"><section className="admin-detail-section">
    <div className="admin-detail-section-head"><div><h2>LoRa V2 配置</h2><span>源端配置 · 设备是否应用尚未确认</span></div><Tag color="cyan">LoRa V2</Tag></div>
    {feedback ? <div className="admin-feedback">{feedback}</div> : null}
    {needsRecovery && <Button loading={busy === "recover"} onClick={async () => { setBusy("recover"); try { await api.admin.reconcileDeviceConfig(deviceId); setNeedsRecovery(false); setFeedback("平台同步已恢复，设备是否应用尚未确认。"); await nodes.refetch(); } catch (error) { setFeedback(formatApiError(error).message); } finally { setBusy(""); } }}>重新同步平台</Button>}
    {failure ? <StateView type="error" title="配置读取失败" description={formatApiError(failure).message} requestId={formatApiError(failure).requestId} /> : null}
    <Tabs items={[
      { key: "gateway", label: "网关配置", children: <><Form layout="vertical"><Form.Item label="新增配置（JSON 对象）"><Input.TextArea rows={8} value={gatewayJSON} onChange={(event) => setGatewayJSON(event.target.value)} spellCheck={false} /></Form.Item><Button type="primary" loading={busy === "gateway"} onClick={() => void run("gateway")}>提交网关配置</Button></Form><Table className="section-gap" rowKey={(item) => text(item.id)} size="small" dataSource={list(gateways.data)} columns={columns} pagination={false} /></> },
      { key: "sensor", label: "节点传感器配置", children: <><Space className="lora-config-node"><span>节点索引</span><Select value={node} options={(nodes.data?.items ?? []).filter((item) => item.target.kind === "gateway_node").map((item) => ({ value: item.target.kind === "gateway_node" ? item.target.node_index : 0, label: item.name }))} onChange={(next) => { if ((sensorJSON !== "[]" || timeContent) && !window.confirm("切换节点将清除未提交的编辑，是否继续？")) return; setNode(next); setSensorJSON("[]"); setWaitTime(0); setTimeContent(""); }} /></Space>{latest.data ? <pre className="admin-json-output">{JSON.stringify(payload(latest.data), null, 2)}</pre> : null}<Form layout="vertical"><Form.Item label="等待时间（秒）"><InputNumber min={0} max={65535} precision={0} value={waitTime} onChange={(item) => setWaitTime(Number(item ?? 0))} /></Form.Item><Form.Item label="传感器配置（JSON 数组）"><Input.TextArea rows={8} value={sensorJSON} onChange={(event) => setSensorJSON(event.target.value)} spellCheck={false} /></Form.Item><Button type="primary" loading={busy === "sensor"} onClick={() => void run("sensor")}>提交节点传感器配置</Button></Form><Table className="section-gap" rowKey={(item) => text(item.id)} size="small" dataSource={list(sensors.data)} columns={columns} pagination={false} /></> },
      { key: "time", label: "节点时间配置", children: <Form layout="vertical"><Space className="lora-config-node"><span>节点索引</span><Select value={node} options={(nodes.data?.items ?? []).filter((item) => item.target.kind === "gateway_node").map((item) => ({ value: item.target.kind === "gateway_node" ? item.target.node_index : 0, label: item.name }))} onChange={(next) => { if ((sensorJSON !== "[]" || timeContent) && !window.confirm("切换节点将清除未提交的编辑，是否继续？")) return; setNode(next); setSensorJSON("[]"); setWaitTime(0); setTimeContent(""); }} /></Space><Form.Item label="时间配置文本" required><Input.TextArea rows={8} value={timeContent} onChange={(event) => setTimeContent(event.target.value)} /></Form.Item><Button type="primary" disabled={!timeContent} loading={busy === "time"} onClick={() => void run("time")}>提交节点时间配置</Button></Form> },
    ]} />
  </section></div>;
}
