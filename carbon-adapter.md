# Carbon 碳汇数据源适配器方案

## 1. 目标

为平台增加 Carbon 碳汇 MySQL 数据源，接入 `carbon_sink_v2` 中的设备、运行资料、原始采样和通量成果，并为碳汇设备提供专属概览、数据分析和导出能力。

第一版只读取源库已经计算完成的 NEE、ER、GPP，不在平台内重复计算，也不创建数据处理任务。

## 2. 已确认的边界

- 仅接入源库 `device_type = carbon-sink-v2` 的设备。
- 平台新增 `device_type = carbon_sink`，`product_id = carbon_sink_v2`。
- 一个 Carbon `devices` 记录对应一个平台设备。
- `node_id` 是设备内部采集通道，不同步为独立设备。
- Carbon 使用专属接口和专属数据页面，不注册为通用设备指标。
- 设备资料和配置页复用平台通用能力；概览和数据页专门实现。
- 设备资料同步到平台，通量与原始采样实时读取源 MySQL，不复制到平台数据库。
- 使用 `device_data_next_YYYYMM` 作为权威原始数据，忽略 `device_data_YYYYMM`。
- 使用 `carbon_flux_YYYYMM` 作为权威通量成果。
- `period_at`、`ts` 均按北京时间 `Asia/Shanghai` 解析和展示。

## 3. 领域模型

```text
Carbon 设备
├── 通道 node_id：1…nodes_count
│   ├── 地块 A
│   ├── 地块 B
│   ├── 地块 C
│   └── 地块 D
└── 测量周期 period
    ├── period_at：周期业务时间
    ├── 4 个地块 × 2 个气室阶段
    └── 每个地块一组 NEE / ER / GPP
```

### 3.1 设备与节点

- 设备身份来自 `devices.id` 和 `devices.sn`。
- `sn` 作为平台稳定序列号。当前 26 台 v2 设备的 `sn` 均非空且唯一。
- 节点选择器展示完整的 `1…nodes_count`。
- 没有数据的节点仍展示，并标记为“暂无数据”。
- 默认选择第一个节点 `node_id = 1`。
- 节点与地块选择写入 URL 参数，便于刷新和分享链接后恢复状态。

### 3.2 地块与气室

每台设备的每个节点包含 A、B、C、D 四个地块。设备有透明和遮光两个气室：

- `room = light`：透明气室。
- `room = black`：遮光气室。

一个完整周期最终为四个地块各产生一段 light 数据和一段 black 数据。实际测量中两个气室会同时覆盖不同地块并在后续阶段交换，例如：

```text
A-light + C-black
B-light + D-black
C-light + A-black
D-light + B-black
```

适配器不得依赖固定执行顺序，应按实际的 `node_id + period + field + room` 分组。

### 3.3 周期与成果

通量成果的最小业务身份为：

```text
device_id + node_id + period + field
```

一条 `carbon_flux_YYYYMM` 记录对应一个设备、一个节点和一个周期，其 `data` JSON 数组通常包含 A/B/C/D 四个地块的成果：

```json
[
  {
    "field": "A",
    "nee": -4.775435381656458,
    "er": 137.51927047507382,
    "gpp": 142.29470585673027
  }
]
```

NEE、ER、GPP 的统一单位为：

```text
μg CO₂·m⁻²·s⁻¹
```

负数属于合法源库成果，不截断为 0，也不自动判定为质量异常。`null` 或字段缺失显示为“暂无结果”。第一版不自行生成质量字段。

## 4. 数据源与适配器

### 4.1 数据源定义

- 底层数据源类型：`mysql`。
- 专用适配器代码：`carbon_sink_mysql`。
- 管理端显示名称：`Carbon 碳汇数据库`。
- DSN 密钥引用：`env:CARBON_SINK_MYSQL_DSN`。
- 目标 schema 固定为 `carbon_sink_v2`，不依赖 DSN 的默认数据库。
- 管理员不需要填写表前缀、字段映射或 JSON 路径。

管理端提供：

1. 测试连接。
2. 查看源设备。
3. 同步全部有效设备。
4. 查看同步结果与失败原因。

实现方式与现有 THCPN 专用数据源适配器同级，不复用通用 MySQL 字段映射。

### 4.2 分表路由

涉及三类月分表：

- `periods_YYYYMM`
- `carbon_flux_YYYYMM`
- `device_data_next_YYYYMM`

月表后缀取决于 Carbon 服务器时间，而 `period_at` 和 `ts` 是北京时间。跨月时，业务时间所在月份和物理表后缀可能不同。

查询规则：

