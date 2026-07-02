# THCPN Adapter 设计说明

本文总结 THCPN 设备数据库接入标准站和组网站的 adapter 设计。当前不涉及具体代码实现，目标是明确边界、数据读取流程、配置修改流程、性能约束和后续落地顺序。

当前实现状态：

```text
第一阶段只读接入已经开始落地。

已实现：
1. 平台库 device_source_refs / device_config_snapshots。
2. thcpn_legacy_mysql telemetry/image 只读查询。
3. 按 device_data_index 定位 device_data_* 分表。
4. 标准站同步入口读取 devices + 最新 device_config，并生成平台 Device / DataStream / Binding。

未实现：
1. gate_node 组网站拓扑同步。
2. 配置修改和新增 device_config。
3. 旧库数据同步到分析库。

当前明确不做：
1. 按历史 device_config_id 精确切换配置解释。
2. 平台始终以最新同步的 device_config 生成和解释 DataStream。
3. 历史数据与当前配置不匹配时跳过并提示，不尝试自动修复或回溯。
```

## 1. 核心结论

标准站和组网站不应该按每台设备分别适配，也不应该为组网站单独写一套完全不同的数据读取 adapter。

当前已知的 THCPN 设备数据结构可以归纳为一个设备家族：

```text
THCPN 标准站协议
```

它覆盖：

```text
1. 标准站单体设备。
2. 组网站网关设备。
3. 组网站节点设备。
```

这些设备共用同一套核心数据结构：

```text
devices
device_config
device_data_index
device_data_*
```

组网站只是额外通过 `gate_node` 表表达网关和节点的父子关系：

```text
gate_node.gate_id -> devices.id
gate_node.node_id -> devices.id
```

因此推荐拆成三类能力：

```text
1. 标准站数据 adapter
   读取 device_data_index / device_data_*。

2. 标准站配置 adapter
   读取 device_config，新增 device_config 版本。

3. 组网站拓扑同步逻辑
   读取 gate_node，同步网关和节点关系。
```

不要把这些能力都塞进一个巨大的查询 adapter。数据查询、配置修改、拓扑同步的风险等级和业务语义不同，应该在接口和服务边界上分开。

## 2. Adapter 命名

当前代码中已有占位 adapter：

```text
thcpn_legacy_mysql
```

如果后续确认“标准站”是正式业务名称，建议新增更明确的 adapter code：

```text
thcpn_standard_station_mysql
```

短期为了减少迁移影响，可以先沿用：

```text
thcpn_legacy_mysql
```

但文档和代码注释中应明确它代表：

```text
THCPN 标准站 MySQL 设备库 adapter。
```

不是每台设备一个 adapter，也不是标准站和组网站各自一套 adapter。

## 3. 相关旧库表

### 3.1 devices

旧库设备主表。标准站、网关、节点都在这张表里。

关键字段：

```text
id
name
iccid
version
status
device_type
active
sn
uuid
current_device_version
created_at
updated_at
deleted_at
```

平台侧不直接使用旧库 `devices.id` 作为平台主键，而是通过映射表保存：

```text
platform device -> external_device_id
```

### 3.2 device_config

设备配置表。每台设备可以有多条配置。

关键字段：

```text
id
device_id
data
image
control
version
uuid
is_mg
created_at
updated_at
deleted_at
```

重要规则：

```text
修改设备配置不是 update 旧记录，而是新增一条 device_config。
设备下次唤醒时获取最新配置。
```

`data` 里描述遥测传感器和 key 的含义，例如：

```text
temp      空气温度 ℃
humi      相对湿度 %
press     气压 hpa
wind_sp   风速 m/s
wind_d    风向 °
pm2.5     PM2.5 ug/m³
pm10      PM10 ug/m³
solar     光照 klux
stemp     土壤温度 ℃
shumi     土壤水分 %
diams     径向生长 mm
rain      降雨量 mm
bat       电压 V
```

`image` 里描述图片通道，例如：

```text
key1      可见光
key2      近红外
key3      叶面积
key4      根系
```

