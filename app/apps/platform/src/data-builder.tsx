import { Button, Input } from "./platform-ui";
import "./data-builder.css";

export function validDataRange(start: string, end: string) {
  return Number.isFinite(Date.parse(start)) && Number.isFinite(Date.parse(end)) && Date.parse(start) < Date.parse(end);
}

export function DataRangeFields({ start, end, setStart, setEnd }: {
  start: string; end: string; setStart: (value: string) => void; setEnd: (value: string) => void;
}) {
  const preset = (days: number) => {
    const now = new Date();
    const local = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    setStart(local(new Date(now.getTime() - days * 86_400_000)));
    setEnd(local(now));
  };
  return <section className="data-builder-range">
    <div className="data-builder-section-title"><strong>时间范围</strong><div className="data-builder-presets">
      <Button type="button" variant="secondary" onClick={() => preset(1)}>最近 1 天</Button>
      <Button type="button" variant="secondary" onClick={() => preset(3)}>最近 3 天</Button>
      <Button type="button" variant="secondary" onClick={() => preset(7)}>最近 7 天</Button>
    </div></div>
    <div className="data-builder-range-inputs">
      <label className="field"><span className="field-label">开始时间</span><Input required type="datetime-local" value={start} onChange={event => setStart(event.target.value)} /></label>
      <label className="field"><span className="field-label">结束时间</span><Input required type="datetime-local" min={start || undefined} value={end} onChange={event => setEnd(event.target.value)} /></label>
    </div>
    {!validDataRange(start, end) && <p className="data-builder-validation" role="alert">请选择有效的时间范围，且结束时间必须晚于开始时间</p>}
  </section>;
}
