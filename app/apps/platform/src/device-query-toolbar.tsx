export type DeviceQueryRange = { start: string; end: string };
export const localQueryTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
export const initialQueryRange = (): DeviceQueryRange => ({ start: localQueryTime(new Date(Date.now() - 7 * 86_400_000)), end: localQueryTime(new Date()) });

export function DeviceQueryToolbar({ range, onChange, onPreset }: { range: DeviceQueryRange; onChange: (range: DeviceQueryRange) => void; onPreset?: (hours: number) => void }) {
  const invalid = !range.start || !range.end || Date.parse(range.start) >= Date.parse(range.end);
  return <>
    <div className="gateway-node-query-fields">
      <label className="field"><span className="field-label">开始时间</span><input type="datetime-local" value={range.start} onChange={(event) => onChange({ ...range, start: event.target.value })}/></label>
      <label className="field"><span className="field-label">结束时间</span><input type="datetime-local" value={range.end} onChange={(event) => onChange({ ...range, end: event.target.value })}/></label>
    </div>
    <div className="range-presets"><span>快捷范围</span>{[{label:"6 小时",hours:6},{label:"3 天",hours:72},{label:"7 天",hours:168}].map((item) => <button key={item.hours} type="button" onClick={() => { if (onPreset) { onPreset(item.hours); return; } const end = new Date(); onChange({ start: localQueryTime(new Date(end.getTime() - item.hours * 3_600_000)), end: localQueryTime(end) }); }}>{item.label}</button>)}</div>
    {invalid && <div className="form-error query-condition-error">结束时间必须晚于开始时间。</div>}
  </>;
}
