# THCPN Web 前端功能设计

## 1. 文档目的

本文档定义 THCPN Web 的功能基线，供后续前端重构、路由调整、组件拆分和自动化测试使用。

本文档关注：

- 用户角色和权限边界。
- 信息架构和页面职责。
- 关键业务流程。
- 页面状态、交互规则和 API 边界。
- 重构时必须保留的业务不变量。

本文档不规定具体 CSS、组件库、文件拆分或视觉稿。React、Ant Design、TanStack Query、ECharts 等属于当前实现方案，可以在重构时替换；业务能力和安全边界不能因此改变。

本文档不是项目进度表，不记录页面完成状态、负责人、迭代排期或临时验收结果。功能契约发生变化时直接修改对应章节，并由 Git 历史保留变更过程。

HTTP 请求与响应的精确定义以 `docs/openapi.yaml` 为准。

## 2. 产品定位

前端是科研物联网平台的管理和数据使用控制台，面向两类相互独立的工作空间：

1. 系统后台：管理平台级设备、设备数据源、THCPN 同步、设备分配和系统元数据。
2. Workspace 控制台：管理组织内项目、站点、成员、设备使用、数据查询、Dataset、导出、分享和审计。

前端不承担设备采集、MQTT 接入、原始数据写入或 adapter 配置生成。普通 Workspace 用户不接触 DSN、表名、字段映射、JSONPath、raw SQL 或系统级设备注册信息。

## 3. 用户与权限边界

### 3.1 未登录用户

- 可以进入登录和注册页面。
- 可以使用密码登录或短信验证码登录。
- 登录要求 MFA 时需要继续输入 TOTP code。
- 登录成功后根据身份进入系统后台或普通控制台。
- 访问受保护路由时跳转到登录页，并保留原目标位置。

### 3.2 普通登录用户

- 至少拥有一个可访问的 Workspace，或看到无可用 Workspace 的明确状态。
- 可以切换 Workspace；所有资源页面随全局 Workspace 上下文刷新。
- 只能看到后端授权范围内的数据和操作。
- 可以管理自己的账号安全、会话、邮箱验证和 MFA。

### 3.3 Workspace 内部成员

- 使用 WorkspaceMember 表达长期协作关系。
- 权限由权限模板或自定义权限点与 scope 共同决定。
- scope 可以落在 Workspace、Project、Site、Device 或 Dataset。
- Owner 的关键保护规则由后端执行，前端应在危险操作前给出明确提示。

### 3.4 外部协作者与售后人员

- 已注册对象使用 AccessGrant。
- 未注册对象使用 Invitation，接受后转换为 AccessGrant。
- 外部授权不能包含成员、Workspace 和审计等内部管理权限。
- Service Engineer 授权必须有过期时间，并清楚展示范围与有效期。

### 3.5 系统管理员

- 系统后台使用独立的管理员账号登录，只有有效的管理员会话可以进入 `/admin`。
- 系统管理员身份独立于 Workspace Owner/Admin。
- 系统管理员可在系统后台维护 DataSource、系统设备资产、设备分配、拓扑、生命周期、能力和系统元数据。
- 系统管理员可以在系统后台与普通控制台之间切换，但两套导航和上下文保持分离。

## 4. 资源关系

```text
User
  -> WorkspaceMembership / AccessGrant

Workspace
  -> Project
      -> Site
  -> DeviceAssignment
      -> Device
          -> DataStream
          -> Child Device / Camera
  -> Dataset
      -> Device / DataStream source
  -> ExportJob
  -> AuditLog

System
  -> DataSource
  -> DeviceSourceRef / DeviceConfigSnapshot / DataStreamBinding
  -> System Device Asset
      -> DeviceAssignment -> Workspace / Project / Site
```

前端显示人类可读名称作为主信息，ID 作为可复制的技术信息。涉及资源选择时，应先显示当前 Workspace 内的候选项，不要求用户记忆 UUID。

## 5. 全局应用行为

### 5.1 认证状态

- 应用启动时从认证存储恢复会话。
- API 请求统一附加 access token。
- logout 必须调用服务端撤销接口，并清理本地认证状态和查询缓存。
- token 刷新成功后更新 access/refresh token；刷新失败进入未登录状态。
- 401 不应无限重试。

