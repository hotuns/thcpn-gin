# 科研物联网平台 Go 后端开发说明

## 1. 文档目标

本文档用于指导科研物联网平台后端第一版开发。

当前前提：

```text
设备数据接收服务已经完成。
设备数据已经落库。
平台后端不负责 MQTT 接入、设备上报解析、实时数据写入。
平台后端主要负责从不同设备数据库读取数据，并提供用户、组织、权限、分享、数据集、导出和审计能力。
```

因此，本平台第一版不是完整的“设备接入平台”，而是：

```text
科研物联网数据管理平台
```

核心目标：

- 管理个人用户、组织空间、项目、站点、设备资产。
- 支持科研院所、公司、政府单位、服务商和个人用户。
- 基于 `Role + Scope + AccessGrant` 实现权限控制。
- 支持单独分享资源给某个人。
- 支持售后临时授权。
- 从多个设备数据源读取时序数据、图片记录和视频记录。
- 平台系统级维护 DataSource、adapter、设备列表、外部设备源映射和 THCPN gateway-node 拓扑；当前设备由系统管理员同步并单一分配到 Workspace，普通用户只管理已分配设备和数据。
- 支持数据集创建、查询、导出和分享。
- 对敏感操作进行审计。

---

## 2. 总体架构

### 2.1 架构定位

平台后端分为三部分：

```text
1. Platform API
   面向前端、管理后台和外部 API 调用。

2. Worker
   处理数据导出、数据集归档、批量媒体打包、过期授权清理等异步任务。

3. Data Source Adapter
   根据平台设备映射从不同设备数据库读取数据，并转换成平台统一格式。
```

### 2.2 架构图

```text
Web / Admin / OpenAPI Client
          |
          v
   Go Platform API
          |
          |-- Auth / User / Workspace
          |-- Project / Site / Device
          |-- Device Source Mapping
          |-- Permission / AccessGrant
          |-- Dataset / Export
          |-- Telemetry Query
          |-- Media Query
          |-- Audit
          |
          |-- Platform DB: PostgreSQL
          |
          |-- Redis
          |
         |-- Object Storage: Alibaba Cloud OSS / local file
          |
          v
   Data Source Adapter
          |
          |-- Device DB A: MySQL
          |-- Device DB B: PostgreSQL
          |-- Device DB C: ClickHouse, optional
          |-- Existing Media Index DB
```

### 2.3 设计原则

```text
平台业务库和设备数据源库分离。
平台系统级维护设备列表和外部设备源映射。
设备源 adapter 在代码中注册，是系统级读取/配置能力，不属于 Workspace。
DataSource 是系统级设备源实例，由系统管理员、部署配置或内部脚本维护。
Workspace Owner / Admin 只管理自己空间内已分配设备和业务资源，不管理 DataSource、adapter、DSN、库表字段映射、JSONPath 或 raw SQL。
权限判断只在平台层完成。
设备数据源库不承担用户权限判断。
业务模块不直接拼接不同设备库 SQL。
所有设备数据查询必须通过 Data Source Adapter。
所有导出和媒体下载必须审计。
大范围数据查询必须走异步任务。
```

---

## 3. 技术栈选型

### 3.1 后端语言

```text
Go
```

选择理由：

- 部署简单。
- 性能和资源占用稳定。
- 适合长期运行的 API 和 Worker。
- 并发处理、数据库访问、导出任务实现直接。
- 适合模块化单体，后续也能平滑拆服务。

### 3.2 推荐技术栈

```text
HTTP 框架：Gin
业务数据库：PostgreSQL
业务数据库访问：pgx + sqlc
设备数据读取：
  - PostgreSQL：pgx
  - MySQL：go-sql-driver/mysql
  - ClickHouse：clickhouse-go，按需引入
数据库迁移：golang-migrate
缓存：Redis + go-redis
异步任务：Asynq
对象存储：Alibaba Cloud OSS，local file 用于本地开发
权限：自研 Role + Scope + AccessGrant
API 文档：OpenAPI + oapi-codegen
日志：log/slog
监控指标：Prometheus client_golang
链路追踪：OpenTelemetry
测试：testing + testify + testcontainers-go
代码质量：golangci-lint
配置管理：环境变量 + YAML，可使用 koanf
参数校验：go-playground/validator
```

### 3.3 第一版暂不引入

