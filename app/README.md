# THCPN Frontend

全新前端 monorepo，API 契约以 `../docs/openapi.yaml` 为准。

## Applications

- `apps/platform`: Workspace 用户控制台，Shadcn 风格共享组件。
- `apps/admin`: 系统后台，Ant Design 管理组件。

开发环境由 platform 将 `/admin` 代理到 admin Vite 服务，使两个应用共享同一浏览器 origin 和认证存储。

## Shared Packages

- `packages/api`: 统一 token、refresh、错误 envelope、request ID、DTO 和领域请求方法。
- `packages/auth`: 会话恢复、登录态、登出和路由守卫。
- `packages/workspace`: Workspace 选择、持久化和 query key 隔离。
- `packages/ui`: 设计 token、基础组件和页面状态。
- `packages/admin-ui`: Ant Design theme 和后台通用组件出口。

## Platform Routes

- `/login`, `/register`: 密码、短信、MFA 登录和密码注册。
- `/dashboard`: Workspace 设备、Dataset 和 Export 汇总。
- `/workspaces`: Workspace 列表、创建和切换。
- `/devices`: 设备列表；选择设备后进入 `/devices/:deviceId` 查看概览、数据或实时视频、配置和操作记录。
- `/device-data`: 旧链接兼容入口，自动跳转到设备详情的数据或实时视频标签。
- `/datasets`: Dataset CRUD、预览和导出。
- `/exports`: ExportJob 创建、详情和下载。
- `/settings?tab=resources`: Project 和 Site。
- `/settings?tab=access`: Member、AccessGrant、Invitation 和 Permission Catalog。
- `/settings?tab=audit`: AuditLog。
- `/settings?tab=security`: refresh、session、邮箱验证和 MFA。

## Admin Routes

- `/admin`: API 健康、平台异常、设备资产、数据源、用户和工作区运维总览。
- `/admin/sources`: DataSource CRUD、标准站/网关/相机同步和全量同步。
- `/admin/devices`: 系统设备搜索、分页、多选批量操作、拓扑、THCPN 配置、生命周期、能力、分配和相机。
- `/admin/sensors`: 平台传感器模板 CRUD，以及协议参数和指标的可视化/JSON 编辑。
- `/admin/device-map`: 系统设备地图、分类统计和批量分类。
- `/admin/logs`: 平台日志查询、导出、原始文件和索引维护。
- `/admin/workspaces`, `/admin/users`: 工作区治理和普通用户账号管理。
- `/admin/metadata`, `/admin/settings`: 设备能力/角色元数据和服务状态设置。

高频流程使用结构化表单。THCPN 配置、权限 scope、角色权限等低频复杂请求使用 JSON 操作台，字段结构直接遵循 OpenAPI；高风险操作提交前必须二次确认。

## Commands

`npm run generate:api` regenerates `packages/api/src/openapi.ts` from `../docs/openapi.yaml`. Root `typecheck` and `build` run this automatically so contract drift fails at compile time.

```bash
npm install
npm run dev:platform
npm run dev:admin
npm run typecheck
npm run build
```
