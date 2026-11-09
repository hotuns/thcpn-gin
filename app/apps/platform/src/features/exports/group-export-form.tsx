import { nodeOptionLabel } from "@thcpn/api";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatApiError, type Device } from "@thcpn/api";
import { Alert, AlertDescription, AlertTitle } from "../../shared/ui/primitives/alert";
import { Button, CheckboxInput, SearchInput, SelectInput } from "../../shared/ui";
import { DataRangeFields as RangeFields, validDataRange } from "../../shared/data/data-builder";
import { ExportDevicePicker, ExportContents } from "./export-device-picker";
import { defaultRange, value, arrayParam, buildGroupExportPayload } from "./export-model";
import { type FormCommon, FormFooter } from "./export-form-layout";

export function GroupExportForm({
  devices,
  tagsByDevice,
  params,
  chooser,
  onClose,
  onCreate,
  feedback,
}: { devices: Device[]; tagsByDevice: Map<string, string[]> } & FormCommon) {
  const gateways = devices.filter(
    (item) => value(item, "device_type") === "gateway",
  );
  const range = defaultRange();
  const [gatewayId, setGatewayId] = useState(params.get("gateway") ?? "");
  const [keyword, setKeyword] = useState("");
  const [nodeScope,setNodeScope]=useState<"bound"|"history">(params.get("node_scope")==="history"?"history":"bound");
  const children = useQuery({
    queryKey: ["device", gatewayId, "nodes", "export",nodeScope],
    queryFn: () => api.devices.nodes(gatewayId,nodeScope),
    enabled: Boolean(gatewayId),
  });
  const gateway = gateways.find((item) => value(item, "id") === gatewayId);
  const lorawan = value(gateway ?? {}, "source_family") === "lorawan_v2";
  const nodeItems = children.data?.items ?? [];
  const nodes = nodeItems.map((node) => ({ id: node.key, name: nodeOptionLabel(node), serial_no: node.target.kind === "device" ? `ID ${node.target.device_id.slice(0, 8)}` : `节点 ${node.target.node_index}` }));
  const filteredNodes = nodes.filter((item) =>
    `${value(item, "name")} ${value(item, "serial_no")} ${(tagsByDevice.get(value(item, "id")) ?? []).join(" ")}`
      .toLowerCase()
      .includes(keyword.toLowerCase()),
  );
  const requested = arrayParam(params.get("nodes"));
  const [selected, setSelected] = useState<string[] | null>(
    params.has("nodes") ? requested : null,
  );
  const [start, setStart] = useState(params.get("start") ?? range.start);
  const [end, setEnd] = useState(params.get("end") ?? range.end);
  const [images, setImages] = useState(true);
  const [data, setData] = useState(params.get("data") !== "0");
  const [status, setStatus] = useState(params.get("status") === "1");
  const [busy, setBusy] = useState(false);
  const chooseGateway = (id: string) => {
    setGatewayId(id);
    setSelected(null);
    setKeyword("");
  };
  const effective = (selected ?? nodes.map((item) => value(item, "id"))).filter(id => nodes.some(node => node.id === id));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || (!effective.length && (data || !(lorawan && status))) || (!data && !(lorawan && status) && (lorawan || !images)) || !validDataRange(start, end)) return;
    setBusy(true);
    const chosen = nodeItems.filter((node) => effective.includes(node.key));
    await onCreate(buildGroupExportPayload({
      nodeTargets: chosen.map((node) => node.target),
      gateway: { id: gatewayId, name: value(gateway ?? {}, "name") },
      start, end, lorawan, images, data, status,
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
            <h2 className="panel-title">组网站导出</h2>

          </div>
        </div>
      </div>
        <div className="export-settings-fields">
        <div className="export-group-layout">
          <ExportDevicePicker
            label="组网站"
            devices={gateways}
            selectedIds={gatewayId ? [gatewayId] : []}
            onChange={(ids) => chooseGateway(ids[0] ?? "")}
            searchPlaceholder="搜索组网站名称或序列号"
          />
          <section className="export-target-picker">
            {lorawan&&<SelectInput aria-label="导出节点范围" value={nodeScope} onChange={event=>{setNodeScope(event.target.value as "bound"|"history");setSelected(null);}}><option value="bound">当前节点</option><option value="history">历史数据</option></SelectInput>}

            {(nodes.length > 5 || keyword) && <SearchInput
              className="export-node-search"
              aria-label="搜索节点名称或序列号"
              placeholder="搜索节点名称或序列号"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />}
            <div className="export-target-head">
              <span>
                节点 <strong>{effective.length}</strong> / {nodes.length}
              </span>
              {nodes.length > 0 && (
                <span className="export-target-actions">
                  <Button variant="ghost"
                    type="button"
                    onClick={() =>
                      setSelected(nodes.map((item) => value(item, "id")))
                    }
                  >
                    全选
                  </Button>
                  <Button variant="ghost" type="button" onClick={() => setSelected([])}>
                    清空
                  </Button>
                </span>
              )}
            </div>
            {children.error && <Alert variant="destructive" className="request-error-inline"><AlertTitle>设备数据加载失败</AlertTitle><AlertDescription><p>{formatApiError(children.error).message}</p></AlertDescription></Alert>}
            {!gatewayId ? <p className="data-builder-empty">请先选择组网站</p> : children.isLoading ? <p className="data-builder-empty">正在加载节点…</p> : !children.error && !filteredNodes.length ? <p className="data-builder-empty">没有匹配的节点</p> : null}
            <div className="export-device-checks">
              {filteredNodes.map((item) => {
                const id = value(item, "id");
                const checked = effective.includes(id);
                return (
                  <label key={id} className={checked ? "is-checked" : ""}>
                    <CheckboxInput
                      checked={checked}
                      onChange={() =>
                        setSelected(
                          checked
                            ? effective.filter((x) => x !== id)
                            : [...effective, id],
                        )
                      }
                    />
                    <span>
                      <strong>{value(item, "name")}</strong>
                      {value(item, "serial_no") && <small>{value(item, "serial_no")}</small>}
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        </div>
        <RangeFields
          start={start}
          end={end}
          setStart={setStart}
          setEnd={setEnd}
        />
        <ExportContents data={data} images={!lorawan && images} setData={setData} setImages={setImages} imagesAvailable={!lorawan} status={lorawan && status} setStatus={lorawan ? setStatus : undefined} />
        </div>
          </section>
        </div>
        <FormFooter includesImages={!lorawan && images} feedback={feedback} count={effective.length || (lorawan && status && gatewayId ? 1 : 0)} busy={busy} onClose={onClose} system="组网站导出" start={start} end={end} content={lorawan ? [data && "采集数据", status && "运行状态"].filter(Boolean).join("、") || "未选择" : data && !lorawan && images ? "设备数据和图片" : data ? "设备数据" : !lorawan && images ? "图片" : "未选择"} invalid={(!effective.length && data) || (!data && !(lorawan && status) && (lorawan || !images))} />
      </form>
    </div>
  );
}
