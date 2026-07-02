# 科研物联网平台设备与数据权限 MVP 方案

## 1. 文档目标

本文档定义科研物联网平台第一版权限体系的最小可行方案，目标是在不过度复杂化的前提下，同时支持以下客户和业务场景：

- 个人用户购买和管理设备。
- 科研院所、实验室、课题组按项目和站点管理设备。
- 非科研公司、政府单位、服务商作为组织客户使用平台。
- 将设备、数据集、项目或站点单独分享给某个人。
- 将指定资源授权给外部协作者、合作公司或售后工程师。
- 对数据导出、媒体下载、设备校准、固件升级、设备转移等敏感操作进行审计。

第一版方案的核心设计原则是：

```text
用户不直接拥有全部设备权限。
设备源、adapter 和设备资产由 THCPN 平台系统级维护。
系统管理员从设备库同步 Device，并将 Device 单一分配给某个 Workspace。
Device 分配给 Workspace 后，Workspace 才拥有项目、站点、数据流、数据集和权限边界。
普通 Workspace 用户只管理已分配到本 Workspace 的设备和数据，不管理设备数据库连接、库表字段、JSONPath、adapter 或 raw SQL。
用户通过角色和资源范围获得权限。
外部分享和临时授权通过 AccessGrant 实现。
所有敏感操作必须审计。
```

---

## 2. 适用范围

本方案适用于以下设备和数据类型：

- 气象监测站。
- 土壤监测站。
- 图像采集设备。
- 视频监控设备。
- 水质、环境、农业、实验室等特殊场景监测设备。
- 设备产生的时序数据、图片、视频、事件、日志和归档数据集。

本方案第一版重点解决：

- 账号和组织空间。
- 项目和站点管理。
- 系统级设备分配到 Workspace，并可选挂到 Project / Site。
- 数据流和数据集。
- 角色权限。
- 单人分享。
- 外部协作。
- 售后临时授权。
- 审计日志。

第一版暂不重点解决：

- 复杂组织树，例如学校、学院、实验室、课题组多层级组织架构。
- 完整自定义权限策略引擎。
- 复杂审批流。
- 多级代理商体系。
- 细粒度字段级数据脱敏。
- 完整数据版本管理和科研数据发布流程。

这些能力可以在后续版本基于 MVP 模型扩展。

---

## 3. 核心概念

### 3.1 User

`User` 是登录账号，可以是个人用户、学生、老师、企业员工、售后工程师、外部专家等。

一个用户可以同时属于多个 Workspace，也可以被多个 Workspace 单独授权访问资源。

示例：

```text
张三
- 个人空间
- 华中农业大学作物生态课题组
- 某农业科技公司共享给他的一个数据集
```

### 3.2 Workspace

`Workspace` 是客户侧权限隔离和业务资源管理的基本单位。

Workspace 不拥有 DataSource、adapter 或系统级设备注册表。系统级 Device 分配到 Workspace 后，该 Workspace 才能管理该设备对应的项目、站点、数据流、数据集、分享、导出和审计。

第一版建议支持两类：

```text
personal      个人空间
organization 组织空间
```

组织空间再通过 `organization_type` 区分实际类型：

```text
lab                  实验室/课题组
institution           科研院所/高校
company               公司
government            政府单位
service_provider      服务商
other                 其他
```

不要把平台限制为只支持科研院所。公司、政府单位、服务商都应统一建模为 `organization workspace`。

### 3.3 Project

`Project` 表示科研项目、课题、业务项目或客户项目。

示例：

```text
冻土区土壤水热监测
小麦生长图像监测
温室环境监测项目
河道水质监测项目
客户 A 运维项目
```

### 3.4 Site / Station

`Site` 表示设备部署点、观测站、样地、场站、点位或试验区。

示例：

```text
那曲 1 号站
试验田 A 区
温室 3 号棚
河道断面 2
客户农场北区
```

### 3.5 Device

`Device` 表示平台系统级维护的真实物联网设备资产。

设备由系统管理员或系统同步流程从外部设备库同步到平台，再通过 `device_assignments` 单一分配给某个 Workspace。`device_assignments.workspace_id` 表示设备当前分配目标和权限边界；可选 `project_id` / `site_id` 表示该 Workspace 内的业务挂载位置。

第一版不支持一个设备同时分配给多个 Workspace。跨 Workspace 使用设备应通过设备转移或 AccessGrant 分享完成。

示例：

```text
气象土壤综合监测站 001
图像监控站 002
视频监控设备 003
CO2 监测设备 004
```

### 3.6 DataStream