### 5.2 Workspace 上下文

- Workspace 控制台只有一个全局选中 Workspace。
- 选中值持久化；持久化值不再可用时回退到第一个可用 Workspace。
- 切换 Workspace 后，Project、Site、Device、Dataset、Export、成员、授权、邀请和审计等数据必须刷新。
- 新建和管理 Workspace 从 Workspace 选择器进入。
- 无 Workspace、加载中和加载失败必须有独立状态。

### 5.3 服务状态

- 普通控制台和系统后台都显示 `healthz` 与 `readyz` 状态。
- 服务状态定期刷新，并允许用户手动刷新。
- readiness 失败不能伪装为业务数据为空。

### 5.4 反馈与异常

- 查询页面必须覆盖 loading、empty、error 和 success 状态。
- mutation 成功使用短反馈，并刷新相关数据。
- mutation 失败显示后端错误信息和 request ID；不得只写“操作失败”。
- 删除、解绑、撤销、转移、配置修改等高风险操作必须确认。
- 表格在窄屏可横向滚动，操作按钮和文本不能重叠。

## 6. 信息架构与路由

### 6.1 公共路由

| 路由 | 页面 | 访问条件 | 职责 |
| --- | --- | --- | --- |
| `/login` | 登录 | 未登录 | 密码登录、短信登录、MFA 续接 |
| `/register` | 注册 | 未登录 | 密码注册并创建初始个人空间 |
| `/` | 根重定向 | 任意 | 未登录到登录页；系统管理员到后台；其他用户到总览 |

已登录用户访问登录或注册页时，应跳转到其默认入口。

### 6.2 Workspace 控制台

| 路由 | 导航位置 | 页面职责 |
| --- | --- | --- |
| `/dashboard` | 运行 / 总览 | 当前 Workspace 资源统计、最近导出和最近审计 |
| `/devices` | 运行 / 设备 | 设备列表、拓扑分类、项目/站点筛选、子节点展开、数据入口和解绑 |
| `/device-map` | 运行 / 地图 | 当前 Workspace 设备精确位置、生态/用途筛选和设备列表 |
| `/claim`、`/claim/:claimSlug` | 运行 / 认领 | 手工输入或扫码永久铭牌认领网关/标准站 |
| `/device-data` | 数据 / 设备数据 | 遥测、图片和相机实时视频查询，以及保存为 Dataset |
| `/data-compare` | 数据 / 数据对比 | 添加任意设备、数据要素和时间范围进行原始值/归一化对比 |
| `/datasets` | 数据 / 数据集 | Dataset 创建、列表、详情、预览、导出和删除 |
| `/exports` | 数据 / 导出 | 导出任务创建、状态查询和文件下载 |
| `/settings` | 管理 / 设置 | 基础资料、访问控制、审计和账号安全 |
| `/workspaces` | Workspace 菜单 | Workspace 列表和组织 Workspace 创建 |

设置中的基础资料、访问控制、审计和账号安全通过 URL query 保持可深链接状态，不为旧前端路由提供兼容入口。

### 6.3 系统后台

| 路由 | 页面职责 |
| --- | --- |
| `/admin` | API 健康、平台异常、设备资产、数据源、用户和工作区运维总览 |
| `/admin/sources` | DataSource 配置、标准站/网关/相机同步和全量同步 |
| `/admin/devices` | 系统设备资产、搜索筛选、分页、多选批量操作、拓扑、配置、生命周期、能力、相机和分配管理 |
| `/admin/sensors` | 平台传感器模板 CRUD、源库导入和协议参数/指标可视化与 JSON 编辑 |
| `/admin/device-map` | 系统设备地图、分类筛选、子节点显示和批量分类 |
| `/admin/logs` | 平台运行日志检索、详情、导出、原始文件和索引维护 |
| `/admin/workspaces`、`/admin/users` | 工作区治理和普通用户账号管理 |
| `/admin/metadata`、`/admin/settings` | 设备能力/角色元数据和服务状态设置 |

