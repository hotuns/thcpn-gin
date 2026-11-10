import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Collapsible } from "radix-ui";
import { ChevronDown } from "lucide-react";
import {
  ApiError, api, formatApiError, nodeOptionLabel,
  type CaptureConfigSaveResult, type Device, type DeviceCaptureConfig,
  type DeviceCaptureField, type DeviceCaptureItem, type UpdateDeviceCaptureConfig,
  type UpdateWorkspaceNodeSensorConfig, type WorkspaceNodeSensorConfig,
} from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import {
  Alert, AlertDescription, AlertTitle, Button, Checkbox, Dialog, DialogContent,
  DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Panel, SelectInput,
  StateView, Tabs, TabsContent, TabsList, TabsTrigger, Textarea,
} from "../../shared/ui";
import "./device-capture-config.css";

type Target = { key: string; deviceId: string; label: string; nodeIndex?: number };
type LoadedConfig = { kind: "device"; config: DeviceCaptureConfig } | { kind: "node"; config: WorkspaceNodeSensorConfig };
type ReviewLine = { label: string; before?: string; after: string };
type Review = { version: number; nodeSN?: string; lines: ReviewLine[]; platformOnly?: boolean; save: () => Promise<CaptureConfigSaveResult> };
type Notice = { kind: "success" | "warning" | "error"; text: string; recover?: boolean };

const fieldLabels: Record<string, string> = {
  name: "显示名称", model: "型号", description: "说明", driver: "驱动 / 协议", port: "接口类型",
  channel: "通道编号", command: "协议命令", wait_time: "等待时间", unit: "单位", decode: "解码规则",
  index: "指标索引", min: "最小值", max: "最大值",
};

export function DeviceCaptureSettings({ device, workspaceId }: { device: Device; workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  return (
    <Collapsible.Root open={open} onOpenChange={next => { setOpen(next); if (next) setOpened(true); }} asChild>
      <Panel className="device-capture-panel t-acc" data-open={String(open)}>
        <Collapsible.Trigger asChild>
          <Button variant="ghost" className="device-capture-trigger">
            <span className="panel-title">{device.source_family === "thcpn" ? "传感器与相机配置" : "传感器配置"}</span>
            <span className="t-acc-chevron" aria-hidden="true"><ChevronDown size={18} /></span>
          </Button>
        </Collapsible.Trigger>
        <Collapsible.Content forceMount className="t-acc-panel" inert={!open}>
          <div className="t-acc-panel-inner">
            {opened && <CaptureTargets device={device} workspaceId={workspaceId} />}
          </div>
        </Collapsible.Content>
      </Panel>
    </Collapsible.Root>
  );
}

function CaptureTargets({ device, workspaceId }: { device: Device; workspaceId: string }) {
  const indexed = device.source_family === "lorawan_v2";
  const gateway = device.topology_role === "gateway" || device.device_type === "gateway";
  const nodes = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "device", device.id, "nodes", "bound"),
    queryFn: () => api.devices.nodes(device.id), enabled: gateway, refetchOnWindowFocus: false,
  });
  const [selected, setSelected] = useState("");
  const [dirty, setDirty] = useState(false);
  const targets: Target[] = indexed ? [] : [{ key: device.id, deviceId: device.id, label: device.name }];
  for (const node of nodes.data?.items ?? []) {
    if (!node.bound) continue;
    if (indexed && node.target.kind === "gateway_node") {
      targets.push({ key: node.key, deviceId: device.id, nodeIndex: node.target.node_index, label: nodeOptionLabel(node) });
    } else if (!indexed && node.target.kind === "device" && node.can_rename) {
      targets.push({ key: node.key, deviceId: node.target.device_id, label: nodeOptionLabel(node) });
    }
  }
  const current = targets.find(item => item.key === selected) ?? targets[0];
  return <div className="device-capture-body">
    {gateway && nodes.isLoading && <div role="status">正在读取节点…</div>}
    {gateway && nodes.error && <StateView type="error" title="节点读取失败" description={formatApiError(nodes.error).message} action={<Button variant="secondary" onClick={() => void nodes.refetch()}>重试</Button>} />}
    {gateway && targets.length > 0 && <label className="field device-capture-target"><span className="field-label">{indexed ? "节点" : "配置设备"}</span>
      <SelectInput value={current?.key} disabled={dirty || targets.length === 1} onValueChange={setSelected} aria-label={indexed ? "选择配置节点" : "选择配置设备"}>
        {targets.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
      </SelectInput>
    </label>}
    {current ? <CaptureTargetEditor key={current.key} target={current} gatewayId={device.id} workspaceId={workspaceId} onDirty={setDirty} />
      : nodes.isSuccess && <StateView type="empty" title="暂无已绑定节点" description="绑定节点后可以编辑传感器配置。" />}
  </div>;
}