`DataStream` 表示设备产生的数据通道。

示例：

```text
空气温度
空气湿度
土壤湿度 10cm
土壤温度 30cm
降雨量
图片抓拍
视频流
设备运行日志
```

### 3.7 Dataset

`Dataset` 表示可归档、可导出、可分享的数据集合。

科研场景里，Dataset 非常重要。因为设备可能转移或退役，但历史数据仍然要保留、导出、共享、引用或用于项目验收。

示例：

```text
2026 年玉米拔节期观测数据
那曲站 2026 上半年土壤水热数据
温室 A 区 2026-06 图像数据集
论文支撑数据集 V1
```

### 3.8 AccessGrant

`AccessGrant` 表示对某个用户、组织或服务账号的局部授权。

它用于：

- 分享一个数据集给某个人。
- 分享一个项目给外部合作方。
- 临时授权售后工程师维护一台设备。
- 授权某个公司访问一个数据集。
- 授权某个服务账号读取指定项目数据。

AccessGrant 是实现“单独分享给某个人”的核心机制。

### 3.9 Device Source Mapping

`Device Source Mapping` 表示平台设备和外部设备数据库记录之间的映射关系。

第一版预计只有三到四类设备数据来源，因此不需要把设备数据源做成客户侧可管理资源。当前 THCPN 接入采用系统管理员后台维护系统级 DataSource，普通 Workspace 用户不接触 DSN、库表字段或 adapter 配置：

- DataSource 是系统级设备源实例，由系统管理员维护。
- adapter 是系统级读取/配置能力，由平台代码注册，不属于任何 Workspace。
- THCPN 设备源实例通过 `/api/v1/admin/data-sources` 和 `/admin/data-sources` 维护；其他特殊源可继续通过部署配置或环境变量维护。
- 系统管理员同步外部设备时指定 `target_workspace_id`，平台库维护系统级设备列表、外部设备 ID / SN / ICCID 映射，并将设备单一分配给目标 Workspace。
- 平台库保存外部最新 `device_config` 快照，并用最新配置解释历史数据；无法匹配的数据给出提示并跳过。
- DataStream 从配置快照解析生成，用户只看到业务数据流。

Workspace 用户使用的是已分配到本 Workspace 的平台设备，不是外部数据库。查询数据时，平台根据设备映射和 adapter 自动去对应设备库读取数据，并转换成统一格式。

---

## 4. MVP 功能边界

第一版必须支持以下能力：

1. 用户注册后自动创建 `personal workspace`。
2. 用户可以创建 `organization workspace`。
3. `organization workspace` 支持科研院所、实验室、公司、政府单位、服务商等类型。
4. Workspace 下可以创建 Project。
5. Project 下可以创建 Site / Station。
6. 系统级 Device 单一分配到 Workspace，可选挂到 Project / Site。
7. Device 下可以产生多个 DataStream。
8. 平台维护设备列表、外部设备映射和设备配置快照。
9. 设备源 adapter 在代码中注册，DataSource 由系统管理员或部署配置维护。
10. 设备分配到 Workspace 后，系统展示该设备已审核的数据流、图片流和视频流。
11. 支持创建 Dataset，把一段时间、某些设备或数据流的数据归档成数据集。
12. 权限采用 `role + scope` 模型。
13. Scope 支持 `workspace / project / site / device / dataset`。
14. 支持 AccessGrant，把指定资源分享给某个用户。
15. 支持 Invitation，把指定资源分享给尚未注册的手机号或邮箱。
16. 图片和视频权限必须与普通时序数据权限分开。
17. 售后权限必须是显式授权，可设置过期时间，并写审计日志。
18. 数据导出、媒体下载、设备校准、固件升级、设备转移必须写审计日志。

---

## 5. 权限模型

### 5.1 基本公式

权限判断公式：

```text
是否允许操作 =
用户身份有效
+ 用户是资源所属 Workspace 的成员，或拥有有效 AccessGrant
+ 用户角色包含目标操作权限
+ 授权范围覆盖目标资源
+ 资源策略允许当前操作
+ 敏感操作满足审计、确认或临时授权要求
```

### 5.2 Role + Scope

不要只判断用户是什么角色，还要判断角色在哪个范围内生效。

示例：

```text
陈老师：Owner，scope = workspace
刘老师：Project Manager，scope = project
李工：Site Operator，scope = site
王同学：Researcher，scope = project
外部专家：Shared Viewer，scope = dataset
售后工程师：Service Engineer，scope = device，48 小时后过期
```

### 5.3 Scope 层级

第一版支持以下授权范围：

```text
workspace
project
site
device
dataset
```

