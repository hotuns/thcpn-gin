import { DatePicker, Space, Button } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useLocale } from "@thcpn/i18n";
import type { ReactNode, CSSProperties } from "react";
import { useAdminMobile } from "./admin-mobile";

export function AdminTimeRange({ value, onChange, presets, style }: {
  value: [Dayjs, Dayjs] | null;
  onChange: (value: [Dayjs, Dayjs] | null) => void;
  presets?: { label: ReactNode; value: [Dayjs, Dayjs] }[];
  style?: CSSProperties;
}) {
  const mobile = useAdminMobile();
  const { t } = useLocale();
  if (!mobile) return <DatePicker.RangePicker showTime value={value} onChange={next => onChange(next?.[0] && next[1] ? [next[0], next[1]] : null)} presets={presets} style={{ width: "min(420px, 100%)", ...style }} />;
  const labels = [t("mobile.startTime"), t("mobile.endTime")];
  return <div className="admin-time-range" style={style}>
    {labels.map((label, index) => <label key={index}>
      <span>{label}</span>
      <DatePicker showTime allowClear={false} aria-label={label} value={value?.[index] ?? null} onChange={next => {
        if (!next) return;
        onChange(index === 0 ? [next, value?.[1] ?? dayjs()] : [value?.[0] ?? dayjs().subtract(24, "hour"), next]);
      }} />
    </label>)}
    {presets && <Space wrap>{presets.map((preset, index) => <Button key={index} size="small" onClick={() => onChange(preset.value)}>{preset.label}</Button>)}</Space>}
  </div>;
}