`control` 里描述采集、上传、唤醒等配置，例如：

```text
data_capture_invl
data_upload_invl
img_capture_invl
img_upload_invl
misc_invl
```

### 3.3 device_data_index

数据分表索引。

已验证结构：

```text
id
start_at
end_at
tb_name
```

它不按设备分，而是按时间段定位物理分表。

示例：

```text
2026-07-01 00:00:00 到 2026-07-31 23:59:59 -> device_data_154
```

查询时必须先查 `device_data_index`，不能扫所有 `device_data_*` 表。

### 3.4 device_data_*

实际数据表。

关键字段：

```text
id
device_config_id
device_id
data
ts
type
uuid
created_at
updated_at
deleted_at
```

已确认有索引：

```text
device_id_ts(device_id, ts)
```

查询必须带：

```text
device_id
ts start/end
deleted_at IS NULL
type
```

遥测行：

```text
type = data
data = {
  "temp": {"value": 26.38},
  "humi": {"value": 70.54}
}
```

图片行：

```text
type = image
data = {
  "key1": {"value": "/1206/xxx_4.jpg"}
}
```

### 3.5 gate_node

组网站拓扑表。

```sql
CREATE TABLE `gate_node` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `gate_id` int(10) unsigned NOT NULL COMMENT '网关编号',
  `node_id` int(10) unsigned NOT NULL COMMENT '节点编号',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `gate_node_FK` (`gate_id`),
  KEY `gate_node_FK_1` (`node_id`)
);
```

语义：

```text
gate_id 是网关设备的 old devices.id。
node_id 是节点设备的 old devices.id。
网关和节点的数据读取方式仍然和标准站一样。
```

`gate_node` 只表达拓扑关系，不改变数据查询规则。

## 4. 平台侧建议模型

### 4.1 DataSource

继续表示内部设备源实例：

```text
data_sources
- id
- name: THCPN 标准站生产库
- type: mysql
- dsn_secret_ref: env:THCPN_STANDARD_STATION_MYSQL_DSN
- status
```

普通 Workspace 用户不管理 DataSource。

### 4.2 DeviceSourceRef

平台设备和旧库设备之间需要映射。

建议表：

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

用途：

```text
平台 device.id -> THCPN old devices.id
```

### 4.3 DeviceConfigSnapshot

保存旧库配置快照。

建议表：

```text
device_config_snapshots
- id
- device_id
- data_source_id
- external_device_id
- external_config_id
- version
- data_json
- image_json
- control_json
- source_created_at
- source_updated_at
- synced_at
- created_at
```

必要性：

```text
DeviceConfigSnapshot 保存平台最近一次同步到的外部设备配置。
平台使用这份最新配置生成当前 DataStream 和 DataStreamBinding。
第一阶段不把它作为历史版本回溯依据。
```

当前解释规则：

```text
1. 平台始终以设备最新同步的 device_config 生成 DataStream。
2. 历史查询也使用当前 DataStreamBinding.adapter_config 解析 JSON。
3. device_data_* 中的 device_config_id 暂时只作为旧库调试和未来扩展信息，不参与第一阶段解析。
4. 如果历史数据行无法按当前配置解析，例如 key 缺失、value_path 取不到、值不是数值或媒体路径为空，则跳过该行或字段。
5. 查询结果应返回 warning 或在页面提示“部分历史数据与当前设备配置不匹配，已跳过”。
6. 如果历史配置中同名 key 的业务含义发生变化，平台第一阶段不自动识别；该风险由设备配置管理流程控制。
```

### 4.4 DataStream 和 DataStreamBinding

`device_config.data` 和 `device_config.image` 应自动生成平台 DataStream。

遥测示例：

```text
data_streams
- device_id
- code: temp
- name: 空气温度
- type: telemetry
- unit: ℃
```

图片示例：

```text
data_streams
- device_id
- code: key1
- name: 可见光
- type: image
```

对应 binding：

```text
data_stream_bindings
- data_stream_id
- data_source_id
- adapter_code: thcpn_standard_station_mysql
- payload_type: columns 或 media
- adapter_config_json
```