推荐继承规则：

```text
workspace 权限覆盖该 workspace 下所有资源
project 权限覆盖该 project 下所有 site、device、dataset
site 权限覆盖该 site 下所有 device
device 权限只覆盖该 device
dataset 权限只覆盖该 dataset
```

第一版不建议支持复杂的显式 deny 规则。推荐：

```text
默认无权限。
有明确 grant 才有权限。
敏感操作通过策略和审计加强控制。
```

---

## 6. 第一版角色

### 6.1 角色清单

第一版建议内置以下系统角色：

```text
Owner
Admin
Project Manager
Site Operator
Data Manager
Researcher
Viewer
Shared Viewer
Shared Downloader
Service Engineer
```

### 6.2 角色说明

| 角色 | 主要使用对象 | 推荐范围 | 说明 |
|---|---|---|---|
| Owner | 个人空间拥有者、课题组负责人、公司负责人 | workspace | 最高权限，管理成员、资源、分享、审计 |
| Admin | 组织管理员、实验室管理员 | workspace / project | 管理项目、站点、设备、成员和数据 |
| Project Manager | 项目负责人 | project | 管理指定项目下的站点、设备和数据 |
| Site Operator | 站点负责人、现场运维 | site | 维护站点设备、查看数据、处理设备问题 |
| Data Manager | 数据管理员、研究助理 | project / dataset | 管理数据集、导出、共享、质量标记 |
| Researcher | 学生、研究员、协作者 | project / dataset | 查看和下载授权范围内的数据 |
| Viewer | 领导、客户、只读用户 | workspace / project / site / device / dataset | 只读查看 |
| Shared Viewer | 外部个人、专家、临时协作者 | project / site / device / dataset | 外部只读分享 |
| Shared Downloader | 外部协作者、算法人员 | dataset / project | 外部查看并下载 |
| Service Engineer | 厂商售后、服务商工程师 | device / site | 临时维护和诊断，默认不允许导出科研数据 |

设备源配置、adapter、外部设备映射和系统级设备注册表不放入上面的 Workspace 角色矩阵。Workspace Owner / Admin 可以管理自己空间内的项目、站点、已分配设备、成员和数据集，但不能管理设备数据库连接、原始库表字段映射、适配器密钥、系统级设备注册表或跨 Workspace 的设备分配规则。

### 6.3 内部成员与外部分享的区别

`workspace_member` 表示组织内部成员。

`access_grant` 表示局部授权、临时授权或外部分享。

推荐规则：

```text
长期参与组织管理的人，加入 workspace_members。
只访问某个项目、设备或数据集的人，使用 access_grants。
售后工程师默认使用 access_grants，不加入客户 workspace。
外部专家默认使用 access_grants，不加入客户 workspace。
```

---

## 7. 第一版权限点

### 7.1 成员与组织

```text
member.manage          管理成员
workspace.view         查看工作空间
workspace.manage       管理工作空间信息
```

### 7.2 项目与站点

```text
project.view           查看项目
project.manage         管理项目
site.view              查看站点
site.manage            管理站点
```

### 7.3 设备

```text
device.view            查看设备
device.bind            将已分配设备挂到 Workspace / Project / Site
device.configure       修改设备配置
device.calibrate       设备校准
device.maintain        设备诊断和维护
device.firmware_upgrade 固件升级
device.unbind          解绑设备
device.transfer        转移设备
```

### 7.4 时序数据

```text
telemetry.view_realtime 查看实时数据
telemetry.view_history  查看历史数据
telemetry.export        导出数据
```

### 7.5 图片和视频

```text
media.live_view         查看实时画面
media.archive_view      查看历史图片/录像
media.download          下载图片/视频
media.delete            删除图片/视频
media.ptz_control       云台控制，如设备支持
```

图片和视频权限必须独立于 `telemetry.*`，不能因为用户能看时序数据，就默认允许查看或下载图片视频。

### 7.6 数据集

```text
dataset.view            查看数据集
dataset.create          创建数据集
dataset.export          导出数据集
dataset.share           分享数据集
dataset.delete          删除数据集
dataset.lock            锁定数据集
```

### 7.7 分享与审计

```text
share.view              查看分享记录
share.create            创建分享
share.revoke            撤销分享
audit.view              查看审计日志
service_access.grant    授权售后访问
```

### 7.8 内部运维动作

设备源、adapter、系统级设备注册表和外部设备映射属于平台内部运维能力，不作为客户 Workspace 权限点。第一版可以通过系统管理员后台、配置、seed、CLI 或内部脚本维护，不需要客户侧前端 CRUD。

