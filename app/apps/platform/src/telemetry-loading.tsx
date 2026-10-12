/** Shared with standard stations; visible during initial loads and refetches. */
export function TelemetryLoading() {
  return <div className="telemetry-loading" role="status" aria-label="正在生成数据趋势" aria-busy="true">
    <div className="telemetry-loading-head" aria-hidden="true"><span/><span/></div>
    <div className="telemetry-loading-stats" aria-hidden="true"><span/><span/><span/><span/></div>
    <div className="telemetry-loading-chart" aria-hidden="true"><i/><i/><i/><i/><i/><i/></div>
    <div className="telemetry-loading-caption">正在读取并整理时间序列…</div>
  </div>;
}
