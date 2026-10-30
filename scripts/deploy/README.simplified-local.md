# 本机精简版与 LoRaWAN V2 联合部署

用户前端使用 `VITE_SIMPLIFIED_ENABLED=true` 构建，后台维持完整运维功能。
本实例使用独立 Compose 项目 `thcpn-simplified`、PostgreSQL、Redis 和文件卷，不覆盖已有 `thcpn-gin` 或 `lorawan-local` 的数据。

## 连接与入口

- 用户前端：`http://127.0.0.1:15173`
- 系统后台：`http://127.0.0.1:15174/admin/`，也可从用户前端的 `/admin/` 访问。
- API：`http://127.0.0.1:18082`
- LoRaWAN V2：复用外部 Docker 网络 `lorawan-local_default` 中的现有服务。
- 数据源类型 `http_api`、来源 `lorawan_v2`、密钥引用 `env:LORAWAN_LOCAL_API`。
- `LORAWAN_LOCAL_API` 是包含 `base_url`、`username`、`password` 的 JSON；本机通过 `http://lorawan-local-openapi-1:8080/api` 访问已有 OpenAPI。
- LoRaWAN 日志和固件存储使用既有 RustFS `http://s3:9000` 及其 `lorawan` bucket；平台导出文件保存在本实例自己的本地对象卷。

本机端口只绑定回环地址。更换部署主机或需要局域网访问时，按实际域名、端口和 Docker 网络调整；设备采集仍由现有 LoRaWAN 服务处理。

## 本地文件

敏感配置与部署产物放在 Git 忽略的 `var/simplified-local/`，配置和账号凭证文件权限为 `0600`。不复制主平台的 `.env`，不将云端数据源接入本实例。

构建上下文需要这些文件：

```text
var/simplified-local/
  .env                    独立配置；含 DEPLOY_VERSION
  credentials.json        本实例初始账号；不要共享或提交
  Dockerfile.prebuilt     来自 Dockerfile.simplified-prebuilt
  bin/                    Linux 对应架构的 api、worker、adminctl
  docs/                   已部署版本的 docs
  migrations/             已部署版本的数据库迁移
  frontend/platform/      精简版用户前端产物
  frontend/admin/         完整运维后台产物
  nginx-platform.conf
  nginx-admin.conf
```

从已确认的提交构建 Go 二进制及前端。用户前端设置 `VITE_SIMPLIFIED_ENABLED=true`，后台设置 `false`，两者的 `VITE_PLATFORM_URL` 均指向本实例用户前端。地图 token 按本机配置传入。处理器镜像默认复用本机 `thcpn-gin-processor:latest`；首次部署前需已有该镜像，或在 `.env` 设置 `PROCESSOR_IMAGE`。

## 启停与验证

在仓库根目录执行：

```sh
docker compose --env-file var/simplified-local/.env -f scripts/deploy/docker-compose.simplified-local.yml config --quiet
docker compose --env-file var/simplified-local/.env -f scripts/deploy/docker-compose.simplified-local.yml build api platform admin
docker compose --env-file var/simplified-local/.env -f scripts/deploy/docker-compose.simplified-local.yml up -d
docker compose --env-file var/simplified-local/.env -f scripts/deploy/docker-compose.simplified-local.yml ps -a
curl -fsS http://127.0.0.1:15173/readyz
```

普通停止使用 `stop`，再次启动使用 `up -d`。不要使用 `down -v`，该选项会删除本实例数据库和文件卷。

通过正式管理员 API 创建本实例账号、数据源，读取并同步已有 LoRaWAN 网关到本平台，再分配给用户工作区。同步只更新平台映射和数据流，不在源端新建网关或下发配置。首次登录的临时密码需要修改。将真实设备加入一张图后验证设备目录、节点、历史查询和导出；原始采样不迁入 PostgreSQL。