1. 根据用户时间范围计算业务月份。
2. 同时尝试业务月份前一个月、当月和后一个月的物理表。
3. 只查询 `information_schema` 中实际存在的表。
4. 合并结果后按北京时间的 `period_at` 或 `ts` 再过滤。
5. 按源表主键或业务身份去重。

不得只根据 `period_at` 所在月份拼接单张表名。

## 5. 设备同步

### 5.1 同步范围

同步条件：

```sql
devices.deleted_at IS NULL
AND devices.device_type = 'carbon-sink-v2'
```

其他 `carbon-sink`、`carbon-sink-v1` 和 `other` 均忽略。

每次同步所有有效设备。同步只写入系统设备库，不自动加入工作区、项目或样地；管理员后续使用平台现有分配流程完成归属。

### 5.2 平台设备映射

| Carbon 字段 | 平台字段 |
| --- | --- |
| `devices.id` | `device_source_refs.external_device_id` |
| `devices.sn` | `devices.serial_no` |
| `devices.name` | `devices.name` |
| `carbon-sink-v2` | `devices.product_id = carbon_sink_v2` |
| 固定映射 | `devices.device_type = carbon_sink` |
| `devices.nodes_count` | Carbon 专属设备属性 |

设备已存在时按数据源引用更新，不重复创建。源设备后续删除时不物理删除平台资产，只更新同步状态并保留历史关联。

### 5.3 设备资料与运行状态

`device_informations` 同一设备可能有多条记录，统一读取 `deleted_at IS NULL` 中 `id` 最大的一条。

同步为稳定资料：

- `latitude`
- `longitude`
- `altitude`
- `address`
- `iccid`
- `current_firmware_version`
- `avatar`

实时读取，不固化为资料：

- `battery`
- `signal`
- `network`

## 6. 原始采样解析

### 6.1 权威表

只读取 `device_data_next_YYYYMM`：

```text
device_id
device_config_id
node_id
period
period_at
field
room
data
type
ts
```

查询必须带设备、节点、时间范围；周期详情进一步带 `period` 和 `field`，避免对整月大表执行无约束聚合。

### 6.2 处理后 JSON 结构

`device_data_next.data` 是数组，不是旧表中的 `{key: {value}}` 对象：

```json
[
  {"key": "CO2", "data": 416.2, "unit": "ppm"},
  {"key": "tempL", "data": 24.9, "unit": "℃"},
  {"key": "humiL", "data": 40.5, "unit": "%"},
  {"key": "tempB", "data": 25.5, "unit": "℃"},
  {"key": "humiB", "data": 41.6, "unit": "%"}
]
```

适配器按数组元素的 `key` 建立索引，并读取元素的 `data`。

页面归一化规则：

- CO₂：读取 `CO2`，单位 ppm。
- `room=light`：温度读取 `tempL`，湿度读取 `humiL`。
- `room=black`：温度读取 `tempB`，湿度读取 `humiB`。
- 非当前气室的温湿度不进入当前地块阶段图表。

实查当前完整阶段通常包含 75 个采样点，持续约 146–149 秒。适配器必须保留全部采样并按 `ts` 排序，不在查询层取首值、尾值、均值或抽样。

## 7. 专属 API

Carbon 不创建通用数据流，使用设备专属接口。建议接口如下：

### 7.1 用户接口

```text
GET /api/v1/devices/:device_id/carbon/overview
GET /api/v1/devices/:device_id/carbon/flux
GET /api/v1/devices/:device_id/carbon/periods
GET /api/v1/devices/:device_id/carbon/periods/:period
POST /api/v1/devices/:device_id/carbon/exports
```

通量查询参数：

```text
node_id
field
start
end
```

周期详情参数：

```text
node_id
field
```

周期详情返回：

- 周期身份和业务时间。
- 当前地块的 NEE、ER、GPP。
- light 全部采样点。
- black 全部采样点。
- 每段的起止时间、采样数和完整状态。
- 原始采样缺失说明。

如果通量成果存在但原始采样不完整，仍返回并展示通量成果；原始数据缺失只作为详情提示。

### 7.2 管理员接口

```text
GET  /api/v1/admin/data-sources/:id/carbon-sink/devices
POST /api/v1/admin/data-sources/:id/carbon-sink/devices/sync-all
```

管理员接口负责预览源设备和同步，不向普通用户暴露源库结构。

所有用户接口继续使用平台现有设备可见性和工作区权限判断。

## 8. 最新数据概况

节点数据概况由该 `node_id` 是否存在 `device_data_next` 采样决定：

- 存在采样：显示“有数据”，并展示最新采样时间。
- 从未有采样：显示“暂无数据”。

设备数据概况：

