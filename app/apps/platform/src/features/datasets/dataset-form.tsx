import "./datasets-mobile.css";
import { isMeasurement, streamPurposeLabel } from "@thcpn/api";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Database, Plus, RefreshCw, X } from "lucide-react";
import { api, formatApiError, type Dataset, type Device, type JsonRecord } from "@thcpn/api";
import { Badge, Button, CheckboxInput, Input, SelectInput, StateView } from "../../shared/ui";
import { DataRangeFields, validDataRange } from "../../shared/data/data-builder";
import { Alert, AlertDescription, AlertTitle } from "../../shared/ui/primitives/alert";
import { SearchInput, Tabs, TabsList, TabsTrigger } from "../../shared/ui";
import { DeviceCombobox } from "../../shared/data/device-combobox";
import { type SourceInput, selectDatasetStreams, type AddableSourceType, type DatasetPrefill, datasetDeviceSystem, localTime, buildDatasetPayload } from "./dataset-model";
import { datasetTypeLabel, datasetStatusLabel, sourceTypeLabel } from "./dataset-format";
import { SourceName } from "./dataset-sources";

export function DatasetForm({
  workspaceId,
  dataset,
  prefill,
  projects,
  devices,
  busy,
  feedback,
  onBusyChange,
  onDirtyChange,
  onSaved,
}: {
  workspaceId: string;
  dataset: Dataset | null;
  prefill?: DatasetPrefill;
  projects: JsonRecord[];
  devices: JsonRecord[];
  busy: boolean;
  feedback?: string;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (
    action: () => Promise<Dataset>,
    message: string,
  ) => Promise<boolean>;
}) {
  const initialDataType = dataset?.data_type ?? "telemetry";
  const initialStartTime =
    dataset
      ? localTime(dataset.time_start)
      : prefill?.startTime ?? localTime(new Date(Date.now() - 7 * 86_400_000));
  const initialEndTime =
    dataset
      ? localTime(dataset.time_end)
      : prefill?.endTime ?? localTime(new Date());
  const generatedName = `${datasetTypeLabel(initialDataType)} ${initialStartTime.slice(0, 10)}`;
  const [name, setName] = useState(
    dataset?.name ?? prefill?.name ?? generatedName,
  );
  const [description, setDescription] = useState(dataset?.description ?? "");
  const [projectId, setProjectId] = useState(dataset?.project_id ?? "");
  const [dataType, setDataType] = useState<Dataset["data_type"]>(initialDataType);
  const [startTime, setStartTime] = useState(initialStartTime);
  const [endTime, setEndTime] = useState(initialEndTime);
  const [status, setStatus] = useState<Dataset["status"]>(
    dataset?.status ?? "draft",
  );
  const [sources, setSources] = useState<SourceInput[]>(
    () =>
      dataset?.sources.map((item) => ({
        source_type: item.source_type,
        source_id: item.source_id,
      })) ?? prefill?.sources ?? [],
  );
  const initialSourceType: AddableSourceType =
    dataset?.sources.some((item) => item.source_type === "device")
      ? "device"
      : "data_stream";
  const [sourceType, setSourceType] =
    useState<AddableSourceType>(initialSourceType);
  const [streamKind, setStreamKind] = useState<"telemetry" | "image">(
    dataset?.data_type === "image" ? "image" : "telemetry",
  );
  const [deviceId, setDeviceId] = useState("");
  const [streamSearch, setStreamSearch] = useState("");
  const selectedStreamIds = sources.filter(source => source.source_type === "data_stream").map(source => source.source_id);
  const [error, setError] = useState("");
  const datasetDevices = useMemo(
    () => devices.filter((item) => Boolean(datasetDeviceSystem(item))),
    [devices],
  );
  const gatewayDevices = useMemo(
    () => devices.filter((item) => String(item.device_type ?? "") === "gateway"),
    [devices],
  );
  const childQueries = useQueries({
    queries: gatewayDevices.map((gateway) => ({
      queryKey: ["device", String(gateway.id), "children", "dataset-form"],
      queryFn: () => api.devices.children(String(gateway.id)),
      staleTime: 60_000,
    })),
  });
  const datasetSelectableDevices = useMemo(() => {
    const items = [...datasetDevices];
    for (const result of childQueries) {
      for (const item of result.data?.items ?? []) {
        const child = item.device as unknown as JsonRecord;
        if (!items.some((candidate) => String(candidate.id) === String(child.id))) items.push(child);
      }
    }
    return items;
  }, [childQueries, datasetDevices]);
  const initialFingerprint = useRef<string | undefined>(undefined);
  const fingerprint = JSON.stringify({
    name,
    description,
    projectId,
    dataType,
    startTime,
    endTime,
    status,
    sources,
  });
  if (initialFingerprint.current === undefined) initialFingerprint.current = fingerprint;
  const dirty = initialFingerprint.current !== fingerprint;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  const streams = useQuery({
    queryKey: ["device", deviceId, "streams", "dataset-form"],
    queryFn: () => api.dataStreams.list(deviceId),
    enabled: Boolean(deviceId),
  });
  useEffect(() => {
    setStreamSearch("");
  }, [deviceId, sourceType, streamKind]);
  const canAddCurrentDevice = () => {
    const currentSystems = new Set(
      sources.flatMap((source) => {
        if (source.source_type === "device") {
          const item = datasetSelectableDevices.find((candidate) => String(candidate.id) === source.source_id);
          return datasetDeviceSystem(item) ? [datasetDeviceSystem(item)] : [];
        }
        return [];
      }),
    );
    const selectedSystem = datasetDeviceSystem(
      datasetSelectableDevices.find((item) => String(item.id) === deviceId),
    );
    if (selectedSystem && currentSystems.size > 0 && !currentSystems.has(selectedSystem)) {
      setError("一个数据集只能选择标准站或组网站中的一种设备体系");
      return false;
    }
    return true;
  };
  const addSources = () => {
    if (!deviceId || !canAddCurrentDevice() || sources.some(source => source.source_type === "device" && source.source_id === deviceId)) return;
    const target = datasetSelectableDevices.find(item=>String(item.id)===deviceId);
    if (target?.source_family === "lorawan_v2") {
      if (!streams.isSuccess) { setError("请等待指标加载完成"); return; }
      const ids=streams.data.items.filter(stream=>stream.type==="telemetry" && stream.status==="active" && isMeasurement(stream)).map(stream=>stream.id);
      if(!ids.length){setError("该设备暂无采集指标");return;}
      setSources(current=>selectDatasetStreams(current,ids,true));
      setDataType(current=>sources.length && current!=="telemetry" ? "mixed" : "telemetry");
    } else {
      setSources(current => [...current, { source_type: "device", source_id: deviceId }]);
      setDataType("mixed");
    }
    setError("");
  };
  const availableStreams =
    streams.data?.items.filter(item => (streamKind === "image" ? item.type === "image" : item.type === "telemetry" && (item.status === "active" && isMeasurement(item) || selectedStreamIds.includes(item.id)))) ?? [];
  const visibleStreams = availableStreams.filter(item => `${item.name} ${item.code} ${item.unit ?? ""}`.toLowerCase().includes(streamSearch.toLowerCase()));
  const availableStreamIds = visibleStreams.map(item => item.id);
  const allStreamsSelected = availableStreamIds.length > 0 && availableStreamIds.every(id => selectedStreamIds.includes(id));
  const changeStreams = (ids: string[], checked: boolean) => {
    if (checked && !canAddCurrentDevice()) return;
    setSources(current => selectDatasetStreams(current, ids, checked));
    if (checked) setDataType(current => current === "mixed" || (sources.length > 0 && current !== streamKind) ? "mixed" : streamKind);
    setError("");
  };
  const toggleStream = (streamId: string) => changeStreams([streamId], !selectedStreamIds.includes(streamId));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sources.length) {
      setError("请至少添加一个设备或数据流来源");
      return;
    }
    const startMs = Date.parse(startTime);
    const endMs = Date.parse(endTime);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
      setError("请选择有效的时间范围，且结束时间必须晚于开始时间");
      return;
    }
    onBusyChange(true);
    setError("");
    const draft = {
      workspaceId,
      projectId,
      name,
      description,
      dataType,
      startTime,
      endTime,
      sources,
      status,
    };
    try {
      const payload = buildDatasetPayload(draft, Boolean(dataset));
      await onSaved(
        () =>
          dataset
            ? api.datasets.update(dataset.id, payload)
            : api.datasets.create(payload),
        dataset ? "数据集已更新" : "数据集已创建",
      );
    } catch (reason) {
      const item = formatApiError(reason);
      setError(
        `${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
      );
    } finally {
      onBusyChange(false);
    }
  };
  return (
    <div className="section-gap dataset-editor-page">
      <form id="dataset-form" className="dataset-builder" onSubmit={submit}>
        <div className="dataset-builder-main">
        <section className="dataset-editor-section">
          <div className="dataset-editor-section-heading">
            <div className="dataset-step-heading">
              <span>1</span>
              <div>
                <h2>定义数据集</h2>
                <p>
                  {prefill?.sources.length
                    ? `已带入 ${prefill.sources.length} 个数据指标和查询时间，可继续调整`
                    : dataset
                      ? "修改名称、时间范围和关联项目"
                      : "设置名称和数据覆盖的时间范围"}
                </p>
              </div>
            </div>
            {dirty && <Badge tone="warning">未保存</Badge>}
          </div>
          <div className="dataset-form-grid">
            <label className="field">
              <div className="dataset-field-label-row">
                <span className="field-label">名称</span>
                <button
                  type="button"
                  className="dataset-auto-name"
                  onClick={() =>
                    setName(`${datasetTypeLabel(dataType)} ${startTime.slice(0, 10)}`)
                  }
                >
                  <RefreshCw size={11} />
                  自动生成
                </button>
              </div>
              <Input required aria-label="名称" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">项目</span>
              <SelectInput value={projectId} disabled={Boolean(dataset)} onChange={(event) => setProjectId(event.target.value)}>
                <option value="">不关联项目</option>
                {projects.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.name)}</option>)}
              </SelectInput>
            </label>
            <div className="dataset-description"><DataRangeFields start={startTime} end={endTime} setStart={setStartTime} setEnd={setEndTime} /></div>
            {dataset && (
              <label className="field">
                <span className="field-label">状态</span>
                <SelectInput value={status} onChange={(event) => setStatus(event.target.value as Dataset["status"])}>
                  {["draft", "published", "locked", "archived"].map((item) => <option key={item} value={item}>{datasetStatusLabel(item as Dataset["status"])}</option>)}
                </SelectInput>
              </label>
            )}
            <label className="field dataset-description">
              <span className="field-label">描述</span>
              <Input value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
          </div>
        </section>
        <section className="dataset-editor-section dataset-sources" data-onboarding="dataset-sources">
          <div className="dataset-editor-section-heading">
            <div className="dataset-step-heading">
              <span>2</span>
              <div>
                <h2>选择数据来源</h2>
                <p>选择整台设备，或从设备中挑选需要的数据指标和图片。</p>
              </div>
            </div>
            <span className="dataset-source-count">{sources.length} 个已选择</span>
          </div>
          <Tabs value={sourceType} onValueChange={value => setSourceType(value as AddableSourceType)}>
            <TabsList aria-label="来源类型"><TabsTrigger value="device">整台设备</TabsTrigger><TabsTrigger value="data_stream">数据指标</TabsTrigger></TabsList>
          </Tabs>
          <div className="source-picker">
            <label className="field">
              <span className="field-label">设备</span>
              <DeviceCombobox
                devices={datasetSelectableDevices as Device[]}
                value={deviceId}
                onChange={setDeviceId}
                ariaLabel="搜索来源设备"
              />
            </label>
            {sourceType === "device" && (
              <Button
                type="button"
                variant="secondary"
                disabled={!deviceId || sources.some(source => source.source_type === "device" && source.source_id === deviceId)}
                onClick={addSources}
              >
                <Plus size={13} />
                添加整台设备
              </Button>
            )}
          </div>
          {sourceType === "data_stream" && (
            <div className="dataset-stream-picker">
              <div className="dataset-stream-picker-header">
                <div>
                  <strong>
                    可选{streamKind === "image" ? "图片数据流" : "数据指标"}
                  </strong>
                  <span>
                    {deviceId
                      ? `${availableStreams.filter(item => selectedStreamIds.includes(item.id)).length} 项已选`
                      : "选择设备后加载指标"}
                  </span>
                </div>
                {deviceId && availableStreamIds.length > 0 && (
                  <button
                    type="button"
                    className="dataset-stream-select-all"
                    onClick={() =>
                      changeStreams(availableStreamIds, !allStreamsSelected)
                    }
                  >
                    {allStreamsSelected ? "清空选择" : "全选指标"}
                  </button>
                )}
              </div>
              <div className="data-builder-stream-toolbar">
                <Tabs value={streamKind} onValueChange={value => setStreamKind(value as "telemetry" | "image")}><TabsList aria-label="数据类型"><TabsTrigger value="telemetry">设备数据</TabsTrigger><TabsTrigger value="image">图片</TabsTrigger></TabsList></Tabs>
                <SearchInput value={streamSearch} onChange={event => setStreamSearch(event.target.value)} placeholder="搜索指标名称或编码" />
              </div>

              {!deviceId ? (
                <div className="dataset-stream-empty">请先选择设备</div>
              ) : streams.isLoading ? (
                <div className="dataset-stream-empty">正在加载数据指标…</div>
              ) : streams.error ? (
                <StateView type="error" title="设备数据加载失败" description={formatApiError(streams.error).message} />
              ) : visibleStreams.length ? (
                <div className="dataset-stream-options">
                  {visibleStreams.map((item) => (
                    <label
                      key={item.id}
                      className={`dataset-stream-option${selectedStreamIds.includes(item.id) ? " selected" : ""}`}
                    >
                      <CheckboxInput
                        checked={selectedStreamIds.includes(item.id)}
                        onChange={() => toggleStream(item.id)}
                      />
                      <span>
                        <strong>{item.name}{!isMeasurement(item) && ` · ${streamPurposeLabel(item)}`}</strong>
                        <small>
                          {item.unit ? `${item.code} · ${item.unit}` : item.code}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="dataset-stream-empty">
                  {streamSearch ? "没有匹配的指标" : <>该设备暂无可用{streamKind === "image" ? "图片数据流" : "数据指标"}</>}
                </div>
              )}

            </div>
          )}
          <div className="dataset-selected-sources">
            <div><strong>已选内容</strong><span>创建前可随时移除</span></div>
          {sources.length ? (
            <div className="source-chips">
              {sources.map((source) => (
                <div
                  key={`${source.source_type}-${source.source_id}`}
                  title={source.source_id}
                >
                  <Database size={13} />
                  <SourceName source={source} devices={datasetSelectableDevices} />
                  <small>{sourceTypeLabel(source.source_type)}</small>
                  <button
                    type="button"
                    aria-label="移除来源"
                    onClick={() =>
                      setSources((current) =>
                        current.filter((item) => item !== source),
                      )
                    }
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="dataset-source-empty">尚未选择来源</div>
          )}
          </div>
        </section>
        </div>
        <aside className="dataset-builder-summary" data-onboarding="dataset-save">
          <div className="dataset-builder-summary-heading"><span>3</span><div><h2>检查并保存</h2><p>确认范围与来源后创建数据集</p></div></div>
          <dl>
            <div><dt>名称</dt><dd>{name || "未填写"}</dd></div>
            <div><dt>数据类型</dt><dd>{datasetTypeLabel(dataType)}</dd></div>
            <div><dt>数据来源</dt><dd>{sources.length ? `${sources.length} 项` : "未选择"}</dd></div>
            <div><dt>时间范围</dt><dd>{startTime.replace("T", " ")}<span>至</span>{endTime.replace("T", " ")}</dd></div>
            <div><dt>关联项目</dt><dd>{projects.find((item) => String(item.id) === projectId)?.name?.toString() ?? "未关联"}</dd></div>
          </dl>
          {(error || feedback) && <Alert variant="destructive"><AlertTitle>无法保存数据集</AlertTitle><AlertDescription>{error || feedback}</AlertDescription></Alert>}
          <div className={`mobile-form-actions${dataset ? " dataset-mobile-save" : ""}`}><Button type="submit" disabled={busy || !name.trim() || !sources.length || !validDataRange(startTime, endTime)}>
            {busy ? "保存中…" : dataset ? "保存数据集" : "创建数据集"}
          </Button></div>
        </aside>
      </form>
    </div>
  );
}
