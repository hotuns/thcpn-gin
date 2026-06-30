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
- Redis 用于后续 Asynq、缓存和异步任务基础设施。
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
- Auth: JWT HS256 access token, bcrypt password hash, SMS verification code in Redis
- SMS sender: `log` / `noop` / Aliyun Dysmsapi
- Web: Vite + React + TypeScript，独立工程位于 `web/`

## 已实现功能

### 基础工程

- 已初始化 Go 模块化单体工程，包含 `cmd/api` 和 `cmd/worker` 两个入口。
- API 已接入 Gin、request id、结构化 access log、panic recovery 和统一错误响应。
- Worker 已完成配置、日志、PostgreSQL、Redis 初始化、优雅退出和 ExportJob 轮询处理；尚未接入 Asynq 真实任务。
- 已提供 Docker Compose 本地基础设施：PostgreSQL、Redis、migrate 工具容器。
- 已提供 Makefile 常用命令：`db-up`、`db-down`、`migrate-up`、`migrate-down`、`sqlc`、`test`、`run-api`、`run-worker`、`web-install`、`run-web`、`build-web`。
- 已提供配置加载：默认值、YAML 配置、环境变量覆盖。
- 已提供独立 Web 前端，可通过 Vite dev server 调用本地 API。

### 健康检查

- `GET /healthz`：API 进程存活检查。
- `GET /readyz`：检查 PostgreSQL 和 Redis 是否可用。
- 依赖不可用时使用统一错误结构返回 `SERVICE_UNAVAILABLE`。

### 数据库和 sqlc

- 已有 migration：
  - `000001_init`：启用 `pgcrypto`，创建 `app_metadata`。
  - `000002_accounts_permissions`：创建账户、Workspace、成员、角色、权限和角色权限表。
  - `000003_auth_credentials`：为 `users` 增加验证/登录时间字段，创建 `user_credentials` 密码凭证表。
- 已 seed 系统权限基础数据：
  - 10 个系统角色：`owner`、`admin`、`project_manager`、`site_operator`、`data_manager`、`researcher`、`viewer`、`shared_viewer`、`shared_downloader`、`service_engineer`。
  - 34 个权限点。
  - 173 条 `role_permissions` 矩阵记录。
- sqlc 已生成平台业务库查询代码到 `internal/db/sqlc`。

### 账户和认证

- 已实现开发注册接口：`POST /api/v1/auth/register`。
- 开发注册由 `auth.dev_register_enabled` / `AUTH_DEV_REGISTER_ENABLED` 控制；默认开发开启，生产应关闭。
- 已实现密码注册接口：`POST /api/v1/auth/password/register`。
- 已实现密码登录接口：`POST /api/v1/auth/password/login`。
- 已实现短信验证码发送接口：`POST /api/v1/auth/sms/send`。
- 已实现短信验证码登录/自动注册接口：`POST /api/v1/auth/sms/login`。
- 注册类流程在事务中完成：
  - 创建 `users` 记录。
  - 自动创建 personal workspace。
  - 自动创建 Owner membership。
- 密码注册额外创建 `user_credentials`，密码使用 bcrypt 哈希保存，不保存明文密码。
- 短信登录使用 Redis 保存验证码哈希，不把验证码写入 PostgreSQL；手机号不存在时自动创建用户和 personal workspace。
- 已实现 JWT access token 签发和校验，claims 使用 `sub=user_id`、`iat`、`exp`。
- API 认证 middleware 优先读取 `Authorization: Bearer <token>`。
- 仍保留开发期 `X-User-ID` fallback，由 `auth.dev_user_header_enabled` / `AUTH_DEV_USER_HEADER_ENABLED` 控制；默认开发开启，生产应关闭。
- 已实现当前用户接口：`GET /api/v1/me`。
- 账号密码登录失败会累计失败次数，默认 5 次后锁定 15 分钟。
- 短信验证码默认 5 分钟有效、60 秒冷却、单手机号每日 10 次、最多 5 次校验尝试。
- 阿里云短信 sender 已接入，但本地默认使用 `sms.provider=log`，避免测试消耗短信费用。

