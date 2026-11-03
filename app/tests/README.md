# 前端必要回归测试

测试于2026-11-03按当前业务重新建立。旧97份 Vitest 测试与2份 Playwright 场景文件已删除，不通过跳过失败或扩大排除项保留旧测试。

## 当前范围

Vitest 共5个文件、24项用例：

| 文件 | 用例 | 业务约束 |
|---|---:|---|
| `api-session.test.ts` | 7 | 用户/管理员分别刷新自己的会话；刷新失败有界退出且不清另一身份；403不刷新会话；表单错误保留校验详情和请求编号 |
| `session-workspace.test.tsx` | 4 | 未登录保留深链接；会话恢复前不展示私有页；退出失败仍清缓存；无权访问的工作区回退；切换后不显示上一工作区的数据 |
| `platform/full-telemetry.test.ts` | 4 | 完整查询不采样；截断响应递归拆分、排序及边界去重；保留局部失败；最小窗口仍不完整时明确失败 |
| `platform/export-targets.test.ts` | 3 | 网关/节点索引身份完整；仅网关状态也能导出；不同网关同索引不混淆，设备更名/删除后仍能解释历史目标 |
| `admin/node-inventory.test.tsx` | 6 | CSV预览与取消不写；仅确认后提交预览行；校验阻断；逐行失败与unknown结果处理；最终同步失败不重复登记 |

浏览器场景在 `../e2e/core-flows.spec.ts`：3个流程各运行390px手机和1440px桌面，共6项，不使用项目条件跳过。

- 设备搜索→详情→返回保留条件；切换工作区清理旧条件并请求新工作区。
- 处理向导在最后确认前不创建任务；提交所选设备与图像输入。
- 后台表单校验阻断写入；409拒绝后显示错误、保留输入且可以取消。

浏览器沿用独立请求fixture，未知业务API和未捕获浏览器异常使测试失败，写请求全部被拦截。它不验证后端鉴权、真实设备写入、处理结果或创建成功后的持久化，也不替代真机键盘/安装和完整页面验收。

## 运行

在 `app` 目录运行所有单元/组件测试：

```bash
npm test
```

检查这些测试及其导入代码的 TypeScript 类型：

```bash
npm run test:typecheck
```

定向运行一个流程：

```bash
npm test -- tests/admin/node-inventory.test.tsx
```

浏览器测试需先分别启动用户端和后台：

```bash
npm run dev:platform -- --port 5175 --strictPort
```

```bash
npm run dev:admin -- --port 5176 --strictPort
```

首次安装浏览器后运行：

```bash
npx playwright install chromium
```

```bash
npm run test:mobile
```

`test:mobile` 同时执行手机与桌面核心流程。可通过 `PLATFORM_URL`、`ADMIN_URL` 更改服务地址，`PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定已有 Chromium。结果、截图和trace在被忽略的 `e2e/artifacts/`，HTML报告为 `e2e/artifacts/report/index.html`。

## 维护原则

- 新增测试必须对应具体业务风险，优先请求内容、状态切换、提交条件及失败恢复。
- 直接测试当前模块和真实交互，仅替换接口或外部能力；不要复制生产算法作为测试预期。
- 按字段含义、操作或资源身份定位，不依赖第几个控件、内部组件顺序、整页文案或源码字符串。
- 公共环境只负责jsdom、storage/mock隔离及React查询通知；每个渲染实例独立QueryClient并自动卸载/清理。
- 异步条件使用明确的Promise或等待可观察结果，不靠固定sleep掩盖时序。
- 不为追求数量恢复旧测试；本套测试不宣称全路由、所有配置项、所有图表/地图或完整国际化覆盖。
