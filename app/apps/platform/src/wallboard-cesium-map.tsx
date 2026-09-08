import { useEffect, useRef } from "react";
import {
  Cartesian2,
  Cartesian3,
  Color,
  ConstantProperty,
  DistanceDisplayCondition,
  Entity,
  HeadingPitchRange,
  HorizontalOrigin,
  LabelStyle,
  Math as CesiumMath,
  NearFarScalar,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  Viewer,
  WebMapTileServiceImageryProvider,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { WallboardDevice } from "@thcpn/api";

type Props = {
  devices: WallboardDevice[];
  mode: "single" | "multi";
  selectedDeviceId?: string;
  onSelectDevice?: (id: string) => void;
};

const CHINA_VIEW = Cartesian3.fromDegrees(104, 35, 6_500_000);

export function WallboardCesiumMap({ devices, mode, selectedDeviceId, onSelectDevice }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const onSelectRef = useRef(onSelectDevice);
  onSelectRef.current = onSelectDevice;
  const token = import.meta.env.VITE_TIANDITU_TOKEN?.trim();

  useEffect(() => {
    if (!hostRef.current || !token) return;
    const viewer = new Viewer(hostRef.current, {
      animation: false,
      baseLayer: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      shouldAnimate: true,
    });
    viewerRef.current = viewer;
    viewer.scene.globe.baseColor = Color.fromCssColorString("#101518");
    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.showGroundAtmosphere = true;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    viewer.scene.fog.enabled = true;
    viewer.imageryLayers.addImageryProvider(tiandituProvider("img_w", token));
    viewer.imageryLayers.addImageryProvider(tiandituProvider("cia_w", token));
    viewer.camera.setView({ destination: Cartesian3.fromDegrees(104, 35, 20_000_000) });

    const validDevices = devices.filter(hasCoordinates);
    validDevices.forEach((device) => viewer.entities.add(deviceEntity(device, device.id === selectedDeviceId, mode)));
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((event: { position: Cartesian2 }) => {
      const picked = viewer.scene.pick(event.position);
      const id = picked?.id instanceof Entity ? picked.id.id : undefined;
      if (id) onSelectRef.current?.(id);
    }, ScreenSpaceEventType.LEFT_CLICK);

    let rotating = true;
    const rotate = () => {
      if (rotating && viewer.camera.positionCartographic.height > 4_000_000) {
        viewer.scene.camera.rotate(Cartesian3.UNIT_Z, -0.00008);
      }
    };
    viewer.clock.onTick.addEventListener(rotate);
    const intro = window.setTimeout(() => {
      rotating = false;
      flyToDevices(viewer, validDevices, mode);
    }, 1800);

    return () => {
      window.clearTimeout(intro);
      handler.destroy();
      viewer.clock.onTick.removeEventListener(rotate);
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [devices, mode, token]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const device of devices) {
      const point = viewer.entities.getById(device.id)?.point;
      if (!point) continue;
      const selected = device.id === selectedDeviceId;
      point.pixelSize = new ConstantProperty(selected ? 15 : 11);
      point.outlineWidth = new ConstantProperty(selected ? 4 : 2);
      point.outlineColor = new ConstantProperty(selected ? Color.WHITE : markerColor(device).withAlpha(0.55));
    }
  }, [devices, selectedDeviceId]);

  if (!token) return <div className="wallboard-map-error">未配置 VITE_TIANDITU_TOKEN，无法加载天地图影像和注记。</div>;
  return <div ref={hostRef} className="wallboard-cesium" data-testid="wallboard-cesium" />;
}

function tiandituProvider(path: "img_w" | "cia_w", token: string) {
  return new WebMapTileServiceImageryProvider({
    url: `https://t{s}.tianditu.gov.cn/${path}/wmts?tk=${encodeURIComponent(token)}`,
    layer: path === "img_w" ? "img" : "cia",
    style: "default",
    format: "tiles",
    tileMatrixSetID: "w",
    tileMatrixLabels: Array.from({ length: 18 }, (_, index) => String(index)),
    subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"],
    maximumLevel: 18,
  });
}

function hasCoordinates(device: WallboardDevice): device is WallboardDevice & { latitude: number; longitude: number } {
  return Number.isFinite(device.latitude) && Number.isFinite(device.longitude);
}

function deviceEntity(device: WallboardDevice & { latitude: number; longitude: number }, selected: boolean, mode: Props["mode"]) {
  const color = markerColor(device);
  return new Entity({
    id: device.id,
    position: Cartesian3.fromDegrees(device.longitude, device.latitude, 40),
    point: {
      color,
      outlineColor: selected ? Color.WHITE : color.withAlpha(0.55),
      outlineWidth: selected ? 4 : 2,
      pixelSize: selected ? 15 : 11,
      scaleByDistance: new NearFarScalar(2_000, 1.35, 8_000_000, 0.65),
      distanceDisplayCondition: new DistanceDisplayCondition(0, 12_000_000),
    },
    label: {
      text: mode === "single" ? `${device.name}\n${statusText(device)}` : device.name,
      font: "500 14px sans-serif",
      fillColor: Color.WHITE,
      outlineColor: Color.BLACK.withAlpha(0.8),
      outlineWidth: 3,
      style: LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cartesian2(0, -22),
      horizontalOrigin: HorizontalOrigin.CENTER,
      verticalOrigin: VerticalOrigin.BOTTOM,
      scaleByDistance: new NearFarScalar(5_000, 1, 5_000_000, 0.55),
      distanceDisplayCondition: new DistanceDisplayCondition(0, 6_000_000),
    },
  });
}

function markerColor(device: WallboardDevice) {
  if (device.runtime_error) return Color.fromCssColorString("#b67cff");
  if (device.status === "alarm" || device.status === "warning") return Color.fromCssColorString("#ff4d5e");
  if (device.status === "online" || device.status === "active") return Color.fromCssColorString("#49e29f");
  return Color.fromCssColorString("#8b99a8");
}

function statusText(device: WallboardDevice) {
  if (device.runtime_error) return "运行信息不可用";
  if (device.status === "online" || device.status === "active") return `在线 · 电量 ${device.battery ?? "--"}%`;
  return "离线";
}

export function deviceViewRectangle(devices: WallboardDevice[]) {
  const valid = devices.filter(hasCoordinates);
  if (!valid.length) return null;
  return {
    west: Math.min(...valid.map((item) => item.longitude)),
    south: Math.min(...valid.map((item) => item.latitude)),
    east: Math.max(...valid.map((item) => item.longitude)),
    north: Math.max(...valid.map((item) => item.latitude)),
  };
}

function flyToDevices(viewer: Viewer, devices: Array<WallboardDevice & { latitude: number; longitude: number }>, mode: Props["mode"]) {
  if (!devices.length) {
    viewer.camera.flyTo({ destination: CHINA_VIEW, duration: 2.2 });
    return;
  }
  if (mode === "single" || devices.length === 1) {
    const device = devices[0];
    viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(device.longitude, device.latitude, 180_000), duration: 2.4 });
    return;
  }
  const entities = devices.map((device) => viewer.entities.getById(device.id)).filter((entity): entity is Entity => Boolean(entity));
  void viewer.flyTo(entities, { duration: 2.5, offset: new HeadingPitchRange(0, CesiumMath.toRadians(-65), 0) });
}
