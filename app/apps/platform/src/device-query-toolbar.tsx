export type DeviceQueryRange = { start: string; end: string };
export const localQueryTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
export const initialQueryRange = (hours = 168): DeviceQueryRange => {
  const end = new Date();
  return { start: localQueryTime(new Date(end.getTime() - hours * 3_600_000)), end: localQueryTime(end) };
};

export function DeviceQueryToolbar({ range, onChange, onPreset, presetHours = [6,72,168] }: { range: DeviceQueryRange; onChange: (range: DeviceQueryRange) => void; onPreset?: (hours: number) => void; presetHours?: number[] }) {
  const invalid = !range.start || !range.end || Date.parse(range.start) >= Date.parse(range.end);
  return <>
    <div className="gateway-node-query-fields">
      <label className="field"><span className="field-label">开始时间</span><Input type="datetime-local" value={range.start} onChange={(event) => onChange({ ...range, start: event.target.value })}/></label>
      <label className="field"><span className="field-label">结束时间</span><Input type="datetime-local" value={range.end} onChange={(event) => onChange({ ...range, end: event.target.value })}/></label>
    </div>
    <div className="range-presets"><span>快捷范围</span>{presetHours.map(hours=>({hours,label:hours<=24?`${hours} 小时`:`${hours/24} 天`})).map((item) => <Button key={item.hours} type="button" variant="secondary" onClick={() => { if (onPreset) { onPreset(item.hours); return; } const end = new Date(); onChange({ start: localQueryTime(new Date(end.getTime() - item.hours * 3_600_000)), end: localQueryTime(end) }); }}>{item.label}</Button>)}</div>
    {invalid && <div className="form-error query-condition-error">结束时间必须晚于开始时间。</div>}
  </>;
}
import { Button, Input } from "./platform-ui";