如果后续暴露 HTTP 管理接口，必须使用独立的内部运维身份和审计，不得通过 `workspace_members` 或普通 `access_grants` 授予客户用户。

```text
ops.device_source.configure      配置设备源实例和密钥引用
ops.device_registry.sync         同步系统级设备列表和外部设备映射
ops.stream_binding.generate      从设备配置快照生成 DataStream / binding
ops.datasource_health.view       查看设备源健康状态
ops.break_glass_access           受审计的紧急排障访问
```

`ops.break_glass_access` 只用于受控排障场景，必须记录访问原因、时间范围、资源范围和 request_id。它不能作为日常查询、下载或导出的替代权限。

### 7.9 高风险权限

以下权限属于高风险权限，必须写审计日志：

```text
device.calibrate
device.firmware_upgrade
device.unbind
device.transfer
telemetry.export
media.download
media.delete
dataset.export
dataset.share
dataset.delete
share.create
share.revoke
service_access.grant
ops.device_source.configure
ops.device_registry.sync
ops.stream_binding.generate
ops.break_glass_access
```

后续版本可对这些操作增加二次确认、审批或 MFA。

---

## 8. 推荐角色权限矩阵

| 权限 | Owner | Admin | Project Manager | Site Operator | Data Manager | Researcher | Viewer | Shared Viewer | Shared Downloader | Service Engineer |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| member.manage | Y | Y | N | N | N | N | N | N | N | N |
| project.view | Y | Y | Y | Y | Y | Y | Y | Y | Y | N |
| project.manage | Y | Y | Y | N | N | N | N | N | N | N |
| site.view | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| site.manage | Y | Y | Y | Y | N | N | N | N | N | N |
| device.view | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| device.bind | Y | Y | Y | N | N | N | N | N | N | N |
| device.configure | Y | Y | Y | Y | N | N | N | N | N | Y |
| device.calibrate | Y | Y | Y | N | N | N | N | N | N | Y |
| device.maintain | Y | Y | Y | Y | N | N | N | N | N | Y |
| device.firmware_upgrade | Y | Y | Y | N | N | N | N | N | N | Y |
| device.unbind | Y | Y | N | N | N | N | N | N | N | N |
| device.transfer | Y | Y | N | N | N | N | N | N | N | N |
| telemetry.view_realtime | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| telemetry.view_history | Y | Y | Y | Y | Y | Y | Y | Y | Y | N |
| telemetry.export | Y | Y | Y | N | Y | Y | N | N | Y | N |
| media.live_view | Y | Y | Y | Y | Y | Y | Y | Y | Y | N |
| media.archive_view | Y | Y | Y | Y | Y | Y | Y | Y | Y | N |
| media.download | Y | Y | Y | N | Y | N | N | N | Y | N |
| media.delete | Y | Y | N | N | N | N | N | N | N | N |
| media.ptz_control | Y | Y | Y | Y | N | N | N | N | N | N |
| dataset.view | Y | Y | Y | Y | Y | Y | Y | Y | Y | N |
| dataset.create | Y | Y | Y | N | Y | N | N | N | N | N |
| dataset.export | Y | Y | Y | N | Y | Y | N | N | Y | N |
| dataset.share | Y | Y | Y | N | Y | N | N | N | N | N |
| dataset.delete | Y | Y | N | N | Y | N | N | N | N | N |
| dataset.lock | Y | Y | Y | N | Y | N | N | N | N | N |
| share.view | Y | Y | Y | N | Y | N | N | N | N | N |
| share.create | Y | Y | Y | N | Y | N | N | N | N | N |
| share.revoke | Y | Y | Y | N | Y | N | N | N | N | N |
| audit.view | Y | Y | N | N | N | N | N | N | N | N |
| service_access.grant | Y | Y | Y | N | N | N | N | N | N | N |

说明：

- `Service Engineer` 默认只能看设备状态、日志、诊断信息和执行必要维护操作。
- `Service Engineer` 默认不允许查看历史科研数据、下载图片视频或导出数据集。
- 如果售后确实需要访问数据，应单独创建更小范围、更短时效的授权。
- `Researcher` 是否允许导出数据可以根据客户偏好配置。第一版建议允许导出普通时序数据和数据集，但不默认允许下载媒体文件。

---

## 9. 单独分享给某个人

### 9.1 目标

平台必须支持把某个资源单独分享给某个人，而不要求这个人成为 Workspace 成员。

可分享资源：

```text
project
site
device
dataset
```

推荐优先支持：

```text
dataset
device
project
```

### 9.2 已注册用户分享流程

