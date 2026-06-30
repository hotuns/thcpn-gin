# thcpn-gin Agent Guide

本文件给后续参与本仓库开发的 Codex/Agent 使用。开始任何实现前，先阅读：

- `iot_research_permission_mvp.md`
- `iot_research_go_backend_dev_guide.md`
- 本文件

**最小化可选评论。在执行过程中，仅发送必要的通知、阻塞性问题、有意义的进度更新、风险/验证说明以及最终结果。**

## 项目定位

- 本项目是科研物联网数据管理平台后端，不负责 MQTT 接入、设备上报解析或实时采集写入。
- 当前阶段是 Go 模块化单体，包含 `api` 和 `worker` 两个进程。
- 平台业务库是 PostgreSQL，设备采集数据源库与平台业务库必须分离。
- Redis 用于后续 Worker/Asynq、缓存和异步任务基础设施。
- 第一版权限主线是 `Role + Scope + AccessGrant + AuditLog`。

## 当前技术栈

- Go module: `thcpn-gin`
- Go version: `1.26.4`
- HTTP: Gin
- PostgreSQL: `pgxpool`
- SQL generation: sqlc
- Migration: golang-migrate through Docker
- Redis: go-redis
- Logger: standard library `log/slog`
- Config: YAML plus environment variable overrides

## 重要目录

- `cmd/api`: API 服务入口。
- `cmd/worker`: Worker 服务入口。
- `internal/app`: Gin router and service wiring.
- `internal/config`: 配置加载、默认值、环境变量覆盖和校验。
- `internal/logger`: slog 初始化。
- `internal/db`: PostgreSQL/Redis 连接与健康检查。
- `internal/db/sqlc`: sqlc 生成代码，禁止手改。
- `internal/httpx`: request id、统一错误响应、HTTP middleware。
- `internal/datasource`: 未来所有设备数据源读取适配器都应放这里。
- `migrations`: PostgreSQL 平台业务库迁移。
- `sql/queries`: sqlc 查询定义。
- `configs/config.example.yaml`: 示例配置。

## 常用命令

```bash
make db-up
make db-down
make migrate-up
make migrate-down
make sqlc
make test
make run-api
make run-worker
```

## 健康检查

- `GET /healthz`: 只判断 API 进程是否存活。
- `GET /readyz`: 判断 PostgreSQL 和 Redis 是否可用。

正常响应：

```json
{"status":"ok"}
```

依赖不可用时，`/readyz` 返回统一错误结构：

```json
{
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "postgres is not ready",
    "request_id": "..."
  }
}
```

## 配置约束

- 不要提交真实 `.env`、数据库密码、JWT 密钥、对象存储密钥或设备数据源 DSN。
- 示例配置只写入 `.env.example` 和 `configs/config.example.yaml`。
- `CONFIG_FILE` 可指定 YAML 配置文件。
- 关键环境变量：
  - `SERVER_ADDR`
  - `PLATFORM_DATABASE_DSN`
  - `REDIS_ADDR`
  - `REDIS_PASSWORD`
  - `REDIS_DB`

## 数据库和 sqlc 规则

- 修改 schema 时必须新增 migration，不要直接改已应用 migration，除非项目仍处在明确允许重写历史的初始化阶段。
- 每个 migration 必须有对应 down 文件，并验证 `migrate-up` 和 `migrate-down`。
- 修改 `sql/queries` 后必须运行 `make sqlc`。
- `internal/db/sqlc` 是生成代码，禁止手动编辑。
- 业务代码应通过 sqlc 或封装好的 repository/query 方法访问平台业务库。
- 平台业务库不保存大量原始设备采集数据。

## 架构边界

- 业务模块不得直接拼接或访问设备数据源 SQL。
- 所有设备数据查询必须通过 `internal/datasource` 的适配层。
- 用户请求不能直接传入 `table_name`、`field_name`、`raw_sql`。
- 设备数据查询必须有时间范围、分页或点数上限。
- 大范围查询应走异步导出任务，不应在 API 请求中同步返回。
- 媒体预览/下载 URL 不应是永久公开 URL。

