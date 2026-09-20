import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Braces,
  Calculator,
  Check,
  CircleHelp,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  formatApiError,
  type ComputedDataStream,
  type DataStream,
  type DeviceMetadata,
  type DeviceMetadataInput,
} from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, CheckboxInput, Input, Panel, SelectInput, Sheet, SheetContent, SheetTitle, StateView, Textarea } from "./platform-ui";

const FORMULA_VARIABLE_PATTERN = /\b(?:stream|meta)\.[A-Za-z][A-Za-z0-9_]*\b/g;
const FORMULA_HIGHLIGHT_PATTERN = /(?:stream|meta)\.[A-Za-z][A-Za-z0-9_]*|\b\d+(?:\.\d+)?\b|&&|\|\||==|!=|<=|>=|[()+\-*/<>!]/g;

export function formulaTokenDeletionRange(
  formula: string,
  selectionStart: number,
  selectionEnd: number,
  direction: "backward" | "forward",
): [number, number] | null {
  const ranges = Array.from(formula.matchAll(new RegExp(FORMULA_VARIABLE_PATTERN.source, "g"))).map((match) => [
    match.index,
    match.index + match[0].length,
  ] as const);
  if (selectionStart !== selectionEnd) {
    const overlaps = ranges.filter(([start, end]) => selectionStart < end && selectionEnd > start);
    if (!overlaps.length) return null;
    return [Math.min(selectionStart, overlaps[0][0]), Math.max(selectionEnd, overlaps.at(-1)![1])];
  }
  const range = ranges.find(([start, end]) => direction === "backward"
    ? selectionStart > start && selectionStart <= end
    : selectionStart >= start && selectionStart < end);
  return range ? [range[0], range[1]] : null;
}

function highlightFormula(formula: string, knownVariables: Set<string>): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  const pattern = new RegExp(FORMULA_HIGHLIGHT_PATTERN.source, "g");
  while ((match = pattern.exec(formula))) {
    if (match.index > cursor) nodes.push(formula.slice(cursor, match.index));
    const token = match[0];
    const className = token.startsWith("stream.") || token.startsWith("meta.")
      ? knownVariables.has(token) ? "formula-token-variable" : "formula-token-unknown"
      : /^\d/.test(token) ? "formula-token-number" : "formula-token-operator";
    nodes.push(<span className={className} key={`${match.index}-${token}`}>{token}</span>);
    cursor = match.index + token.length;
  }
  if (cursor < formula.length) nodes.push(formula.slice(cursor));
  return nodes;
}

