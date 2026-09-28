import { useEffect, useState } from "react";
import { Alert, Form, Input, Select, Tabs } from "@thcpn/admin-ui";
import type { JsonRecord, THCPNSensorTemplate } from "@thcpn/api";
import { LoRaProtocolFields, attachMetricInfo, buildLoRaContent, collectMetricInfo, splitLoRaContent, type LoRaVisualItem } from "./lora-protocol-fields";

export function readNodeSensorDraft(contentJSON: string, metricsJSON: string) {
  const content = JSON.parse(contentJSON);
  const metrics = JSON.parse(metricsJSON);
  if (!Array.isArray(content) || !Array.isArray(metrics)) throw new Error("协议配置和指标语义必须是 JSON 数组");
  const items = splitLoRaContent(content);
  if (items.length !== content.length) throw new Error("包含暂不支持的协议，请使用 JSON 编辑以保留原始配置");
  return attachMetricInfo(items, metrics.map((metric: JsonRecord) => {
    const { key, ...info } = metric;
    return { key, info };
  }));
}

export function serializeNodeSensorDraft(items: LoRaVisualItem[]) {
  return {
    content: JSON.stringify(buildLoRaContent(items), null, 2),
    metrics: JSON.stringify(collectMetricInfo(items).map(metric => ({ key: metric.key, ...(metric.info as JsonRecord) })), null, 2),
  };
}

export function NodeSensorEditor({ contentJSON, metricsJSON, templates, onChange }: {
  contentJSON: string; metricsJSON: string; templates: THCPNSensorTemplate[];
  onChange: (content: string, metrics: string) => void;
}) {
  const form = Form.useFormInstance();
  const [mode, setMode] = useState("visual");
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      form.setFieldValue("lora_items", readNodeSensorDraft(contentJSON, metricsJSON));
      setError("");
    } catch (cause) {
      setMode("json");
      setError(cause instanceof Error ? cause.message : "无法读取配置");
    }
  }, [contentJSON, metricsJSON, form]);
  return <>
    <Form.Item label="从传感器模板 V2 导入" extra="追加到当前草稿；可继续修改协议与指标，不会修改原模板。提交后作为独立节点配置保存。">
      <Select value={undefined} placeholder="选择模板并添加协议与指标" showSearch optionFilterProp="label"
        options={templates.map(template => ({ value: template.id, label: template.sensor_type }))}
        onChange={(id: number) => {
          try {
            const template = templates.find(item => item.id === id)!;
            const variant = (template.variants as JsonRecord).lorawan_v2 as JsonRecord;
            const current = readNodeSensorDraft(contentJSON, metricsJSON);
            const added = readNodeSensorDraft(JSON.stringify(variant.content), JSON.stringify(template.metrics));
            const draft = serializeNodeSensorDraft([...current, ...added]);
            onChange(draft.content, draft.metrics);
            setMode("visual"); setError("");
          } catch (cause) { setError(cause instanceof Error ? cause.message : "导入失败"); }
        }} />
    </Form.Item>
    {error && <Alert type="warning" showIcon title={error} />}
    <Tabs destroyOnHidden activeKey={mode} onChange={next => {
      if (next === "visual") {
        try { form.setFieldValue("lora_items", readNodeSensorDraft(contentJSON, metricsJSON)); setError(""); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "JSON 格式错误"); return; }
      }
      setMode(next);
    }} items={[
      { key: "visual", label: "可视化编辑", children: <LoRaProtocolFields /> },
      { key: "json", label: "JSON 编辑", children: <>
        <Form.Item label="数据指标 JSON" extra="每项包含 key、name，可配置 type、unit、min、max。"><Input.TextArea className="mono" rows={12} spellCheck={false} value={metricsJSON} onChange={event => onChange(contentJSON, event.target.value)} /></Form.Item>
        <Form.Item label="LoRaWAN V2 原生配置" extra="ad / 485 / sdi / iic 协议数组。"><Input.TextArea className="mono" rows={12} spellCheck={false} value={contentJSON} onChange={event => onChange(event.target.value, metricsJSON)} /></Form.Item>
      </> },
    ]} />
  </>;
}
