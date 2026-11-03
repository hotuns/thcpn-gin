import { useId } from "react";
import { Button } from "../ui";
import "./mobile-map.css";

/** A non-modal panel switcher: the map stays mounted and usable above the panel. */
export function MobileMapPanels({ value, onChange, options }: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
}) {
  const id = useId();
  return <nav className="mobile-map-panels" aria-label="地图面板">
    <Button variant="secondary" aria-pressed={!value} onClick={() => onChange("")}>地图</Button>
    {options.map(option => <Button key={`${id}:${option.value}`} variant="secondary" disabled={option.disabled} aria-expanded={value === option.value} onClick={() => onChange(value === option.value ? "" : option.value)}>{option.label}</Button>)}
  </nav>;
}