export function DeviceMetadataPanel({
  workspaceId,
  deviceId,
  canConfigure,
}: {
  workspaceId: string;
  deviceId: string;
  canConfigure: boolean;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const queryKey = workspaceQueryKey(workspaceId, "device", deviceId, "metadata");
  const query = useQuery({ queryKey, queryFn: () => api.devices.metadata(deviceId) });
  const items = query.data?.items ?? [];

  return (
    <>
      <Panel className="device-metadata-panel">
        <div className="panel-header compact-panel-header">
          <div>
            <h2 className="panel-title">设备元数据</h2>
          </div>
          {canConfigure && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil size={14} />
              管理
            </Button>
          )}
        </div>
        {feedback && <div className="command-note computed-feedback">{feedback}</div>}
        {query.isLoading ? (
          <StateView type="loading" title="正在加载元数据" description="正在读取设备业务参数。" />
        ) : query.error ? (
          <StateView
            type="error"
            title="元数据加载失败"
            description={formatApiError(query.error).message}
            requestId={formatApiError(query.error).requestId}
          />
        ) : items.length ? (
          <div className="device-metadata-list">
            {items.map((item) => (
              <div key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <small className="mono">meta.{item.key}</small>
                </div>
                <span>{metadataDisplayValue(item)}</span>
                <Badge tone="neutral">{metadataTypeLabel(item.value_type)}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <StateView type="empty" title="暂无设备元数据" description="可添加初始值、修正系数等设备业务参数。" />
        )}
      </Panel>
      {editing && (
        <MetadataEditor
          items={items}
          onClose={() => setEditing(false)}
          onSave={async (next) => {
            try {
              await api.devices.replaceMetadata(deviceId, next);
              await client.invalidateQueries({ queryKey });
              setFeedback("设备元数据已更新");
              setEditing(false);
            } catch (error) {
              throw new Error(apiErrorMessage(error));
            }
          }}
        />
      )}
    </>
  );
}

export function ComputedStreamsPanel({
  workspaceId,
  deviceId,
  streams,
}: {
  workspaceId: string;
  deviceId: string;
  streams: DataStream[];
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<ComputedDataStream | "new" | null>(null);
  const [feedback, setFeedback] = useState("");
  const queryKey = workspaceQueryKey(workspaceId, "device", deviceId, "computed-streams");
  const metadataKey = workspaceQueryKey(workspaceId, "device", deviceId, "metadata");
  const profile = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "device", deviceId, "profile", "computed-access"),
    queryFn: () => api.devices.profile(deviceId),
  });
  const query = useQuery({ queryKey, queryFn: () => api.devices.computedStreams(deviceId) });
  const metadata = useQuery({ queryKey: metadataKey, queryFn: () => api.devices.metadata(deviceId) });
  const definitions = query.data?.items ?? [];
  const rawStreams = streams.filter(
    (stream) => stream.type === "telemetry" && stream.status === "active" && !stream.computed,
  );
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey }),
      client.invalidateQueries({ queryKey: workspaceQueryKey(workspaceId, "device", deviceId, "streams") }),
      client.invalidateQueries({ queryKey: workspaceQueryKey(workspaceId, "device", deviceId, "telemetry") }),
    ]);
  };
  const remove = async (item: ComputedDataStream) => {
    if (!window.confirm(`确认删除计算指标“${item.name}”？原始数据不会受影响。`)) return;
    setFeedback("");
    try {
      await api.devices.deleteComputedStream(deviceId, item.data_stream_id);
      await refresh();
      setFeedback("计算指标已删除");
    } catch (error) {
      setFeedback(apiErrorMessage(error));
    }
  };

  return (
    <>
      <Panel className="section-gap computed-stream-panel">
        <div className="panel-header compact-panel-header">
          <div>
            <h2 className="panel-title">计算指标</h2>
          </div>
          {profile.data?.can_configure && (
            <Button
              variant="secondary"
              disabled={!rawStreams.length}
              onClick={() => setEditing("new")}
            >
              <Plus size={14} />
              新建计算指标
            </Button>
          )}
        </div>
        {feedback && <div className="command-note computed-feedback">{feedback}</div>}
        {query.isLoading ? (
          <StateView type="loading" title="正在加载计算指标" description="正在读取设备公式。" />
        ) : query.error ? (
          <StateView type="error" title="计算指标加载失败" description={formatApiError(query.error).message} />
        ) : definitions.length ? (
          <div className="computed-stream-list">
            {definitions.map((item) => (
              <div key={item.data_stream_id}>
                <span className="computed-fx">fx</span>
                <div>
                  <strong>{item.name}{item.unit ? ` · ${item.unit}` : ""}</strong>
                  <code>{item.formula}</code>
                </div>
                <Badge tone={item.enabled ? "success" : "neutral"}>
                  {item.enabled ? "启用" : "停用"}
                </Badge>
                {profile.data?.can_configure && (
                  <div className="computed-row-actions">
                    <button type="button" title="编辑计算指标" onClick={() => setEditing(item)}>
                      <Pencil size={14} />
                    </button>
                    <button type="button" title="删除计算指标" onClick={() => void remove(item)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <StateView type="empty" title="暂无计算指标" description="可使用原始设备数据与设备元数据生成查询时计算的数据。" />
        )}
      </Panel>
      {editing && (
        <ComputedStreamEditor
          deviceId={deviceId}
          item={editing === "new" ? null : editing}
          streams={rawStreams}
          metadata={metadata.data?.items ?? []}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await refresh();
            setFeedback(editing === "new" ? "计算指标已创建" : "计算指标已更新");
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function MetadataEditor({
  items,
  onClose,
  onSave,
}: {
  items: DeviceMetadata[];
  onClose: () => void;
  onSave: (items: DeviceMetadataInput[]) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<DeviceMetadataInput[]>(() =>
    items.map(({ key, name, value_type, value, unit }) => ({ key, name, value_type, value, unit })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (index: number, patch: Partial<DeviceMetadataInput>) =>
    setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave(drafts);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onOpenChange={(open) => !open && !busy && onClose()}>
      <SheetContent className="access-editor computed-editor-drawer">
        <Panel className="access-editor-panel">
          <div className="panel-header">
            <SheetTitle className="panel-title">设备元数据</SheetTitle>
            <Button variant="secondary" onClick={onClose}><X size={14} />关闭</Button>
          </div>
          <form onSubmit={submit}>
            <div className="metadata-editor-list">
              {drafts.map((item, index) => (
                <div key={`${index}-${item.key}`}>
                  <label className="field"><span className="field-label">Key</span><Input required pattern="[A-Za-z][A-Za-z0-9_]{0,63}" value={item.key} onChange={(event) => update(index, { key: event.target.value })} /></label>
                  <label className="field"><span className="field-label">名称</span><Input required value={item.name} onChange={(event) => update(index, { name: event.target.value })} /></label>
                  <label className="field"><span className="field-label">类型</span><SelectInput value={item.value_type} onChange={(event) => {
                    const value_type = event.target.value as DeviceMetadataInput["value_type"];
                    update(index, { value_type, value: value_type === "number" ? 0 : value_type === "boolean" ? false : "" });
                  }}><option value="number">数值</option><option value="string">文本</option><option value="boolean">布尔</option></SelectInput></label>
                  <label className="field"><span className="field-label">值</span>{item.value_type === "boolean" ? <SelectInput value={String(item.value)} onChange={(event) => update(index, { value: event.target.value === "true" })}><option value="true">是</option><option value="false">否</option></SelectInput> : <Input required type={item.value_type === "number" ? "number" : "text"} step="any" value={String(item.value)} onChange={(event) => update(index, { value: item.value_type === "number" ? Number(event.target.value) : event.target.value })} />}</label>
                  <label className="field"><span className="field-label">单位</span><Input disabled={item.value_type !== "number"} value={item.unit ?? ""} onChange={(event) => update(index, { unit: event.target.value })} /></label>
                  <button type="button" aria-label="删除元数据" onClick={() => setDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button>
                </div>
              ))}
              <Button type="button" variant="secondary" onClick={() => setDrafts((current) => [...current, { key: "", name: "", value_type: "number", value: 0, unit: "" }])}><Plus size={14} />添加元数据</Button>
            </div>
            {error && <div className="form-error computed-form-error">{error}</div>}
            <div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存元数据"}</Button></div>
          </form>
        </Panel>
      </SheetContent>
    </Sheet>
  );
}

function ComputedStreamEditor({
  deviceId,
  item,
  streams,
  metadata,
  onClose,
  onSaved,
}: {
  deviceId: string;
  item: ComputedDataStream | null;
  streams: DataStream[];
  metadata: DeviceMetadata[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [code, setCode] = useState(item?.code ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "");
  const [formula, setFormula] = useState(item?.formula ?? "");
  const [enabled, setEnabled] = useState(item?.enabled ?? true);
  const [preview, setPreview] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [formulaScroll, setFormulaScroll] = useState({ top: 0, left: 0 });
  const formulaInputRef = useRef<HTMLTextAreaElement>(null);
  const numericMetadata = metadata.filter((entry) => entry.value_type === "number");
  const sampleStreams = useMemo(
    () => Object.fromEntries(streams.map((stream) => [stream.code, 1])),
    [streams],
  );
  const knownVariables = useMemo(
    () => new Set([
      ...streams.map((stream) => `stream.${stream.code}`),
      ...numericMetadata.map((entry) => `meta.${entry.key}`),
    ]),
    [numericMetadata, streams],
  );
  const formulaVariables = useMemo(
    () => Array.from(new Set(formula.match(FORMULA_VARIABLE_PATTERN) ?? [])),
    [formula],
  );
  const unknownVariableCount = formulaVariables.filter((variable) => !knownVariables.has(variable)).length;
  useEffect(() => setPreview(null), [formula]);
  const insert = (variable: string) => {
    const input = formulaInputRef.current;
    const start = input?.selectionStart ?? formula.length;
    const end = input?.selectionEnd ?? start;
    const before = formula.slice(0, start);
    const after = formula.slice(end);
    const beforeSeparator = before && !/[\s([,=+\-*/%^]$/.test(before) ? " " : "";
    const afterSeparator = !after || !/^[\s),=+\-*/%^]/.test(after) ? " " : "";
    const next = `${before}${beforeSeparator}${variable}${afterSeparator}${after}`;
    const cursor = start + beforeSeparator.length + variable.length;
    setFormula(next);
    requestAnimationFrame(() => {
      formulaInputRef.current?.focus();
      formulaInputRef.current?.setSelectionRange(cursor, cursor);
    });
  };
  const deleteFormulaToken = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    const input = event.currentTarget;
    const range = formulaTokenDeletionRange(
      formula,
      input.selectionStart,
      input.selectionEnd,
      event.key === "Backspace" ? "backward" : "forward",
    );
    if (!range) return;
    event.preventDefault();
    setFormula(`${formula.slice(0, range[0])}${formula.slice(range[1])}`);
    requestAnimationFrame(() => {
      formulaInputRef.current?.focus();
      formulaInputRef.current?.setSelectionRange(range[0], range[0]);
    });
  };
  const tryFormula = async () => {
    setError("");
    try {
      const result = await api.devices.previewComputedStream(deviceId, {
        formula,
        streams: sampleStreams,
      });
      setPreview(result.value);
    } catch (reason) {
      setPreview(null);
      setError(apiErrorMessage(reason));
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = { name, code, unit, formula, enabled };
      if (item) await api.devices.updateComputedStream(deviceId, item.data_stream_id, payload);
      else await api.devices.createComputedStream(deviceId, payload);
      await onSaved();
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onOpenChange={(open) => !open && !busy && onClose()}>
      <SheetContent className="access-editor computed-editor-drawer">
        <Panel className="access-editor-panel">
          <div className="panel-header"><SheetTitle className="panel-title">{item ? "编辑计算指标" : "新建计算指标"}</SheetTitle><Button variant="secondary" onClick={onClose}><X size={14} />关闭</Button></div>
          <form onSubmit={submit}>
            <div className="computed-definition-grid">
              <label className="field"><span className="field-label">名称</span><Input required value={name} onChange={(event) => setName(event.target.value)} /></label>
              <label className="field"><span className="field-label">Code</span><Input required pattern="[A-Za-z][A-Za-z0-9_]{0,63}" value={code} onChange={(event) => setCode(event.target.value)} /></label>
              <label className="field"><span className="field-label">输出单位</span><Input value={unit} onChange={(event) => setUnit(event.target.value)} /></label>
              <label className="computed-enabled"><CheckboxInput checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />启用</label>
            </div>
            <div className="formula-editor">
              <div className="formula-editor-heading">
                <span className="field-label">公式</span>
                <span className="formula-editor-status">
                  {formulaVariables.length
                    ? `${formulaVariables.length} 个变量${unknownVariableCount ? ` · ${unknownVariableCount} 个未匹配` : ""}`
                    : "等待输入变量"}
                </span>
              </div>
              <details className="formula-help">
                <summary><CircleHelp size={14} />支持四则运算、条件判断和常用数学函数<span>查看完整语法</span></summary>
                <div className="formula-help-content">
                  <dl>
                    <div><dt>变量</dt><dd><code>stream.指标Code</code>、<code>meta.元数据Key</code></dd></div>
                    <div><dt>算术</dt><dd><code>+ - * /</code>，可用括号调整优先级</dd></div>
                    <div><dt>比较</dt><dd><code>== != &lt; &lt;= &gt; &gt;=</code>，结果为 1（成立）或 0（不成立）</dd></div>
                    <div><dt>逻辑</dt><dd><code>&amp;&amp; || !</code>，0 表示假，非 0 表示真</dd></div>
                    <div><dt>函数</dt><dd><code>min(a,b)</code>、<code>max(a,b)</code>、<code>abs(x)</code>、<code>round(x)</code>、<code>sqrt(x)</code>、<code>pow(x,n)</code></dd></div>
                    <div><dt>条件</dt><dd><code>if(条件, 成立值, 不成立值)</code></dd></div>
                  </dl>
                  <div className="formula-help-examples"><strong>示例</strong><code>stream.temperature * 1.8 + 32</code><code>if(stream.value &gt; meta.maximum, meta.maximum, stream.value)</code></div>
                  <p>仅支持数值运算，公式最长 1024 个字符；不支持 <code>%</code>、<code>^</code>，幂运算请使用 <code>pow()</code>。</p>
                </div>
              </details>
              <div className="formula-input-shell">
                <pre
                  className="formula-highlight"
                  aria-hidden="true"
                  style={{ transform: `translate(${-formulaScroll.left}px, ${-formulaScroll.top}px)` }}
                >
                  {formula ? highlightFormula(formula, knownVariables) : <span className="formula-placeholder">点击下方变量插入公式</span>}
                </pre>
                <Textarea
                  ref={formulaInputRef}
                  required
                  rows={4}
                  value={formula}
                  onChange={(event) => setFormula(event.target.value)}
                  onKeyDown={deleteFormulaToken}
                  onScroll={(event) => setFormulaScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}
                  aria-label="公式"
                  placeholder="stream.change / 1000 + meta.initial_value"
                  spellCheck={false}
                />
              </div>
              {formulaVariables.length > 0 && (
                <div className="formula-token-summary" aria-label="公式中的变量">
                  {formulaVariables.map((variable) => (
                    <span key={variable} className={knownVariables.has(variable) ? "formula-token-chip" : "formula-token-chip unknown"}>
                      {variable}
                    </span>
                  ))}
                </div>
              )}
              <div className="formula-variables">
                <strong><Braces size={14} />原始指标</strong>
                <div>{streams.map((stream) => <button type="button" key={stream.id} onClick={() => insert(`stream.${stream.code}`)}><span>{stream.name}</span><code>stream.{stream.code}</code></button>)}</div>
                <strong><Braces size={14} />数值元数据</strong>
                <div>{numericMetadata.map((entry) => <button type="button" key={entry.id} onClick={() => insert(`meta.${entry.key}`)}><span>{entry.name}</span><code>meta.{entry.key}</code></button>)}</div>
              </div>
              <div className="formula-actions">
                <span>试算时所有原始指标使用示例值 1，元数据使用当前值。</span>
                <Button type="button" variant="secondary" disabled={!formula.trim()} onClick={() => void tryFormula()}><Calculator size={14} />校验并试算</Button>
                {preview !== null && <Badge tone="success"><Check size={12} />结果 {preview}</Badge>}
              </div>
            </div>
            {error && <div className="form-error computed-form-error">{error}</div>}
            <div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存计算指标"}</Button></div>
          </form>
        </Panel>
      </SheetContent>
    </Sheet>
  );
}

function metadataTypeLabel(value: DeviceMetadata["value_type"]) {
  return value === "number" ? "数值" : value === "boolean" ? "布尔" : "文本";
}

function metadataDisplayValue(item: DeviceMetadata) {
  if (item.value_type === "boolean") return item.value ? "是" : "否";
  return `${String(item.value)}${item.unit ? ` ${item.unit}` : ""}`;
}

function apiErrorMessage(error: unknown) {
  const item = formatApiError(error);
  return `${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`;
}
