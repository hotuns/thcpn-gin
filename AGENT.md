# thcpn-gin Agent Guide

本文件只维护仓库开发规则、架构边界和验证要求，不记录功能进度、历史验收结果或临时任务状态。

开始实现前先阅读：

- `iot_research_permission_mvp.md`
- `iot_research_go_backend_dev_guide.md`
- `thcpn-adapter.md`
- `docs/frontend-functional-design.md`，涉及前端时必读
- 本文件

## 文档维护

- 本文件只记录长期有效的规则，不记录已完成功能、migration 数量、测试通过历史、版本验收或待办清单。
- 功能契约变化时更新对应设计文档和 OpenAPI；任务进度保留在 issue、commit、PR 或当次协作记录中。
- 避免复制可从源码直接读取且容易过期的清单、版本号和统计数字。
- 删除或调整规则时说明架构原因，不用项目进度作为长期规则。

## 项目边界

- 本项目是科研物联网数据管理平台，采用 Go 模块化单体，包含 `api` 和 `worker` 两个进程，以及 `frontend/` 下的独立前端。
- 本项目不负责 MQTT 接入、设备上报解析或实时采集写入。
- 平台业务库使用 PostgreSQL；设备采集数据源必须与平台业务库分离。
- Redis 用于验证码、会话辅助、Asynq 队列及必要缓存。
- 权限模型遵循 `Role + Scope + AccessGrant + AuditLog`。
- 保持模块化单体，不提前拆分微服务，不引入与当前规模不匹配的复杂 ABAC、ReBAC、审批流或组织树。

## 信息来源

- 数据库结构以 `migrations/` 为准。
- 平台 SQL 查询以 `sql/queries/` 为准，`internal/db/sqlc/` 是生成代码。
- HTTP 路由以 `internal/app/router.go` 为准，HTTP 契约以 `docs/openapi.yaml` 为准；两者必须同步。
- 后端依赖和 Go 版本以 `go.mod` 为准。
- 前端依赖和脚本以 `frontend/package.json` 为准；`web/` 是旧工程，不作为新实现的参考或兼容目标。
- 前端功能边界、页面职责和关键流程以 `docs/frontend-functional-design.md` 为准。
- 设计文档描述目标模型；代码与文档冲突时，先识别是实现偏差还是设计变更，不要静默选择一方。

## 目录职责

- `cmd/api`：API 进程入口和生命周期管理。
- `cmd/worker`：异步任务进程入口和生命周期管理。
- `internal/app`：Gin router、middleware 和服务装配。
- `internal/config`：默认配置、YAML 加载、环境变量覆盖和校验。
- `internal/auth`：认证、token、验证码、会话和 MFA。
- `internal/permission`：权限目录、资源解析和授权判断。
- `internal/audit`：审计写入和查询。
- `internal/project`、`site`、`device`、`datastream`、`dataset`：平台资源领域模块。
- `internal/datasource`：设备数据源元信息、同步和运行时 adapter。
- `internal/telemetry`、`media`：设备数据查询工作流。
- `internal/export`、`task`：导出任务和异步处理。
- `internal/objectstore`：对象上传、读取、删除和临时访问签名。
- `internal/httpx`、`metrics`、`tracing`、`logger`：横切基础设施。
- `migrations`：平台 PostgreSQL schema 迁移。
- `sql/queries`：sqlc 查询定义。
- `internal/db/sqlc`：sqlc 生成结果，禁止手改。
- `frontend/src/lib`：前端 API client、DTO 和领域无关工具。
- `frontend/src/app`：前端路由、上下文、壳层和全局状态。
- `frontend/src/pages`：按业务能力组织的前端页面。
- `frontend/src/components`：无业务归属的共享组件。

## 配置与密钥