非系统管理员访问 `/admin` 时显示 403，不回退为普通 Workspace 管理权限。

## 7. 公共认证页面

### 7.1 登录

密码登录：

- 输入登录标识和密码。
- 后端要求 MFA 时展示 MFA code 输入，并保留当前登录上下文。
- 成功后保存用户 token，并进入用户平台总览；系统管理员从独立的后台登录入口进入管理端。

短信登录：

- 输入手机号并发送验证码。
- 展示冷却状态，防止重复发送。
- 输入验证码完成登录；账号不存在时由后端决定是否自动注册。
- 后端要求 MFA 时继续 TOTP 校验。

### 7.2 注册

- 支持密码注册所需身份字段和密码确认。
- 展示服务端密码策略错误。
- 注册成功即建立认证状态，并进入默认入口。
- 开发注册开关关闭时，不应提供不可用入口或应明确说明不可用。

## 8. Workspace 控制台功能

### 8.1 控制台壳层

- 导航分为运行、数据、管理三组。
- 左侧提供 Workspace 切换、Workspace 创建/管理、账号菜单和服务状态。
- 移动端使用抽屉导航，页面功能与桌面端一致。
- 系统管理员账号菜单提供“进入系统后台”。

### 8.2 总览

- 展示 Project、Site、Device、Dataset 和 ExportJob 数量。
- 展示最近导出任务及其状态。
- 展示最近审计事件。
- 任一数据源失败时，相关区域显示错误或不可用状态，不把失败计为 0。

### 8.3 Workspace 管理

- 列出当前用户可访问的 Workspace、状态、角色、创建时间和 ID。
- 创建 organization Workspace，类型包括实验室、机构、企业、政府、服务商和其他。
- personal Workspace 不在此处手工创建。
- 创建成功后刷新列表，并允许切换到新 Workspace。

### 8.4 基础资料

基础资料位于 Settings，包含 Project 和 Site 管理。

Project：

- 按当前 Workspace 列表。
- 创建时填写名称和描述。
- 展示状态、创建时间和 ID。

Site：

- 按当前 Workspace 和 Project 筛选。
- 创建时选择 Project，并填写名称、位置和描述。
- 展示状态、所属 Project、创建时间和 ID。

### 8.5 设备

- 设备由系统管理员同步并分配到 Workspace；普通控制台不创建设备或编辑数据源绑定。
- 支持按 Project 和 Site 筛选。
- 按全部、组网站、节点、相机、标准站分类并显示数量。
- 展示名称、序列号、拓扑角色、生命周期、状态、能力、站点和 ID。
- 网关可展开查看子节点及其分配状态。
- “查看数据”根据设备类型进入设备数据页；相机入口强调实时视频。
- 解绑属于高风险操作，必须确认并刷新列表。
- 设备详情页按设备类型显示功能：相机只显示实时视频、资料和操作记录，不显示不适用的概览、配置和分享入口。
- 设备资料集中编辑描述、Project、Site、观测分类、业务元数据和资料图片；运行位置和电压等源库属性单独实时读取。
- 设备详情提供快捷切换设备，切换到相机或普通设备时自动修正不适用的标签。

### 8.6 数据流

- 数据流由系统同步生成，Workspace 用户只读。
- 用户先选择设备，再查看该设备的数据流。
- 展示名称、code、类型、单位、状态和 ID。
- 数据流页面不得提供 adapter、库表字段或 binding 编辑能力。

### 8.7 设备数据

查询条件：

- 必选设备。
- 必选时间范围。
- 设置结果上限，不能超过后端限制。
- 可选择一个或多个 DataStream；未选择时按页面规则查询设备可用流。

遥测结果：

- 按 series 展示趋势图。
- 展示扁平明细表，包括 DataStream、时间、值、单位、质量和 ID。
- 展示查询 warning，不静默丢弃无法解释的数据。

媒体结果：

- 按 DataStream 分类显示图片。
- 显示采集时间、媒体类型和可用的缩略图/预览。
- 下载入口只使用后端返回的临时 URL。

相机：