function CaptureTargetEditor({ target, gatewayId, workspaceId, onDirty }: {
  target: Target; gatewayId: string; workspaceId: string; onDirty: (value: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery<LoadedConfig>({
    queryKey: workspaceQueryKey(workspaceId, "device", target.deviceId, "capture-config", String(target.nodeIndex ?? 0)),
    queryFn: async () => target.nodeIndex === undefined
      ? { kind: "device", config: await api.devices.captureConfig(target.deviceId) }
      : { kind: "node", config: await api.devices.nodeSensorConfig(target.deviceId, target.nodeIndex) },
    refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false,
  });
  const [review, setReview] = useState<Review | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsRead, setNeedsRead] = useState(false);
  const [reset, setReset] = useState(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => () => onDirty(false), [onDirty]);

  const reload = async (clearNotice = false) => {
    const result = await query.refetch();
    if (!result.isSuccess) return;
    setReset(current => current + 1);
    setNeedsRead(false);
    if (clearNotice) setNotice(null);
    onDirty(false);
  };
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: workspaceQueryKey(workspaceId, "device", target.deviceId, "streams") });
    void queryClient.invalidateQueries({ queryKey: workspaceQueryKey(workspaceId, "device", target.deviceId, "sampling-profile") });
    void queryClient.invalidateQueries({ queryKey: workspaceQueryKey(workspaceId, "device", gatewayId, "nodes") });
  };
  const apply = async () => {
    if (!review || busy) return;
    setBusy(true);
    try {
      const result = await review.save();
      setReview(null);
      if (result.write_state.platform === "failed") {
        setNotice({ kind: "warning", text: result.warnings?.find(item => item.code === "platform_sync_failed")?.message ?? "配置已保存，平台同步尚未完成。", recover: true });
      } else if (result.write_state.source === "unchanged") {
        setNotice({ kind: "success", text: result.write_state.platform === "synced" ? "平台指标已更新，未下发设备配置。" : "配置内容没有变化，未下发。" });
      } else {
        setNotice({ kind: "success", text: `源端已接受配置${result.version ? `（版本 ${result.version}）` : ""}。设备是否生效尚未确认。` });
      }
      invalidate();
      await reload();
    } catch (error) {
      setReview(null);
      const detail = formatApiError(error);
      const conflict = error instanceof ApiError && error.status === 409;
      const unknown = !(error instanceof ApiError) || error.status >= 500;
      setNeedsRead(conflict || unknown);
      setNotice({ kind: "error", text: `${conflict ? detail.message : unknown ? "保存结果未确认，请先重新读取配置，再决定是否重试。" : detail.message}${detail.requestId ? ` · ${detail.requestId}` : ""}` });
    } finally {
      setBusy(false);
    }
  };
  const recover = async () => {
    setBusy(true);
    try {
      await api.devices.reconcileConfig(target.deviceId);
      setNotice({ kind: "success", text: "平台同步已恢复。" });
      invalidate();
      await reload();
    } catch (error) {
      setNotice({ kind: "error", text: formatApiError(error).message, recover: true });
    } finally { setBusy(false); }
  };
  const prepare = (next: Review) => {
    if (busy || needsRead) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReview(next);
  };
  const editorProps = { disabled: busy || needsRead || query.isError, onDirty, onReview: prepare };
  const loaded = query.data;
  if (query.isPending) return <StateView type="loading" title="正在读取采集配置" description="" />;
  return <>
    {query.error && <StateView type="error" title="配置读取失败" description={formatApiError(query.error).message} action={<Button variant="secondary" disabled={busy || query.isFetching} onClick={() => void reload(true)}>重新读取</Button>} />}
    {notice && <Alert variant={notice.kind === "error" ? "destructive" : "default"} role={notice.kind === "success" ? "status" : "alert"}>
      <AlertDescription>{notice.text}{notice.recover && <Button variant="secondary" size="sm" disabled={busy} onClick={() => void recover()}>重新同步平台</Button>}
        {needsRead && <Button variant="secondary" size="sm" disabled={query.isFetching} onClick={() => void reload(true)}>重新读取并丢弃草稿</Button>}
      </AlertDescription>
    </Alert>}
    {loaded && (loaded.kind === "device"
      ? <DeviceFieldsDraft key={`${loaded.config.version}:${reset}`} config={loaded.config} targetId={target.deviceId} {...editorProps} />
      : <NodeSensorDraft key={`${loaded.config.version}:${loaded.config.node_sn}:${reset}`} config={loaded.config} targetId={target.deviceId} nodeIndex={target.nodeIndex!} {...editorProps} />)}
    {review && <CaptureConfirmation review={review} targetLabel={target.label} busy={busy} onApply={apply} onClose={() => setReview(null)} onReturnFocus={() => returnFocus.current?.focus()} />}
  </>;
}

