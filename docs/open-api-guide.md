# THCPN 开放 API 接入指南

开放 API 面向需要从第三方系统读取工作区设备数据的专业版用户。所有业务请求使用工作区 API Key，不使用用户登录令牌。

## 创建 API Key

工作区管理员进入“订阅与用量 → 开放 API”，创建并立即保存以 `thcpn_` 开头的密钥。完整密钥只展示一次，可以随时撤销。

请求头：

```http
Authorization: Bearer thcpn_xxxxxxxxx
Accept: application/json
```

交互式接口文档位于：

```text
/api/v1/open/docs
```

## 1. 获取设备和字段

```bash
curl 'https://example.com/api/v1/open/devices' \
  -H 'Authorization: Bearer thcpn_xxxxxxxxx'

curl 'https://example.com/api/v1/open/devices/DEVICE_ID/data-streams' \
  -H 'Authorization: Bearer thcpn_xxxxxxxxx'
```

设备列表可通过 `device_type` 和 `status` 筛选。数据流中的 `id` 用于查询，`code`、`name` 和 `unit` 用于展示。

## 2. 查询遥测数据

时间采用 RFC 3339，并建议明确携带时区：

```bash
curl 'https://example.com/api/v1/open/devices/DEVICE_ID/telemetry?start_time=2026-08-17T00:00:00%2B08:00&end_time=2026-08-18T00:00:00%2B08:00&data_stream_ids=STREAM_ID&limit=1000' \
  -H 'Authorization: Bearer thcpn_xxxxxxxxx'
```

`data_stream_ids` 可传多个 UUID，以英文逗号分隔。不传时查询设备的全部遥测数据流。

## 3. 查询图片和媒体

```bash
curl 'https://example.com/api/v1/open/devices/DEVICE_ID/media?media_type=image&start_time=2026-08-17T00:00:00%2B08:00&end_time=2026-08-18T00:00:00%2B08:00&page=1&page_size=50' \
  -H 'Authorization: Bearer thcpn_xxxxxxxxx'
```

返回的预览地址有短期有效期。需要原始文件时，请继续请求记录中的 `download_url`；原始文件下载计入工作区下载流量。

## 4. 查询碳汇站

```text
GET /api/v1/open/devices/{device_id}/carbon/overview
GET /api/v1/open/devices/{device_id}/carbon/flux
GET /api/v1/open/devices/{device_id}/carbon/periods
GET /api/v1/open/devices/{device_id}/carbon/period
```

通量和周期接口使用 `node_id`、`field`、`start_time`、`end_time`；周期详情使用列表返回的 `period`。

## 5. 下载导出产物

```bash
curl 'https://example.com/api/v1/open/exports/EXPORT_JOB_ID/download' \
  -H 'Authorization: Bearer thcpn_xxxxxxxxx'
```

导出任务必须属于 API Key 的工作区且仍在有效期内。返回的是短期下载地址，文件大小计入工作区下载流量。

## 错误处理

- `400`：参数或时间格式错误。
- `401`：API Key 缺失、无效、过期或已撤销。
- `403`：工作区专业版已失效或无对应权益。
- `404`：资源不属于该工作区，或资源不存在。
- `409`：导出文件未完成、已失效或下载额度不足。

API Key 只允许访问其所属工作区当前认领的设备；设备离开工作区后会立即失去访问权限。

每个 API Key 默认限制为每分钟 600 次请求。工作区的 API Key 列表会显示每个密钥本月累计调用次数和最近使用时间。
