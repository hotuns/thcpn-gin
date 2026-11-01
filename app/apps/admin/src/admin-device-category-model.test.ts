import {expect,it} from "vitest";
import {adminDeviceCategories,matchesAdminDeviceCategory} from "./admin-device-category-model";
it("uses the requested six tabs without an all category",()=>{expect(adminDeviceCategories.map(c=>c.label)).toEqual(["标准站","组网站","网关v2","节点v2","碳汇","监控"])});
it("separates LoRaWAN gateways and physical inventory from THCPN gateways",()=>{
 expect(matchesAdminDeviceCategory({source_family:"thcpn"},"gateway","gateway")).toBe(true);
 expect(matchesAdminDeviceCategory({source_family:"lorawan_v2"},"gateway","gateway")).toBe(false);
 expect(matchesAdminDeviceCategory({source_family:"lorawan_v2"},"lorawan_v2","gateway")).toBe(true);
 expect(matchesAdminDeviceCategory({source_family:"thcpn"},"lorawan_v2","gateway")).toBe(false);
 expect(matchesAdminDeviceCategory({source_family:"lorawan_v2"},"node_v2","gateway")).toBe(false);
});
