# LoRaWAN V2 API 接入清单

对照本地采集服务 `/Users/hotuns/code/lora_iot_server-v2-rust/openapi.yaml`（info.version: `20261012`）与平台路由、来源实现、后台入口检查。文档列出 25 个 HTTP 操作；增加节点功能完成后，25 个均有直接调用实现，最新数据查询不再使用固定时间窗口替代。此清单说明代码接入，不代表已对线上设备执行配置或验证硬件生效。

| 上游操作 | 接入情况 | 平台用途 / 入口 |
| --- | --- | --- |
| `GET /ping` | 已接入 | 数据源连接测试 |
| `GET /devices` | 已接入 | 数据源网关列表、全量同步 |
| `POST /device` | 已接入 | 后台创建设备，自动生成 SN 与默认配置 |
| `GET /device/{sn}` | 已接入 | 网关详情、配置校验及同步 |
| `POST /device/{sn}` | 本次新增 | 设备详情 → 节点管理 → 增加节点；只允许保持或增加总数，1–254 |
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

## 增加节点的保存与恢复

平台入口为 `PATCH /api/v1/admin/devices/{device_id}/lorawan-v2/node-count`，请求体为目标总数 `{"node_count": 5}`，不是新增数量。

1. 使用平台设备的有效来源映射定位数据源和网关，读取源端最新数量。平台内同一数据源/网关的同步与扩容使用同一数据库 advisory lock；上游没有条件版本写入，不能保证排除绕过平台的外部并发操作。
2. 写入目标总数后回读源端。即使写请求返回错误，回读确认达到目标时仍可确认源端接受；无法确认则记录 `unknown` 和操作 ID，不能声称成功。
3. 在平台事务中更新数量，并为新增编号建立内置电压、RSSI、SNR、SD 使用率指标和绑定。保留已有指标、名称、安装资料和归属，不扫描已有节点的传感器配置。
4. 平台失败返回 `partial`，后台可按同一总数重试。源端已是该数量时不再次 POST，只补平台投影。
5. 新节点的业务传感器指标与时间配置仍由运维继续设置；成功提示仅表示源端和平台完成，设备应用状态保持未知。