- 仅对具备相机能力的设备请求 live session。
- 成功后按需加载播放器 SDK 并播放实时视频。
- 离开页面、切换设备或重新创建 session 时销毁旧播放器。

保存为 Dataset：

- 将当前设备、选中 DataStream、数据类型和时间范围带入 Dataset 表单。
- 用户补充名称、Project 和描述后创建。
- 混合查询自动推断为 mixed，纯遥测或纯图片使用对应类型。

快捷时间范围包含 6 小时、3 天和 7 天；查询最多支持 366 天。服务端返回的错误消息和 request ID 必须显示给用户。

遥测图表支持分指标查看或同图对比、独立 Y 轴、指标显隐和真实采样时间 Hover；相机设备使用实时视频入口。

### 8.7.1 数据对比

`/data-compare` 是跨设备/跨数据流的联合分析入口，与单设备详情中的数据页职责分离：

- 用户可添加任意设备、数据要素和时间范围组合。
- 原始值保留单位；不同单位使用独立 Y 轴。
- Min-Max 和 Z-score 是可选的相对化模式，不覆盖原始值。
- 横轴可选择真实时间，或将不同时间范围按 0–100% 进度对齐。
- Hover 显示实际采样时间；当前对比条件可以保存到数据集。

### 8.8 Dataset

列表：

- 按当前 Workspace 查询，可按 Project 筛选。
- 展示名称、类型、状态、来源、时间范围、创建时间和 ID。
- 提供详情/预览、导出和删除操作；操作可用性由后端权限决定。

创建：

- 填写名称、Project、数据类型、开始时间、结束时间和描述。
- 数据来源可按 Device 或 DataStream 选择。
- DataStream 选择必须受所选 Device 约束。
- 至少选择一个有效来源。
- 来源展示设备和数据要素信息，不只展示数据要素名称，避免同名指标无法区分来源。

详情与预览：

- 展示 Dataset 元信息、来源和时间范围。
- 遥测 Dataset 可在允许范围内调整预览时间和结果上限。
- 预览结果使用与设备数据一致的图表和明细表达。

### 8.9 导出

- 列出当前用户或当前 Workspace 可见的 ExportJob。
- 展示导出类型、资源、状态、创建时间、过期时间、错误和 ID。
- 支持资源类型：Device、DataStream、Dataset、Media。
- 支持导出类型：telemetry CSV、telemetry Excel、media ZIP、dataset ZIP。
- telemetry 和 media 导出要求时间范围，可设置行数上限和媒体类型。
- 只有 success 且文件未过期的任务显示下载入口。
- pending/running 显示处理中；failed 展示原因；expired 不允许下载。

### 8.10 Settings

一级 tab：

- 基础资料：Project 和 Site。
- 访问控制：成员权限、资源授权、邀请。
- 审计日志。
- 账号安全。

tab 状态写入 URL query，刷新和兼容路由跳转后应保持选中项。

### 8.10.1 设备认领与公开访问

- `/claim` 支持扫码永久铭牌或输入序列号/手工认领码。
- 扫码的登录用户是本次认领操作者；认领时选择目标 Workspace，可选 Project 和 Site。
- 永久铭牌二维码长期有效，解绑后可以再次认领；认领操作必须幂等。
- 设备公开访问使用固定地址和二维码，可选密码保护；关闭后重新开启不更换地址。

### 8.11 成员权限

- 列出当前 Workspace 的内部成员。
- 添加对象可按邮箱、手机号或用户 ID 匹配，且对象必须已注册。
- 先选择权限模板，再按权限组微调；模板不匹配时显示为自定义权限。
- 选择 scope 类型和具体资源；Owner 固定使用受保护的 Workspace 范围。
- 支持调整成员权限模板、权限点和范围。
- 支持移除成员，并对最后一个 Owner 等后端约束显示明确错误。
- 列表展示成员、状态、权限摘要、模板、scope、加入时间和 ID。

### 8.12 资源授权

- 用于已注册外部对象、临时售后或单资源分享，不代替内部成员。
- 授权对象支持 user ID、邮箱或手机号。
- scope 支持 Workspace、Project、Site、Device 和 Dataset。
- 资源选择器显示当前 Workspace 中的人类可读资源；同时允许粘贴合法 ID 作为补充路径。
- 权限模板可微调，但过滤内部管理权限。
- Service Engineer 必须设置过期时间。
- 展示当前 Workspace 发出的授权和授予当前用户的授权。
- 发出方可以撤销有效授权。