- 不得提交真实 `.env`、数据库密码、JWT 密钥、对象存储密钥、设备数据源 DSN、短信密钥或摄像头平台密钥。
- 示例值只维护在 `.env.example` 和 `configs/config.example.yaml`。
- 敏感配置必须通过环境变量、Secret Manager 或部署系统注入，平台库只保存 secret 引用。
- `CONFIG_FILE` 可指定 YAML 配置；环境变量覆盖配置文件。
- 新增配置项时必须同时更新配置结构、默认值、校验、环境变量覆盖、示例配置和配置测试。
- 开发默认值不得被当作生产配置。生产环境必须使用强随机 JWT 密钥，并关闭开发注册和 `X-User-ID` fallback。
- 日志、错误响应、审计记录和 trace 属性不得包含密码、token、验证码、TOTP secret、完整 DSN 或对象存储密钥。

## 认证与会话

- 正式业务接口使用 `Authorization: Bearer <token>`；不得新增只依赖 `X-User-ID` 的接口。
- `X-User-ID` 仅用于明确启用的本地开发环境。
- 开发注册接口必须受配置开关保护，生产环境必须关闭。
- 密码必须经过策略校验并使用 bcrypt 等单向密码哈希保存，禁止明文或可逆加密。
- 短信和邮箱验证码只保存在 Redis，保存哈希、尝试次数和过期信息，不写 PostgreSQL。
- access token 主动失效必须继续走 blacklist；refresh token 必须使用服务端 session 和 token hash，不得只依赖客户端删除。
- TOTP secret 必须加密持久化；除 setup 响应外不得返回或记录明文 secret。
- 认证失败、账号锁定、会话撤销和 MFA 校验必须使用统一错误模型，并避免泄露账号是否存在等敏感信息。

## 数据库与 sqlc

- schema 变更必须新增成对的 `*.up.sql` 和 `*.down.sql` migration；不要修改已应用迁移，除非项目明确处于允许重写历史的初始化阶段。
- migration 必须可从空库完整升级，并至少验证最近一步 down/up。
- 修改 `sql/queries/*.sql` 后必须运行 `make sqlc`，并提交对应的 `internal/db/sqlc` 生成结果。
- 禁止手工编辑 `internal/db/sqlc`。
- 平台业务代码优先通过 sqlc 或领域层封装访问 PostgreSQL，不在 handler 中直接拼 SQL。
- 跨库写操作不能假设原子性；必须使用幂等设计、状态记录、补偿或对账机制处理部分成功。
- 平台业务库不保存大量原始设备采集数据。

## 设备数据源与 Adapter

- 所有设备数据查询必须通过 `internal/datasource` adapter 层。
- 业务模块不得绕过 adapter 直接访问设备数据源。
- 用户请求不得传入 `table_name`、`field_name`、`JSONPath`、`adapter_config` 或 `raw_sql`。
- DataSource、DSN、外部设备映射和 DataStreamBinding 属于系统运维边界，不属于普通 Workspace 管理能力。
- Workspace Owner/Admin 也不能获得系统级数据源管理权限。
- 系统管理员身份与 Workspace 角色必须分离；系统后台必须使用独立管理员账号和管理员会话校验。
- adapter 由代码注册，DataSource 只描述受控实例，DataStreamBinding 只保存经过审核的映射。
- 表名、列名和 JSON path 必须来自受控配置并经过严格校验；数据值使用参数绑定。
- 设备查询必须有时间范围、分页或点数上限；大范围查询走异步导出。
- 媒体预览和下载使用临时签名 URL 或受控代理，不返回永久公开地址。
- THCPN 旧库接入应围绕 `thcpn_legacy_mysql`、DeviceSourceRef、DeviceConfigSnapshot、DataStream 和 DataStreamBinding 展开，不把旧库结构暴露给普通前端。
- THCPN 配置写入必须保留配置变更状态、审计和失败恢复能力；外部 MySQL 与平台 PostgreSQL 的更新需要显式处理一致性。

## 资源与权限