### Workspace

- 已实现创建 organization workspace：`POST /api/v1/workspaces`。
- 已实现当前用户 workspace 列表：`GET /api/v1/workspaces`。
- 创建 organization workspace 时，创建者自动成为 Owner。
- personal workspace 只能由注册流程自动创建。
- organization type 当前支持：`lab`、`institution`、`company`、`government`、`service_provider`、`other`。

### 权限检查

- 已实现 `permission.Checker`。
- 当前 checker 支持 `workspace`、`project`、`site`、`device`、`data_stream`、`dataset` 资源解析。
- 当前 checker 先基于 `workspace_members` + `roles` + `role_permissions` 判断 workspace 成员权限，再基于有效 `access_grants` 判断局部授权权限。
- 当前 AccessGrant 覆盖规则：
  - `workspace` grant 覆盖 workspace 下资源。
  - `project` grant 覆盖 project 下 site、device、data_stream。
  - `site` grant 覆盖 site 下 device、data_stream。
  - `device` grant 覆盖 device 和其 data_stream。
  - `dataset` grant 覆盖单个 dataset。
- 成员管理接口已经使用 `member.manage` 做实际权限保护。

### Workspace 成员管理

- 已实现成员管理接口：
  - `GET /api/v1/workspaces/:workspace_id/members`
  - `POST /api/v1/workspaces/:workspace_id/members`
  - `PATCH /api/v1/workspaces/:workspace_id/members/:member_id`
  - `DELETE /api/v1/workspaces/:workspace_id/members/:member_id`
- 所有成员管理接口都需要 JWT；开发环境也可在配置允许时使用 `X-User-ID` fallback。当前用户必须对目标 workspace 拥有 `member.manage`。
- 添加成员只支持已注册 active 用户，可用 `user_id`、`email` 或 `phone` 三选一指定。
- 添加 workspace member 只允许内部成员角色：`owner`、`admin`、`project_manager`、`site_operator`、`data_manager`、`researcher`、`viewer`。
- 明确不允许把 `shared_viewer`、`shared_downloader`、`service_engineer` 作为 workspace member；这些应走后续 `AccessGrant`。
- 删除成员是软删除：`workspace_members.status = 'removed'`。
- 已保护最后一个 active Owner：不允许删除最后一个 Owner，也不允许把最后一个 Owner 改成非 Owner 角色。

### 项目、站点、设备和数据流

- 已新增平台业务库资源模型 migration `000004_assets`：
  - `projects`
  - `sites`
  - `devices`
  - `device_capabilities`
  - `data_streams`
- 已实现 Project 管理接口：
  - `GET /api/v1/projects?workspace_id=...`
  - `POST /api/v1/projects`
  - `GET /api/v1/projects/:project_id`
  - `PATCH /api/v1/projects/:project_id`
- 已实现 Site / Station 管理接口：
  - `GET /api/v1/sites?workspace_id=...`
  - `POST /api/v1/sites`
  - `GET /api/v1/sites/:site_id`
  - `PATCH /api/v1/sites/:site_id`
- 已实现 Device 资产管理接口：
  - `GET /api/v1/devices?workspace_id=...`
  - `POST /api/v1/devices`
  - `GET /api/v1/devices/:device_id`
  - `PATCH /api/v1/devices/:device_id`
- 已实现 DataStream 元信息接口：
  - `GET /api/v1/data-streams?device_id=...`
  - `POST /api/v1/data-streams`
  - `GET /api/v1/data-streams/:data_stream_id`
  - `PATCH /api/v1/data-streams/:data_stream_id`
- 已新增设备数据源元信息 migration `000008_data_sources`：
  - `data_sources`
  - `data_stream_bindings`
- 已实现 DataSource 元信息接口：
  - `GET /api/v1/data-sources?workspace_id=...`
  - `POST /api/v1/data-sources`
  - `GET /api/v1/data-sources/:data_source_id`
  - `PATCH /api/v1/data-sources/:data_source_id`
