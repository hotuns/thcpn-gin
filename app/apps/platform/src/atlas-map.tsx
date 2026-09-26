import { useMemo } from "react";
import { DeviceMap, tiandituImageryStyle } from "@thcpn/device-map";
import type { DeviceMapItem } from "@thcpn/api";
import { located } from "./atlas-model";

export function AtlasMap({
  points,
  selectedId,
  onSelect,
  reset,
}: {
  points: DeviceMapItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  reset: number;
}) {
  const token = import.meta.env.VITE_TIANDITU_TOKEN?.trim();
  const style = useMemo(() => {
    if (!token) return undefined;
    const base = tiandituImageryStyle(token);
    return {
      ...base,
      layers: base.layers.map((layer) =>
        layer.type === "raster" && layer.id === "tianditu-imagery"
          ? {
              ...layer,
              paint: {
                "raster-saturation": -0.6,
                "raster-brightness-max": 0.6,
                "raster-contrast": 0.2,
              },
            }
          : layer,
      ),
    };
  }, [token]);
  const markers = useMemo(
    () =>
      points
        .filter(located)
        .map((d) => ({
          device_id: d.device_id,
          name: d.name,
          device_type: d.device_type,
          status: d.status,
          latitude: d.latitude,
          longitude: d.longitude,
        })),
    [points],
  );
  return (
    <DeviceMap
      key={reset}
      height="100%"
      showNavigation={false}
      points={markers}
      onSelect={onSelect}
      selectedDeviceId={selectedId}
      mapStyle={style}
      styleUrl={!token ? import.meta.env.VITE_MAP_STYLE_URL : undefined}
    />
  );
}
