import type { JsonRecord } from "@thcpn/api";
export const adminDeviceCategories=[
 {key:"standalone",label:"标准站"},{key:"gateway",label:"组网站"},{key:"lorawan_v2",label:"网关v2"},{key:"node_v2",label:"节点v2"},{key:"carbon_sink",label:"碳汇"},{key:"camera",label:"视频站"},
] as const;
export function matchesAdminDeviceCategory(item:JsonRecord,category:string,role:string){
 if(category==="node_v2")return false; // Physical inventory has a source-scoped API, not device asset rows.
 return category==="lorawan_v2"?item.source_family==="lorawan_v2"&&role==="gateway":role===category&&item.source_family!=="lorawan_v2";
}
