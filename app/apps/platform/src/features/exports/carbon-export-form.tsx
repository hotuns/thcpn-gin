import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layers3 } from "lucide-react";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { CheckboxInput, StateView } from "../../shared/ui";
import { DataRangeFields as RangeFields, validDataRange } from "../../shared/data/data-builder";
import { ExportDevicePicker, ExportContentToggle as ChoiceCard } from "./export-device-picker";
import { defaultRange, value, pickerOptions, arrayParam, buildCarbonExportPayload } from "./export-model";
import { type FormCommon, FormFooter } from "./export-form-layout";

export function CarbonExportForm({
  devices,
  params,
  chooser,
  onClose,
  onCreate,
  feedback,
}: { devices: JsonRecord[] } & FormCommon) {
  const stations = devices.filter(
    (item) => value(item, "device_type") === "carbon_sink",
  );
  const range = defaultRange();
  const [deviceId, setDeviceId] = useState(params.get("device") ?? "");
  const overview = useQuery({
    queryKey: ["carbon", deviceId, "overview"],
    queryFn: () => api.carbon.overview(deviceId),
    enabled: Boolean(deviceId),
  });
  const nodesCount = overview.data?.nodes_count ?? 0;
  const allNodes = Array.from({ length: nodesCount }, (_, i) => i + 1);
  const requestedNodes = arrayParam(params.get("nodes"))
    .map(Number)
    .filter((item) => item > 0);
  const [nodes, setNodes] = useState<number[] | null>(
    requestedNodes.length ? requestedNodes : null,
  );
  const [fields, setFields] = useState<string[]>(["A", "B", "C", "D"]);
  const [start, setStart] = useState(params.get("start") ?? range.start);
  const [end, setEnd] = useState(params.get("end") ?? range.end);
  const [flux, setFlux] = useState(true);
  const [raw, setRaw] = useState(true);
  const [busy, setBusy] = useState(false);
  const effectiveNodes = (nodes ?? allNodes).filter(id => allNodes.includes(id));
  const toggleField = (field: string) =>
    setFields((now) =>
      now.includes(field)
        ? now.filter((item) => item !== field)
        : [...now, field],
    );
  const toggleNode = (id: number) =>
    setNodes((now) =>
      effectiveNodes.includes(id)
        ? effectiveNodes.filter((item) => item !== id)
        : [...effectiveNodes, id],
    );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !validDataRange(start, end)) return;
    if (!effectiveNodes.length || !fields.length || (!flux && !raw) || overview.isLoading || overview.error) return;
    setBusy(true);
    await onCreate(buildCarbonExportPayload({
      deviceId, nodeIds: effectiveNodes, fields, start, end, flux, raw,
    }));
    setBusy(false);
  };
  return (
    <div className="export-system-form">
      <form className="export-builder dataset-builder" onSubmit={submit}>
        <div className="export-builder-main dataset-builder-main">
          {chooser}
          <section className="dataset-editor-section export-settings-section">
      <div className="dataset-editor-section-heading">
        <div className="dataset-step-heading">
          <span className="export-form-icon">
            2
          </span>
          <div>
            <h2 className="panel-title">碳汇站导出</h2>

          </div>
        </div>
      </div>
        <div className="export-settings-fields">
        <ExportDevicePicker
          label="碳汇站"
          options={pickerOptions(stations)}
          selectedIds={deviceId ? [deviceId] : []}
          onChange={(ids) => {
            setDeviceId(ids[0] ?? "");
            setNodes(null);
          }}
          searchPlaceholder="搜索碳汇站名称或序列号"
        />
        {overview.error && <StateView type="error" title="设备数据加载失败" description={formatApiError(overview.error).message} />}
        <div className="carbon-export-selector">
          <section>
            <div className="export-selector-title">
              <span>
                <strong>Node</strong>
                <small>默认全选该站全部节点</small>
              </span>
              <em>
                {effectiveNodes.length}/{allNodes.length}
              </em>
            </div>
            <div className="export-option-checks">
              {allNodes.map((id) => (
                <label
                  className={effectiveNodes.includes(id) ? "active" : ""}
                  key={id}
                >
                  <CheckboxInput checked={effectiveNodes.includes(id)} onChange={() => toggleNode(id)} />{overview.data?.nodes.find(node => node.node_id === id)?.name ?? `节点 ${id}`}
                </label>
              ))}
            </div>
          </section>
          <section>
            <div className="export-selector-title">
              <span>
                <strong>地块</strong>
                <small>用户可移除不需要的地块</small>
              </span>
              <em>{fields.length}/4</em>
            </div>
            <div className="export-option-checks">
              {["A", "B", "C", "D"].map((field) => (
                <label
                  className={fields.includes(field) ? "active" : ""}
                  key={field}
                >
                  <CheckboxInput checked={fields.includes(field)} onChange={() => toggleField(field)} />
                  <b>{field}</b> 地块
                </label>
              ))}
            </div>
          </section>
        </div>
        <div className="carbon-export-matrix">
          <span className="export-matrix-icon">
            <Layers3 size={17} />
          </span>
          <span>
            <strong>
              将生成 {effectiveNodes.length * fields.length} 个 Node × 地块组合
            </strong>
            <small>
              {effectiveNodes
                .map((node) =>
                  fields.map((field) => `${overview.data?.nodes.find(item => item.node_id === node)?.name ?? `节点 ${node}`}/${field}`).join("、"),
                )
                .join("；") || "请选择组合"}
            </small>
          </span>
        </div>
        <RangeFields
          start={start}
          end={end}
          setStart={setStart}
          setEnd={setEnd}
        />
        <div className="export-content-section">
          <div>
            <strong>导出内容</strong>
            <span>至少选择一种数据内容</span>
          </div>
          <div className="export-content-checks">
            <ChoiceCard
              checked={flux}
              onChange={setFlux}
              title="通量数据"
              description="NEE、ER、GPP"
            />
            <ChoiceCard
              checked={raw}
              onChange={setRaw}
              title="原始采样"
              description="周期与原始记录"
            />
          </div>
        </div>
        </div>
          </section>
        </div>
        <FormFooter feedback={feedback}
          invalid={(!flux && !raw) || overview.isLoading || Boolean(overview.error)}
          count={effectiveNodes.length * fields.length}
          busy={busy}
          onClose={onClose}
          system="碳汇站导出"
          start={start}
          end={end}
          content={[flux ? "通量数据" : "", raw ? "原始采样" : ""].filter(Boolean).join("、") || "未选择"}
        />
      </form>
    </div>
  );
}
