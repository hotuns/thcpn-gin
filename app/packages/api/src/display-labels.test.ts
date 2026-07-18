import { describe, expect, it } from "vitest";
import {
  commonStatusLabel,
  deviceLifecycleLabel,
  deviceCapabilityLabel,
  deviceStatusLabel,
  deviceTopologyRoleLabel,
  roleTemplateLabel,
} from "./display-labels";

describe("domain display labels", () => {
  it("translates device states without changing their API codes", () => {
    expect(deviceStatusLabel("active")).toBe("启用");
    expect(deviceLifecycleLabel("maintenance")).toBe("维护中");
    expect(deviceTopologyRoleLabel("gateway_node")).toBe("网关节点");
    expect(deviceCapabilityLabel("image_capture")).toBe("图片采集");
    expect(deviceCapabilityLabel("custom_sensor")).toBe("扩展能力");
  });

  it("translates built-in permission templates and common statuses", () => {
    expect(roleTemplateLabel("project_manager", "Project Manager")).toBe(
      "项目管理员",
    );
    expect(roleTemplateLabel("custom", "Custom")).toBe("自定义权限");
    expect(commonStatusLabel("pending")).toBe("待处理");
  });

  it("keeps a customized role display name", () => {
    expect(roleTemplateLabel("admin", "系统管理员")).toBe("系统管理员");
  });
});
