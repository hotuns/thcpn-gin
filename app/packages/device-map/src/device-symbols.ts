/** Local, network-independent cartographic symbol system. The tip is the location. */
export const deviceKinds = ["standard", "gateway", "node", "camera", "carbon", "sensor", "unknown"] as const;
export type DeviceKind = typeof deviceKinds[number];
export type SymbolState = "active" | "inactive" | "alert" | "unknown";
export const deviceKindLabels: Record<DeviceKind, string> = { standard: "标准站", gateway: "网关", node: "节点", camera: "摄像设备", carbon: "碳汇站", sensor: "独立传感器", unknown: "其他设备" };
export const symbolStates: Record<SymbolState, { label: string; color: string }> = {
  active: { label: "已启用", color: "#26c6a0" }, inactive: { label: "已停用", color: "#768697" },
  alert: { label: "异常/预警", color: "#ff8266" }, unknown: { label: "状态未知", color: "#e5b75b" },
};
export function deviceKind(type: string): DeviceKind {
  if (["standard", "standard_station", "station", "standalone"].includes(type)) return "standard";
  if (["gateway", "lorawan_v2", "lorawanv2"].includes(type)) return "gateway";
  if (["node", "gateway_node"].includes(type)) return "node";
  if (["camera", "video"].includes(type)) return "camera";
  if (["carbon", "carbon_station", "carbon_sink"].includes(type)) return "carbon";
  if (type === "sensor") return "sensor";
  return "unknown";
}
export function symbolState(status: string): SymbolState {
  if (["active", "enabled", "online"].includes(status)) return "active";
  if (["inactive", "disabled", "offline"].includes(status)) return "inactive";
  if (["error", "alert", "fault"].includes(status)) return "alert";
  return "unknown";
}
const glyph: Record<DeviceKind, string> = {
  standard: '<path d="M18 28h28M25 28v19m14-19v19M20 47h24M32 18v10m-6-5h12M21 36h22"/><circle cx="32" cy="16" r="3"/>',
  gateway: '<path d="M32 29v17m-8 0h16M24 34a11 11 0 0 1 0-16m16 0a11 11 0 0 1 0 16M19 39a18 18 0 0 1 0-26m26 0a18 18 0 0 1 0 26"/><circle cx="32" cy="25" r="3"/>',
  node: '<rect x="22" y="23" width="20" height="19" rx="4"/><path d="M32 17v6m-12 8h-5m34 0h-5M27 28h10m-10 8h5"/>',
  camera: '<rect x="17" y="24" width="30" height="21" rx="4"/><path d="m23 24 3-6h12l3 6"/><circle cx="32" cy="34" r="6"/>',
  carbon: '<path d="M19 40c-2-18 9-22 27-21 1 18-10 27-24 24m2-4 16-13M24 39l-4 9"/><path d="m28 35 1-8m5 2 7 1"/>',
  sensor: '<rect x="24" y="17" width="16" height="29" rx="7"/><path d="M32 23v13"/><circle cx="32" cy="39" r="3"/>',
  unknown: '<path d="m32 17 14 8v16l-14 8-14-8V25zM18 25l14 8 14-8M32 33v16"/>',
};
export function deviceSymbolId(type: string, status: string, selected = false) { return `eco-${deviceKind(type)}-${symbolState(status)}-${selected ? "selected" : "normal"}`; }
export function deviceSymbolSvg(kind: DeviceKind, state: SymbolState, selected = false) {
  const color = symbolStates[state].color;
  const outline = selected ? "#75eaff" : "#d7ecf2";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="80" viewBox="0 0 64 80"><path d="M32 78 27 67h10z" fill="${outline}"/><path d="M32 61v16" stroke="${outline}" stroke-width="2"/><path d="M32 3 57 17v29L32 61 7 46V17z" fill="#092638" stroke="${outline}" stroke-width="${selected ? 3 : 1.5}"/>${selected ? '<path d="M32 8 52 20v23L32 55 12 43V20z" fill="none" stroke="#39c9f5" stroke-opacity=".6"/>' : ""}<g fill="none" stroke="#eefbff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${glyph[kind]}</g><circle cx="52" cy="14" r="7" fill="${color}" stroke="#092638" stroke-width="2"/>${state === "alert" ? '<path d="M52 10v4m0 3v.1" stroke="#092638" stroke-width="2" stroke-linecap="round"/>' : state === "inactive" ? '<path d="M49 14h6" stroke="#fff" stroke-width="2"/>' : state === "unknown" ? '<path d="M50 12a2 2 0 1 1 3 2l-1 1m0 2v.1" stroke="#092638" fill="none" stroke-width="1.5"/>' : ""}<circle cx="32" cy="78" r="2" fill="${color}"/></svg>`;
}
export async function rasterizeDeviceSymbol(svg: string): Promise<ImageData> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Device symbol canvas unavailable");
  ctx.drawImage(image, 0, 0, 128, 160);
  return ctx.getImageData(0, 0, 128, 160);
}