```text
MQTT client
NATS
Kafka
设备接入服务 ingest
设备命令下发服务
复杂权限引擎，如 OpenFGA / Ory Keto
复杂工作流引擎，如 Temporal
完整微服务架构
```

说明：

这些能力不是不能用，而是当前阶段不属于最小可行后端。第一版应优先保证资源模型、权限模型、多数据源读取、数据导出和审计链路正确。

---

## 4. 服务进程

第一版建议两个 Go 进程：

```text
api
worker
```

### 4.1 api

`api` 进程负责：

```text
用户登录和认证
个人空间和组织空间管理
成员管理
项目管理
站点管理
设备资产管理
权限判断
分享和授权管理
设备源映射读取
设备配置快照查询
数据流查询
图片/视频记录查询
数据集管理
导出任务创建
审计日志查询
```

### 4.2 worker

`worker` 进程负责：

```text
CSV / Excel 导出
数据集打包
图片 / 视频批量打包
过期 AccessGrant 清理
过期下载文件清理
定时报表
耗时统计任务
```

Worker 使用 Asynq 作为第一版异步任务队列。

---

## 5. 推荐项目结构

```text
cmd/
  api/
    main.go
  worker/
    main.go

internal/
  app/
  config/
  logger/
  db/
  httpx/
  auth/
  user/
  workspace/
  member/
  project/
  site/
  device/
  datastream/
  datasource/
  telemetry/
  media/
  dataset/
  export/
  permission/
  accessgrant/
  audit/
  objectstore/
  task/

migrations/
  000001_init.up.sql
  000001_init.down.sql

sql/
  queries/
    user.sql
    workspace.sql
    project.sql
    site.sql
    device.sql
    datastream.sql
    datasource.sql
    permission.sql
    accessgrant.sql
    dataset.sql
    audit.sql

api/
  openapi.yaml

configs/
  config.example.yaml

test/
  integration/
```

### 5.1 目录职责

| 目录 | 职责 |
|---|---|
| `cmd/api` | API 服务入口 |
| `cmd/worker` | Worker 服务入口 |
| `internal/config` | 配置加载 |
| `internal/logger` | 日志初始化 |
| `internal/db` | 平台业务库连接 |
| `internal/httpx` | HTTP 中间件、错误响应、分页等公共能力 |
| `internal/auth` | 登录、Token、认证中间件 |
| `internal/workspace` | 个人空间、组织空间 |
| `internal/member` | Workspace 成员 |
| `internal/project` | 项目 |
| `internal/site` | 站点 |
| `internal/device` | 设备资产 |
| `internal/datastream` | 数据流元信息 |
| `internal/datasource` | 多设备数据库连接和读取适配 |
| `internal/telemetry` | 时序数据查询 |
| `internal/media` | 图片、视频记录查询和访问 |
| `internal/dataset` | 数据集 |
| `internal/export` | 导出任务 |
| `internal/permission` | 权限判断 |
| `internal/accessgrant` | 分享、临时授权 |
| `internal/audit` | 审计日志 |
| `internal/objectstore` | OSS / local file 对象访问 |
| `internal/task` | Asynq 任务定义和调度 |

---

## 6. 平台业务数据库

### 6.1 业务库职责

平台业务库保存平台自己的业务数据：

```text
用户
Workspace
组织成员
角色
权限
项目
站点
设备资产
数据流元信息
设备源配置引用
外部设备映射
设备配置快照
数据集
分享和临时授权
导出任务
审计日志
```

平台业务库不保存大量原始设备采集数据。设备采集数据仍然保留在现有设备数据库中。

### 6.2 核心表

第一版建议包含：

```text
users
workspaces
workspace_members
roles
permissions
role_permissions
projects
sites
devices
device_capabilities
data_streams
device_source_refs
device_config_snapshots
data_stream_bindings
datasets
dataset_sources
access_grants
invitations
export_jobs
audit_logs
```

---

## 7. 多设备数据源读取

### 7.1 DeviceSourceConfig

由于设备数据已经落在不同数据库中，平台需要知道每类设备源如何连接和读取。DataSource 是系统级设备源实例，adapter 是系统级读取/配置能力，二者都不属于 Workspace。第一版预计只有三到四类设备数据来源，因此不建设客户侧设备数据源管理；THCPN 接入仅提供系统管理员后台维护系统级 DataSource。

