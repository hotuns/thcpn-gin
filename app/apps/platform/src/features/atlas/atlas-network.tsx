import { useEffect, useState } from "react";
import type { Map } from "maplibre-gl";
import type { DeviceMapItem, GatewayNode } from "@thcpn/api";
import { located } from "./atlas-model";
import { networkArc, networkNodes } from "./atlas-network-model";
import "./atlas-network.css";

/** Reproject on camera changes so both ends remain anchored while orbiting or zooming. */
export function AtlasNetwork({
  map,
  gateway,
  nodes,
  devices,
  selectedNodeKey,
  onSelectNode,
  running,
  appearance,
}: {
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
  const label = (name: string, max = 12) => (name.length > max ? `${name.slice(0, max)}…` : name);
  const pillWidth = (text: string) => Math.max(76, Math.min(text.length, 14) * 12 + 24);
  const [, renderCamera] = useState(0);

  useEffect(() => {
    const update = () => renderCamera((value) => value + 1);
    map.on("move", update);
    map.on("resize", update);
    return () => {
      map.off("move", update);
      map.off("resize", update);
    };
  }, [map]);

  const { locatedNodes, unlocated } = networkNodes(nodes, devices);
  const center = located(gateway) ? map.project([gateway.longitude!, gateway.latitude!]) : undefined;
  const projected = locatedNodes.map((item) => ({
    ...item,
    point: map.project([item.location.longitude, item.location.latitude]),
  }));

  const gatewayTitle = label(gateway.name, 14);
  const gatewaySub = `LoRa · ${nodes.length} 节点${unlocated > 0 ? ` · ${unlocated} 未定位` : ""}`;
  const gatewayBoxW = Math.max(156, Math.max(gatewayTitle.length * 13, gatewaySub.length * 9) + 32);

  return (
    <>
      <svg
        className={`atlas-network-overlay${deepBlue ? " eco-network-overlay" : ""}`}
        aria-label="网关和节点位置及连接关系"
        data-running={running}
      >
        <defs>
          <linearGradient id="obs-lora-arc" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.92" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0.96" />
          </linearGradient>
        </defs>

        {center &&
          projected.map(({ node, point }, index) => (
            <g key={node.key}>
              <path className="atlas-network-glow" d={networkArc(point, center)} />
              <path className="atlas-network-arc" d={networkArc(point, center)} />
              <path
                className="atlas-network-packet"
                pathLength="100"
                d={networkArc(point, center)}
                style={{ animationDelay: `${index * -0.55}s` }}
              />
            </g>
          ))}

        {projected.map(({ node, point }) => {
          const nodeLabel = label(node.name);
          const boxW = pillWidth(nodeLabel);
          return (
            <g
              key={node.key}
              className="atlas-network-node"
              data-selected={selectedNodeKey === node.key}
              transform={`translate(${point.x} ${point.y})`}
              role="button"
              tabIndex={0}
              aria-label={`选择节点 ${node.name}`}
              aria-pressed={selectedNodeKey === node.key}
              onClick={() => onSelectNode(node.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectNode(node.key);
                }
              }}
            >
              <title>
                {node.name}
                {node.asset_no ? ` · ${node.asset_no}` : ""}
                {node.node_sn ? ` · 节点 SN ${node.node_sn}` : ""}
              </title>
              <circle className="atlas-network-node-hit" r="22" />
              <ellipse className="eco-network-halo" rx="22" ry="8" />
              <ellipse className="atlas-network-ground" rx="13" ry="5" />
              <line x1="0" y1="0" x2="0" y2="-20" />
              <circle className="atlas-network-dot" cy="-21" r="4.5" />
              <g className="eco-network-node-label" transform={`translate(${-boxW / 2} -56)`}>
                <rect className="eco-network-label-box" width={boxW} height="26" rx="8" />
                <text x={boxW / 2} y="17" textAnchor="middle">
                  {nodeLabel}
                </text>
              </g>
            </g>
          );
        })}

        {center && (
          <g className="atlas-network-gateway" transform={`translate(${center.x} ${center.y})`}>
            <title>{gateway.name} · 网关</title>
            <ellipse className="eco-network-radar-pulse" rx="56" ry="18" />
            <ellipse className="eco-network-gateway-ring" rx="38" ry="12" />
            <ellipse className="atlas-network-ground" rx="22" ry="7" />
            <line className="eco-network-gateway-stem" x1="0" y1="0" x2="0" y2="-30" />
            <circle className="obs-gateway-orb" cx="0" cy="-46" r="18" />
            <g className="eco-network-radio">
              <path d="M0 -54 L-6 -39 M0 -54 L6 -39 M-3.5 -44 H3.5" />
              <path d="M-7 -53 Q-14 -48 -8 -42 M7 -53 Q14 -48 8 -42" />
              <circle cx="0" cy="-55" r="2" />
            </g>
            <g className="eco-network-gateway-label" transform={`translate(${-gatewayBoxW / 2} -118)`}>
              <rect className="eco-network-label-box obs-gw-box" width={gatewayBoxW} height="44" rx="11" />
              <text x={gatewayBoxW / 2} y="19" textAnchor="middle">
                {gatewayTitle}
              </text>
              <text className="eco-network-serial" x={gatewayBoxW / 2} y="36" textAnchor="middle">
                {gatewaySub}
              </text>
            </g>
          </g>
        )}
      </svg>

      {!center && (
        <div className="eco-network-status" role="status">
          网关未设置位置，暂不展示连线{unlocated > 0 && ` · ${unlocated} 个节点未定位`}
        </div>
      )}
    </>
  );
}