- 已实现 DataStreamBinding 元信息接口：
  - `GET /api/v1/data-stream-bindings?data_stream_id=...`
  - `POST /api/v1/data-stream-bindings`
  - `GET /api/v1/data-stream-bindings/:binding_id`
  - `PATCH /api/v1/data-stream-bindings/:binding_id`
- DataSource 只保存 `dsn_secret_ref`，不保存明文 DSN。
- DataStreamBinding 保存已审核的库/表/字段映射；用户侧 Telemetry/Media 查询后续不得直接传入 `table_name`、`field_name` 或 `raw_sql`。
- 已实现 PostgreSQL Telemetry 运行时适配器：
  - `dsn_secret_ref` 当前支持 `env:NAME`，运行时从环境变量读取 DSN。
  - 只支持 `payload_type = columns` 的 telemetry 查询。
  - 查询 SQL 只使用 DataStreamBinding 中已校验的表名/字段名，设备 key、时间范围和 limit 均使用参数绑定。
- 已实现 Telemetry Query 接口：
  - `GET /api/v1/devices/:device_id/telemetry?start_time=...&end_time=...&limit=...`
  - `GET /api/v1/data-streams/:data_stream_id/telemetry?start_time=...&end_time=...&limit=...`
  - 需要 `telemetry.view_history` 权限；时间范围和点数受 `query_limits` 限制。
- 已实现 PostgreSQL Media Query 运行时适配器：
  - 只支持 `payload_type = media` 的 image/video/audio 查询。
  - `query_config` 可配置 `id_field`、`object_key_field`、`thumbnail_key_field`、`media_type_field` 和 `media_type`。
  - 预览、缩略图和下载 URL 使用 HMAC + 过期时间签名，不返回永久公开 URL。
- 已实现 Media Query / Download 接口：
  - `GET /api/v1/devices/:device_id/media?start_time=...&end_time=...&media_type=...&page=...&page_size=...`
  - `GET /api/v1/devices/:device_id/media/images?start_time=...&end_time=...`
  - `GET /api/v1/devices/:device_id/media/videos?start_time=...&end_time=...`
  - `GET /api/v1/data-streams/:data_stream_id/media?start_time=...&end_time=...&page=...&page_size=...`
  - `GET /api/v1/media/download?token=...`
  - 列表需要 `media.archive_view`；下载需要 `media.download` 并写 audit log。
- 当前阶段三资源接口均需要 JWT；开发环境也可在配置允许时使用 `X-User-ID` fallback。
- 当前阶段三资源接口需要对应资源权限：
  - Project: `project.view` / `project.manage`
  - Site: `site.view` / `site.manage`
  - Device: `device.view` / `device.bind` / `device.configure`
  - DataStream: `device.view` / `device.configure`
  - DataSource: `workspace.manage`
  - DataStreamBinding: `device.configure`
  - Telemetry Query: `telemetry.view_history`
  - Media Query: `media.archive_view`
  - Media Download: `media.download`
- 设备绑定会记录 `bound_by`、`activated_at` 并写入 audit log。

### Dataset

- 已新增 Dataset 元信息 migration `000007_datasets`：
  - `datasets`
  - `dataset_sources`
- 已实现 Dataset 元信息和查询定义接口：
  - `GET /api/v1/datasets?workspace_id=...&project_id=...`
  - `POST /api/v1/datasets`
  - `GET /api/v1/datasets/:dataset_id`
  - `PATCH /api/v1/datasets/:dataset_id`
  - `DELETE /api/v1/datasets/:dataset_id`
- 当前 Dataset 第一版保存 query definition / metadata；导出通过 ExportJob 异步任务元信息创建，Worker 真正生成文件仍待实现。
- Dataset source 当前支持 `device`、`data_stream`、`file`；`device` / `data_stream` 会校验所属 workspace，带 `project_id` 时也校验所属 project。
- Dataset 权限动作：`dataset.view`、`dataset.create`、`dataset.delete`，将状态更新为 `locked` 时需要 `dataset.lock`。
- Dataset scope AccessGrant 已接入 checker，可授权到单个 dataset。