示例：把一个数据集分享给外部专家。

```text
1. Data Manager 打开 Dataset 页面。
2. 点击分享。
3. 输入对方手机号或邮箱。
4. 系统识别对方已有账号。
5. 选择权限：仅查看 / 允许下载。
6. 设置有效期。
7. 创建 AccessGrant。
8. 对方在“分享给我的”列表中看到该数据集。
9. 对方访问或下载时写入 audit_log。
10. 原拥有方可随时撤销分享。
```

### 9.3 未注册用户邀请流程

如果对方还没有账号，使用 Invitation。

```text
1. 用户输入手机号或邮箱。
2. 系统创建 invitation。
3. 对方收到链接或验证码。
4. 对方注册或登录。
5. 系统将 invitation 转换为 access_grant。
6. 写入 audit_log。
```

### 9.4 分享限制

第一版建议默认限制：

```text
外部分享必须可撤销。
外部分享建议设置过期时间。
外部分享默认不允许再次分享。
外部分享默认不允许创建 API Key。
外部分享的数据导出、媒体下载必须审计。
```

---

## 10. 支持非科研公司使用

平台不应把组织空间限制为科研院所。

统一模型：

```text
workspace.type = organization
organization_type = company
```

公司客户可以按同样结构使用：

```text
Workspace：某农业科技公司
  Project：客户农场环境监测
    Site：山东寿光温室 A
      Device：气象土壤监测站
      Device：视频监控站
      Device：CO2 监测设备
```

或者：

```text
Workspace：某环保公司
  Project：河道水质监测
    Site：断面 1
    Site：断面 2
```

科研客户和公司客户底层模型一致，区别主要在 UI 文案和默认模板：

| 资源 | 科研客户文案 | 公司客户文案 |
|---|---|---|
| Workspace | 课题组 / 实验室 / 研究所 | 公司 / 团队 |
| Project | 课题 / 科研项目 | 项目 / 客户项目 |
| Site | 观测站 / 样地 / 试验田 | 场站 / 点位 / 门店 / 农场 |
| Dataset | 科研数据集 | 数据集 / 归档数据 / 报表数据 |

---

## 11. 数据模型建议

### 11.1 users

```text
users
- id
- name
- phone
- email
- status
- created_at
- updated_at
```

### 11.2 workspaces

```text
workspaces
- id
- type: personal / organization
- organization_type: lab / institution / company / government / service_provider / other
- name
- owner_user_id
- status
- created_at
- updated_at
```

### 11.3 workspace_members

```text
workspace_members
- id
- workspace_id
- user_id
- role_id
- status
- joined_at
- created_at
- updated_at
```

### 11.4 roles

```text
roles
- id
- workspace_id nullable
- code
- name
- is_system_role
- created_at
- updated_at
```

系统角色的 `workspace_id` 可以为空。后续支持自定义角色时，自定义角色绑定某个 workspace。

### 11.5 permissions

```text
permissions
- id
- code
- name
- resource_type
- action
```

### 11.6 role_permissions

```text
role_permissions
- role_id
- permission_id
```

### 11.7 projects

```text
projects
- id
- workspace_id
- name
- description
- status
- created_by
- created_at
- updated_at
```

### 11.8 sites

```text
sites
- id
- workspace_id
- project_id
- name
- description
- location_text
- latitude
- longitude
- status
- created_at
- updated_at
```

### 11.9 devices

```text
devices
- id
- product_id
- serial_no
- name
- status
- activated_at
- created_at
- updated_at
```

### 11.9.1 device_assignments

```text
device_assignments
- id
- device_id
- workspace_id
- project_id nullable
- site_id nullable
- status
- assigned_by
- assigned_at
- unassigned_at nullable
- created_at
- updated_at
```

### 11.10 device_capabilities

```text
device_capabilities
- id
- device_id
- capability_code
```

能力示例：

```text
telemetry
image_capture
video_stream
ptz_control
remote_command
configurable
calibratable
firmware_update
edge_storage
```

### 11.11 device_source_configs

`device_source_configs` 表示系统级设备源实例配置。第一版可以不做客户侧数据库 CRUD 表，而是通过系统管理员后台、部署配置、环境变量、seed 或内部脚本维护。

推荐配置形态：

```text
device_source_configs
- source_code: thcpn_legacy / vendor_a / vendor_b
- adapter_code: thcpn_legacy_mysql / generic_columns / generic_media / http_api
- dsn_secret_ref: env:THCPN_LEGACY_MYSQL_DSN
- table_index: device_data_index
- table_prefix: device_data_
- status: active / disabled
```