推荐做法：

```text
adapter registry 写在代码里，是系统级能力。
THCPN 设备源实例由系统管理员后台维护为系统级 DataSource；其他特殊源可先写在部署配置、环境变量、seed 或内部脚本里。
平台库保存系统级设备、设备映射、配置快照、DataStream 和绑定关系。
系统管理员把系统级设备单一分配给 Workspace。
普通 Workspace 用户只消费已分配设备的数据，不查看、不创建、不修改设备源或 adapter。
```

配置示例：

```text
device_sources:
  thcpn_legacy:
    adapter_code: thcpn_legacy_mysql
    dsn_secret_ref: env:THCPN_LEGACY_MYSQL_DSN
    table_index: device_data_index
    table_prefix: device_data_
    status: active
```

说明：

```text
source_code 是平台内部稳定标识，例如 thcpn_legacy。
adapter_code 对应代码中注册的 adapter。
dsn_secret_ref 不直接保存明文数据库密码。
真实连接串应放在环境变量、配置中心、Secret Manager 或加密配置中。
source_code、DataSource 和 adapter 不属于任何 workspace；客户权限边界来自分配后的 Device / DataStream / Dataset。
```

当前代码实现保留 `data_sources` 表作为系统级设备源实例配置载体，`data_sources.type` 表示物理连接类型，例如 `postgres`、`mysql`、`clickhouse` 或 `http_api`，不再保存工作区归属字段。THCPN 设备源由 `system_admins` 中的有效管理员通过 `/api/v1/admin/data-sources` 和前端 `/admin/data-sources` 维护；普通 Workspace 控制台不暴露 DataSource、DSN、库表字段或 adapter 配置。运行时业务分发不再按 `data_sources.type` 决定，而是按 `data_stream_bindings.adapter_code` 决定。

### 7.2 DataStreamBinding

平台需要知道某个数据流从哪个设备源、哪个外部设备、哪段配置和哪个受控字段读取。

`DataStreamBinding` 是平台内部读取映射。它可以由同步任务、seed 或内部脚本从外部设备配置表生成。普通用户不能在前端提交 `table_name`、`field_name`、`raw_sql` 或任意 JSONPath。

```text
data_stream_bindings
- id
- data_stream_id
- data_source_id
- adapter_code: generic_columns / generic_media / http_api / thcpn_legacy_mysql
- table_name nullable
- device_key_field nullable
- device_key_value nullable
- time_field nullable
- value_field nullable
- payload_type: columns / json / media
- adapter_config_json
- status
- created_at
- updated_at
```

通用列式数据源可以继续使用受控配置：

```text
data_stream: soil_moisture_10cm
data_source_id: <internal source instance>
adapter_code: generic_columns
table_name: device_data_2026
device_key_field: sn
device_key_value: THCPN001
time_field: collect_time
value_field: soil_moisture_10
payload_type: columns
```

媒体索引类标准表使用 `generic_media`，媒体字段从 `adapter_config_json` 读取：

```text
data_stream: camera_1_image
data_source_id: <internal source instance>
adapter_code: generic_media
table_name: media_index
device_key_field: sn
device_key_value: THCPN001
time_field: captured_at
payload_type: media
adapter_config_json: {"object_key_field":"object_key","id_field":"media_id","media_type":"image"}
```

THCPN 旧 MySQL 设备库应使用专门 adapter，而不是把分表和 JSON 解析规则暴露给普通用户。当前代码第一阶段已实现 `thcpn_legacy_mysql` 只读 adapter：同步入口读取旧库 `devices` 和最新 `device_config`，生成系统级平台 Device，并将 Device 单一分配给目标 Workspace，同时生成 DeviceSourceRef、DeviceConfigSnapshot、DataStream 和 DataStreamBinding；查询入口按 `device_data_index` 定位 `device_data_*` 分表并读取 telemetry/image JSON key。下面是 `adapter_config_json` 使用的受控字段示例：

```json
{
  "external_device_id": 101,
  "row_type": "data",
  "json_key": "stemp",
  "value_path": "$.\"stemp\".value",
  "table_index": "device_data_index",
  "table_name_field": "tb_name",
  "index_start_field": "start_at",
  "index_end_field": "end_at",
  "time_field": "ts",
  "deleted_at_field": "deleted_at"
}
```

