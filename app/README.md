# THCPN Frontend

全新前端 monorepo，API 契约以 `../docs/openapi.yaml` 为准。

## Applications

- `apps/platform`: Workspace 用户控制台，shadcn/ui 风格共享组件。
- `apps/admin`: 系统后台，Ant Design 管理组件。

开发环境由 platform 将 `/admin` 代理到 admin Vite 服务，使两个应用共享同一浏览器 origin 和认证存储。

## Shared Packages

- `packages/api`: 统一 token、refresh、错误 envelope、request ID、DTO 和领域请求方法。
- `packages/auth`: 会话恢复、登录态、登出和路由守卫。
- `packages/workspace`: Workspace 选择、持久化和 query key 隔离。
- `packages/ui`: 设计 token、基础组件和页面状态。
- `packages/admin-ui`: Ant Design theme 和后台通用组件出口。

平台端的 shadcn/ui 源码组件位于 `apps/platform/src/shared/ui/primitives`，通过 `shared/ui/index.tsx` 保持业务页面接口稳定。组件使用 Radix UI 处理弹层、焦点和键盘交互，并沿用平台现有主题变量。

## Platform Code Organization

- `src/main.tsx`：浏览器启动、MapLibre worker 与全局样式入口。
- `src/app/`：Provider 装配、路由、认证守卫、应用布局、导航与全局通知。
- `src/features/<domain>/`：业务页面、私有组件和领域模型。设备、数据集、导出等模块分别提供列表、详情、编辑入口，路由直接按需加载具体页面。
- `src/shared/`：平台内复用的 UI、遥测展示、数据选择、地图工具、主题和配置。共享模块不能导入 `features` 或 `app`；业务模块不能导入应用装配层。
- `src/styles/`：全局样式入口和主题覆盖。`platform.css` 只按原始顺序导入 `platform/` 下的样式段，保留 CSS 层叠行为；业务专用 CSS 跟随业务模块。
- `src/types/`：第三方库的补充类型声明；`src/vendor/` 保留第三方源码与许可。

列表页面负责查询、筛选和导航；详情/编辑页面组合业务模块。纯分类、校验、payload 等逻辑放在所属业务的 `*-model.ts`，不要从页面文件重新导出。跨业务共享的能力进入 `shared`，数字样地 fixture、地块边界等专用逻辑保留在 `features/digital-plot`。

前端回归测试集中在 `tests/`，仅覆盖关键业务行为：会话恢复/失效、工作区隔离、完整遥测读取、导出目标身份、后台 CSV 确认提交和失败恢复。Vitest 只收集 `tests/**/*.test.{ts,tsx}`；不保留旧的源码字符串扫描、全量文案登记断言或依赖控件排列的测试。测试维护约定与命令见 [tests/README.md](tests/README.md)。

## Platform Type and Control Scale

用户端的字号与控件尺寸集中在 `apps/platform/src/styles/scale.css`，只由平台入口导入；后台保持 Ant Design 的尺寸体系。

| 用途 | 桌面 | 手机（<768px） |
| --- | --- | --- |
| 页标题 / 区块标题 / 弹层标题 | 28 / 18 / 20px | 24 / 18 / 20px |
| 正文 / 辅助文字 / 注释 | 15 / 14 / 13px | 16 / 14 / 13px |
| 输入文字 / 普通按钮文字 | 15 / 14px | 16 / 15px |
| 普通控件 / 紧凑操作 / 图标按钮 | 40 / 32 / 36px | 44 / 44 / 44px |

宽屏触控设备同样使用44px操作目标和16px输入文字。优先复用共享 Button、TextInput、SelectInput；导航链接需要按钮外观时使用 `Button asChild`。表格保持14px以兼顾数据密度，图表坐标使用13px并同步 Recharts 的 tick 字号，避免 CSS 字号与测量字号不一致。业务样式使用对应 token，避免固定28–36px高度覆盖触控规则。

## Platform Routes

- `/login`, `/register`: 密码、短信、MFA 登录和密码注册。
- `/dashboard`: Workspace 观测记录、图片、今日新增、设备更新状态、每日趋势和活动告警；未知与部分统计显式区分。
- `/workspaces`: Workspace 列表、创建和切换。
- `/devices`: 设备列表；选择设备后进入 `/devices/:deviceId` 查看概览、数据或实时视频、配置和操作记录。
- `/device-data`: 旧链接兼容入口，自动跳转到设备详情的数据或实时视频标签。
- `/datasets`: Dataset CRUD、预览和导出。
- `/exports`: ExportJob 创建、详情和下载。
- `/settings?tab=resources`: Project 和 Site。
- `/settings?tab=access`: Member、AccessGrant、Invitation 和 Permission Catalog。
- `/settings?tab=audit`: AuditLog。
- `/settings?tab=security`: refresh、session、邮箱验证和 MFA。

## Mobile Web App

用户端 `<768px` 使用“总览 / 设备 / 预警 / 数据 / 更多”底栏，`/data` 和 `/more` 集中现有业务入口；详情有返回，工作区在顶栏切换。编辑页面和地图工作台隐藏主底栏。桌面仍使用侧栏；后台使用 Ant Design 手机抽屉导航和表格内部横滚。

- 公共布局：`apps/platform/src/app/mobile-*`、`use-route-scroll.ts` 与 `styles/mobile.css`。共享断点在 `shared/hooks/use-mobile.ts`。
- 领域布局：各 `features` 内的 `*-mobile.css` 与 `shared/data`、`shared/telemetry`、`shared/maps`。同一个查询和操作状态供手机、桌面使用。
- safe-area、可视视口和底部空间由 `--mobile-safe-top`、`--mobile-safe-bottom`、`--mobile-header-height`、`--mobile-nav-height`、`--mobile-viewport-height`、`--mobile-keyboard-inset` 协调。新增底部操作请复用这些变量。
- manifest 和主屏幕图标在 `apps/platform/public`。没有注册 Service Worker，也不缓存离线认证或业务数据。
- 浏览器验收在 `e2e/`，配置在 `playwright.config.ts`；启动平台 5175、后台 5176 后，在 `app` 目录运行 `npm run test:mobile`。测试拦截 API，请勿把 fixture 接入生产。首次运行按 Playwright 指引安装 Chromium；已有浏览器可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定路径。
- 路由覆盖和验证限制见 [移动端验收说明](../docs/mobile-webapp.md)。

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