- 权限判断必须同时考虑 action、resource 和 scope，禁止只按角色名称放行。
- 支持的资源范围为 `workspace`、`project`、`site`、`device`、`data_stream` 和 `dataset`；对外授权范围以产品权限模型允许的集合为准。
- Workspace 权限覆盖该 Workspace 下资源。
- Project 权限覆盖该 Project 下的 Site、Device、DataStream 和 Dataset。
- Site 权限覆盖该 Site 下的 Device 和 DataStream。
- Device 权限覆盖设备及其 DataStream；Dataset 权限只覆盖自身。
- 内部长期协作者使用 WorkspaceMember；外部个人分享、临时售后和局部授权使用 AccessGrant。
- 未注册对象使用 Invitation，接受后再转为 AccessGrant。
- 外部授权不得包含 `member.manage`、`workspace.manage`、`audit.view` 等内部管理权限。
- 售后授权必须显式、限范围、可过期、可撤销、可审计。
- 图片、视频和音频访问权限必须与普通时序数据权限分开。
- 设备转移不得静默改变历史 Dataset 的归属和可访问性。
- 删除成员、降级 Owner 等操作必须保护最后一个有效 Owner。

## 审计

- 高风险操作的成功和失败都应记录审计，除非设计文档明确说明只记录成功。
- 审计至少包含 actor、action、resource、result、reason、client IP、user agent、request ID 和时间。
- 必须审计的操作包括：
  - 登录、异常登录、会话撤销和高风险认证变更。
  - 创建组织空间、成员邀请、角色或范围变更。
  - 设备分配、解绑、转移、配置修改、校准和固件升级。
  - DataSource、外部映射、配置快照和 DataStreamBinding 变更。
  - Dataset 创建、更新、锁定、删除、分享和导出。
  - 媒体下载、导出和删除。
  - AccessGrant、Invitation、售后授权和撤销。
  - 内部排障访问客户设备数据。
- 审计写入失败时，高风险业务操作不得伪装成成功；具体失败策略由领域操作决定并写测试。

## API 规则