### ExportJob

- 已新增导出任务 migration：
  - `000009_export_jobs` 创建 `export_jobs`。
  - `000010_export_job_request_config` 给导出任务保存 `request_config_json`，用于 Worker 获取 `start_time`、`end_time`、`limit` 等任务参数。
- 已实现 ExportJob API：
  - `GET /api/v1/export-jobs?mine=true&workspace_id=...&limit=...`
  - `POST /api/v1/export-jobs`
  - `GET /api/v1/export-jobs/:export_job_id`
  - `GET /api/v1/export-jobs/:export_job_id/download`
  - `POST /api/v1/datasets/:dataset_id/export`
- 支持的导出任务类型：
  - `telemetry_csv` / `telemetry_excel`，资源为 `device` 或 `data_stream`，需要 `telemetry.export`。
  - `dataset_zip`，资源为 `dataset`，需要 `dataset.export`。
  - `media_zip`，资源为 `device`、`data_stream` 或媒体 data-stream alias，需要 `media.download`。
- API 当前创建 `pending` 任务、记录文件过期时间，并为成功任务生成临时对象下载 URL。
- Worker 当前可 claim `pending` 任务、过期旧任务、生成并上传导出文件，然后把任务更新为 `success` 或 `failed`：
  - `telemetry_csv`：支持 `device` / `data_stream` 资源，使用任务 `request_config_json.start_time`、`end_time`、`limit` 查询已绑定 PostgreSQL telemetry 数据源并生成 CSV。
  - `dataset_zip`：支持 Dataset 元信息 ZIP，包含 `dataset.json`、`sources.csv`，并为 telemetry 类型的 device / data_stream source 生成 CSV。
  - `telemetry_excel` 和 `media_zip` Worker 真生成仍待实现。
- 对象存储当前支持本地文件后端（`object_store.provider=file`）和 MinIO/S3 SigV4 PUT；下载 URL 在配置访问密钥时使用 S3 预签名 GET，否则回退为平台 HMAC 临时 URL。
- 导出任务创建和下载准备会写 audit log；按 workspace 查询全量导出任务需要 `audit.view`，默认列表只返回当前用户创建的任务。

### AccessGrant 和 Invitation

- 已新增分享和临时授权 migration `000005_access_grants`：
  - `access_grants`
  - `invitations`
- 已实现 AccessGrant 接口：
  - `GET /api/v1/access-grants?workspace_id=...`
  - `POST /api/v1/access-grants`
  - `GET /api/v1/access-grants/mine`
  - `DELETE /api/v1/access-grants/:access_grant_id`
- 已实现 Invitation 接口：
  - `GET /api/v1/invitations?workspace_id=...`
  - `POST /api/v1/invitations`
  - `GET /api/v1/invitations/mine`
  - `POST /api/v1/invitations/:invitation_id/accept`
  - `DELETE /api/v1/invitations/:invitation_id`
- AccessGrant 第一版只支持 `subject_type = user`。
- 可授权角色：`project_manager`、`site_operator`、`data_manager`、`researcher`、`viewer`、`shared_viewer`、`shared_downloader`、`service_engineer`；不允许通过 AccessGrant 授予 `owner` 或 `admin`。
- `service_engineer` 授权必须设置 `expires_at`，且 scope 只能是 `device` 或 `site`。
- 对已注册用户创建 AccessGrant 时，目标用户可用 `subject_user_id`、`email` 或 `phone` 三选一指定。
- 对未注册用户使用 Invitation，邀请人可用 `email` 或 `phone` 三选一指定；被邀请用户注册或登录后，若账号 email/phone 匹配，可 accept invitation 并转换为 AccessGrant。
### AuditLog