- 至少一个节点存在采样，则显示“有数据”。
- 所有节点均无采样，则显示“暂无数据”。

上传时间不用于推断设备是否实时在线，也不再计算延迟或离线状态。

## 9. Carbon 专属前端

### 9.1 通用与专属页面边界

- 资料：复用通用设备资料页。
- 配置：复用通用配置页，并增加只读 Carbon 属性。
- 概览：Carbon 专属。
- 数据：Carbon 专属。

前端根据 `device_type = carbon_sink` 选择专属概览和数据组件。

### 9.2 概览页

展示：

- 设备数据概况。
- 最新原始采样时间和最新通量时间。
- 节点数据矩阵，固定展示 `1…nodes_count`。
- 当前节点 A/B/C/D 四个地块的最新 NEE、ER、GPP 摘要。
- 电量、信号、网络等源库设备信息。

### 9.3 数据页

筛选顺序：

1. 选择节点，默认节点 1。
2. 选择地块，默认 A。
3. 选择时间范围，默认最近 7 天。

时间范围快捷项：24 小时、7 天、30 天、自定义。

趋势区域分别展示三张图：

- NEE 趋势图。
- ER 趋势图。
- GPP 趋势图。

三张图共享时间范围，但不叠在同一坐标系。负数值保留，图表显示零基线。

点击任意曲线点后：

1. 选择对应周期。
2. 将 `period` 写入 URL。
3. 自动滚动到同页下方的周期详情。
4. 三张图的当前周期选择状态同步。

### 9.4 周期详情

周期详情包含：

- 周期时间、周期编号、节点和地块。
- NEE、ER、GPP 成果。
- light/black CO₂ 对比图。
- 温度图。
- 湿度图。
- 各阶段采样数量、实际起止时间和缺失状态。

CO₂ 对比图将 light 和 black 分别换算为“阶段开始后的相对秒数”，再叠加到同一坐标系中，便于比较变化斜率。温度和湿度使用当前气室对应字段。

### 9.5 数值精度

- 摘要卡和坐标轴：2 位小数。
- Tooltip 和周期详情：4 位小数。
- 后端返回和 CSV：保留源库完整精度。

## 10. 导出

两类导出都进入平台现有异步导出任务，不受页面图表采样点数限制。

### 10.1 通量成果 CSV

列：

```text
device_id
node_id
period
period_at
field
nee
er
gpp
```

### 10.2 原始采样 CSV

不做平滑、抽样、聚合或其他后处理，也不包含原始 JSON 列。

列：

```text
device_id
node_id
period
period_at
field
room
ts
CO2
tempL
humiL
tempB
humiB
stemp
shumi
```

导出请求使用当前设备、节点、地块和时间范围。CSV 保留源库完整数值精度。

## 11. 数据库与代码改动范围

### 11.1 平台数据库

- 扩展 `devices.device_type` 约束，允许 `carbon_sink`。
- 扩展 `data_stream_bindings.adapter_code` 或对应适配器注册约束，允许 `carbon_sink_mysql`。
- 注册设备类型的中英文显示名称。
- 如现有扩展属性无法保存 `nodes_count`，增加 Carbon 专属设备元数据存储。

### 11.2 后端

- Carbon 数据源连接校验。
- Carbon 源设备读取与全量同步。
- 最新 `device_informations` 解析。
- 月分表发现和跨月查询。
- 通量 JSON 数组解析。
- `device_data_next.data` 数组解析。
- Carbon 专属概览、通量、周期详情接口。
- 通量和原始采样异步 CSV 导出。

### 11.3 前端

- 管理员 Carbon 数据源入口、设备预览和同步。
- 设备类型名称、筛选和图标。
- Carbon 专属概览。
- Carbon 专属数据页与周期联动详情。
- 两类导出入口和任务状态反馈。

## 12. 第一版不做

- 不在平台计算或重算 NEE、ER、GPP。
- 不创建 Carbon 数据处理任务。
- 不将 `node_id` 创建为独立设备。
- 不将 Carbon 指标注册为通用设备数据流。
- 不读取 `device_data_YYYYMM`。
- 不根据数值正负自行判断质量。
- 不复制通量和原始采样到平台数据库。
- 不接入当前没有实际记录的 `type=image` 数据。

## 13. 实施顺序

1. 增加数据库约束、设备类型和适配器注册。
2. 实现 Carbon 数据源连接、源设备预览和同步。
3. 实现分表发现、通量查询和原始周期详情查询。
4. 实现 Carbon 管理端入口。
5. 实现 Carbon 专属概览和数据页。
6. 实现通量与原始采样异步 CSV 导出。
