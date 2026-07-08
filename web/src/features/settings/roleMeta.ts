import type { AccessGrantRoleCode, AccessGrantScopeType, InternalMemberRoleCode } from "../../api";

export interface RoleMeta {
  code: InternalMemberRoleCode | AccessGrantRoleCode;
  label: string;
  summary: string;
  risk?: string;
}

export const internalRoleMeta: Record<InternalMemberRoleCode, RoleMeta> = {
  owner: {
    code: "owner",
    label: "Owner",
    summary: "工作区所有者，可管理成员、权限、数据和高风险设备操作。",
    risk: "通常只分配给负责人。"
  },
  admin: {
    code: "admin",
    label: "Admin",
    summary: "工作区管理员，可管理成员、权限、设备、数据集和审计。",
    risk: "适合长期管理人员。"
  },
  project_manager: {
    code: "project_manager",
    label: "项目经理",
    summary: "管理项目、站点、设备协作、数据集和资源分享。"
  },
  site_operator: {
    code: "site_operator",
    label: "站点操作员",
    summary: "负责站点和设备日常操作，不管理数据导出和分享。"
  },
  data_manager: {
    code: "data_manager",
    label: "数据管理员",
    summary: "管理数据集、导出、媒体下载和资源分享。"
  },
  researcher: {
    code: "researcher",
    label: "研究员",
    summary: "查看历史数据并导出遥测/数据集，不默认下载媒体文件。"
  },
  viewer: {
    code: "viewer",
    label: "只读",
    summary: "只读查看工作区资源、设备数据和数据集。"
  }
};

export const accessRoleMeta: Record<AccessGrantRoleCode, RoleMeta & { allowedScopes: AccessGrantScopeType[] }> = {
  project_manager: {
    ...internalRoleMeta.project_manager,
    allowedScopes: ["workspace", "project", "site", "device", "dataset"]
  },
  site_operator: {
    ...internalRoleMeta.site_operator,
    allowedScopes: ["workspace", "project", "site", "device", "dataset"]
  },
  data_manager: {
    ...internalRoleMeta.data_manager,
    allowedScopes: ["workspace", "project", "site", "device", "dataset"]
  },
  researcher: {
    ...internalRoleMeta.researcher,
    allowedScopes: ["workspace", "project", "site", "device", "dataset"]
  },
  viewer: {
    ...internalRoleMeta.viewer,
    allowedScopes: ["workspace", "project", "site", "device", "dataset"]
  },
  shared_viewer: {
    code: "shared_viewer",
    label: "共享只读",
    summary: "外部协作者只读查看指定范围资源。",
    allowedScopes: ["workspace", "project", "site", "device", "dataset"]
  },
  shared_downloader: {
    code: "shared_downloader",
    label: "共享下载",
    summary: "外部协作者可查看并下载/导出指定范围数据。",
    risk: "会开放下载能力，建议限定范围和过期时间。",
    allowedScopes: ["workspace", "project", "site", "device", "dataset"]
  },
  service_engineer: {
    code: "service_engineer",
    label: "服务工程师",
    summary: "临时售后维护角色，仅限设备或站点范围。",
    risk: "必须设置过期时间，不加入工作区成员。",
    allowedScopes: ["site", "device"]
  }
};

export const internalRoleOptions = Object.values(internalRoleMeta).map((role) => ({
  label: role.label,
  value: role.code as InternalMemberRoleCode
}));

export const accessRoleOptions = Object.values(accessRoleMeta).map((role) => ({
  label: role.label,
  value: role.code as AccessGrantRoleCode
}));

export function roleLabel(code: string): string {
  return internalRoleMeta[code as InternalMemberRoleCode]?.label || accessRoleMeta[code as AccessGrantRoleCode]?.label || code;
}

export function roleSummary(code: string): string {
  return internalRoleMeta[code as InternalMemberRoleCode]?.summary || accessRoleMeta[code as AccessGrantRoleCode]?.summary || "按后端角色权限矩阵执行。";
}

export function roleRisk(code: string): string | undefined {
  return internalRoleMeta[code as InternalMemberRoleCode]?.risk || accessRoleMeta[code as AccessGrantRoleCode]?.risk;
}