type DraftProps = { targetId: string; disabled: boolean; onDirty: (value: boolean) => void; onReview: (review: Review) => void };
type Change = UpdateDeviceCaptureConfig["changes"][number];
type Edit = { target: Omit<Change, "fields">; field: DeviceCaptureField; label: string; value: string };
const editKey = (target: Omit<Change, "fields">, key: string) => JSON.stringify([target.section, target.item_id, target.metric ?? 0, key]);

function DeviceFieldsDraft({ config, targetId, disabled, onDirty, onReview }: DraftProps & { config: DeviceCaptureConfig }) {
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [validation, setValidation] = useState("");
  const pending = Object.values(edits);
  const dirty = pending.length > 0;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const review = () => {
    const invalid = pending.find(({ field, value }) => field.kind !== "text" && (!value.trim() || !Number.isFinite(Number(value)) || field.kind === "integer" && (!/^\d+$/.test(value.trim()) || Number(value) > 2147483647)));
    if (invalid) { setValidation(`${invalid.label}的值无效，请检查后重试。`); return; }
    const groups = new Map<string, Change>();
    for (const edit of pending) {
      const key = editKey(edit.target, "");
      const change = groups.get(key) ?? { ...edit.target, fields: {} };
      change.fields[edit.field.key] = edit.value;
      groups.set(key, change);
    }
    const lines = pending.map(edit => ({ label: edit.label, before: edit.field.value, after: edit.value }));
    onReview({ version: config.version, lines, save: () => api.devices.updateCaptureConfig(targetId, { expected_version: config.version, risk_confirmed: true, changes: [...groups.values()] }) });
  };
  const fields = (item: DeviceCaptureField[], target: Omit<Change, "fields">, caption: string) => <div className="device-capture-fields">
    {item.map(field => {
      const key = editKey(target, field.key);
      const label = fieldLabels[field.key] ?? field.key;
      return <label className="field" key={field.key}><span className="field-label">{label}</span>
        <Input className={field.key === "command" || field.key === "decode" ? "device-capture-mono" : undefined} type={field.kind === "text" ? "text" : "number"} step={field.kind === "number" ? "any" : 1} min={field.kind === "integer" ? 0 : undefined} disabled={disabled} value={edits[key]?.value ?? field.value} onChange={event => {
          const value = event.target.value;
          setValidation("");
          setEdits(current => {
            const next = { ...current };
            if (value === field.value) delete next[key];
            else next[key] = { target, field, label: `${caption} · ${label}`, value };
            return next;
          });
        }} />
      </label>;
    })}
  </div>;
  const list = (items: DeviceCaptureItem[], section: Change["section"]) => items.length ? items.map((item, index) => {
    const name = item.fields.find(field => field.key === "name")?.value || item.label || `${section === "sensor" ? "传感器" : "相机"} ${index + 1}`;
    const target = { section, item_id: item.id };
    return <fieldset className="device-capture-item" key={item.id}><legend>{name}</legend>
      {fields(item.fields, target, name)}
      {!!item.metrics?.length && <details className="device-capture-metrics"><summary>数据指标（{item.metrics.length}）</summary>
        {item.metrics.map(metric => <fieldset className="device-capture-item" key={metric.number}><legend>{metric.label || `指标 ${metric.number}`}</legend>
          {fields(metric.fields, { ...target, metric: metric.number }, `${name} · ${metric.label || `指标 ${metric.number}`}`)}
        </fieldset>)}
      </details>}
    </fieldset>;
  }) : <StateView type="empty" title={section === "sensor" ? "没有可编辑的传感器" : "没有可编辑的相机通道"} description="" />;
  return <>
    {config.has_cameras ? <Tabs defaultValue="sensor"><TabsList><TabsTrigger value="sensor">传感器</TabsTrigger><TabsTrigger value="camera">相机通道</TabsTrigger></TabsList>
      <TabsContent value="sensor" className="device-capture-items">{list(config.sensors, "sensor")}</TabsContent>
      <TabsContent value="camera" className="device-capture-items">{list(config.cameras, "camera")}</TabsContent>
    </Tabs> : <div className="device-capture-items">{list(config.sensors, "sensor")}</div>}
    {validation && <Alert variant="destructive"><AlertDescription>{validation}</AlertDescription></Alert>}
    <DraftActions dirty={dirty} disabled={disabled} onReset={() => { setEdits({}); setValidation(""); }} onReview={review} />
  </>;
}