遥测 binding 配置示例：

```json
{
  "external_device_id": 1206,
  "row_type": "data",
  "json_key": "temp",
  "value_path": "$.temp.value",
  "table_index": "device_data_index",
  "table_name_field": "tb_name",
  "index_start_field": "start_at",
  "index_end_field": "end_at",
  "time_field": "ts"
}
```

图片 binding 配置示例：

```json
{
  "external_device_id": 1206,
  "row_type": "image",
  "image_key": "key1",
  "object_key_path": "$.key1.value",
  "media_type": "image",
  "table_index": "device_data_index",
  "table_name_field": "tb_name",
  "index_start_field": "start_at",
  "index_end_field": "end_at",
  "time_field": "ts"
}
```

### 4.5 DeviceRelation

组网站网关和节点关系建议进入平台业务库。

建议表：

```text
device_relations
- id
- workspace_id
- parent_device_id
- child_device_id
- relation_type: gateway_node
- data_source_id
- external_parent_device_id
- external_child_device_id
- status
- synced_at
- created_at
- updated_at
```

这样网关和节点都仍然是平台 Device，关系由 `device_relations` 表达。

不要把节点数据流都挂到网关设备下面。正确模型是：

```text
网关是一个 Device。
每个节点也是一个 Device。
每个 Device 有自己的 DataStream。
网关和节点通过 DeviceRelation 连接。
```

## 5. 数据查询逻辑

### 5.1 查询输入

数据 adapter 的最小输入：

```text
external_device_id
row_type: data / image
json_key 或 image_key
start_time
end_time
limit 或 page/page_size
```

这些输入来自平台内部的 `DataStreamBinding.adapter_config_json` 和用户的查询时间范围。用户请求不能直接传入库表名、JSONPath 或 raw SQL。

### 5.2 分表定位

先查 `device_data_index`：

```sql
SELECT tb_name
FROM device_data_index
WHERE start_at <= :query_end
  AND end_at >= :query_start
ORDER BY start_at;
```

得到一组分表：

```text
device_data_153
device_data_154
```

adapter 必须校验 `tb_name`：

```text
只允许匹配受控格式，例如 ^device_data_[0-9]+$。
不允许外部输入任意表名。
```

### 5.3 遥测查询

对每个命中的分表执行受控查询：

```sql
SELECT
  ts,
  JSON_UNQUOTE(JSON_EXTRACT(data, '$.temp.value')) AS raw_value
FROM `device_data_154`
WHERE device_id = ?
  AND deleted_at IS NULL
  AND type = 'data'
  AND ts >= ?
  AND ts <= ?
ORDER BY ts ASC
LIMIT ?;
```

多分表结果在应用层合并：

```text
1. 根据当前 DataStreamBinding.adapter_config 的 value_path 取 raw_value。
2. raw_value 缺失、为空、不是数值或结构不符合当前配置时，跳过该行并累计 skipped_rows。
3. 合并 rows。
4. 按 ts 排序。
5. 应用最终 limit。
6. 返回统一 TelemetryResult。
7. skipped_rows > 0 时返回 warning，例如 thcpn_config_mismatch。
```

### 5.4 媒体查询

对每个命中的分表执行受控查询：

```sql
SELECT
  id,
  ts,
  JSON_UNQUOTE(JSON_EXTRACT(data, '$.key1.value')) AS object_key
FROM `device_data_154`
WHERE device_id = ?
  AND deleted_at IS NULL
  AND type = 'image'
  AND ts >= ?
  AND ts <= ?
  AND JSON_EXTRACT(data, '$.key1.value') IS NOT NULL
ORDER BY ts DESC
LIMIT ?
OFFSET ?;
```

返回统一 MediaResult：

```text
id
captured_at
object_key
thumbnail_object_key
media_type
```

图片路径仍然是旧库里的对象 key，例如：

```text
/1206/1782886365_1782886264_4.jpg
```

是否需要补齐对象存储域名、签名下载 URL，应由平台对象访问层处理，不由标准站数据 adapter 直接拼公开 URL。