说明：

- `adapter_code` 对应代码中注册的 adapter。
- `dsn_secret_ref` 不保存明文连接串，真实 DSN 放在环境变量、Secret Manager 或部署配置中。
- 普通 Workspace 用户不创建、不编辑、不查看设备源配置。
- THCPN 设备源当前已产品化为系统管理员后台能力：`users.is_system_admin = true` 的账号可通过 `/api/v1/admin/data-sources` 和前端 `/admin/data-sources` 维护系统级 DataSource，并同步系统级设备到指定 `target_workspace_id`。

当前代码实现保留 `data_sources` 表作为系统级设备源实例配置载体；`data_sources.type` 表示物理连接类型，不再保存工作区归属字段。普通工作区控制台不暴露数据源管理；业务读取策略由 `data_stream_bindings.adapter_code` 决定，不再按 `data_sources.type` 直接分发。

### 11.12 device_source_refs

`device_source_refs` 保存系统级平台设备和外部设备数据源中的真实设备记录之间的映射。

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

这张表解决“系统级平台设备分配给 Workspace”和“平台到旧设备库读取数据”之间的关系。`workspace_id` 表示当前分配目标和权限边界，不表示 Workspace 拥有 DataSource 或 adapter。用户只接触已分配设备的 ID、SN 或二维码，不接触外部库表、外部字段和 DSN。

### 11.13 device_config_snapshots

`device_config_snapshots` 保存从外部设备配置表同步而来的配置快照，用于解释历史数据中 `data` JSON key 的含义。

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

THCPN 第一阶段永远使用外部设备库中的最新 `device_config` 解释历史数据。历史数据如果和最新配置不匹配，查询层返回 warning 并跳过无法解释的字段，不做历史配置回溯。

### 11.14 data_streams

```text
data_streams
- id
- workspace_id
- device_id
- code
- name
- type: telemetry / image / video / audio / event / log
- unit
- source: system_discovered / manual_alias
- source_ref_id nullable
- status
- created_at
- updated_at
```

`data_streams` 对客户 Workspace 可见，但默认由系统从设备配置快照同步生成。Workspace 用户可以在授权范围内查看、归档、分享和导出数据流，不应直接配置数据流背后的库表字段。

### 11.15 data_stream_bindings

`data_stream_bindings` 是系统生成的数据读取映射。第一版可由同步任务、seed 或内部脚本维护，不作为客户侧配置入口。

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

标准数据源使用 `generic_columns` / `generic_media` adapter 和 `data_stream_bindings` 中的受控表字段映射。特殊数据源使用专用 adapter 和 `adapter_config_json`。对于 THCPN 旧 MySQL 设备库，当前第一阶段使用 `thcpn_legacy_mysql` 只读 adapter：`adapter_config_json` 包含受控字段，例如外部设备 ID、`row_type`、JSON key、JSON path、分表索引表和时间字段。运行时先查 `device_data_index`，再查命中的 `device_data_*` 分表。它不能保存用户提交的 raw SQL，也不能由普通客户前端编辑。

### 11.16 datasets

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

### 11.17 dataset_sources

```text
dataset_sources
- id
- dataset_id
- source_type: device / data_stream / file
- source_id
```

### 11.18 access_grants

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

说明：

- 分享给某个人时，`subject_type = user`。
- 分享给某个公司或组织时，`subject_type = workspace`。
- 售后授权也使用 access_grants，通常 scope 是 `device`，并设置 `expires_at`。
- 第一版可以先支持 `subject_type = user`，后续再扩展到 `workspace`。

### 11.19 invitations

```text
invitations
- id
- workspace_id
- invitee_email
- invitee_phone
- role_id
- scope_type
- scope_id
- expires_at
- invited_by
- status: pending / accepted / expired / revoked
- created_at
- updated_at
```