- API 路由使用 `/api/v1` 前缀；健康检查和指标端点除外。
- 新增或修改路由时必须同步 `docs/openapi.yaml` 和 `frontend/src/lib/api.ts` 中相关调用。
- handler 负责解析、认证上下文、响应映射；业务校验和状态变化放在 service。
- 请求必须先认证、再授权、最后执行业务逻辑。
- 列表接口必须有明确的范围条件和分页/limit 上限。
- 统一错误响应：

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "permission denied",
    "request_id": "req_123"
  }
}
```

- 错误码使用稳定枚举，例如 `INVALID_ARGUMENT`、`UNAUTHORIZED`、`PERMISSION_DENIED`、`NOT_FOUND`、`CONFLICT`、`RATE_LIMITED`、`DATA_SOURCE_ERROR`、`EXPORT_TOO_LARGE`、`SERVICE_UNAVAILABLE` 和 `INTERNAL`。
- 不向客户端返回底层 SQL、DSN、堆栈或第三方密钥信息。

## Worker、导出与对象存储

- 长耗时、跨大量数据或需要重试的工作放到 Worker，不阻塞 API 请求。
- 异步任务必须有明确状态机、幂等 claim、失败原因、重试策略和过期处理。
- 创建任务与投递队列之间必须考虑部分失败；Worker 应能补偿可恢复的 pending 任务。
- 导出必须校验资源权限、时间范围和最大行数，生成文件必须设置过期时间。
- 对象 key 必须校验并防止路径穿越；上传、下载和删除必须受 context 控制。
- 对象存储 provider 差异封装在 `internal/objectstore`，业务模块不直接调用云厂商 SDK。

## 可观测性

- 请求日志至少包含 request ID、method、route、status、duration 和 client IP；可用时加入 user ID、workspace ID 和 trace ID。
- 指标标签必须低基数，禁止使用用户 ID、设备 ID、对象 key 或原始 URL 作为 Prometheus label。
- 权限拒绝、审计失败、设备数据源错误和导出任务结果应有可监控信号。
- trace 应覆盖 API、权限判断、平台库、设备数据源、导出任务和对象存储等关键边界。
- 健康检查区分进程存活与依赖就绪；新增关键依赖时评估是否加入 readiness。
- 反向代理场景必须显式配置可信代理，不能无条件信任客户端转发的 IP header。

## 前端规则

- 前端功能、角色边界、路由职责和关键流程遵循 `docs/frontend-functional-design.md`。
- 前端功能契约变化时同步更新该文档；不要在其中维护重构进度、负责人或完成百分比。
- 保持系统后台与 Workspace 控制台的身份和导航边界，不把系统运维能力放进普通控制台。
- Workspace 是普通控制台的全局上下文；所有 Workspace 资源查询和 mutation 必须使用当前选择并在切换后刷新相关缓存。
- UI 隐藏或禁用操作不能替代后端授权；前端应根据权限改善体验，后端仍是最终裁决者。
- API 调用集中在 `frontend/src/lib/api.ts`，页面不得散落原始 `fetch` 或重复 DTO。
- TanStack Query key 必须包含影响结果的 workspace、resource ID、filter 和分页参数；mutation 成功后只失效相关缓存。
- 页面必须提供 loading、empty、error、success/feedback 和 destructive confirmation 状态。
- 高风险操作必须清楚展示作用范围和后果，不使用含糊的确认文案。
- 资源 ID 应可复制，但页面主标签优先显示人类可读名称、序列号和上下文。
- 保持桌面和移动端可用；表格、筛选器、弹窗、抽屉和图表不得溢出或遮挡。
- 大型页面和第三方播放器应按路由或功能懒加载，避免进入控制台时加载无关代码。
- 前端重构可以更换组件和目录，但不得无意改变功能设计文档中的业务不变量。

## 测试与验证

- Go 代码变更后运行 `gofmt` 和 `go test ./...`。
- 并发、认证、队列或共享状态变更应运行 `go test -race ./...`。
- 提交前运行可用的静态检查；新增告警不得被忽略或通过降低规则规避。
- SQL 查询变更运行 `make sqlc` 和 Go 测试。
- migration 变更运行完整 up，并验证对应 down/up。
- 前端变更至少运行 `npm --prefix frontend run build`；功能行为变更应增加单元、组件或端到端测试。
- API 变更必须验证 OpenAPI 能解析，并核对 router method/path 与文档一致。
- 涉及 PostgreSQL、Redis、设备数据源、对象存储或 Worker 的流程应优先增加真实依赖集成测试。
- 权限测试必须包含允许和拒绝路径，特别关注跨 Workspace、过期授权、外部分享和系统管理员边界。
- 不把手工 HTTP 验证当作长期自动化测试的替代品。

## 开发流程

- 开始修改前运行 `git branch --show-current` 和 `git status --short`。
- 日常开发在 `dev` 分支进行；`main` 只用于稳定集成、发布或明确的热修。
- 工作区可能包含用户未提交改动。先阅读 diff，保留并兼容这些改动，不重置、不覆盖、不顺手提交无关文件。
- 不使用 `git reset --hard`、`git checkout -- <file>` 等破坏性命令，除非用户明确要求。
- 修改范围应聚焦请求，不做无关重构或格式化。
- 优先沿用现有包边界、命名和依赖，只有在确实降低复杂度时才新增抽象。
- 注释解释原因、边界和非显然行为，不复述代码。
- 依赖变更后运行 `go mod tidy` 或更新前端 lockfile，并提交 manifest 与 lockfile。
- 提交前检查 `.env`、日志、构建产物、临时文件和真实密钥未进入暂存区。
- commit 使用简洁的 Conventional Commits 风格，并保持单一目标。

## 常用命令

```bash
make db-up
make db-down
make migrate-up
make migrate-down MIGRATE_STEPS=1
make sqlc
make test
make run-api
make run-worker
make frontend-install
make run-frontend
make build-frontend

go test -race ./...
go vet ./...
npm --prefix frontend run build
git diff --check
```
