import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { Alert, Button, Empty, Modal, Select, Space } from "@thcpn/admin-ui";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { configCopyCandidates } from "./config-copy";
import "./config-copy.css";

export type ConfigCopyPreview<T> = { draft: T; summary: string; preview: string };
type ConfigCopyContext = { value: string; label: string };
type Props<T> = {
  targetDeviceId: string;
  configKind: string;
  disabled?: boolean;
  // Source-specific readers and draft conversion stay with the editor that owns them.
  read: (source: JsonRecord, target: JsonRecord, context?: string) => Promise<ConfigCopyPreview<T>>;
  onCopy: (draft: T) => void;
  contexts?: { current: string; load: (deviceId: string) => Promise<ConfigCopyContext[]> };
};

export function ConfigCopyPicker<T>(props: Props<T>) {
  const [open, setOpen] = useState(false);
  const [copiedFrom, setCopiedFrom] = useState("");
  return <div className="config-copy-toolbar">
    <Button icon={<Copy size={14} />} disabled={props.disabled} onClick={() => setOpen(true)}>从同类型设备复制配置</Button>
    {copiedFrom ? <span role="status">草稿已载入：{copiedFrom}</span> : null}
    {open ? <ConfigCopyDialog {...props} onClose={() => setOpen(false)} onCopied={name => { setCopiedFrom(name); setOpen(false); }} /> : null}
  </div>;
}

function ConfigCopyDialog<T>({ onClose, onCopied, ...props }: Props<T> & { onClose: () => void; onCopied: (name: string) => void }) {
  const [sourceId, setSourceId] = useState<string>();
  const [context, setContext] = useState<string>();
  const devices = useQuery({ queryKey: ["admin", "devices"], queryFn: api.admin.devices });
  const target = devices.data?.items.find(device => device.id === props.targetDeviceId);
  const candidates = target ? configCopyCandidates(target, devices.data?.items ?? [], Boolean(props.contexts)) : [];
  const source = candidates.find(device => device.id === sourceId);
  const parts = useQuery({
    queryKey: ["admin", "config-copy-contexts", props.configKind, sourceId],
    queryFn: () => props.contexts!.load(sourceId!),
    enabled: Boolean(source && props.contexts), retry: false,
  });
  const options = (parts.data ?? []).filter(part => sourceId !== props.targetDeviceId || part.value !== props.contexts?.current);
  const contextValid = !props.contexts || options.some(part => part.value === context);
  const configuration = useQuery({
    queryKey: ["admin", "config-copy-preview", props.targetDeviceId, props.configKind, sourceId, context],
    queryFn: () => props.read(source!, target!, context),
    enabled: Boolean(source && target && contextValid), retry: false, gcTime: 0,
  });
  const error = devices.error ?? parts.error ?? configuration.error;
  const ready = Boolean(source && target && contextValid && configuration.data && !configuration.isFetching && !parts.isFetching && !devices.isFetching && !error && !props.disabled);
  const sourceLabel = source ? String(source.name || source.serial_no || source.id) : "";
  const contextLabel = options.find(part => part.value === context)?.label;
  return <Modal open title={`复制${props.configKind}`} width={720} onCancel={onClose}
    okText="复制并替换当前草稿" cancelText="取消" okButtonProps={{ disabled: !ready }}
    onOk={() => { if (ready && configuration.data) { props.onCopy(configuration.data.draft); onCopied(`${sourceLabel}${contextLabel ? ` · ${contextLabel}` : ""}`); } }}>
    <Space orientation="vertical" size={16} className="config-copy-content">
      <Alert type="info" showIcon title={`目标设备：${String(target?.name || props.targetDeviceId)}`}
        description="仅列出来源体系、设备角色和产品型号相同的设备。复制会替换当前未保存的草稿，检查并保存后才会应用到目标设备。" />
      {devices.isLoading ? <span role="status">正在加载同类型设备…</span> : !devices.error && !candidates.length ? <Empty description="暂无可复制配置的同类型设备" /> : null}
      <label className="config-copy-field">来源设备
        <Select aria-label="配置来源设备" showSearch optionFilterProp="label" allowClear value={sourceId} loading={devices.isFetching}
          placeholder="按设备名称或序列号搜索" options={candidates.map(device => ({ value: String(device.id), label: `${String(device.name || "未命名设备")} · ${String(device.serial_no || device.id)}` }))}
          onChange={id => { setSourceId(id); setContext(undefined); }} />
      </label>
      {source && props.contexts ? <label className="config-copy-field">来源节点
        <Select aria-label="配置来源节点" value={context} loading={parts.isFetching} placeholder="选择要复制的节点" options={options} onChange={setContext} />
        {!parts.isLoading && !parts.error && !options.length ? <span>该设备没有可复制的其他节点。</span> : null}
      </label> : null}
      {configuration.isFetching ? <span role="status">正在读取源端最新配置…</span> : null}
      {error ? <Alert type="error" showIcon title="配置读取失败" description={formatApiError(error).message}
        action={<Button onClick={() => { if (devices.error) void devices.refetch(); else if (parts.error) void parts.refetch(); else void configuration.refetch(); }}>重试</Button>} /> : null}
      {source && contextValid && configuration.data && !configuration.isFetching && !error ? <section>
        <strong>{configuration.data.summary}</strong>
        <details className="config-copy-preview"><summary>查看待复制配置</summary><pre>{configuration.data.preview}</pre></details>
      </section> : null}
    </Space>
  </Modal>;
}
