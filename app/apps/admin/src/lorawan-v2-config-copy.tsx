import { api, type JsonRecord } from "@thcpn/api";
import { ConfigCopyPicker } from "./config-copy-picker";
import { gatewayConfigCopyDraft, sensorConfigCopyDraft, latestGatewayConfiguration } from "./lorawan-v2-config-copy-model";

const contexts = async (deviceId: string) => {
  const nodes = await api.admin.deviceNodes(deviceId);
  return nodes.items.flatMap(item => item.target.kind === "gateway_node"
    ? [{ value: String(item.target.node_index), label: item.name }] : []);
};

export function LoRaWANV2GatewayConfigCopy({ deviceId, disabled, onCopy }: { deviceId: string; disabled: boolean; onCopy: (draft: string) => void }) {
  return <ConfigCopyPicker targetDeviceId={deviceId} configKind="LoRa V2 网关配置" disabled={disabled}
    read={async (source, target) => {
      const response = await api.admin.deviceSourceConfig(String(source.id), "gateway", { page: 1, page_size: 50 });
      const configuration = latestGatewayConfiguration(response);
      const draft = gatewayConfigCopyDraft(configuration, String(target.external_key || target.serial_no || ""));
      return { draft, summary: `配置版本 ${String(configuration.id ?? "—")} · 已保留目标网关 SN，并移除源配置编号`, preview: draft };
    }} onCopy={onCopy} />;
}

export function LoRaWANV2SensorConfigCopy({ deviceId, node, disabled, onCopy }: { deviceId: string; node: number; disabled: boolean; onCopy: (draft: ReturnType<typeof sensorConfigCopyDraft>) => void }) {
  return <ConfigCopyPicker targetDeviceId={deviceId} configKind="LoRa V2 节点传感器配置" disabled={disabled}
    contexts={{ current: String(node), load: contexts }}
    read={async (source, _target, context) => {
      const response = await api.admin.deviceSourceConfig(String(source.id), "sensor", { node_index: Number(context), latest: true });
      const configuration = (response.payload ?? response) as JsonRecord;
      const draft = sensorConfigCopyDraft(configuration);
      return { draft, summary: `协议、指标和等待时间（${draft.waitTime} 秒）`, preview: JSON.stringify({ content: JSON.parse(draft.content), metrics: JSON.parse(draft.metrics), wait_time: draft.waitTime }, null, 2) };
    }} onCopy={onCopy} />;
}

export function LoRaWANV2TimeConfigCopy({ deviceId, node, disabled, onCopy }: { deviceId: string; node: number; disabled: boolean; onCopy: (draft: string) => void }) {
  return <ConfigCopyPicker targetDeviceId={deviceId} configKind="LoRa V2 节点时间配置" disabled={disabled}
    contexts={{ current: String(node), load: contexts }}
    read={async (source, _target, context) => {
      const configuration = await api.admin.nodeTimeConfig(String(source.id), Number(context));
      if (!configuration?.content?.trim()) throw new Error("来源节点尚未保存时间配置");
      return { draft: configuration.content, summary: "节点启动时间规则", preview: configuration.content };
    }} onCopy={onCopy} />;
}
