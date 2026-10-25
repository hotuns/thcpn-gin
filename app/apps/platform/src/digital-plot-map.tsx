// SPDX-License-Identifier: GPL-3.0-or-later
// 作者全平台ID：宋夏天Dazzle；公众号：送你整个夏天
// React integration of three-scope-map-skill; terminal synthetic parcel scope.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLocale } from "@thcpn/i18n";
import { Download, Mountain, Map as MapIcon } from "lucide-react";
import { exportCanvas } from "./map-tools-model";
import { Button } from "./platform-ui";
import { plots } from "./digital-plot-model";
import { DigitalPlotScene, type DigitalPlotMapProps } from "./digital-plot-scene";
import { mapThemeStyle } from "./vendor/three-scope-map/mapTheme";
import "./digital-plot-three.css";

export function DigitalPlotMap(props: DigitalPlotMapProps) {
  const { t } = useLocale();
  const d = (key: string) => t(`digitalPlot.${key}`);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<DigitalPlotScene | null>(null);
  const [tilted, setTilted] = useState(true);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState("");
  const [imageError, setImageError] = useState<"" | "fallback" | "unavailable">("");
  const [attempt, setAttempt] = useState(0);
  const state = { ...props, tilted, names: plots.map(plot => d(`p${plot.index}`)), stationLabel: d("station") };
  const current = useRef(state);
  current.current = state;

  useEffect(() => {
    if (!host.current) return;
    setReady(false);
    setFailure("");
    setImageError("");
    try {
      scene.current = new DigitalPlotScene(host.current, current.current, {
        ready: () => setReady(true),
        imageError: () => setImageError("unavailable"),
        imageFallback: () => setImageError("fallback"),
        contextLost: () => setFailure("WebGL context lost"),
      });
    } catch (error) {
      setFailure(error instanceof Error ? error.message.slice(0, 180) : "WebGL renderer unavailable");
    }
    return () => { scene.current?.dispose(); scene.current = null; };
  }, [attempt, props.parcels]);
  useEffect(() => { scene.current?.update(current.current); }, [props, tilted, t]);

  return <div className="dp-map-container dp-three-container" style={mapThemeStyle as CSSProperties}>
    <div ref={host} className="dp-map-canvas dp-three-map-host" aria-label={d("directory")} />
    <div className="observatory-view-controls dp-three-controls">
      <Button variant="ghost" disabled={!ready || !!failure} aria-pressed={tilted} onClick={() => setTilted(value => !value)} title={d("threeControls")}>
        {tilted ? <Mountain size={14} /> : <MapIcon size={14} />}
        {d(tilted ? "threePerspective" : "threePlan")}
      </Button>
      <small>{d("threeControls")}</small>
      <Button variant="ghost" disabled={!ready || !!failure} onClick={async () => { try { if (scene.current) await exportCanvas(scene.current.snapshot(), "digital-plot-3d.png", "红柳林数字样地 · 边界/设备/指标为模拟 · 用户提供正射影像"); } catch { setFailure("三维场景截图失败"); } }}><Download size={14} />导出三维地图</Button>
    </div>
    {!ready && !failure && <div className="dp-map-message" role="status">{d("loading")}</div>}
    {failure && <div className="dp-map-message" role="alert">
      <strong>{d("mapError")}</strong><code>{failure}</code>
      <Button onClick={() => setAttempt(value => value + 1)}>{d("retry")}</Button>
    </div>}
    {imageError && <small className="dp-map-warning" role="status">{d(imageError === "fallback" ? "aerialUnavailable" : "threeImageError")}</small>}
  </div>;
}