### 8.13 Invitation

- 用于尚未注册或暂未加入平台的邮箱、手机号。
- 创建字段与资源授权一致，但只有接受后才产生有效 AccessGrant。
- 展示当前 Workspace 发出的邀请和当前用户收到的 pending 邀请。
- 发出方可在接受前撤销；接收方可接受匹配自己身份的邀请。

### 8.14 审计

- 按当前 Workspace 查询。
- 可以调整返回数量，但不能超过后端上限。
- 展示时间、actor、action、resource、result、reason、request ID 和必要技术信息。
- success/failure 必须有明显区分。
- 审计页面只对拥有 `audit.view` 的用户可用；403 与空日志必须区分。

### 8.15 账号安全

- 手动刷新 access token。
- 服务端 logout。
- 查看 refresh sessions，包括客户端、IP、最近使用、创建和过期时间。
- 撤销指定 session。
- 发送并验证当前绑定邮箱的验证码。
- 查看 MFA 状态，执行 TOTP setup、enable 和 disable。
- setup secret 和 otpauth URI 只在必要阶段展示；启用后不再展示原 secret。

## 9. 系统后台功能

### 9.1 后台壳层

- 导航包含后台总览、THCPN 数据源、设备管理和元数据管理。
- 提供服务状态、账号菜单、退出登录和“进入普通控制台”。
- 不依赖 WorkspaceProvider；需要 Workspace 的后台操作显式选择目标 Workspace。

### 9.2 后台总览

- 汇总 Workspace、Project、Site、系统设备和 DataSource。
- 提供到数据源和设备管理的快捷入口。
- 统计请求失败时显示异常状态，不显示误导性的零值。

### 9.3 THCPN 数据源

DataSource 管理：

- 列表展示名称、source type、secret 引用、状态、创建时间和 ID。
- 创建和修改只保存 secret 引用，不录入明文 DSN。
- source type 选项由后端能力约束；THCPN 同步只对兼容 MySQL 数据源开放。

标准站同步：

- 选择 DataSource。
- 输入外部设备 ID，可补充产品、序列号和名称。
- 可选择目标 Workspace、Project 和 Site；推荐先同步系统资产，再独立分配。
- 展示同步后的 Device、配置快照、DataStream、Binding 和禁用项摘要。

组网站同步：

- 选择 DataSource 和外部网关设备。
- 可选目标 Workspace、Project、Site，并决定是否级联分配节点。
- 展示网关、节点、关系、DataStream、Binding 和分配结果。

### 9.4 系统设备资产

列表与筛选：

- 支持搜索设备。
- 按设备状态、生命周期和是否分配筛选。
- 按全部、网关、节点、相机和标准站分类。
- 展示设备基本信息、拓扑、生命周期、分配、能力、状态和 ID。
- 网关可展开节点列表。

设备编辑：

- 修改系统设备名称、序列号、设备类型和状态等允许字段。
- 维护设备能力。
- 维护生命周期并展示历史事件。
- 维护父子拓扑关系。

设备分配：

- 选择 Workspace，可选 Project 和 Site。
- 只有系统管理员可执行分配和取消分配。
- Project/Site 候选项必须跟随目标 Workspace 级联。

THCPN 配置：

- 查看外部最新配置和平台快照。
- 编辑 data、image 和 control JSON 时进行 JSON 结构校验。
- 提交前清楚提示该操作会写入外部设备库并更新平台 DataStream/Binding。
- 展示新增、更新、禁用的数据流和 Binding 结果。

相机：

- 创建或修改相机绑定。
- 配置设备标识、播放地址所需信息和清晰度等受控字段。
- 密钥继续由服务端环境变量管理，前端不接触 app secret。

### 9.5 元数据管理

设备能力定义：

- 列出 code、名称、状态和排序。
- 创建和更新能力定义。

系统角色：

