import { useEffect, useState } from "react";
import type { Map } from "maplibre-gl";
import type { DeviceMapItem, GatewayNode } from "@thcpn/api";
import { located } from "./atlas-model";
import { networkArc, networkNodes } from "./atlas-network-model";
import "./atlas-network.css";

/** Reproject on camera changes so both ends remain anchored while orbiting or zooming. */
export function AtlasNetwork({ map, gateway, nodes, devices, selectedNodeKey, onSelectNode, running, appearance }: {
  map: Map;
  gateway: DeviceMapItem;
  nodes: GatewayNode[];
  devices: DeviceMapItem[];
  selectedNodeKey?: string;
  onSelectNode: (key: string) => void;
  running: boolean;
  appearance?: "deep-blue" | "research" | "expedition";
}) {
  const deepBlue = appearance === "deep-blue";
  const alternate = appearance === "research" || appearance === "expedition" ? appearance : undefined;
  const label = (name: string, max = 14) => name.length > max ? `${name.slice(0, max)}…` : name;
  const labelWidth = (name: string) => Math.max(86, Math.min(name.length, 15) * 15 + 24);
  const [, renderCamera] = useState(0);
  useEffect(() => {
    const update = () => renderCamera(value => value + 1);
    map.on("move", update);
    map.on("resize", update);
    return () => { map.off("move", update); map.off("resize", update); };
  }, [map]);
  const { locatedNodes, unlocated } = networkNodes(nodes, devices);
  const center = located(gateway) ? map.project([gateway.longitude!, gateway.latitude!]) : undefined;
  const projected = locatedNodes.map(item => ({ ...item, point: map.project([item.location.longitude, item.location.latitude]) }));
  return <>
    <svg className={`atlas-network-overlay${deepBlue ? " eco-network-overlay" : alternate ? ` ${alternate}-network-overlay` : ""}`} aria-label="网关和节点位置及连接关系" data-running={running}>
      {center && projected.map(({ node, point }, index) => <g key={node.key}>
        <path className="atlas-network-glow" d={networkArc(point, center)} />
        <path className="atlas-network-arc" d={networkArc(point, center)} />
        <path className="atlas-network-packet" pathLength="100" d={networkArc(point, center)} style={{ animationDelay: `${index * -.45}s` }} />
      </g>)}
      {projected.map(({ node, point }) => <g
        key={node.key} className="atlas-network-node" data-selected={selectedNodeKey === node.key}
        transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0}
        aria-label={`选择节点 ${node.name}`} aria-pressed={selectedNodeKey === node.key}
        onClick={() => onSelectNode(node.key)}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectNode(node.key); } }}
      >
        <title>{node.name}{node.node_sn ? ` · ${node.node_sn}` : ""}</title>
        <circle className="atlas-network-node-hit" r={deepBlue ? 23 : 15} />
        {deepBlue && <ellipse className="eco-network-halo" rx="30" ry="10" />}
        <ellipse className="atlas-network-ground" rx={deepBlue ? 20 : 13} ry={deepBlue ? 7 : 5} />
        <line x1="0" y1="0" x2="0" y2={deepBlue ? -22 : -12} />
        <circle className="atlas-network-dot" cy={deepBlue ? -23 : -13} r={deepBlue ? 5 : 4} />
        {deepBlue ? <g className="eco-network-node-label" transform="translate(8 -68)">
          <path className="eco-network-label-box" d={`M8 0 H${labelWidth(node.name)} V32 H0 V8 Z`} />
          <text x="12" y="22">{label(node.name)}</text>
        </g> : <text x="10" y="-20">{node.name}</text>}
      </g>)}
      {center && <g className="atlas-network-gateway" transform={`translate(${center.x} ${center.y})`}>
        <title>{gateway.name} · 网关</title>
        {deepBlue ? <>
          <ellipse className="eco-network-halo" rx="88" ry="25" />
          <ellipse className="eco-network-gateway-ring" rx="67" ry="19" />
          <ellipse className="atlas-network-ground" rx="45" ry="13" />
          <line className="eco-network-gateway-stem" x1="0" y1="0" x2="0" y2="-42" />
          <path className="atlas-network-gateway-hex" d="M0 -146 L44 -121 L44 -69 L0 -44 L-44 -69 L-44 -121 Z" />
          <g className="eco-network-radio">
            <path d="M0 -116 L-14 -73 M0 -116 L14 -73 M-8 -90 H8 M-11 -82 H11 M-5 -102 H5" />
            <path d="M-12 -116 Q-29 -103 -15 -88 M12 -116 Q29 -103 15 -88 M-21 -125 Q-46 -104 -26 -80 M21 -125 Q46 -104 26 -80" />
            <circle cx="0" cy="-118" r="3" />
          </g>
          <g className="eco-network-gateway-label" transform="translate(0 -236)">
            <path className="eco-network-label-box" d="M-100 0 H100 V55 L90 65 H-100 V10 Z" />
            <text y="28" textAnchor="middle">{label(gateway.name, 9)}</text>
            <text className="eco-network-serial" y="51" textAnchor="middle">{label(gateway.serial_no, 22)}</text>
          </g>
          <g className="eco-network-badge" transform="translate(0 39)">
            <path className="eco-network-label-box" d="M-112 0 H112 V27 L104 35 H-112 V8 Z" />
            <text y="24" textAnchor="middle">LoRa 组网 · {nodes.length} 个节点</text>
            {unlocated > 0 && <text className="eco-network-unlocated" y="54" textAnchor="middle">{unlocated} 个节点未定位</text>}
          </g>
        </> : <>
          <ellipse className="atlas-network-ground" rx="30" ry="10" />
          <line x1="0" y1="0" x2="0" y2="-25" />
          <path className="atlas-network-gateway-hex" d="M0 -66 L20 -55 L20 -33 L0 -22 L-20 -33 L-20 -55 Z" />
          <path className="atlas-network-antenna" d="M0 -54 L-7 -34 M0 -54 L7 -34 M-5 -41 H5 M-8 -55 Q-14 -48 -8 -42 M8 -55 Q14 -48 8 -42" />
          <text y="-78" textAnchor="middle">{gateway.name}</text>
        </>}
      </g>}
    </svg>
    {deepBlue ? !center && <div className="eco-network-status" role="status">网关未设置位置，暂不展示连线{unlocated > 0 && ` · ${unlocated} 个节点未定位`}</div> : <div className={alternate ? `${alternate}-network-caption` : "atlas-network-caption"} role="status">
      <strong>组网拓扑</strong><span>网关 1 · 节点 {nodes.length}</span>
      {unlocated > 0 && <span>{unlocated} 个节点未设置位置</span>}
      {!center && <span>网关未设置位置，暂不展示连线</span>}
    </div>}
  </>;
}