- 已新增审计日志 migration `000006_audit_logs`，创建 `audit_logs`。
- 已实现审计查询接口：`GET /api/v1/audit-logs?workspace_id=...&limit=...`，需要 `audit.view`。
- 已对当前已实现的敏感操作写入 audit log：
  - 密码注册、密码登录、短信登录成功和失败。
  - 创建 organization workspace 成功和失败。
  - 添加成员、修改成员角色、删除成员成功和失败。
  - 设备绑定、设备配置修改成功和失败。
  - 创建 AccessGrant、撤销 AccessGrant 成功和失败。
  - 创建 Invitation、接受 Invitation、撤销 Invitation 成功和失败。
  - `service_engineer` 授权使用 `service_access.grant` action 写审计。
  - 创建、更新、锁定、删除 Dataset 成功和失败。
  - 媒体下载成功和权限拒绝。
  - 创建导出任务成功和失败，导出文件下载准备成功和失败。
- 审计日志记录 actor、action、resource、result、reason、ip、user_agent、request_id 和 created_at。

### 已验证事项

- `make sqlc` 可正常生成代码。
- `go test ./...` / `make test` 通过。
- `make migrate-up` 可迁移到版本 10。
- `make migrate-down MIGRATE_STEPS=1` 已验证 `000010` down 可用，随后已重新 `make migrate-up` 到版本 10。
- 已通过真实 HTTP 验证健康检查、密码注册、密码登录、JWT 调 `/me`、短信验证码发送、短信登录自动注册、JWT 调 workspace 列表、普通成员 JWT 访问成员管理被拒绝。
- 已通过真实 HTTP 验证 Project / Site / Device / DataStream 创建和列表查询。
- 已通过真实 HTTP 验证 DataSource 创建/列表，以及 DataStreamBinding 创建/列表。
- 已通过真实 HTTP 验证 PostgreSQL Telemetry Query：创建外部表样例、配置 `env:PLATFORM_DATABASE_DSN` DataSource、绑定 DataStream 后返回 2 个时序点。
- 已通过真实 HTTP 验证 PostgreSQL Media Query：创建媒体表样例、绑定 image DataStream 后返回 2 条媒体记录，`/media/download` 返回临时对象 URL，并确认 `media.download` audit log 写入。
- 已通过真实 HTTP 验证 Dataset ExportJob：`POST /api/v1/datasets/:dataset_id/export` 创建 `pending` 任务，`GET /api/v1/export-jobs?mine=true` 可查到任务，pending 下载返回 409；手动标记 success 后 `/export-jobs/:id/download` 返回临时对象 URL，并确认 `dataset.export` audit log 写入。
- 已通过真实 API + Worker 验证 Telemetry CSV 导出：创建设备、DataStream、DataSource、DataStreamBinding 和外部样例表后，`POST /api/v1/export-jobs` 创建 `telemetry_csv` 任务，`WORKER_RUN_ONCE=true go run ./cmd/worker` 将任务处理为 `success`，本地对象存储生成 CSV，`/export-jobs/:id/download` 返回 200。
- 已通过真实 HTTP 验证 AccessGrant：未授权用户访问 device 被拒绝，创建 `shared_viewer` device grant 后可读取 device，但仍不能 PATCH device。
- 已通过真实 HTTP 验证 `service_engineer` device grant 必须通过显式 grant 创建并带过期时间。
- 已通过真实 HTTP 验证 Invitation：创建 project invitation、受邀用户在 `/invitations/mine` 看到邀请、accept 后可读取 project。
- 已通过真实 HTTP 验证 audit log 写入和 `GET /api/v1/audit-logs?workspace_id=...` 查询。
- 此前已通过真实 HTTP 验证开发注册、workspace 列表、创建 organization workspace、添加成员、列成员、更新成员角色、普通成员访问成员管理被拒绝、删除成员。

### 尚未实现

