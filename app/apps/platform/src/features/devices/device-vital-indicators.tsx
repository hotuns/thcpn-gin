import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../shared/ui/primitives/tooltip";
import { Battery, BatteryLow, BatteryMedium, BatteryFull, BatteryWarning, Signal, SignalZero, SignalLow, SignalMedium, SignalHigh } from "lucide-react";
import { type THCPNLatestAttributesResponse } from "@thcpn/api";
import { inferBatteryReading, numericAttributeValue, inferSignalReading, csqSignalBars } from "./device-model";

export function DeviceVitalIndicators({
  attributes,
  loading = false,
  csq = false,
  lithiumVoltage = false,
  signalCsq = csq,
  batteryValue,
  signalValue,
}: {
  attributes?: THCPNLatestAttributesResponse["attributes"];
  loading?: boolean;
  csq?: boolean;
  lithiumVoltage?: boolean;
  signalCsq?: boolean;
  batteryValue?: number | null;
  signalValue?: number | null;
}) {
  const battery = inferBatteryReading(
    loading ? null : batteryValue !== undefined ? batteryValue : numericAttributeValue(attributes?.battery),
    csq,
    lithiumVoltage,
  );
  const signal = inferSignalReading(
    loading ? null : signalValue !== undefined ? signalValue : numericAttributeValue(attributes?.signal),
    signalCsq,
  );
  const bars = csqSignalBars(loading ? null : signalValue !== undefined ? signalValue : numericAttributeValue(attributes?.signal));
  const SignalIcon = signalCsq ? [SignalZero, SignalLow, SignalMedium, SignalHigh, Signal][bars ?? 0] : Signal;
  const BatteryIcon = csq ? ({ unknown: Battery, critical: BatteryWarning, low: BatteryLow, fair: BatteryMedium, good: BatteryFull })[battery.level] : Battery;
  return (
    <TooltipProvider delayDuration={200}><div className={`device-vitals device-vitals-refined ${loading ? "loading" : ""}`}>
      <Tooltip><TooltipTrigger asChild><span
        tabIndex={0}
        className={`device-vital ${battery.level}`}
        aria-label={loading ? "正在读取电量" : battery.description}
      >
        {loading ? <small aria-hidden="true">…</small> : battery.valueLabel === "—" ? <small aria-hidden="true">?</small> : <BatteryIcon size={20} aria-hidden="true" />}
      </span></TooltipTrigger><TooltipContent className="device-vital-tooltip">
        <div><strong>电池</strong><b>{loading ? "…" : battery.valueLabel}</b></div>
        <p>{loading ? "正在读取电量" : battery.description}</p>
      </TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger asChild><span
        tabIndex={0}
        className={`device-vital ${signal.level}`}
        aria-label={loading ? "正在读取信号" : signal.description}
      >
        {loading ? <small aria-hidden="true">…</small> : signal.level === "unknown" ? <small aria-hidden="true">?</small> : <SignalIcon size={20} aria-hidden="true" />}
      </span></TooltipTrigger><TooltipContent className="device-vital-tooltip">
        <div><strong>信号</strong><b>{loading ? "…" : signal.valueLabel}</b></div>
        <p>{loading ? "正在读取信号" : signal.description}</p>
      </TooltipContent></Tooltip>
    </div></TooltipProvider>
  );
}
