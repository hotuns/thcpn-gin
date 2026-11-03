# 移动 Web App 设计与验收

## 适用范围

用户端沿用 React、React Router、TanStack Query 和 Radix；后台沿用 Ant Design。手机断点为 767px，768–1023px 为紧凑平板；桌面保留侧栏。没有替换后端接口、权限规则或查询含义。

用户端底栏提供总览、设备、预警、数据、更多。顶栏提供返回、工作区切换和通知；`/data`、`/more` 为现有页面的入口。数据集创建/编辑、创建导出和地图工作台隐藏底栏，让业务操作占据底部。返回设备列表恢复工作区内的筛选、分类和滚动位置。

查询条件保留草稿与应用状态；展开/收起、指标上下移不自动提交。图表提供触屏缩放按钮、重置、全屏和明细表，普通滚轮与竖向触摸保留页面滚动。地图面板切换保持地图实例、对象选择和回放状态。

## 路由与手机操作

| 页面 | 手机入口与主要操作 | 权限及提交边界 |
|---|---|---|
| `/dashboard` | 总览；紧凑资源计数、设备状态、最近导出和审计 | 当前工作区查询 |
| `/devices` | 设备；搜索、筛选 Sheet、摘要列表、展开网关节点 | 设备能力及原有授权 |
| `/devices/:id?tab=…` | 详情返回、可横滑页签、条件摘要/编辑、指标排序、图表与表格 | 保留原来的页签归一、查询和配置权限 |
| `/claim`、`/claim/:slug` | 添加设备；识别与归属表单 | 原有认领确认流程 |
| `/device-map` | 地图常驻；目录与筛选、选中对象详情可收起 | 只显示可访问设备；未定位明确标识 |
| `/data`、`/data-compare` | 数据工具入口；跨设备来源/时间/指标选择 | 复用既有来源选择、查询和导出 |
| `/datasets`、`/datasets/:id` | 摘要列表、预览、编辑和导出 | 原有资源授权 |
| `/datasets/new`、`/datasets/:id/edit` | 来源选择全屏弹层、表单分区、底部保存与检查反馈 | 原有校验/payload；选择来源不自动保存 |
| `/exports`、`/exports/new` | 状态摘要、错误/下载/重试、底部提交 | 原有额度/权限/禁用与确认逻辑 |
| `/processing`、`/processing/:id` | 任务摘要；四步弹层、执行产物；ROI开始/重选/取消 | 最后一步提交；未开启框选时允许竖滑 |
| `/alerts`、`/notifications` | 底栏预警、顶栏通知；规则创建、启停、事件确认 | 原有专业版/权限条件；不新增既有规则编辑接口 |
| `/more`、`/workspaces` | 工作区、账号、语言、外观、使用引导和退出 | 切换触发已有工作区 Query 隔离 |
| `/settings?tab=…` | 资源、成员、授权、审计；弹层内校验与错误 | 原有设置权限；失败不关闭表单 |
| `/account`、`/subscription` | 账号安全、会话、套餐与用量 | 订阅入口仍受 billing policy 控制 |
| `/atlas`、`/atlas/:id` | 模板与大屏；地图/目录/详情面板、视图菜单 | 原有模板与工作区授权 |
| `/atlas/topics/digital-plot` | 目录、详情、回放、地图显示；绘制完成/取消 | 原有演示标识、本机保存语义不变 |
| `/login`、`/register`、`/public/devices/:slug` | 无登录态公共入口，16px输入与视口约束 | 原有认证、验证码和公开访问规则 |
| `/admin/*` | 抽屉导航，工具栏换行，表格局部横滚，表单底部操作 | 系统管理员身份；不增加业务入口 |

## 公共布局约定