媒体流使用同样原则：

```json
{
  "external_device_id": 101,
  "row_type": "image",
  "image_key": "key1",
  "object_key_path": "$.\"key1\".value",
  "media_type": "image",
  "table_index": "device_data_index",
  "table_name_field": "tb_name",
  "index_start_field": "start_at",
  "index_end_field": "end_at",
  "time_field": "ts",
  "deleted_at_field": "deleted_at"
}
```

### 7.2.1 DeviceSourceRef 和配置快照

平台设备和外部设备库记录之间需要独立映射：

```text
device_source_refs
- id
- workspace_id
- device_id
- data_source_id
- adapter_code
- external_device_id
- external_sn
- external_uuid
- external_device_type
- status
- synced_at
- created_at
- updated_at
```

对于 THCPN 旧库，设备数据行通过 `device_config_id` 指向当时的设备配置。平台应同步设备配置快照，用于解释历史 `data` JSON key：

```text
device_config_snapshots
- id
- device_id
- data_source_id
- adapter_code
- external_config_id
- external_device_id
- version
- data_json
- image_json
- control_json
- source_created_at
- source_updated_at
- synced_at
- created_at
```

历史数据解释必须优先使用数据行对应的 `device_config_id` 或配置快照，而不是设备当前最新配置。

### 7.3 Data Source Adapter

业务层不直接访问设备数据库。所有设备数据读取都通过 `internal/datasource`。

推荐接口：

```go
type Manager interface {
    Get(ctx context.Context, sourceID string) (DataSource, error)
}

type DataSource interface {
    Type() string
    QueryTelemetry(ctx context.Context, req TelemetryQuery) (*TelemetryResult, error)
    QueryMedia(ctx context.Context, req MediaQuery) (*MediaResult, error)
    Health(ctx context.Context) error
}
```

推荐按数据库类型实现：

```text
PostgresDataSource
MySQLDataSource
ThcpnLegacyMySQLDataSource
ClickHouseDataSource
HTTPDataSource, optional
```

### 7.4 查询安全要求

数据源适配层必须防止任意 SQL 注入和越权查询。

要求：

```text
表名和字段名只能来自平台业务库中已审核配置。
用户请求不能直接传入 table_name、field_name、raw_sql。
时间范围必须有上限。
分页必须有上限。
大范围查询必须走异步导出。
```

---

## 8. 权限模型

### 8.1 核心模型

第一版采用：

```text
Role + Scope + AccessGrant
```

判断公式：

```text
是否允许操作 =
用户身份有效
+ 用户是资源所属 Workspace 成员，或拥有有效 AccessGrant
+ 用户角色包含目标权限
+ 授权范围覆盖目标资源
+ 当前资源策略允许
```

### 8.2 Scope

第一版支持：

```text
workspace
project
site
device
dataset
```

继承规则：

```text
workspace 覆盖 workspace 下所有资源
project 覆盖 project 下所有 site、device、dataset
site 覆盖 site 下所有 device
device 只覆盖该 device
dataset 只覆盖该 dataset
```

### 8.3 权限判断接口

推荐：

```go
type Checker interface {
    Can(ctx context.Context, actor Actor, action string, resource ResourceRef) (Decision, error)
}

type Actor struct {
    UserID string
}

type ResourceRef struct {
    Type string
    ID   string
}

type Decision struct {
    Allowed bool
    Reason  string
}
```

所有业务接口必须先鉴权再执行业务。

示例：

```text
查询历史数据：
permission.Can(user, "telemetry.view_history", device)

导出数据集：
permission.Can(user, "dataset.export", dataset)

下载图片：
permission.Can(user, "media.download", media_resource)

授权售后：
permission.Can(user, "service_access.grant", device)
```

### 8.4 AccessGrant

`AccessGrant` 用于：

```text
单独分享给某个人
分享给外部协作者
授权售后工程师
授权服务账号
后续支持授权给公司/组织
```

表结构建议：

```text
access_grants
- id
- workspace_id
- subject_type: user / workspace / service_account
- subject_id
- role_id
- scope_type: workspace / project / site / device / dataset
- scope_id
- expires_at
- allow_reshare
- allow_api_access
- created_by
- status: active / revoked / expired
- created_at
- updated_at
```

第一版必须支持：