- 列出系统角色 code、名称和更新时间。
- 编辑允许调整的角色元数据或权限配置。
- 角色修改必须与权限目录保持一致，并明确影响范围。

## 10. API 模块边界

前端 API 层按领域拆分，页面只调用领域 client：

| 模块 | 主要职责 |
| --- | --- |
| `auth` | 登录、注册、refresh、logout、session、邮箱验证、MFA、当前用户 |
| `workspaces` | Workspace 列表、创建和后台列表 |
| `projects` / `sites` | Workspace 资源列表、创建、读取、更新和后台列表 |
| `devices` | 标准站查询、子节点、解绑、设备操作及后台资产管理 |
| `dataStreams` | DataStream 只读查询 |
| `telemetry` / `media` | 设备和 DataStream 数据查询 |
| `datasets` | Dataset CRUD 和遥测预览 |
| `exports` | ExportJob 创建、列表、详情和下载 |
| `members` | WorkspaceMember 列表、添加、调整和移除 |
| `accessGrants` / `invitations` | 外部授权与邀请生命周期 |
| `permissions` | 权限点、分组和模板目录 |
| `audit` | Workspace 审计查询 |
| `dataSources` | 系统 DataSource 和 THCPN 同步 |
| `cameras` | 后台相机绑定和普通 live session |

重构规则：

- DTO 不在页面重复定义。
- client 统一处理 token、query string、JSON 和错误 envelope。
- 页面不直接拼接散落的 API base URL。
- query key 包含所有影响响应的上下文和筛选条件。
- mutation 成功后按领域失效缓存，不全局刷新所有请求。

## 11. 重构边界

### 11.1 必须保留的业务不变量

- 系统后台与 Workspace 控制台权限分离。
- Workspace 是普通控制台的全局资源上下文。
- 普通用户不能管理 DataSource、DSN、Binding 或 raw SQL。
- 成员、AccessGrant 和 Invitation 是三种不同协作关系。
- 权限由权限点和 scope 共同决定。
- 数据流由系统生成，普通控制台只读。
- 设备数据查询受时间和数量限制。
- Dataset 可以由 Device 或 DataStream 及时间范围组成。
- 导出是异步任务，并具有状态和过期时间。
- 媒体下载使用临时地址。
- 高风险操作需要确认、授权和审计。

### 11.2 可以调整的实现

- React 组件层级和文件目录。
- Ant Design、自定义组件和样式方案。
- Settings 使用 tab、子路由或其他可深链接结构。
- 表格、抽屉和弹窗的具体组件实现。
- 状态管理库和数据请求封装，只要缓存隔离与认证行为保持正确。
- 路由级代码拆分和第三方 SDK 加载方式。

### 11.3 推荐的领域拆分

```text
app/
  auth-session
  routing
  workspace-context
  query-client

domains/
  workspace
  project-site
  device
  device-data
  dataset
  export
  access-control
  audit
  account-security
  system-admin

shared/
  api
  ui
  format
  feedback
```

每个领域可以包含 route、page、query、mutation、form schema 和领域组件。共享层不能反向依赖具体领域。

## 12. 重构验收清单

- 未登录、普通用户、Workspace 管理者和系统管理员的入口与拒绝路径正确。
- Workspace 切换不会显示前一个 Workspace 的缓存数据。
- 所有主页面支持 loading、empty、error 和成功状态。
- Project、Site、Device、DataStream、Dataset 和 Export 的关键路径可完成。
- 成员、授权和邀请不会互相混用。
- 权限模板微调后能正确表现为自定义权限。
- 系统后台 DataSource、同步、设备分配、拓扑、配置和元数据操作仍可用。
- 遥测图表、明细、warning、图片预览和相机播放器生命周期正确。
- 导出状态和下载可用性正确。
- 高风险操作有确认和明确结果反馈。
- OpenAPI DTO 与前端类型一致。
- 桌面和移动端导航、表格、弹窗、抽屉和图表无重叠或不可操作区域。
- 路由级懒加载避免普通入口下载系统后台和播放器等无关大包。
- 自动化测试覆盖认证守卫、Workspace 切换、权限拒绝和关键业务流程。