### 11.20 audit_logs

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
- created_at
```

---

## 12. 关键业务流程

### 12.1 用户注册

```text
1. 用户使用手机号或邮箱注册。
2. 系统创建 user。
3. 系统自动创建 personal workspace。
4. 系统将用户加入 personal workspace。
5. 授予 Owner 角色。
```

### 12.2 创建组织空间

```text
1. 用户点击创建组织。
2. 选择组织类型：实验室 / 科研院所 / 公司 / 政府单位 / 服务商 / 其他。
3. 输入组织名称。
4. 系统创建 organization workspace。
5. 创建者成为 Owner。
```

### 12.3 设备分配

```text
1. 系统管理员从系统级设备列表选择已同步设备，或从外部设备库按 external_device_id 同步设备。
2. 系统校验设备存在、未被分配到其他 Workspace，或本次操作是受审计的设备转移。
3. 系统管理员选择目标 workspace。
4. 可选选择 project 和 site，作为目标 Workspace 内的业务挂载位置。
5. 系统写入或更新 `device_assignments`，其中 `workspace_id` 表示当前分配目标和权限边界，`project_id` / `site_id` 表示 Workspace 内的业务挂载位置。
6. 系统基于已审核的 device_source_refs / device_config_snapshots 暴露该设备的数据流。
7. 普通 Workspace 用户不能在设备分配、数据查询或数据集创建流程中输入 DSN、表名、字段名、JSONPath 或 raw SQL。
8. 记录分配操作人、`assigned_by`、`assigned_at`，并在设备首次启用时记录 `activated_at`。
9. 写 audit_log。
```

### 12.4 创建设备数据集

```text
1. 用户选择 project、device 或 data_stream。
2. 选择时间范围。
3. 选择数据类型：时序数据 / 图片 / 视频 / 混合。
4. 输入数据集名称和说明。
5. 系统创建 dataset。
6. 系统创建 dataset_sources。
7. 写 audit_log。
```

### 12.5 分享数据集给个人

```text
1. 用户在 dataset 页面点击分享。
2. 输入手机号或邮箱。
3. 选择权限：仅查看 / 允许下载。
4. 设置有效期。
5. 若对方已有账号，创建 access_grant。
6. 若对方未注册，创建 invitation。
7. 写 audit_log。
```

### 12.6 授权售后维护设备

```text
1. 客户在设备页面点击授权售后。
2. 选择授权时长：24h / 48h / 7d。
3. 选择允许操作：查看状态、查看日志、远程诊断、修改配置、固件升级。
4. 系统创建 access_grant，角色为 Service Engineer。
5. 售后工程师操作设备时必须记录 audit_log。
6. 到期后授权自动失效。
```

### 12.7 设备转移

设备转移属于敏感操作，不建议普通业务流程直接修改 `workspace_id`。

第一版可以先简化为：

```text
1. Owner/Admin 发起设备转移申请，或系统管理员执行设备转移。
2. 选择目标 workspace。
3. 系统要求确认历史数据是否随设备转移。
4. 默认只转移设备，不自动转移历史 dataset。
5. 写 audit_log。
```

后续版本可增加 `transfer_requests` 表和审批流程。

---

## 13. 鉴权逻辑

后端所有接口必须走统一鉴权方法。

伪代码：

```pseudo
can(user, action, resource, context):
    workspace = resolveWorkspace(resource)

    if not user.is_active:
        return false

    grants = []

    member = findWorkspaceMember(user, workspace)
    if member is active:
        grants.add(member.role, scope = workspace)

    access_grants = findActiveAccessGrants(user, workspace, resource)
    grants.add(access_grants)

    if not grants.hasPermission(action):
        return false

    if not grants.scopeCovers(resource):
        return false

    if not policyAllows(user, action, resource, context):
        return false

    return true
```

敏感操作必须在执行前后写入审计日志：

```pseudo
if can(user, action, resource, context):
    writeAuditLog(user, action, resource, "success")
    execute()
else:
    writeAuditLog(user, action, resource, "failure")
    reject()
```

---

## 14. 审计要求

第一版必须审计以下操作：

```text
登录和异常登录
创建组织空间
邀请成员
修改成员角色
创建设备分配
解绑设备
转移设备
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

审计日志至少记录：

```text
谁
什么时候
从哪里
做了什么操作
操作对象是什么
操作结果是什么
失败原因是什么
```

示例：

```text
actor = user_123
action = dataset.export
resource = dataset_456
result = success
ip = 1.2.3.4
created_at = 2026-06-30 10:30:22
```

---

## 15. MVP 不建议做的事情

第一版不建议做：

```text
复杂的显式 deny 权限。
完整 ABAC 策略引擎。
复杂审批流。
字段级权限。
多级代理商管理。
复杂数据版本发布系统。
按真实行政组织建无限层级组织树。
允许外部分享默认再次分享。
允许售后默认访问全部客户数据。
允许普通 Viewer 导出数据。
允许 Workspace Owner / Admin 管理设备数据源连接、密钥、库表字段映射或 raw SQL。
允许 Workspace Owner / Admin 管理系统级设备注册表、DataSource、adapter 或跨 Workspace 设备分配规则。
让普通用户在设备分配、数据查询或数据集创建流程中输入设备库表名、字段名、JSONPath 或 raw SQL。
为了三到四类固定设备源，第一版建设复杂的设备数据源管理后台。
```