```text
subject_type = user
```

后续可以扩展：

```text
subject_type = workspace
subject_type = service_account
```

### 8.5 设备源运维边界

设备源配置、外部设备映射同步和 DataStreamBinding 生成属于平台内部运维能力，不纳入客户 Workspace 权限模型。

第一版建议通过部署配置、seed、CLI 或内部脚本维护这些内容。如果后续暴露 HTTP 管理接口，再单独设计内部运维身份和权限，不要复用 `workspace_members` 或客户 `access_grants`。

内部运维动作示例：

```text
ops.device_source.configure
ops.device_registry.sync
ops.stream_binding.generate
ops.datasource_health.view
ops.break_glass_access
```

`ops.break_glass_access` 必须强制填写原因、资源范围、时间范围，并写入 audit log；它不能绕过导出、下载和客户授权审计。

---

## 9. 数据查询模块

### 9.1 Telemetry Query

时序数据查询由 `internal/telemetry` 负责。

查询流程：

```text
1. API 接收查询请求。
2. 根据 device_id / data_stream_id 查平台业务库。
3. 判断用户是否有 telemetry.view_history 或 telemetry.view_realtime。
4. 查询平台已生成的 data_stream_binding。
5. 根据 source_code 获取设备源配置。
6. 调用 Data Source Adapter。
7. 返回统一格式。
```

用户请求只表达业务资源和时间范围，不暴露或接受 source_code、库表名、字段名、JSONPath 或 raw SQL。

请求参数必须包含：

```text
device_id 或 data_stream_id
start_time
end_time
limit 或 interval
```

示例返回：

```json
{
  "device_id": "dev_001",
  "stream": "soil_moisture_10cm",
  "unit": "%",
  "points": [
    {
      "ts": "2026-06-01T00:00:00Z",
      "value": 23.4,
      "quality": "valid"
    }
  ]
}
```

### 9.2 查询限制

第一版建议默认限制：

```text
实时查询：默认最近 24 小时
历史页面查询：默认最多 31 天
单次返回点数：最多 5000
更大范围查询：创建 export_job
```

所有限制应配置化。

### 9.3 Media Query

图片和视频由 `internal/media` 负责。

查询流程：

```text
1. API 接收图片/视频列表请求。
2. 鉴权 media.archive_view 或 media.live_view。
3. 根据平台已生成的 data_stream_binding 查询媒体记录所在设备源。
4. 返回媒体元信息和短期预览 URL。
5. 下载原图/视频时再次鉴权 media.download。
6. 写 audit_log。
```

媒体列表接口不应返回永久公开 URL。

推荐返回：

```json
{
  "items": [
    {
      "id": "img_001",
      "device_id": "dev_001",
      "captured_at": "2026-06-01T08:00:00Z",
      "thumbnail_url": "temporary-signed-url",
      "preview_url": "temporary-signed-url",
      "download_allowed": false
    }
  ],
  "page": 1,
  "page_size": 50,
  "total": 120
}
```

---

## 10. 数据集模块

### 10.1 Dataset 定位

`Dataset` 是科研数据资产，不等同于设备本身。

设备可以转移、退役或维修，但历史 Dataset 仍然属于原 Workspace / Project。

第一版 Dataset 可以先做成：

```text
查询定义 + 元信息
```

不要求立即把所有数据物化到新表。

### 10.2 数据表

```text
datasets
- id
- workspace_id
- project_id nullable
- name
- description
- data_type
- time_start
- time_end
- status: draft / locked / archived / published
- created_by
- created_at
- updated_at
```

```text
dataset_sources
- id
- dataset_id
- source_type: device / data_stream / file
- source_id
```

### 10.3 Dataset 查询

流程：

```text
1. 用户请求 dataset.view。
2. 鉴权。
3. 读取 dataset_sources。
4. 按平台已生成的 data_stream_binding 查询设备源。
5. 返回统一数据结构。
```

### 10.4 Dataset 导出

流程：

```text
1. 用户请求 dataset.export。
2. API 鉴权。
3. API 创建 export_job。
4. Worker 读取 dataset_sources。
5. Worker 从不同设备数据源读取数据。
6. 生成 CSV / Excel / ZIP。
7. 上传对象存储。
8. 更新 export_job 状态。
9. 写 audit_log。
```

---

## 11. 导出模块

