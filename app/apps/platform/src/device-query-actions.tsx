import { Check, Search } from "lucide-react";
import { api, type DataStream, type TelemetryQueryResponse } from "@thcpn/api";
import { Badge, Button, Panel, StateView } from "@thcpn/ui";

type QueryInput = { startTime: string; endTime: string };
const totalRawPointBudget = 20_000;
const totalChartPointBudget = 6_000;
const telemetryQueryConcurrency = 4;

async function queryTelemetryStreams(
  streamIds: string[],
  query: (id: string) => Promise<TelemetryQueryResponse>,
) {
  const responses: TelemetryQueryResponse[] = [];
  for (
    let index = 0;
    index < streamIds.length;
    index += telemetryQueryConcurrency
  ) {
    responses.push(
      ...(await Promise.all(
        streamIds
          .slice(index, index + telemetryQueryConcurrency)
          .map((id) => query(id)),
      )),
    );
  }
  return responses;
}

export async function querySelectedTelemetry(
  deviceId: string,
  streamIds: string[],
  input: QueryInput,
  client = api.telemetry,
): Promise<TelemetryQueryResponse> {
  const rawLimit = Math.min(
    5000,
    Math.max(
      500,
      Math.floor(totalRawPointBudget / Math.max(1, streamIds.length)),
    ),
  );
  const targetPoints = Math.min(
    1000,
    Math.max(
      200,
      Math.floor(totalChartPointBudget / Math.max(1, streamIds.length)),
    ),
  );
  if (!streamIds.length)
    return {
      device_id: deviceId,
      start_time: input.startTime,
      end_time: input.endTime,
      limit: rawLimit,
      series: [],
    };
  return client.device(deviceId, {
    ...input,
    limit: rawLimit,
    adaptive: true,
    targetPoints,
    dataStreamIds: streamIds,
  });
}

export async function querySelectedTelemetryRaw(
  deviceId: string,
  streamIds: string[],
  input: QueryInput,
  limit = 500,
  client = api.telemetry,
): Promise<TelemetryQueryResponse> {
  if (!streamIds.length)
    return {
      device_id: deviceId,
      start_time: input.startTime,
      end_time: input.endTime,
      limit,
      series: [],
    };
  const responses = await queryTelemetryStreams(
    streamIds,
    (id) => client.dataStream(id, { ...input, limit }),
  );
  return {
    device_id: deviceId,
    start_time: input.startTime,
    end_time: input.endTime,
    limit,
    series: responses.flatMap((item) => item.series),
  };
}

export function DeviceQueryActions({
  streams,
  selected,
  onSelectedChange,
  startTime,
  endTime,
  onStartTimeChange,
  onEndTimeChange,
  onRangeChange,
  onSearch,
  dirty,
  searching,
}: {
  streams: DataStream[];
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  startTime: string;
  endTime: string;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
  onRangeChange: (hours: number) => void;
  onSearch: () => void;
  dirty: boolean;
  searching: boolean;
}) {
  const telemetryStreams = streams.filter(
    (item) => item.type === "telemetry" && item.status === "active",
  );
  const invalidRange = !startTime || !endTime || Date.parse(startTime) >= Date.parse(endTime);
  const toggle = (id: string) =>
    onSelectedChange(
      selected.includes(id)
        ? selected.filter((item) => item !== id)
        : [...selected, id],
    );
  return (
    <Panel className="section-gap stream-selector query-condition-panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">查询条件</h2>
          <div className="panel-kicker">设置时间范围和数据指标后统一搜索</div>
        </div>
        <div className="header-actions">
          {dirty && <Badge tone="warning">条件未应用</Badge>}
          <Button disabled={invalidRange || searching} onClick={onSearch}>
            <Search size={14} />
            {searching ? "搜索中…" : "搜索"}
          </Button>
        </div>
      </div>
      <div className="query-bar query-condition-fields">
        <label className="field">
          <span className="field-label">开始时间</span>
          <input type="datetime-local" value={startTime} onChange={(event) => onStartTimeChange(event.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">结束时间</span>
          <input type="datetime-local" value={endTime} onChange={(event) => onEndTimeChange(event.target.value)} />
        </label>
      </div>
      <div className="range-presets">
        <span>快捷范围</span>
        {[
          { label: "1 小时", hours: 1 },
          { label: "6 小时", hours: 6 },
          { label: "24 小时", hours: 24 },
          { label: "7 天", hours: 168 },
        ].map((item) => (
          <button key={item.hours} type="button" onClick={() => onRangeChange(item.hours)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="query-metric-heading">
        <div>
          <strong>数据指标</strong>
          <small>默认全选，可按需取消</small>
        </div>
        <div className="header-actions">
          <Badge tone="info">已选 {selected.length}</Badge>
          <Button
            variant="secondary"
            disabled={!telemetryStreams.length}
            onClick={() =>
              onSelectedChange(
                selected.length === telemetryStreams.length
                  ? []
                  : telemetryStreams.map((item) => item.id),
              )
            }
          >
            {selected.length === telemetryStreams.length && selected.length ? "清空" : "全选"}
          </Button>
        </div>
      </div>
      {telemetryStreams.length ? (
        <div className="stream-check-grid">
          {telemetryStreams.map((stream) => (
            <button
              type="button"
              key={stream.id}
              className={selected.includes(stream.id) ? "selected" : ""}
              onClick={() => toggle(stream.id)}
            >
              <span className="stream-check">{selected.includes(stream.id) && <Check size={12} />}</span>
              <span><strong>{stream.name}</strong><small>{stream.unit || "无单位"}</small></span>
            </button>
          ))}
        </div>
      ) : (
        <StateView type="empty" title="没有遥测指标" description="当前设备尚未同步可查询的遥测指标。" />
      )}
      {invalidRange && <div className="form-error query-condition-error">结束时间必须晚于开始时间。</div>}
    </Panel>
  );
}
