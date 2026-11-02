import type { NodeRuntime, LoRaWANV2GatewayInfo, TelemetrySeries } from "./index";
export const statusMetrics = {
  battery: {label:"电池电压",unit:"V",digits:2},
  rssi: {label:"信号强度",unit:"dBm",digits:0},
  sd_card_rate: {label:"SD 卡使用率",unit:"%",digits:1},
  snr: {label:"信噪比",unit:"dB",digits:1},
  cell: {label:"信号质量",unit:"CSQ",digits:0},
} as const;
export type StatusMetric = keyof typeof statusMetrics;
export type StatusSnapshot = {values:Partial<Record<StatusMetric,number>>;sampledAt?:string;history:Record<string,string>;error?:string};
export const nodeStatusKeys:StatusMetric[]=["battery","rssi","sd_card_rate","snr"];
export const gatewayStatusKeys:StatusMetric[]=["battery","cell"];
export function statusValue(key:StatusMetric,value?:number){
  if(value==null || !Number.isFinite(value))return "—";
  if(key==="cell" && (value<0 || value>31))return "未知";
  return `${value.toFixed(statusMetrics[key].digits)} ${statusMetrics[key].unit}`;
}
export function runtimeInfoTime(ts?:Record<string,unknown>){
  const date=ts?.$date;
  const value=typeof date==="object"&&date?(date as Record<string,unknown>).$numberLong:date;
  const ms=typeof value==="string"&&!/^\d+$/.test(value)?Date.parse(value):Number(value);
  return Number.isFinite(ms)&&ms>0?new Date(ms).toISOString():undefined;
}
export function nodeSnapshot(item?:NodeRuntime):StatusSnapshot {
  return {values:{battery:item?.battery,rssi:item?.rssi,sd_card_rate:item?.sd_card_rate,snr:item?.snr},sampledAt:item?.sampled_at,history:item?.history_stream_ids??{},error:item?.error};
}
export function gatewaySnapshot(info?:LoRaWANV2GatewayInfo|null):StatusSnapshot {
  return {values:{battery:info?.battery,cell:info?.cell},sampledAt:runtimeInfoTime(info?.ts),history:info?.history_stream_ids??{}};
}
export function statusHistory(series:TelemetrySeries[],key:StatusMetric){
  return series.map(item=>({...item,name:statusMetrics[key].label,unit:statusMetrics[key].unit,points:key==="cell"?item.points.filter(point=>point.value>=0&&point.value<=31):item.points}));
}