### 11.1 ExportJob

```text
export_jobs
- id
- workspace_id
- requested_by
- resource_type: device / data_stream / dataset / media
- resource_id
- export_type: telemetry_csv / telemetry_excel / media_zip / dataset_zip
- status: pending / running / success / failed / expired
- file_object_key
- error_message
- created_at
- started_at
- finished_at
- expires_at
```

### 11.2 导出要求

```text
大范围数据必须异步导出。
导出文件必须有过期时间。
导出下载必须鉴权。
导出操作必须审计。
导出文件应保存到对象存储。
```

### 11.3 导出格式

第一版支持：

```text
CSV
Excel，可选
ZIP
```

建议第一版优先实现 CSV 和 ZIP。Excel 可以后续根据客户需求增加。

---

## 12. 审计模块

### 12.1 必须审计的操作

```text
登录和异常登录
创建组织空间
邀请成员
修改成员角色
设备分配
设备解绑
设备转移
修改设备配置
设备校准
固件升级
创建数据集
导出时序数据
下载图片或视频
导出数据集
分享资源
撤销分享
授权售后
售后访问设备
删除数据或媒体
修改设备源部署配置
修改外部设备映射或 DataStreamBinding
内部排障访问客户设备数据
```

### 12.2 审计表

```text
audit_logs
- id
- workspace_id
- actor_type: user / service_account / system
- actor_id
- action
- resource_type
- resource_id
- result: success / failure
- reason
- ip
- user_agent
- request_id
- created_at
```

### 12.3 审计写入原则

```text
敏感操作成功要写审计。
敏感操作失败也要写审计。
售后访问客户设备必须写审计。
导出和下载必须写审计。
权限拒绝可按操作敏感度写审计。
```

---

## 13. API 设计规范

### 13.1 路由风格

建议：

```text
/api/v1/auth/login
/api/v1/workspaces
/api/v1/workspaces/{workspace_id}/members
/api/v1/projects
/api/v1/sites
/api/v1/devices
/api/v1/devices/{device_id}/transfer
/api/v1/devices/{device_id}/unbind
/api/v1/devices/{device_id}/telemetry
/api/v1/devices/{device_id}/media/images
/api/v1/data-streams
/api/v1/datasets
/api/v1/datasets/{dataset_id}/export
/api/v1/access-grants
/api/v1/audit-logs
/api/v1/admin/data-sources
/api/v1/admin/data-sources/{data_source_id}/thcpn-standard-station/devices
/api/v1/admin/devices
/api/v1/admin/devices/{device_id}/assignment
```

第一版不提供客户侧设备源管理 API 或页面。普通 `/api/v1/data-sources` 和 `/api/v1/data-stream-bindings` 不再注册为客户侧路由；普通 Workspace 控制台不暴露 DataSource 创建、查看、DSN、库表字段映射或 raw SQL 配置入口。系统级 THCPN 数据源管理迁入 `/api/v1/admin/data-sources` 与 `/admin/data-sources`，由系统管理员同步系统级设备资产并生成外部设备映射、配置快照和 DataStreamBinding；设备是否分配给 Workspace 由 `/api/v1/admin/devices/{device_id}/assignment` 和后台系统设备资产 / 设备分配入口单独管理。

### 13.2 错误响应

统一错误格式：

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

```text
INVALID_ARGUMENT
UNAUTHORIZED
PERMISSION_DENIED
NOT_FOUND
CONFLICT
RATE_LIMITED
INTERNAL
DATA_SOURCE_ERROR
EXPORT_TOO_LARGE
```

### 13.3 分页

统一分页参数：

```text
page
page_size
```

或对大数据列表使用：

```text
cursor
limit
```

设备数据点查询不建议用普通 page，而应使用：

```text
start_time
end_time
limit
interval
```

---

## 14. 配置管理

### 14.1 配置文件示例

```yaml
server:
  addr: ":8080"

database:
  platform_dsn_env: "PLATFORM_DATABASE_DSN"

redis:
  addr: "127.0.0.1:6379"
  db: 0

object_store:
  provider: "oss"
  endpoint: "https://oss-cn-beijing.aliyuncs.com"
  bucket: "iot-platform"
  region: "cn-beijing"
  local_path: "var/objectstore"
  public_url_prefix: ""
  access_key_env: "OBJECT_STORE_ACCESS_KEY"
  secret_key_env: "OBJECT_STORE_SECRET_KEY"

query_limits:
  max_history_days: 31
  max_points: 5000
  max_media_page_size: 100

export:
  file_ttl_hours: 72
```