## 权限模型约束

- 不要只按角色判断权限；必须同时考虑 scope。
- MVP scope 包含：
  - `workspace`
  - `project`
  - `site`
  - `device`
  - `dataset`
- Workspace 权限覆盖该 workspace 下资源。
- Project 权限覆盖该 project 下的 site、device、dataset。
- Site 权限覆盖该 site 下的 device。
- Device 和 Dataset 权限只覆盖自身。
- 外部个人分享、售后临时授权和局部授权走 `AccessGrant`，不要把临时外部人员直接加入 `workspace_members`。
- 图片/视频权限必须独立于时序数据权限。
- 售后权限必须显式授权、可过期、可审计。

## 审计规则

以下操作属于高风险或敏感操作，后续实现时必须写 audit log：

- 登录和异常登录
- 创建组织空间
- 邀请成员
- 修改成员角色
- 设备绑定、解绑、转移
- 修改设备配置
- 设备校准
- 固件升级
- 创建数据集
- 导出时序数据
- 下载图片或视频
- 导出数据集
- 分享资源和撤销分享
- 授权售后
- 售后访问设备
- 删除数据或媒体

敏感操作失败也应按操作风险写审计。

## API 和错误响应

统一错误响应格式：

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "permission denied",
    "request_id": "req_123"
  }
}
```

常用错误码：

- `INVALID_ARGUMENT`
- `UNAUTHORIZED`
- `PERMISSION_DENIED`
- `NOT_FOUND`
- `CONFLICT`
- `RATE_LIMITED`
- `INTERNAL`
- `DATA_SOURCE_ERROR`
- `EXPORT_TOO_LARGE`
- `SERVICE_UNAVAILABLE`

新增 API 时应先经过认证和权限判断，再执行业务逻辑。

## 开发守则

- 优先沿用现有包边界和命名风格，不要引入新的框架层级。
- 保持模块化单体，不要提前拆微服务。
- 不要在第一版引入复杂 ABAC/ReBAC 引擎、审批流、组织树或设备接入重构。
- 代码变更后运行 `gofmt`。
- 依赖变更后运行 `go mod tidy`。
- 查询或 migration 变更后运行 `make sqlc`。
- 提交前至少运行 `make test`。
- 涉及 Docker PostgreSQL/Redis、migration 或健康检查时，运行对应的 `make db-up`、`make migrate-up` 和 `/readyz` 验证。

## Git 提交指引

- 提交前先运行 `git status --short`，确认没有把 `.env`、真实密钥、临时日志、构建产物或本地缓存加入暂存区。
- 每次提交应聚焦一个可描述的开发目标；不要把无关重构、格式化和功能变更混在同一个 commit。
- 提交信息使用简洁的 Conventional Commits 风格：
  - `feat: add workspace registration flow`
  - `fix: handle inactive user auth`
  - `docs: update agent development guide`
  - `chore: refresh generated sqlc code`
- 涉及 migration、sqlc 或 Go 依赖时，提交中必须包含配套文件：
  - migration 变更同时提交 `migrations/*.up.sql` 和 `migrations/*.down.sql`
  - query 变更同时提交 `sql/queries/*.sql` 和 `internal/db/sqlc/*`
  - dependency 变更同时提交 `go.mod` 和 `go.sum`
- 提交前根据变更范围运行验证：
  - Go 代码变更：`gofmt` 后运行 `make test`
  - SQL 查询或 schema 变更：运行 `make sqlc` 和 `make test`
  - migration 变更：运行 `make migrate-up`，必要时运行 `make migrate-down MIGRATE_STEPS=1 && make migrate-up`
- 如果工作区里有他人或用户的未提交修改，不要重置、覆盖或顺手提交无关文件；先用 `git diff` 和 `git status` 分清变更来源。
- 不使用破坏性命令清理工作区，例如 `git reset --hard` 或 `git checkout -- <file>`，除非用户明确要求。
