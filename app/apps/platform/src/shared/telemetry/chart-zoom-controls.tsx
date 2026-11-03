import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "../ui";
import type { useChartZoom } from "./chart-zoom";
import "./telemetry-mobile.css";

export function ChartZoomControls({ zoom }: { zoom: ReturnType<typeof useChartZoom> }) {
  return <div className="telemetry-zoom-controls" role="group" aria-label="图表缩放">
    <Button variant="secondary" aria-label="放大图表" disabled={!zoom.canZoomIn} onClick={zoom.zoomIn}><Plus size={16}/>放大</Button>
    <Button variant="secondary" aria-label="缩小图表" disabled={!zoom.canZoomOut} onClick={zoom.zoomOut}><Minus size={16}/>缩小</Button>
    <Button variant="secondary" aria-label="重置图表缩放" disabled={!zoom.canZoomOut} onClick={zoom.resetZoom}><RotateCcw size={16}/>重置</Button>
  </div>;
}
