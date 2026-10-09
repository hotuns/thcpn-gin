import { useQuery } from "@tanstack/react-query";
import { api, type NodeRuntime } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Battery, Signal, SignalLow, SignalMedium, SignalHigh } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./platform-ui";

export function useNodeRuntime(workspaceId: string, deviceId: string) {
  return useQuery({ queryKey: workspaceQueryKey(workspaceId, "device", deviceId, "node-runtime"), queryFn: () => api.devices.nodeRuntime(deviceId), staleTime: 60_000, refetchInterval: 60_000, retry: false });
}

export function NodeVitals({ item, loading, error }: { item?: NodeRuntime; loading?: boolean; error?: boolean }) {
  const stale = item?.sampled_at ? Date.now() - Date.parse(item.sampled_at) > 86400000 : true;
  const signal = item?.rssi;
  // Positive THCPN signal values are not assumed to be LoRa RSSI or CSQ.
  const Icon = signal == null || signal >= 0 ? Signal : signal >= -80 ? SignalHigh : signal >= -100 ? SignalMedium : SignalLow;
  const failed = error || Boolean(item?.error);
  return <TooltipProvider><Tooltip><TooltipTrigger asChild><span tabIndex={0} className={`node-vitals ${stale || failed ? "is-stale" : ""}`}>
    <span><Battery size={17}/>{loading ? "…" : failed || item?.battery == null ? "—" : `${item.battery.toFixed(2)} V`}</span>
    <span><Icon size={17}/>{loading ? "…" : failed || signal == null ? "—" : `${signal}${signal < 0 ? " dBm" : ""}`}</span>
  </span></TooltipTrigger><TooltipContent>
    {failed ? "节点状态读取失败" : loading ? "正在读取节点状态" : <><div>{stale ? "上次读数" : "最近读数"}：{item?.sampled_at ? new Date(item.sampled_at).toLocaleString() : "暂无数据"}</div><div>SNR：{item?.snr == null ? "—" : `${item.snr} dB`}</div><div>电量显示实测电压，不估算百分比。</div></>}
  </TooltipContent></Tooltip></TooltipProvider>;
}