### 14.2 敏感配置

以下内容不得提交到 Git：

```text
数据库密码
对象存储密钥
JWT 签名密钥
第三方 API Key
设备数据源连接串
```

---

## 15. 可观测性

### 15.1 日志字段

所有请求日志建议包含：

```text
request_id
trace_id
method
path
status
duration_ms
user_id
workspace_id
resource_type
resource_id
error
```

### 15.2 关键指标

Prometheus 指标建议：

```text
http_requests_total
http_request_duration_seconds
db_query_duration_seconds
datasource_query_duration_seconds
datasource_errors_total
export_jobs_total
export_job_duration_seconds
permission_denied_total
audit_write_errors_total
```

### 15.3 链路追踪

建议对以下链路打 trace：

```text
API 请求
权限判断
平台库查询
设备数据源查询
导出任务
对象存储上传
```

---

## 16. 测试要求

### 16.1 单元测试

必须覆盖：

```text
权限判断
Scope 覆盖关系
AccessGrant 过期和撤销
设备源运维动作和 Workspace 权限隔离
普通用户不能管理设备源配置 / DataStreamBinding
数据查询参数校验
导出任务状态流转
```

### 16.2 集成测试

建议使用 `testcontainers-go` 启动：

```text
PostgreSQL
Redis
MySQL, 如需要测试设备数据源
OSS mock 或本地 file store, 如需要测试对象存储
```

重点测试：

```text
用户能否访问授权项目下设备
用户不能访问其他 Workspace 设备
外部分享过期后失效
售后工程师不能导出科研数据
Shared Viewer 不能下载媒体
Shared Downloader 可以导出指定 Dataset
大范围查询会被拒绝并提示走导出
Workspace Owner / Admin 不能配置设备源、库表字段或 raw SQL
Workspace Owner / Admin 不能创建、查看或修改 DataSource / adapter
设备必须先由系统同步并分配到 Workspace 后才进入普通业务权限模型
设备源 adapter registry 能按 source_code 选择正确 adapter
设备分配和普通查询流程不接受 DSN、表名、字段名、JSONPath 或 raw SQL
```

### 16.3 CI 检查

每次提交至少执行：

```text
go test ./...
go test -race ./...
golangci-lint run
sqlc generate 校验
migrate up/down 校验
```

---

## 17. 开发顺序建议

### 阶段一：基础工程和业务库

目标：

```text
项目骨架
配置加载
日志
PostgreSQL 连接
Redis 连接
数据库迁移
sqlc
统一错误响应
认证中间件框架
```

交付：

```text
api 服务可以启动
health check 可用
业务库 migration 可执行
CI 基础流程可跑
```

### 阶段二：用户、Workspace、角色权限

目标：

```text
User
Workspace
WorkspaceMember
Role
Permission
RolePermission
Permission Checker
```

交付：

```text
用户注册后自动创建 personal workspace
支持创建 organization workspace
支持成员管理
支持基础角色权限判断
```

### 阶段三：设备源适配和设备映射

目标：

```text
AdapterRegistry
DeviceSourceConfig
DeviceSourceRef
DeviceConfigSnapshot
DataStreamBinding
```

交付：

```text
代码中注册三到四类系统级设备源 adapter
系统级 DataSource 由系统管理员后台、部署配置、环境变量或 seed 维护
系统可以同步或录入平台设备和外部设备映射，并将设备单一分配到 Workspace
系统可以从设备配置快照发现 DataStream
普通 Workspace 用户不能创建、查看或修改 DataSource / adapter / DataStreamBinding
```

### 阶段四：项目、站点、设备资产

目标：

```text
Project
Site
Device
DataStream
DeviceCapability
```

交付：

```text
可管理项目、站点、设备
系统级设备可分配到 workspace，并可选挂到 project / site
设备分配后可查看平台已生成的数据流
```

### 阶段五：AccessGrant 和分享

目标：

```text
AccessGrant
Invitation
Shared Viewer
Shared Downloader
Service Engineer
```

交付：