const formatJSON = (value: unknown) => JSON.stringify(value, null, 2);
const canonical = (value: unknown) => JSON.stringify(value, (_, entry) => entry && typeof entry === "object" && !Array.isArray(entry) ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
type LoRaMetric = WorkspaceNodeSensorConfig["metrics"][number];

function NodeSensorDraft({ config, targetId, nodeIndex, disabled, onDirty, onReview }: DraftProps & { config: WorkspaceNodeSensorConfig; nodeIndex: number }) {
  const [protocol, setProtocol] = useState(formatJSON(config.content));
  const [metrics, setMetrics] = useState(formatJSON(config.metrics));
  const [wait, setWait] = useState(String(config.wait_time));
  const [validation, setValidation] = useState("");
  const dirty = protocol !== formatJSON(config.content) || metrics !== formatJSON(config.metrics) || wait !== String(config.wait_time);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const review = () => {
    try {
      const content: unknown = JSON.parse(protocol);
      const draftMetrics: unknown = JSON.parse(metrics);
      const waitTime = Number(wait);
      if (!Array.isArray(content) || !content.length) throw new Error("原生协议配置必须是非空 JSON 数组。");
      if (!Array.isArray(draftMetrics) || draftMetrics.some(item => !item || typeof item.key !== "string" || !item.key.trim() || typeof item.name !== "string" || !item.name.trim())) throw new Error("每个指标需要填写 Key 和名称。");
      if (!wait.trim() || !Number.isInteger(waitTime) || waitTime < 0 || waitTime > 65535) throw new Error("等待时间必须是 0–65535 秒的整数。");
      const protocolChanged = canonical(content) !== canonical(config.content);
      const nativeChanged = waitTime !== config.wait_time || protocolChanged;
      const lines: ReviewLine[] = [];
      if (protocolChanged) lines.push({ label: "原生协议配置", before: `${config.content.length} 项协议`, after: `${content.length} 项协议（内容有变化）` });
      if (waitTime !== config.wait_time) lines.push({ label: "等待时间", before: `${config.wait_time} 秒`, after: `${waitTime} 秒` });
      const current = new Map(config.metrics.map(item => [item.key, item]));
      const next = new Map((draftMetrics as LoRaMetric[]).map(item => [item.key, item]));
      if (next.size !== draftMetrics.length) throw new Error("指标 Key 不能重复。");
      for (const key of new Set([...current.keys(), ...next.keys()])) {
        const before = current.get(key), after = next.get(key);
        if (canonical(before) !== canonical(after)) lines.push({ label: `平台指标 · ${key}`, before: before ? JSON.stringify(before) : "—", after: after ? JSON.stringify(after) : "移除" });
      }
      if (!lines.length) { setValidation("没有实际改动。"); return; }
      const payload: UpdateWorkspaceNodeSensorConfig = { expected_version: config.version, node_sn: config.node_sn, risk_confirmed: true, mode: nativeChanged ? "advanced" : "metrics", metrics: draftMetrics,
        ...(nativeChanged ? { content, wait_time: waitTime } : {}) };
      setValidation("");
      onReview({ version: config.version, nodeSN: config.node_sn, platformOnly: !nativeChanged, lines, save: () => api.devices.updateNodeSensorConfig(targetId, nodeIndex, payload) });
    } catch (error) { setValidation(error instanceof SyntaxError ? "JSON 格式不正确，请检查后重试。" : (error as Error).message); }
  };
  return <>
    <Tabs defaultValue="protocol"><TabsList><TabsTrigger value="protocol">传感器协议</TabsTrigger><TabsTrigger value="metrics">平台指标</TabsTrigger></TabsList>
      <TabsContent value="protocol" className="device-capture-items"><label className="field"><span className="field-label">原生协议配置（JSON）</span><Textarea className="device-capture-mono" spellCheck={false} rows={9} disabled={disabled} value={protocol} onChange={event => { setProtocol(event.target.value); setValidation(""); }} /></label>
        <label className="field device-capture-target"><span className="field-label">等待时间（秒）</span><Input type="number" min={0} max={65535} step={1} disabled={disabled} value={wait} onChange={event => { setWait(event.target.value); setValidation(""); }} /></label></TabsContent>
      <TabsContent value="metrics" className="device-capture-items"><label className="field"><span className="field-label">指标配置（JSON）</span><Textarea className="device-capture-mono" spellCheck={false} rows={9} disabled={disabled} value={metrics} onChange={event => { setMetrics(event.target.value); setValidation(""); }} /></label></TabsContent>
    </Tabs>
    {validation && <Alert variant="destructive"><AlertDescription>{validation}</AlertDescription></Alert>}
    <DraftActions dirty={dirty} disabled={disabled} onReset={() => { setProtocol(formatJSON(config.content)); setMetrics(formatJSON(config.metrics)); setWait(String(config.wait_time)); setValidation(""); }} onReview={review} />
  </>;
}

function DraftActions({ dirty, disabled, onReset, onReview }: { dirty: boolean; disabled: boolean; onReset: () => void; onReview: () => void }) {
  return <div className="device-capture-actions"><Button variant="secondary" disabled={!dirty || disabled} onClick={onReset}>撤销草稿</Button><Button disabled={!dirty || disabled} onClick={onReview}>核对并保存</Button></div>;
}

function CaptureConfirmation({ review, targetLabel, busy, onApply, onClose, onReturnFocus }: {
  review: Review; targetLabel: string; busy: boolean; onApply: () => Promise<void>; onClose: () => void; onReturnFocus: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [accepted, setAccepted] = useState(false);
  const checkboxId = useId();
  const riskCheckbox = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (step === 2) riskCheckbox.current?.focus(); }, [step]);
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="device-capture-dialog" aria-busy={busy} onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus(); }}>
      <DialogHeader>
        <DialogTitle>{step === 1 ? "核对采集配置（1 / 2）" : "确认设备失控风险（2 / 2）"}</DialogTitle>
        <DialogDescription>{targetLabel}{review.nodeSN ? ` · 节点 SN ${review.nodeSN}` : ""}{review.version ? ` · 当前版本 ${review.version}` : " · 首次配置"}</DialogDescription>
      </DialogHeader>
      {step === 1 ? <>
        <ul className="device-capture-review">{review.lines.map((item, index) => <li key={`${item.label}:${index}`}><strong>{item.label}</strong><div><span>{item.before || "—"}</span><span aria-hidden="true">→</span><span>{item.after || "—"}</span></div></li>)}</ul>
        <DialogFooter><Button variant="secondary" onClick={onClose}>返回编辑</Button><Button onClick={() => setStep(2)}>继续确认</Button></DialogFooter>
      </> : <>
        <Alert variant="destructive">
          <AlertTitle>{review.platformOnly ? "本次仅保存平台指标" : "配置错误可能导致设备失控"}</AlertTitle>
          <AlertDescription>{review.platformOnly ? "本次仅更新平台指标，不下发设备配置。指标填错可能影响数据显示。" : "设备应用后，传感器可能停止采集、相机可能停止拍摄，也可能无法远程恢复，需要到现场处理。"}</AlertDescription>
        </Alert>
        <div className="device-capture-risk"><Checkbox id={checkboxId} ref={riskCheckbox} checked={accepted} disabled={busy} onCheckedChange={value => setAccepted(value === true)} /><label htmlFor={checkboxId}>我已核对设备和改动，了解上述风险。</label></div>
        <DialogFooter><Button variant="secondary" disabled={busy} onClick={() => { setAccepted(false); setStep(1); }}>返回核对</Button><Button variant="danger" disabled={!accepted || busy} onClick={() => void onApply()}>{busy ? "正在保存…" : "确认保存配置"}</Button></DialogFooter>
      </>}
    </DialogContent>
  </Dialog>;
}