### 5.5 组网站查询

组网站的单节点查询和标准站完全一样：

```text
node platform device
-> device_source_refs.external_device_id = node_id
-> standard station data adapter
```

网关查询也是一样：

```text
gateway platform device
-> device_source_refs.external_device_id = gate_id
-> standard station data adapter
```

如果要查询整个组网站：

```text
1. 上层 service 根据 gateway platform device 查 device_relations。
2. 找到所有 child node devices。
3. 分别查询每个节点的 DataStream。
4. 上层 service 合并结果。
```

不要让底层数据 adapter 直接理解“整个组网站聚合查询”。底层 adapter 只负责：

```text
external_device_id + key + 时间范围 -> 数据
```

## 6. 查询性能边界

### 6.1 可以接受的原因

直接查旧 MySQL 分表不是最终高性能分析方案，但第一版可以做到可控。

原因：

```text
1. device_data_index 很小，只用于按时间找分表。
2. device_data_* 有 device_id_ts(device_id, ts) 索引。
3. 单设备、单数据流、有限时间范围查询时，MySQL 先用索引缩小行集，再做 JSON_EXTRACT。
```

### 6.2 必须强制的限制

adapter 必须强制：

```text
1. 查询必须带 start_time 和 end_time。
2. 普通同步 API 时间范围必须有限制，例如 7 天或 31 天。
3. 大范围查询走 ExportJob，不走同步 API。
4. 查询必须先查 device_data_index。
5. 查询分表时必须带 device_id 和 ts 范围。
6. 不能按 JSON 字段过滤或排序。
7. 不能让用户传 table_name、JSONPath 或 raw SQL。
8. 分表数量过多时拒绝同步查询。
```

### 6.3 后续高性能方案

如果后续访问量大、跨设备分析多、跨年查询多，建议增加平台侧标准化存储：

```text
旧库 device_data_*
  -> sync/ingest
  -> 平台标准遥测表 / ClickHouse / Timescale
  -> THCPN 查询 API
```

标准化后的表可以是：

```text
telemetry_points
- workspace_id
- device_id
- stream_id
- external_device_id
- external_config_id
- key
- ts
- value
- unit
- quality
```

这样可以避免每次查询旧库分表和 JSON_EXTRACT。

第一版建议先直连旧库读，跑通模型和权限，再根据真实查询压力决定是否同步到分析库。

## 7. 配置修改逻辑

### 7.1 配置修改不是数据读取 adapter 的职责

数据读取 adapter 负责：

```text
QueryTelemetry
QueryMedia
Health
```

配置修改 adapter 负责：

```text
GetCurrentConfig
ListConfigSnapshots
ValidateConfigPatch
CreateConfigVersion
CheckConfigApplyStatus
```

它们可以在同一个 adapter family 下，但接口和 service 边界必须分开。

### 7.2 修改规则

已确认业务规则：

```text
修改配置就是新增一条 device_config。
设备下次唤醒时获取最新 config。
```

所以不能直接 update 旧配置：

```sql
UPDATE device_config SET control = ...
```

应该：

```text
1. 读取当前最新 device_config。
2. 基于当前配置应用受控 patch。
3. INSERT 一条新的 device_config。
4. 保存平台侧 DeviceConfigChange。
5. 写 audit log。
6. 标记 pending_apply。
7. 等设备下次唤醒后通过新数据的 device_config_id 判断是否 applied。
```

### 7.3 配置修改示例

用户修改采集和上传间隔时，前端不应该提交完整 raw JSON，而应该提交受控字段：

```json
{
  "control": {
    "data_capture_invl": "20,30,40,50 *",
    "data_upload_invl": "20,30,40,50 *",
    "img_capture_invl": "30 *",
    "img_upload_invl": "30 *"
  }
}
```

后端读取当前配置：

```text
current.data
current.image
current.control
```

然后生成：

```text
new.data = current.data
new.image = current.image
new.control = merge(current.control, patch.control)
```

最后插入新配置：

