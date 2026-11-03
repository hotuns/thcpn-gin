import { useId, useState, type CSSProperties } from "react";
import type { DashboardDay, DashboardOverview } from "@thcpn/api";
import { useLocale } from "@thcpn/i18n";
import { Button, Panel } from "../../shared/ui";

type Measure = "records" | "images";

export function DashboardTrend({ days, onDaysChange, data, busy, placeholder, error, onRetry }: {
  days: 7 | 30;
  onDaysChange: (days: 7 | 30) => void;
  data?: DashboardOverview;
  busy: boolean;
  placeholder: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const { t, locale, formatNumber } = useLocale();
  const [measure, setMeasure] = useState<Measure>("records");
  const [view, setView] = useState<"chart" | "table">("chart");
  const [selected, setSelected] = useState<string | null>(null);
  const tooltipId = useId();
  const rows = data?.trend ?? [];
  const point = rows.find((row) => row.date === selected);
  const metric = t(`platform:overview.${measure === "records" ? "trendRecords" : "trendImages"}`);
  const number = (value: number | null) => value === null ? t("platform:overview.unknown") : formatNumber(value);
  const date = (value: string, short = false) => new Intl.DateTimeFormat(locale, {
    timeZone: "UTC", ...(short ? { month: "numeric", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" }),
  }).format(new Date(`${value}T00:00:00Z`));
  const status = (row: DashboardDay, key: Measure) => t(`platform:overview.${row[key] === null ? "unknown" : row[`${key}_complete`] ? "complete" : "partial"}`);
  const hasPartial = rows.some((row) => !row[`${measure}_complete`]);
  // Round the one shared scale up to clean integer ticks, always anchored at zero.
  const maximum = Math.max(1, ...rows.map((row) => row[measure] ?? 0));
  const magnitude = 10 ** Math.floor(Math.log10(maximum));
  const upper = Math.ceil(maximum / magnitude) * magnitude;
  const tickCount = upper < 4 ? upper : 4;
  const top = upper < 4 ? upper : Math.ceil(upper / 4) * 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => top * (tickCount - index) / tickCount);

  return <Panel className="overview-trend" aria-labelledby="overview-trend-title">
    <div className="overview-section-heading"><div><h2 id="overview-trend-title">{t("platform:overview.trend")}</h2><p>{t("platform:overview.trendScope")}</p></div></div>
    <div className="overview-trend-controls">
      <div className="overview-segment" role="group" aria-label={t("platform:overview.range")}>{([7, 30] as const).map((range) => <Button key={range} variant="ghost" aria-pressed={range === days} onClick={() => onDaysChange(range)}>{t(`platform:overview.days${range}`)}</Button>)}</div>
      <div className="overview-segment" role="group" aria-label={t("platform:overview.measure")}>{(["records", "images"] as const).map((key) => <Button key={key} variant="ghost" aria-pressed={measure === key} onClick={() => setMeasure(key)}>{t(`platform:overview.${key === "records" ? "trendRecords" : "trendImages"}`)}</Button>)}</div>
      <div className="overview-segment" role="group" aria-label={t("platform:overview.view")}>{(["chart", "table"] as const).map((key) => <Button key={key} variant="ghost" aria-pressed={view === key} onClick={() => setView(key)}>{t(`platform:overview.${key}`)}</Button>)}</div>
    </div>
    <div className="overview-trend-caption"><strong>{t("platform:overview.trendTitle", { metric })}</strong>{rows.length > 0 && <span>{date(rows[0].date)} – {date(rows[rows.length - 1].date)}</span>}</div>
    {error != null && <div className="overview-notice" role="alert"><span>{t("platform:overview.trendUnavailable")}</span><Button variant="secondary" disabled={busy} onClick={onRetry}>{t("platform:overview.retry")}</Button></div>}
    <div className="overview-trend-feedback" role="status">{placeholder ? t("platform:overview.previousRange") : busy ? t(`platform:overview.${data ? "refreshing" : "loading"}`) : hasPartial ? t("platform:overview.trendPartial") : t("platform:overview.trendMissing")}</div>
    <div className={`overview-trend-frame${busy && data ? " is-refreshing" : ""}`} aria-busy={busy} data-testid="overview-trend-frame">
      {view === "table" ? <div className="overview-table-scroll"><table className="overview-trend-table">
        <caption>{t("platform:overview.trend")}</caption><thead><tr><th scope="col">{t("platform:overview.date")}</th><th scope="col">{t("platform:overview.trendRecords")}</th><th scope="col">{t("platform:overview.trendImages")}</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.date}><th scope="row">{date(row.date)}</th>{(["records", "images"] as const).map((key) => <td key={key}>{number(row[key])}<span className="overview-table-status">{status(row, key)}</span></td>)}</tr>)}</tbody>
      </table>{rows.length === 0 && <p className="overview-chart-empty">{t(`platform:overview.${busy ? "loading" : error ? "trendUnavailable" : "trendEmpty"}`)}</p>}</div> : <>
        <div className="overview-chart-readout" id={tooltipId} role="status" aria-live="polite">
          {point ? <><strong>{number(point[measure])}</strong><span>{metric} · {date(point.date)} · {status(point, measure)}</span></> : <span>{t("platform:overview.pointHint")}</span>}
        </div>
        <div className="overview-chart-layout">
          <div className="overview-chart-axis" aria-hidden="true">{ticks.map((tick) => <span key={tick}>{formatNumber(tick, { notation: "compact", maximumFractionDigits: 1 })}</span>)}</div>
          <div className="overview-chart-scroll">
            <div className="overview-chart" style={{ "--day-count": rows.length || days } as CSSProperties}>
              <div className="overview-chart-grid" aria-hidden="true">{ticks.map((tick) => <i key={tick} />)}</div>
              <div className="overview-chart-columns" role="group" aria-label={t("platform:overview.trendTitle", { metric })}>
                {rows.map((row, index) => <div className="overview-chart-column" key={row.date}>
                  <button type="button" className="overview-bar-target" aria-describedby={point?.date === row.date ? tooltipId : undefined}
                    aria-label={t("platform:overview.point", { date: date(row.date), metric, value: number(row[measure]), status: status(row, measure) })}
                    onMouseEnter={() => setSelected(row.date)} onFocus={() => setSelected(row.date)} onClick={() => setSelected(row.date)} onKeyDown={(event) => { if (event.key === "Escape") setSelected(null); }}
                    data-selected={point?.date === row.date || undefined}>
                    {row[measure] === null ? <span className="overview-missing-mark" aria-hidden="true">?</span> : row[measure] === 0 ? <span className="overview-zero-mark" aria-hidden="true">0</span> : <span className="overview-bar" aria-hidden="true" style={{ height: `${row[measure] / top * 100}%` }} />}
                  </button>
                  <span className="overview-chart-date" aria-hidden="true">{rows.length <= 7 || index % 5 === 0 || index === rows.length - 1 ? date(row.date, true) : ""}</span>
                </div>)}
              </div>
              {rows.length === 0 && <p className="overview-chart-empty">{t(`platform:overview.${busy ? "loading" : error ? "trendUnavailable" : "trendEmpty"}`)}</p>}
            </div>
          </div>
        </div>
      </>}
    </div>
    <p className="overview-chart-help">{t("platform:overview.trendHelp")}</p>
  </Panel>;
}