```text
支持分享 Dataset / Device / Project 给某个用户
支持未注册用户邀请
支持售后临时授权
支持撤销分享
```

### 阶段六：多数据源读取

目标：

```text
DeviceSourceConfig
DataStreamBinding
PostgresDataSource
MySQLDataSource
ThcpnLegacyMySQLDataSource
Telemetry Query
Media Query
```

交付：

```text
可以从至少一种现有设备数据库读取数据
查询返回统一格式
支持时间范围和分页限制
用户查询不接受 source_code、库表字段或 raw SQL
```

### 阶段七：Dataset 和 Export

目标：

```text
Dataset
DatasetSource
ExportJob
Asynq Worker
Object Storage
```

交付：

```text
可以创建数据集
可以导出数据集
可以导出时序数据 CSV
可以打包媒体文件
```

### 阶段八：审计和可观测性

目标：

```text
AuditLog
Prometheus Metrics
OpenTelemetry Trace
关键操作审计
```

交付：

```text
敏感操作全量审计
API 日志带 request_id
设备数据源查询耗时可观测
导出任务状态可观测
```

---

## 18. 第一版验收标准

### 18.1 用户和组织

```text
用户注册后自动拥有 personal workspace。
用户可以创建 organization workspace。
organization workspace 支持 company / lab / institution 等类型。
Owner 可以邀请和管理成员。
```

### 18.2 权限

```text
Owner 可以管理 workspace 下所有资源。
Owner / Admin 不能管理 DataSource、adapter、设备源连接、外部设备映射或 DataStreamBinding。
Project Manager 只能管理授权 project。
Site Operator 只能维护授权 site 下设备。
Researcher 可以查看授权范围内数据。
Shared Viewer 只能查看被分享资源。
Shared Downloader 可以下载被分享数据。
Service Engineer 只能在授权时间内维护指定设备。
```

### 18.3 数据查询

```text
用户只能查询自己有权限的设备数据。
平台可以从至少一种现有设备数据库读取数据。
查询接口支持时间范围限制。
大范围查询不能直接同步返回。
用户查询和设备分配后的普通业务流程不接受 DSN、库表字段、JSONPath 或 raw SQL。
```

### 18.4 数据集和导出

```text
用户可以创建 Dataset。
用户可以把 Dataset 分享给某个人。
用户可以导出授权 Dataset。
导出任务异步执行。
导出文件有过期时间。
```

### 18.5 审计

```text
数据导出有审计。
媒体下载有审计。
售后授权有审计。
设备校准和固件升级有审计。
分享和撤销分享有审计。
设备源配置、外部设备映射和 DataStreamBinding 修改有审计。
内部排障访问客户设备数据有审计。
```

---

## 19. 不建议第一版实现的能力

```text
完整微服务拆分
复杂组织树
复杂审批流
完整 ABAC / ReBAC 权限引擎
多级代理商体系
设备接入重构
实时流处理平台
字段级数据脱敏
完整科研数据版本发布系统
允许客户 Workspace 管理 DataSource、adapter、设备数据库连接、密钥、库表字段映射或 raw SQL
为了三到四类固定设备源，第一版建设复杂的设备数据源管理后台
```

这些能力可以在第一版稳定后，根据真实客户需求逐步扩展。

---

## 20. 最终建议

第一版后端应围绕以下主线开发：

```text
Go 模块化单体
+ PostgreSQL 平台业务库
+ 代码内置 Adapter Registry
+ 设备源部署配置和外部设备映射
+ 多设备数据库 Data Source Adapter
+ Role + Scope + AccessGrant 权限模型
+ Dataset 数据资产模型
+ Asynq 异步导出
+ Alibaba Cloud OSS / local file 对象存储
+ AuditLog 敏感操作审计
```

当前阶段最重要的不是引入更多基础设施，而是把以下边界做清楚：

```text
平台业务数据和设备采集数据的边界。
设备源运维配置和客户 Workspace 资源管理的边界。
用户组织权限和外部分享权限的边界。
设备资产和科研数据集的边界。
同步查询和异步导出的边界。
普通查看和敏感下载/导出的边界。
客户权限和售后权限的边界。
```

只要这些边界清晰，平台后续无论是支持更多设备类型、更多数据库类型、更多客户组织类型，还是扩展审批、服务商、数据发布和高级分析，都可以在现有模型上继续演进。