```text
INSERT device_config (
  device_id,
  data,
  image,
  control,
  version,
  uuid,
  is_mg
)
```

具体字段取值要符合旧系统规则。

### 7.4 配置生效状态

新增 `device_config` 后不能立即认为设备已经生效。因为设备需要下次唤醒才会获取最新配置。

平台侧状态：

```text
pending_apply
applied
failed
superseded
```

判断是否生效：

```text
1. 新增配置得到 new_external_config_id。
2. 后续查询设备最新 data 行。
3. 如果最新 data.device_config_id = new_external_config_id，说明已生效。
4. 否则继续 pending_apply。
```

### 7.5 DeviceConfigChange

建议平台侧增加配置变更记录：

```text
device_config_changes
- id
- workspace_id
- device_id
- data_source_id
- adapter_code
- external_device_id
- previous_external_config_id
- new_external_config_id
- patch_json
- status
- requested_by
- requested_at
- applied_at
- error_message
```

用途：

```text
1. 审计谁改了什么。
2. 记录旧配置和新配置。
3. 跟踪等待生效和已生效状态。
4. 支持后续回滚或再次新增配置。
```

### 7.6 组网站配置修改

组网站配置仍然按具体设备修改：

```text
改网关配置 -> INSERT device_config where device_id = gate_id
改节点配置 -> INSERT device_config where device_id = node_id
```

如果用户选择“修改整个组网站采集频率”，平台 service 应展开成多个配置变更：

```text
gateway config change
node 1 config change
node 2 config change
node 3 config change
```

每个变更都有独立状态：

```text
pending_apply
applied
failed
```

不要把组网站当成一条整体配置写入旧库，除非旧系统本身有这样的配置机制。

## 8. 组网站拓扑同步

### 8.1 拓扑同步输入

旧库：

```text
gate_node
- gate_id
- node_id
- deleted_at
```

同步逻辑：

```text
1. 读取 gate_node where deleted_at is null。
2. 找到 gate_id 对应的旧库 devices。
3. 找到 node_id 对应的旧库 devices。
4. upsert 平台网关 device。
5. upsert 平台节点 devices。
6. upsert device_source_refs。
7. upsert device_relations(parent = gateway, child = node)。
8. 对网关和每个节点同步 device_config。
9. 解析配置并生成 data_streams / data_stream_bindings。
```

### 8.2 用户绑定组网站

推荐第一版：

```text
用户绑定网关。
系统自动同步该网关下的节点。
节点也作为平台 Device 存在。
```

这样权限、数据流、导出和配置修改都更清晰。

可选增强：

```text
用户也可以直接绑定节点。
系统展示它所属的网关。
```

但第一版可以先不做。

### 8.3 前端展示

后端模型可以是平铺设备加关系表，前端展示成树：

```text
北京森林站组网站
├── 网关
│   ├── 电池
│   └── 信号
├── 节点 1
│   ├── 空气温度
│   └── 相对湿度
└── 节点 2
    ├── 土壤温度
    └── 土壤水分
```

不要为了前端树形展示，把所有节点数据流都挂到网关设备下面。

## 9. DataStream 生成规则

### 9.1 遥测流

从 `device_config.data` 的 `params.contents` 解析：

```text
key
info.name
info.type
info.unit
info.index
sensorType
port
port_num
```

生成：

```text
DataStream.code = key
DataStream.name = info.name
DataStream.type = telemetry
DataStream.unit = info.unit
```

如果同一台设备内 key 重名，内部 code 需要追加后缀，但 binding 里仍保存真实 `json_key`。

### 9.2 图片流

从 `device_config.image` 解析：

```text
key
name
desc
port
port_num
sensorType
```

生成：

```text
DataStream.code = key
DataStream.name = name 或 desc
DataStream.type = image
```

### 9.3 配置消失和新增

当设备配置变化：

```text
1. 新增 key -> 新增 DataStream 和 Binding。
2. key 仍存在 -> 更新名称、单位、配置快照引用。
3. key 消失 -> 不删除历史 DataStream，标记 archived 或 disabled。
```

