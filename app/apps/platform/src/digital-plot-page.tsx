import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLocale } from "@thcpn/i18n";
import {
  ArrowLeft,
  ChevronRight,
  Crosshair,
  Layers3,
  Maximize2,
  Minimize2,
  Mountain,
  Pause,
  Play,
  RadioTower,
  Droplets,
  Thermometer,
  CloudRain,
  Leaf,
  SkipBack,
  StepBack,
  StepForward,
} from "lucide-react";
import { Slider as SliderPrimitive } from "radix-ui";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  SelectInput,
  Switch,
} from "./platform-ui";
import { AtlasClock } from "./atlas-clock";
import { demoStations } from "./digital-plot-field";
import {
  advanceFrame,
  dateFrame,
  flightAt,
  flights,
  frameDate,
  inputDate,
  lastFrame,
  metricColor,
  metrics,
  metricSpecs,
  orthophoto,
  plots,
  reading,
  type PlotMetric,
} from "./digital-plot-model";
import "./digital-plot.css";
import "./observatory.css";

const DigitalPlotMap = lazy(() =>
  import("./digital-plot-map").then((m) => ({ default: m.DigitalPlotMap })),
);
function Range({
  label,
  value,
  max = 100,
  onChange,
}: {
  label: string;
  value: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <SliderPrimitive.Root
      className="dp-slider"
      aria-label={label}
      min={0}
      max={max}
      step={1}
      value={[value]}
      onValueChange={(values) => onChange(values[0])}
    >
      <SliderPrimitive.Track className="dp-slider-track">
        <SliderPrimitive.Range className="dp-slider-range" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="dp-slider-thumb" aria-label={label} />
    </SliderPrimitive.Root>
  );
}
export function DigitalPlotPage() {
  const { t, locale } = useLocale();
  const d = (key: string) => t(`digitalPlot.${key}`);
  const shell = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState("P03");
  const [metric, setMetric] = useState<PlotMetric>("moisture");
  const [heatmap, setHeatmap] = useState(true);
  const [frame, setFrame] = useState(lastFrame);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [layers, setLayers] = useState({
    boundaries: true,
    stations: true,
    heat: true,
    aerial: false,
  });
  const [opacity, setOpacity] = useState(52);
  const [reset, setReset] = useState(0);
  const [flightId, setFlightId] = useState("auto");
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(50);
  const [before, setBefore] = useState<string>(flights[0].id);
  const [after, setAfter] = useState<string>(flights[2].id);
  const [fullscreen, setFullscreen] = useState(false);
  const [screenError, setScreenError] = useState(false);
  const plot = plots.find((p) => p.id === selected)!;
  const spec = metricSpecs[metric];
  const flight =
    flightId === "auto"
      ? flightAt(frame)
      : flights.find((f) => f.id === flightId);
  const chart = Array.from({ length: Math.min(frame, 6 * 24) + 1 }, (_, i) => {
    const f = Math.max(0, frame - 6 * 24) + i;
    return {
      time: frameDate(f).getTime(),
      value: reading(plot.index, f, metric),
    };
  });
  const formatTime = (value: number, long = false) =>
    new Date(value).toLocaleString(locale, {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      ...(long ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    });
  useEffect(() => {
    if (!playing || compare) return;
    const timer = window.setInterval(
      () => setFrame((f) => advanceFrame(f)),
      1000 / speed,
    );
    return () => window.clearInterval(timer);
  }, [playing, speed, compare]);
  useEffect(() => {
    if (frame >= lastFrame) setPlaying(false);
  }, [frame]);
  useEffect(() => {
    document.body.classList.add("digital-plot-route");
    const change = () =>
      setFullscreen(document.fullscreenElement === document.documentElement);
    document.addEventListener("fullscreenchange", change);
    return () => {
      document.removeEventListener("fullscreenchange", change);
      document.body.classList.remove("digital-plot-route");
      if (document.fullscreenElement)
        void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  const jump = (f: number) => {
    setPlaying(false);
    setFrame(Math.max(0, Math.min(lastFrame, f)));
  };
  const toggleFullscreen = async () => {
    setScreenError(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setScreenError(true);
    }
  };
  const flightStyle = (id: string) => {
    const f = flights.find((item) => item.id === id)!;
    return {
      filter: `saturate(${1 + f.saturation}) brightness(${f.brightness})`,
    };
  };
  const moveSplit = (element: HTMLDivElement, clientX: number) => {
    const rect = element.getBoundingClientRect();
    setSplit(
      Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)),
    );
  };
  return (
    <div
      ref={shell}
      className={`digital-plot ${fullscreen ? "is-fullscreen" : ""}`}
      data-screen-label="Digital forest"
    >
      <header className="dp-header">
        <Link to="/atlas" className="dp-back" title={d("back")}>
          <ArrowLeft size={17} />
          <Mountain size={28} />
          <span>{d("category")}</span>
        </Link>
        <div className="dp-title">
          <span>DIGITAL FIELD OBSERVATORY</span>
          <h1>{d("title")}</h1>
        </div>
        <div className="dp-header-tools">
          <span className="dp-demo">{d("demo")}</span>
          <AtlasClock />
          <Button
            variant="ghost"
            onClick={() => void toggleFullscreen()}
            title={d(fullscreen ? "exitFullscreen" : "fullscreen")}
            aria-label={d(fullscreen ? "exitFullscreen" : "fullscreen")}
          >
            {fullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
          </Button>
        </div>
      </header>
      {screenError && (
        <div role="alert" className="dp-screen-error">
          {d("fullscreenError")}
        </div>
      )}
      <div className="dp-scene">
        <aside className="dp-panel dp-directory">
          <header>
            <h2>{d("directory")}</h2>
            <span>08</span>
          </header>
          <div className="dp-plot-list">
            {plots.map((p) => (
              <Button
                variant="ghost"
                key={p.id}
                aria-pressed={selected === p.id}
                className={`dp-plot-row ${selected === p.id ? "is-selected" : ""}`}
                onClick={() => setSelected(p.id)}
              >
                <i
                  style={{
                    background: metricColor(
                      reading(p.index, frame, metric),
                      metric,
                    ),
                  }}
                />
                <b>{p.id}</b>
                <span>{d(`p${p.index}`)}</span>
                <small>{p.area} ha</small>
                <ChevronRight size={13} />
              </Button>
            ))}
          </div>
          <section className="dp-layer-list">
            <h2>
              <Layers3 size={15} />
              {d("layers")}
            </h2>
            {(
              [
                ["boundaries", "boundaries"],
                ["stations", "stationLayer"],
                ["heat", "heat"],
                ["aerial", "aerial"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <span>{d(label)}</span>
                <Switch
                  checked={layers[key]}
                  onCheckedChange={(checked) =>
                    setLayers((previous) => ({ ...previous, [key]: checked }))
                  }
                  aria-label={d(label)}
                />
              </label>
            ))}
            <div className="dp-opacity">
              <span>{d("opacity")}</span>
              <b>{opacity}%</b>
              <Range
                label={d("opacity")}
                value={opacity}
                onChange={setOpacity}
              />
            </div>
            <Button variant="secondary" onClick={() => setReset((n) => n + 1)}>
              <Crosshair size={15} />
              {d("locate")}
            </Button>
          </section>
        </aside>
        <section className="dp-geography" aria-label={d("directory")}>
          <Suspense
            fallback={<div className="dp-map-message">{d("loading")}</div>}
          >
            <DigitalPlotMap
              selected={selected}
              frame={frame}
              metric={metric}
              heatmap={heatmap}
              {...layers}
              opacity={opacity}
              flight={flight}
              reset={reset}
              onSelect={setSelected}
            />
          </Suspense>
          <div className="dp-map-top">
            <div className="dp-statistics">
              {[
                ["area", "128.6", "ha"],
                ["parcels", "08", ""],
                ["stations", "06", ""],
                ["archive", "03", ""],
              ].map(([key, value, unit]) => (
                <div key={key}>
                  <span>{d(key)}</span>
                  <strong>{value}</strong>
                  <small>{unit}</small>
                </div>
              ))}
            </div>
            <div className="dp-metrics" role="group" aria-label={d("legend")}>
              {metrics.map((m) => (
                <Button
                  key={m}
                  variant="ghost"
                  aria-pressed={metric === m}
                  onClick={() => setMetric(m)}
                >
                  {d(m)}
                </Button>
              ))}
            </div>
            <div className="dp-mode">
              <Button
                variant="ghost"
                aria-pressed={!heatmap}
                onClick={() => setHeatmap(false)}
              >
                {d("classification")}
              </Button>
              <Button
                variant="ghost"
                aria-pressed={heatmap}
                onClick={() => setHeatmap(true)}
              >
                {d("heatmap")}
              </Button>
            </div>
            <span className="dp-estimated">
              {d(heatmap ? "estimated" : "parcelEstimate")}
            </span>
          </div>
          {layers.heat && (
            <div className="dp-legend">
              <strong>
                {d(metric)} {spec.unit && `(${spec.unit})`}
              </strong>
              <div>
                <div className="dp-color-ramp" />
                <div className="dp-color-ticks">
                  {[0, 0.25, 0.5, 0.75, 1].map((n) => (
                    <span key={n}>
                      {Number(
                        (spec.min + (spec.max - spec.min) * n).toFixed(
                          spec.digits,
                        ),
                      )}
                    </span>
                  ))}
                </div>
              </div>
              <small>{d(heatmap ? "heatmap" : "classification")}</small>
            </div>
          )}
        </section>
        <aside className="dp-panel dp-inspector">
          <header>
            <div>
              <span className="dp-eyebrow">SELECTED PARCEL</span>
              <h2>
                {selected} · {d(`p${plot.index}`)}
              </h2>
              <small>
                {plot.area} ha <span>/</span>{" "}
                {plot.station
                  ? `${d("station")} ${demoStations.find((s) => s.plot.id === plot.id)?.id}`
                  : d("noStation")}
              </small>
            </div>
            <RadioTower size={18} />
          </header>
          <div className="dp-readings">
            {metrics.map((m) => (
              <div key={m}>
                {m === "moisture" ? (
                  <Droplets size={23} />
                ) : m === "temperature" ? (
                  <Thermometer size={23} />
                ) : m === "rainfall" ? (
                  <CloudRain size={23} />
                ) : (
                  <Leaf size={23} />
                )}
                <span>{d(m)}</span>
                <strong>
                  {reading(plot.index, frame, m).toFixed(metricSpecs[m].digits)}
                  <small>{metricSpecs[m].unit}</small>
                </strong>
              </div>
            ))}
          </div>
          <section className="dp-trend">
            <h3>
              {d(metric)} · {d("trend")}
            </h3>
            <div className="dp-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chart}
                  margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="dp-area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#40d9d2" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#40d9d2" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#29404d" strokeDasharray="2 4" />
                  <XAxis
                    dataKey="time"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(value) => formatTime(value)}
                    tick={{ fill: "#9db7c4", fontSize: 10 }}
                    tickCount={3}
                    minTickGap={25}
                  />
                  <YAxis
                    width={36}
                    domain={[spec.min, spec.max]}
                    tick={{ fill: "#9db7c4", fontSize: 10 }}
                    tickCount={3}
                  />
                  <Tooltip
                    labelFormatter={(value) => formatTime(Number(value), true)}
                    formatter={(value) => [`${value} ${spec.unit}`, d(metric)]}
                    contentStyle={{
                      background: "#102b36",
                      border: "1px solid #355364",
                      color: "#e2f5f7",
                      fontSize: 12,
                    }}
                  />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="value"
                    stroke="#4adfdb"
                    fill="url(#dp-area)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <small>{d("trendHint")}</small>
          </section>
          <section className="dp-imagery">
            <h3>
              {d("imagery")} <small>{flight?.date ?? "—"}</small>
            </h3>
            <div className="dp-image-preview">
              {flight && (
                <img
                  src={orthophoto}
                  alt={d("imageHint")}
                  style={flightStyle(flight.id)}
                />
              )}
              <span>
                {flight ? `RGB · ${flight.resolution} cm/px*` : d("noFlight")}
              </span>
            </div>
            <small>{d("resolutionHint")}</small>
            <SelectInput
              value={flightId}
              aria-label={d("flight")}
              onValueChange={(id) => {
                setFlightId(id);
                setLayers((v) => ({ ...v, aerial: true }));
              }}
            >
              <option value="auto">{d("follow")}</option>
              {flights.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.date} · {d("demo")}
                </option>
              ))}
            </SelectInput>
            <Button
              variant="secondary"
              onClick={() => {
                setPlaying(false);
                setCompare(true);
              }}
            >
              {d("compare")}
            </Button>
            <small>{d(flightId === "auto" ? "sourceDate" : "pinned")}</small>
          </section>
        </aside>
      </div>
      <section className="dp-panel dp-playback" aria-label={d("history")}>
        <div className="dp-playback-heading">
          <h2>{d("history")}</h2>
          <span>
            <i />
            {d("archive")}
          </span>
        </div>
        <div className="dp-transport">
          <label>
            <span>{d("time")}</span>
            <Input
              type="datetime-local"
              value={inputDate(frame)}
              min={inputDate(0)}
              max={inputDate(lastFrame)}
              onChange={(event) => {
                const f = dateFrame(event.target.value);
                if (f !== undefined) jump(f);
              }}
            />
          </label>
          <div className="dp-play-buttons">
            <Button
              variant="ghost"
              aria-label={d("restart")}
              title={d("restart")}
              onClick={() => jump(0)}
            >
              <SkipBack size={16} />
            </Button>
            <Button
              variant="ghost"
              aria-label={d("previous")}
              disabled={frame === 0}
              onClick={() => jump(frame - 1)}
            >
              <StepBack size={16} />
            </Button>
            <Button
              className="dp-play"
              aria-label={d(playing ? "pause" : "play")}
              onClick={() => {
                if (!playing && frame === lastFrame) setFrame(0);
                setPlaying((v) => !v);
              }}
            >
              {playing ? <Pause size={19} /> : <Play size={19} />}
            </Button>
            <Button
              variant="ghost"
              aria-label={d("next")}
              disabled={frame === lastFrame}
              onClick={() => jump(frame + 1)}
            >
              <StepForward size={16} />
            </Button>
          </div>
          <div className="dp-timeline">
            <output
              className="dp-current-time"
              style={{
                left: `${Math.min(88, Math.max(12, (frame / lastFrame) * 100))}%`,
              }}
            >
              {inputDate(frame).replace("T", " ")}
            </output>
            <Range
              label={d("scrub")}
              max={lastFrame}
              value={frame}
              onChange={jump}
            />
            <div className="dp-flight-markers">
              {flights.map((f) => (
                <button
                  key={f.id}
                  style={{ left: `${(f.frame / lastFrame) * 100}%` }}
                  title={`${d("flightMarker")} ${f.date}`}
                  aria-label={`${d("flightMarker")} ${f.date}`}
                  onClick={() => jump(f.frame)}
                >
                  ◆
                </button>
              ))}
            </div>
            <div className="dp-dates">
              {Array.from({ length: 7 }, (_, i) => (
                <button
                  key={i}
                  onClick={() => jump(i * 24)}
                  aria-current={
                    Math.floor(frame / 24) === i ? "date" : undefined
                  }
                >
                  10/{String(i + 2).padStart(2, "0")}
                </button>
              ))}
            </div>
          </div>
          <SelectInput
            value={String(speed)}
            aria-label={d("speed")}
            onValueChange={(v) => setSpeed(Number(v))}
          >
            {[1, 2, 4].map((s) => (
              <option key={s} value={String(s)}>
                {s}×
              </option>
            ))}
          </SelectInput>
        </div>
      </section>
      <footer className="dp-footer">
        <span>{d("disclaimer")}</span>
        <a
          href="https://openaerialmap.org/about/"
          target="_blank"
          rel="noreferrer"
        >
          BSU / Open Imagery Network · CC BY 4.0
        </a>
      </footer>
      <Dialog open={compare} onOpenChange={setCompare}>
        <DialogContent className="dp-compare-dialog">
          <DialogHeader>
            <DialogTitle>{d("compareTitle")}</DialogTitle>
            <DialogDescription>{d("compareHint")}</DialogDescription>
          </DialogHeader>
          <div className="dp-compare-selectors">
            <SelectInput
              value={before}
              aria-label={d("before")}
              onValueChange={setBefore}
            >
              {flights.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.date} · A
                </option>
              ))}
            </SelectInput>
            <SelectInput
              value={after}
              aria-label={d("after")}
              onValueChange={setAfter}
            >
              {flights.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.date} · B
                </option>
              ))}
            </SelectInput>
          </div>
          <div
            className="dp-compare-stage"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              moveSplit(e.currentTarget, e.clientX);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                moveSplit(e.currentTarget, e.clientX);
            }}
          >
            <img
              draggable={false}
              src={orthophoto}
              alt={d("after")}
              style={flightStyle(after)}
            />
            <img
              draggable={false}
              src={orthophoto}
              alt={d("before")}
              style={{
                ...flightStyle(before),
                clipPath: `inset(0 ${100 - split}% 0 0)`,
              }}
            />
            <div className="dp-compare-line" style={{ left: `${split}%` }}>
              <span>↔</span>
            </div>
            <span className="dp-compare-a">
              A · {flights.find((f) => f.id === before)?.date}
            </span>
            <span className="dp-compare-b">
              B · {flights.find((f) => f.id === after)?.date}
            </span>
          </div>
          <Range label={d("split")} value={split} onChange={setSplit} />
          <small>{d("sourceDate")}</small>
        </DialogContent>
      </Dialog>
    </div>
  );
}
