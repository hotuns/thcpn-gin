# LoRaWAN V2 API 接入清单

对照本地采集服务 `/Users/hotuns/code/lora_iot_server-v2-rust/openapi.yaml`（info.version: `20261031`）与平台路由、来源实现、后台入口检查。物理节点接口接入范围见下文；最新数据查询使用专用接口。此清单说明代码接入，不代表已对线上设备执行配置或验证硬件生效。

| 上游操作 | 接入情况 | 平台用途 / 入口 |
| --- | --- | --- |
| `GET /ping` | 已接入 | 数据源连接测试 |
| `GET /devices` | 已接入 | 数据源网关列表、全量同步 |
| `POST /device` | 已接入 | 后台创建设备，自动生成 SN 与默认配置 |
| `GET /device/{sn}` | 已接入 | 网关详情、配置校验及同步 |
| `POST /device/{sn}` | 已退出业务调用 | 源端已废弃人工节点数量；不再用于扩容 |
| `POST /device/{sn}/firmware` | 已接入 | 从固件库选择版本登记升级 |
| `GET /firmwares` | 已接入 | 数据源工具中的源端固件列表 |
| `GET /firmware/{id}` | 已接入 | 数据源工具查看源端固件详情 |
| `DELETE /firmware/{id}` | 已接入 | 数据源工具删除源端固件；平台固件库归档是另一种操作 |
| `POST /device/{sn}/config` | 已接入 | 网关配置编辑及默认配置创建 |
| `GET /device/{sn}/configs` | 已接入 | 网关配置历史 |
| `GET /device/{sn}/config/{id}` | 已接入 | 历史配置详情、JSON 查看 |
| `POST /device/{sn}/node/{index}/sensor_config` | 已接入 | 节点传感器配置保存与批量应用 |
| `GET /device/{sn}/node/{index}/sensor_config/latest` | 已接入 | 当前传感器配置、指标发现 |
| `GET /device/{sn}/node/{index}/sensor_configs` | 已接入 | 传感器配置历史 |
| `GET /device/{sn}/node/{index}/sensor_config/{id}` | 已接入 | 传感器历史配置详情 |
| `POST /device/{sn}/node/{index}/time_config` | 已接入 | 节点时间配置保存 |
| `GET /device/{sn}/node/{index}/time_config/latest` | 已接入 | 当前时间配置 |
| `GET /device/{sn}/node/{index}/time_configs` | 已接入 | 时间配置历史 |
| `GET /device/{sn}/node/{index}/time_config/{id}` | 已接入后台 API / client | 按 ID 读取；后台历史列表已有完整内容，未单独调用此详情接口 |
| `GET /device/{sn}/node/{index}/latest` | 已接入 | 网关概览与前后台节点电量/信号读取，保留长期离线前最后一条记录 |
| `GET /device/{sn}/logs` | 已接入 | 网关日志查询及下载 |
| `GET /device/{sn}/node/{index}/data` | 已接入 | 节点曲线、原始表格、异步导出和诊断状态 |
| `GET /device/{sn}/info` | 已接入 | 前后台网关上报信息，无历史窗口限制；ICCID 不覆盖人工登记 |
| `GET /device/{sn}/infos` | 已接入 | 网关指标历史和导出 |

## 最新记录查询

节点状态直接使用 `/node/{index}/latest`，网关上报信息直接使用 `/info`，不传 `start_at`、`end_at` 或分页参数，不再受 3 天或 90 天窗口影响。历史曲线和导出仍使用 `/data` 与 `/infos`。

节点的秒级 Unix 时间戳转为 UTC 时间值，由页面显示北京时间；兼容已有毫秒、RFC3339 和 BSON 日期格式。网关信息保持原有 API 响应字段，包括 BSON 日期及字符串 ICCID。`payload: null` 表示暂无上报，不能伪造电量、信号零值；HTTP 错误或无效记录保留错误，不回退到历史查询掩盖失败。最后一条上报记录不代表设备当前在线。


新增物理节点接口由节点管理接入：登记、来源库存列表（分页/筛选）、实际绑定列表、安装、解绑、更换。平台节点资产缓存保存稳定 UUID、来源 ID/SN 和当前安装关系；采集位置继续保留原数据流、名称、经纬度、配置和历史引用。

按物理节点详情查询的 `GET /nodes/{sn}` 尚未提供单独详情页；源库存接口支持 SN 精确筛选。新网关 connection/activity 接口本轮未接入，现有状态读取方式保持。

取消旧的“增加节点数量”接口和 UI。上游 node_count 为协议上限 254；同步只扫描实际绑定节点，列表另保留有历史数据流或资料的位置，不生成 254 个虚拟节点。

配置保存、历史、固件、日志和时间范围数据接口继续使用原上游路径，配置与数据属于网关＋序号。未绑定位置保存配置不代表下发，更换物理设备不改变配置 CID 或历史数据归属。

节点源端操作成功后刷新平台绑定与指标。部分成功须通过“同步平台指标”恢复，不重复登记/绑定/更换；结果未知先刷新源端核对。管理员操作记录审计和源端操作状态，硬件应用状态不作推断。

## 独立节点v2入口及 CSV 新建安装

平台新增来源级节点库存/新建接口、来源内网关选择接口和 CSV 只读预览接口。登记可脱离网关；可选网关时先检查数据源一致、位置空闲和 SN 未登记，再调用 `POST /nodes`、`PUT /nodes/{sn}/binding`。两次写入无法合并事务，分别报告 created/bound 和操作 ID。CSV 前端逐行提交相同来源级接口，结束后统一使用网关同步能力补全平台指标。文件结构校验不向源端写入。