这些能力可以等客户需求明确后再扩展。

---

## 16. 推荐实施顺序

### 第一阶段：基础账户和资源模型

```text
User
Workspace
WorkspaceMember
Role
Permission
Project
Site
Device
DataStream
```

目标：

- 用户能注册。
- 用户有个人空间。
- 用户能创建组织空间。
- 组织下能建项目和站点。
- 系统级设备能分配到空间，并可选挂到项目和站点。

### 第二阶段：设备源适配和设备映射

```text
AdapterRegistry
DeviceSourceConfig
DeviceSourceRef
DeviceConfigSnapshot
DataStreamBinding
```

目标：

- 代码中注册三到四类设备源 adapter。
- THCPN 设备源实例通过系统管理员后台维护为系统级 DataSource；其他特殊源仍可先通过部署配置、环境变量或 seed 维护。
- 系统能同步或录入外部设备映射。
- 系统能从设备配置快照生成 DataStream。
- 当前阶段设备由系统管理员同步并单一分配到工作区；未来若提供普通用户自助申请，也只能申请使用平台设备标识，不能管理系统级设备注册、数据源连接和字段映射。

### 第三阶段：权限和分享

```text
AccessGrant
Invitation
RolePermission
统一鉴权函数
```

目标：

- 支持 role + scope。
- 支持单独分享给某个人。
- 支持未注册用户邀请。
- 支持售后临时授权。

### 第四阶段：数据集和审计

```text
Dataset
DatasetSource
AuditLog
```

目标：

- 支持创建数据集。
- 支持数据集查看、导出和分享。
- 对敏感操作进行审计。

### 第五阶段：媒体和高风险操作控制

```text
media 权限
设备校准权限
固件升级权限
设备转移流程
```

目标：

- 图片和视频权限独立控制。
- 高风险设备操作全部审计。
- 设备转移不影响历史科研数据归属。

---

## 17. 典型示例

### 17.1 科研课题组

```text
Workspace：华中农业大学 - 作物生态课题组

Project：玉米田间微气候监测
  Site：试验田 A 区
    Device：气象土壤监测站 001
    Device：图像监控站 002
    Device：视频监控站 003

Dataset：2026 年玉米拔节期观测数据
```

成员和授权：

```text
陈老师：Owner，scope = workspace
刘老师：Project Manager，scope = project
研究生小王：Researcher，scope = project
田间运维李工：Site Operator，scope = site
数据管理员赵同学：Data Manager，scope = dataset
外部专家：Shared Viewer，scope = dataset，90 天过期
厂商售后：Service Engineer，scope = device，48 小时过期
```

### 17.2 公司客户

```text
Workspace：某农业科技公司

Project：客户农场环境监测
  Site：山东寿光温室 A
    Device：气象土壤监测站
    Device：视频监控站
    Device：CO2 监测设备
```

成员和授权：

```text
公司负责人：Owner，scope = workspace
项目经理：Project Manager，scope = project
现场运维：Site Operator，scope = site
客户代表：Viewer，scope = project
算法供应商：Shared Downloader，scope = dataset，合同期内有效
```

### 17.3 个人用户

```text
Workspace：张三的个人空间

Project：自建农田观测
  Site：家里试验田
    Device：便携式土壤监测仪
```

分享：

```text
张三将 2026-06 土壤数据集分享给李老师。
subject_type = user
role = Shared Downloader
scope_type = dataset
expires_at = 2026-12-31
```

---

## 18. 最终建议

第一版平台应采用以下最小可行设计：

```text
Workspace 作为权限隔离单元。
Project 作为项目管理单元。
Site / Station 作为部署点管理单元。
Device 作为设备资产单元。
DataStream 作为设备数据通道。
Dataset 作为可归档、可导出、可分享的数据资产。
Device Source Mapping 作为平台设备和外部设备库之间的读取边界。
Role + Scope 作为核心权限模型。
AccessGrant 作为单人分享、外部协作和售后授权机制。
AuditLog 作为敏感操作追溯机制。
```

这套方案可以同时支持：

```text
个人用户
科研院所
实验室和课题组
非科研公司
政府单位
外部专家
算法合作方
售后服务工程师
```

第一版不要追求完整权限引擎，而要确保核心模型正确：

```text
资源归属清晰。
角色边界清晰。
授权范围清晰。
外部分享可控。
售后权限临时。
敏感操作可审计。
```

只要这几个基础打牢，后续扩展自定义角色、审批流、组织层级、服务商体系、数据发布和高级策略时，不需要推倒重来。
