import type { GatewayNode } from "./index";

export const nodeHistoryNotice = "按当前网关和序号查询连续历史，可能包含更换节点前的数据；当前 SN 不代表每条历史记录的硬件归属。";
export function nodeOptionLabel(node: GatewayNode) {
  if (node.target.kind !== "gateway_node") return node.name;
  const index = node.target.node_index;
  if (!node.bound) return `${node.custom_name || "节点"} · 序号 ${index}`;
  return [node.name, node.node_sn, `序号 ${index}`].filter(Boolean).join(" · ");
}
