# OSS 成本优化方案

本文记录图片存储与访问的后期优化方向。当前只作为实施计划，不代表相关配置已经上线。

## 现状判断

2026 年 7 月 OSS 监控截图中，7 月 8 日单个观测点显示：

- 内网流入约 216.5 GB；
- 内网流出约 208.4 GB；
- 公网流出约 16.9 GB；
- CDN 回源流入、流出均为 0。

同地域服务器通过内网 Endpoint 访问 OSS 时，内网流入和流出不收取流量费。当前直接成本优化重点是图片预览与下载产生的公网流出。上述数值只是单日观测点，不能代替完整月度用量。

## 目标

- 用户可以持续查看图片预览；
- 页面查看不传输设备原图；
- 原图只通过受控下载入口交付；
- 降低 OSS 公网流出及业务服务器公网带宽；
- 在访问体验、存储成本和取回成本之间保持可预测的平衡。

## 目标访问链路

```text
设备上传原图
  └─ OSS 保存原图
       ├─ 列表：480 px WebP 缩略图
       ├─ 详情：1600 px WebP 预览图
       ├─ 高频预览：CDN 缓存
       └─ 原图：鉴权后下载或批量导出
```

## 实施顺序

### 1. 统一图片预览规格

- 列表缩略图：宽 320～480 px，WebP，质量 60～70；
- 详情预览图：宽 1280～1600 px，WebP，质量 70～80；
- 原图不得用于列表、卡片或普通详情预览；
- 同一种规格使用固定图片处理样式和稳定 URL，避免重复生成缓存键；
- 原图不支持图片处理时，生成并保存对应的预览文件。

候选 OSS 图片处理参数：

```text
x-oss-process=image/resize,w_480/quality,Q_70/format,webp
x-oss-process=image/resize,w_1600/quality,Q_75/format,webp
```

### 2. 减少前端重复请求

- 图片列表使用分页或虚拟滚动；
- 仅加载当前视口附近的图片；
- 不预加载原图；
- 切换 Node、Tab、地块或时间范围时复用未变化的请求结果；
- 避免组件重新挂载导致相同图片重复请求；
- 对图片列表、预览图和原图下载分别统计请求量与响应字节数。

### 3. 高频预览接入 CDN

- 使用已备案的图片访问域名；
- CDN 源站类型配置为 OSS 域名，而不是普通自定义源站；
- Bucket 保持私有，通过 CDN 鉴权访问；
- 预览图片使用较长缓存时间；
- Object Key 不原地覆盖，新内容使用新 Key；
- 统一签名与缓存键规则，避免每次签名生成不可复用的缓存对象；
- 上线后持续观察 CDN 命中率、OSS CDN 回源流量和 CDN 下行流量。

只有同一图片存在重复访问时，CDN 才能显著降低回源成本。低命中率场景应优先依靠缩小图片体积，而不是盲目增加 CDN 层。

### 4. 分离服务端与用户下载链路

- 华北 2（北京）的服务端 OSS 客户端使用 `oss-cn-beijing-internal.aliyuncs.com`；
- 服务端不代理图片文件字节到用户；
- 服务端完成权限校验后签发短期 OSS 或 CDN 地址；
- 原图单张下载、批量图片导出和 API 原图访问统一进入下载额度统计；
- 导出 ZIP 保持短期有效，过期后删除产物。

### 5. 购买资源包

完成图片压缩和 CDN 验证后，再根据至少一个完整月的稳定用量购买资源包：

- OSS 直接公网流出使用 OSS 下行流量包；
- CDN 用户下行使用对应区域的 CDN 流量包；
- OSS 到 CDN 的回源流量按实际情况购买回源流量包；
- 资源包先覆盖预计用量的 70%～80%，峰值继续按量计费；
- 不在流量链路调整前一次性购买大额资源包。

### 6. 原图生命周期分层

候选策略：

- 预览图保持标准存储；
- 最近 90 天原图保持标准存储；
- 90 天以上且很少下载的原图转为低频访问；
- 一年以上且允许等待恢复的原图才考虑归档；
- 临时导出产物继续按 72 小时生命周期删除。

低频和归档对象存在取回费用与最低存储时长，正式配置前必须根据真实下载频率重新测算。不能只比较每 GB 存储单价。

## 观测与验收

上线前后按相同统计周期比较：

- 单次列表加载的图片响应字节数；
- 单次详情预览的图片响应字节数；
- OSS 公网流出 GB；
- OSS CDN 回源 GB；
- CDN 下行 GB 与缓存命中率；
- 每个工作区的预览流量和原图下载流量；
- 图片处理费用、请求费用、存储费用和取回费用；
- 业务服务器公网流量与图片代理请求数。

第一阶段目标是确保页面不再加载原图，并验证典型图片的预览体积较原图至少降低 80%。CDN 是否保留，以稳定运行后的实际命中率和总成本决定。

## 官方资料

- [OSS 流量费用](https://help.aliyun.com/zh/oss/traffic-fees/)
- [OSS 图片处理](https://help.aliyun.com/zh/oss/user-guide/overview-17/)
- [OSS 图片格式转换](https://help.aliyun.com/zh/oss/user-guide/convert-image-formats-2)
- [OSS 结合 CDN 加速](https://help.aliyun.com/zh/oss/user-guide/cdn-acceleration)
- [CDN 源站配置](https://help.aliyun.com/zh/cdn/user-guide/configure-an-origin-server/)
- [OSS 地域与 Endpoint](https://help.aliyun.com/zh/oss/user-guide/regions-and-endpoints)
- [OSS 存储费用](https://help.aliyun.com/zh/oss/storage-fees)
- [OSS 资源包](https://help.aliyun.com/zh/oss/purchase-resource-plans/)
- [CDN 资源包选购](https://help.aliyun.com/zh/cdn/product-overview/guidelines-for-choosing-resource-plans)
