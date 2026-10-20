# 导出执行与故障恢复

大型 ZIP 由 Worker 异步生成到私有临时目录。图片逐个读取并直接写 ZIP；JPEG、PNG、WebP、GIF、MP4 使用 Store，文本仍使用 Deflate。完整 ZIP 不进入内存，CSV/XLSX 查询仍受既有最大行数限制。

上传使用平台导出对象存储（不改变设备原始图片所在数据源的存储）。OSS 使用官方 Uploader，16 MiB 分片、单路上传；S3 使用顺序分片，通常每片 16 MiB，单片最多尝试三次。S3 签名通过流式 SHA256 计算，不再 ReadAll 整个文件；未知大小 Reader 临时落盘。单片大文件不支持跨 Worker 重启续传。

## 配置

- `EXPORT_TEMP_DIR`：默认系统临时目录下 `thcpn-exports`。Compose 挂载专用 `export_tmp` 卷到 `/var/lib/thcpn/export-tmp`，应根据预期最大 ZIP 大小配置磁盘与告警。
- `EXPORT_MIN_FREE_MB`：默认 256；创建前和写入期间检查剩余空间。检查不预留整个 ZIP 所需空间，也不能保证其他进程不占用磁盘；不足时明确失败。
- `EXPORT_MAX_CONCURRENT_JOBS`：每个 Worker 默认仅执行一个导出；其他已领取的队列消息等待容量后才将数据库任务标为 running。多副本总并发为各副本之和。

既有生产服务器不应直接覆盖主 Compose 文件。可将 `scripts/deploy/docker-compose.release.yml` 与 `Dockerfile.frontend-prebuilt` 复制到服务器 `.deploy/`，命令追加 `-f .deploy/docker-compose.release.yml`；该 overlay 添加 Worker 临时卷，并使用本地从提交版本构建、放在 `.deploy/frontend/platform` 和 `.deploy/frontend/admin` 的静态产物构建前端镜像，避免在空间紧张的服务器执行 npm 安装。保留现有 `.env`、主 Compose 与后端 prebuilt override。之后的部署、重建和回滚均应继续带上此 overlay。

## 状态与进度

需先应用 migration `000045_export_progress` 再启动新 API/Worker。任务执行最长六小时；执行期间每 15 秒更新数据库心跳及 `progress`（阶段、已打包图片数、已打包字节数）。上传阶段显示打包完成量，不将其冒充已上传字节数。数据库写心跳失败会取消执行，防止在失去租约后继续工作。

Worker 每分钟、启动时扫描一次超过五分钟无心跳的 running 任务，标记 failed，而不是重新执行。普通错误、取消和 panic 使用独立的短时 context 写入失败状态；进程被强杀或主机掉电则由心跳扫描兜底。页面失败任务可“重新导出”，沿用原条件创建新任务，重新校验当前权限并记录原有创建审计，不覆盖原失败记录或直接重放上游操作。

成功与可捕获失败会关闭并删除本地临时 ZIP。扫描器只清理本目录内、已不再 running 且超过十分钟的合法任务临时文件。上传失败中止未完成分片；强杀进程无法运行清理函数，因此生产 Bucket 仍需设置清理未完成 Multipart Upload 的生命周期规则（例如一天），并监控残留分片和临时卷。

## 验证

- ZIP 64 MiB 图片流式落盘测试检查堆分配不随图片体积增长。
- HTTP 模拟 S3 验证分片创建、上传、完成、单片重试及失败 abort。
- 独立 PostgreSQL 集成测试验证空库迁移、045 down/up、心跳与过期回收、取消后写入失败、真实任务领取到磁盘上传完成、失败及临时文件清理。
- 未连接生产 Bucket 执行大规模导出。发布时先停止旧版大型导出提交，应用迁移、启动新 Worker，再验证真实对象上传和下载；已失联的旧任务会在新 Worker 扫描后标为失败，需要重新导出。