- `styles/mobile.css` 负责应用导航、44px主要触控目标、16px输入、弹层边界、安全区域和页面底部占位。业务布局在各领域的 `*-mobile.css`。
- `--mobile-header-height` 与 `--mobile-nav-height` 表示实际导航占位；工作台与编辑页的底栏占位为零。
- `--mobile-viewport-height`、`--mobile-keyboard-inset` 从 VisualViewport 更新，弹层避让软键盘；捏合缩放不被误判成键盘。没有 VisualViewport 时回退 `100dvh`。
- `--mobile-safe-top`、`--mobile-safe-bottom` 使用系统安全区。固定操作条须自行预留正文空间。
- 长名称完整换行；表格在局部横滚。不要以页面 `overflow-x:hidden` 掩盖布局问题。
- 设备/来源列表和手机摘要复用原查询/处理函数，避免手机与桌面同时挂载两套数据请求。
- `data-label` 纳入既有英文 DOM 翻译；新增集中导航文案使用 i18next 资源。

## 主屏幕与离线范围

`manifest.webmanifest`、192/512px图标、Apple 180px图标、viewport-fit 和 standalone 元数据已加入。支持浏览器提供的添加到主屏幕入口；业务仍需联网。没有 Service Worker、认证数据离线缓存或后台自动提交。

## 验证方法

单元/组件测试继续使用 Vitest；`app/e2e` 使用 Playwright 驱动真实页面并拦截 API。fixture 仅存在于测试，不进入生产包；未匹配的 API、浏览器运行异常和持续整页横向溢出会使测试失败。

在 `app` 目录，先安装依赖。首次运行安装 Playwright Chromium：

```bash
npx playwright install chromium
```

通过 `.claude/launch.json` 中的 platform / admin 配置启动，或分别在两个终端启动平台5175、后台5176：

```bash
npm run dev:platform -- --port 5175 --strictPort
```

```bash
npm run dev:admin -- --port 5176 --strictPort
```

两个服务就绪后运行：

```bash
npm run test:mobile
```

非默认地址可通过 `PLATFORM_URL`、`ADMIN_URL` 指定。

配置中的环境变量可指定服务地址和已有 Chromium 可执行文件。截图、失败 trace 与请求附件留在被忽略的 `e2e/artifacts` 中。Vitest 只收集 `app/tests`，Playwright 只收集 `app/e2e/core-flows.spec.ts`，避免混用两个运行器。

## 检查记录（2026-11-03）

- 移动改造交付时，全工作区类型检查和两端生产构建通过；设备详情/数据集长名称横溢、地图标记遮挡、趋势标题竖排及异步英文标签问题已经修正。后台设备保存错误已放入抽屉内，并保留输入。
- 随后按新的测试维护要求删除旧前端测试，重写必要回归。当前 Vitest 为5个文件、24项用例，全通过；测试本身的 `test:typecheck` 和全工作区 `typecheck` 通过。测试范围与维护方式见 [前端测试说明](../app/tests/README.md)。
- 当前 Playwright 为3个核心流程×390px手机/1440px桌面，共6项，全通过、无跳过。覆盖设备搜索/返回/工作区切换、处理向导最终提交、后台校验及409失败反馈。报告位于 `app/e2e/artifacts/report/index.html`，结构化结果为 `app/e2e/artifacts/results.json`。
- 之前移动改造验收曾检查360/390/430px、768px、英文暗色及地图面板；这些属于先前的验收记录，不是现有精简测试的持续覆盖范围。
- 所有浏览器写请求均由测试拦截，没有向真实设备、导出或通知提交写请求。

## 实机限制

桌面 Chromium 的手机视口与触屏模拟不能替代 iOS Safari/Android Chrome 真机软键盘、刘海安全区、系统安装以及 WebGL 触摸验证。业务写请求均使用固定测试响应，不代表生产设备配置、导出生成或通知发送已执行。

当前浏览器测试使用测试 token 和 `/me` 拦截，不验证真实鉴权。处理向导使用无需 ROI 的图像方案，后台保存验证409失败反馈，不验证实际处理产物或创建成功后的持久化。真实文件生成/上传、地图瓦片、断网、全部后台详情页及完整英文工作流不属于这套精简回归的覆盖范围。