历史数据不通过 `device_config_id` 对应快照解释。查询始终按当前 active DataStreamBinding 解析；无法按当前配置解析的数据会被跳过并提示。

## 10. 权限和安全

### 10.1 数据查询

用户只能按平台业务资源查询：

```text
device
data_stream
dataset
```

用户不能传：

```text
table_name
tb_name
json_path
raw_sql
external_device_id
```

这些都来自平台内部映射和 binding。

### 10.2 配置修改

配置修改是高风险能力，应至少要求：

```text
device.configure
```

后续建议拆细：

```text
device.config.view
device.config.update_schedule
device.config.update_sensor
device.config.update_camera
device.config.raw_update
```

普通用户不应直接编辑完整 `device_config.data` / `image` / `control` JSON。

第一版只建议开放受控配置项，例如：

```text
数据采集间隔
数据上传间隔
图片抓拍间隔
图片上传间隔
```

raw JSON 修改应只给系统管理员或服务工程师，并且必须审计。

## 11. 推荐落地顺序

### 第一阶段：只读接入

当前代码已实现该阶段的主体能力：

```text
POST /api/v1/admin/data-sources/:data_source_id/thcpn-standard-station/devices
```

该接口只允许系统管理员调用。请求体必须包含 `target_workspace_id` 和 `external_device_id`，并可选 `project_id`、`site_id`、`product_id`、`serial_no`、`name`。接口读取系统级 THCPN MySQL DataSource 中的旧库 `devices` 和最新 `device_config`，把平台设备归属到 `target_workspace_id`，并 upsert 设备映射、配置快照、DataStream 和 DataStreamBinding。运行时查询通过 `thcpn_legacy_mysql` adapter 读取旧库分表。

实现目标：

```text
1. 标准站数据 adapter。
2. 按 device_data_index 定位分表。
3. 支持 telemetry JSON key 查询。
4. 支持 image key 查询。
5. 支持时间范围、limit、分页。
6. 保存 DeviceSourceRef。
7. 保存最新 DeviceConfigSnapshot，作为当前配置快照，不做历史回溯。
8. 从 device_config 生成 DataStream 和 Binding。
9. 查询时按当前 binding 解析旧库 JSON；不匹配数据跳过并返回 warning。
```

不做配置修改。

### 第二阶段：组网站拓扑

实现目标：

```text
1. 读取 gate_node。
2. 同步网关和节点设备。
3. 保存 device_relations。
4. 绑定网关时自动同步节点。
5. 前端以树形展示组网站。
```

数据读取仍然走标准站数据 adapter。

### 第三阶段：配置修改

实现目标：

```text
1. DeviceConfigChange。
2. 标准站配置 adapter。
3. 支持新增 device_config。
4. 只开放受控 control 配置。
5. 设备下次唤醒后通过 device_config_id 判断 applied。
6. 全量 audit log。
```

### 第四阶段：性能增强

触发条件：

```text
1. 查询频率高。
2. 跨设备聚合多。
3. 跨月、跨年查询多。
4. 导出任务大量访问旧库。
```

增强方向：

```text
1. 同步旧库数据到平台标准遥测表。
2. 或同步到 ClickHouse。
3. 建立按 device_id / stream_id / ts 的查询模型。
4. 旧库只作为原始数据和配置来源。
```

## 12. 当前设计判断

当前 `adapter_code` 模式适合接入标准站和组网站。

原因：

```text
1. 标准站和组网站共用同一数据读取协议。
2. 不需要每台设备写代码。
3. 每台设备差异由 device_config 元数据表达。
4. 分表由 device_data_index 按时间定位。
5. 组网站只增加 gate_node 拓扑，不改变数据读取。
6. 配置修改可以作为独立 config adapter，避免污染查询 adapter。
```

最终目标：

```text
一个 THCPN 标准站数据 adapter
一个 THCPN 标准站配置 adapter
一个 gate_node 拓扑同步逻辑
```

而不是：

```text
每台设备一个 adapter
标准站一套 adapter，组网站另一套 adapter
把配置写操作混入数据查询 adapter
```
