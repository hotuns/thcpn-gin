import {
  Activity,
  BatteryMedium,
  Gauge,
  Leaf,
  RadioTower,
  Ruler,
  Sun,
  Thermometer,
  Waves,
  Wind,
} from "lucide-react";

// Units are reliable; an unfamiliar metric keeps the neutral observation icon.
export function ObservationIcon({
  unit = "",
  size = 16,
}: {
  unit?: string;
  size?: number;
}) {
  const Icon =
    (
      {
        v: BatteryMedium,
        "°c": Thermometer,
        "℃": Thermometer,
        hpa: Gauge,
        kpa: Gauge,
        "m/s": Wind,
        dbm: RadioTower,
        lux: Sun,
        klux: Sun,
        mm: Ruler,
        ndvi: Leaf,
        "%": Waves,
      } as Record<string, typeof Activity>
    )[unit.toLowerCase()] ?? Activity;
  return <Icon size={size} aria-hidden="true" className="observation-icon" />;
}