- Refresh token、退出登录、session 黑名单、设备会话管理、MFA、邮箱验证码/邮箱验证。
- Export Worker 的 `telemetry_excel`、真实媒体文件 `media_zip` 打包、Asynq 队列化和更完整对象存储集成。
- Project / Site / Device / DataStream / Dataset 当前完成资产、元信息、查询定义、PostgreSQL telemetry 读取和 PostgreSQL media 记录查询；Project / Site / DataStream 变更审计可后续按风险扩展。
- 尚未实现模块的敏感操作审计仍待对应模块落地时接入，例如设备校准、固件升级和设备转移。
- MySQL / ClickHouse / HTTP DataSource 运行时适配器。
- Asynq 真实任务、对象存储、Prometheus、OpenTelemetry。

## 重要目录

- `cmd/api`: API 服务入口。
- `cmd/worker`: Worker 服务入口。
- `internal/app`: Gin router and service wiring.
- `internal/config`: 配置加载、默认值、环境变量覆盖和校验。
- `internal/logger`: slog 初始化。
- `internal/db`: PostgreSQL/Redis 连接与健康检查。
- `internal/db/sqlc`: sqlc 生成代码，禁止手改。
- `internal/httpx`: request id、统一错误响应、HTTP middleware。
- `internal/audit`: AuditLog 写入和查询。
- `internal/accessgrant`: AccessGrant、Invitation、外部分享和售后临时授权。
- `internal/project`: Project 管理。
- `internal/site`: Site / Station 管理。
- `internal/device`: Device 资产和 capability 管理。
- `internal/datastream`: DataStream 元信息管理。
- `internal/datasource`: DataSource / DataStreamBinding 元信息和设备数据源运行时适配器。
- `internal/telemetry`: 时序数据查询 workflow。
- `internal/media`: 图片、视频、音频媒体查询和下载 workflow。
- `internal/objectstore`: 对象存储 URL / 下载 token 签名。
- `internal/export`: 导出任务创建、查询、下载准备和权限审计 workflow。
- `migrations`: PostgreSQL 平台业务库迁移。
- `sql/queries`: sqlc 查询定义。
- `web`: 独立前端工程，使用 Vite proxy 调用后端 `/api`、`/healthz`、`/readyz`。
- `configs/config.example.yaml`: 示例配置。
- `docs/openapi.yaml`: 当前已实现 HTTP API 的 OpenAPI 3.1 文档，新增/调整接口时必须同步更新。

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
make web-install
make run-web
make build-web
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
  - `JWT_SECRET`
  - `AUTH_ACCESS_TOKEN_TTL_MINUTES`
  - `AUTH_DEV_USER_HEADER_ENABLED`
  - `AUTH_DEV_REGISTER_ENABLED`
  - `SMS_PROVIDER`
  - `SMS_CODE_TTL_SECONDS`
  - `SMS_COOLDOWN_SECONDS`
  - `SMS_DAILY_LIMIT`
  - `SMS_MAX_VERIFY_ATTEMPTS`
  - `ALIYUN_ACCESS_KEY_ID`
  - `ALIYUN_ACCESS_KEY_SECRET`
  - `ALIYUN_SMS_SIGN_NAME`
  - `ALIYUN_SMS_TEMPLATE_CODE`

## 认证开发约束

- 业务接口优先使用 `Authorization: Bearer <token>`；不要新增只依赖 `X-User-ID` 的正式接口。
- `X-User-ID` 只作为开发期 fallback，生产环境必须关闭 `AUTH_DEV_USER_HEADER_ENABLED`。
- `POST /api/v1/auth/register` 是开发注册接口，生产环境必须关闭 `AUTH_DEV_REGISTER_ENABLED`。
- 本地/测试默认使用 `SMS_PROVIDER=log` 或 `noop`；只有配置好阿里云环境变量并确认模板审核通过后才使用 `aliyun`。
- 短信验证码只存 Redis，value 保存 code hash、attempt count 和过期信息；不要把明文验证码写入数据库或响应体。
- 密码必须通过 `ValidatePassword` 校验，并使用 `bcrypt` 保存哈希；不要保存明文密码或可逆加密密码。
- 当前 JWT 只有 access token，没有 refresh token 或黑名单；实现退出登录、踢下线或会话管理前，不要假设 token 可主动失效。

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
