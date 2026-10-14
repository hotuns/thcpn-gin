import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale } from "@thcpn/i18n";
import { api, formatApiError, type GatewayNode } from "@thcpn/api";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Input } from "./platform-ui";

export function NodeLocationEditor({ gatewayId, node }: { gatewayId: string; node: GatewayNode }) {
  const client = useQueryClient();
  const { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const [open, setOpen] = useState(false);
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = lat !== "" && lon !== "" && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180;
  const save = async (clear = false) => {
    if (!clear && !valid) return;
    setBusy(true); setError("");
    try {
      await api.devices.updateNodeLocation(gatewayId, node.target.kind === "gateway_node" ? node.target.node_index : 0, clear ? { latitude: null, longitude: null } : { latitude: Number(lat), longitude: Number(lon) });
      await client.invalidateQueries({ predicate: query => (query.queryKey.includes("nodes") && query.queryKey.includes(gatewayId)) || query.queryKey.includes("device-map") });
      setOpen(false);
    } catch (e) { setError(formatApiError(e).message); } finally { setBusy(false); }
  };
  return <><Button variant="ghost" type="button" onClick={() => { setLat(node.latitude?.toString() ?? ""); setLon(node.longitude?.toString() ?? ""); setError(""); setOpen(true); }}>
    {node.latitude != null && node.longitude != null ? `${node.longitude.toFixed(5)}, ${node.latitude.toFixed(5)}` : text("设置位置", "Set location")}
  </Button><Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}><DialogContent>
    <DialogHeader><DialogTitle>{text("节点位置", "Node location")} · {node.name}</DialogTitle><DialogDescription>{text("填写 WGS84 经纬度；仅保存到平台，不下发设备。地图开启显示子节点后可见。", "Enter WGS84 coordinates. Saved on the platform only, not sent to the device. Enable child nodes on the map to view it.")}</DialogDescription></DialogHeader>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div style={{ display: "grid", gap: 16, padding: "16px 0" }}>
        <label className="field"><span>{text("经度（-180 ～ 180）", "Longitude (-180 to 180)")}</span><Input type="number" min={-180} max={180} step="any" required value={lon} disabled={busy} onChange={event => setLon(event.target.value)} /></label>
        <label className="field"><span>{text("纬度（-90 ～ 90）", "Latitude (-90 to 90)")}</span><Input type="number" min={-90} max={90} step="any" required value={lat} disabled={busy} onChange={event => setLat(event.target.value)} /></label>
        {error && <p role="alert">{error}</p>}
      </div><DialogFooter>
        {node.latitude != null && <Button type="button" variant="secondary" disabled={busy} onClick={() => void save(true)}>{text("清空位置", "Clear location")}</Button>}
        <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>{text("取消", "Cancel")}</Button>
        <Button type="submit" disabled={busy || !valid}>{busy ? text("保存中…", "Saving…") : text("保存", "Save")}</Button>
      </DialogFooter>
    </form>
  </DialogContent></Dialog></>;
}
