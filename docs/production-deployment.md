# IES Watch 线上部署与维护

> 实况核对：2026-11-27（直连服务器核验）。后续维护前请以实时查询为准。

## 1. 环境概览

| 项目 | 实况 |
| --- | --- |
| 服务器 | `ssh hotuns@8.131.103.198`（Linux x86_64） |
| 运行目录 | `/home/hotuns/thcpn-gin`（**非 Git 仓库**，禁止 `git pull`） |
| 公网入口 | 用户端 `https://ieswatch.com/`，管理端 `https://ieswatch.com/admin/` |
| 反向代理 | 主机 `caddy`（systemd），配置 `/etc/caddy/Caddyfile` |
| 前端静态根 | `/srv/ieswatch/current`（软链指向 `/srv/ieswatch/releases/<SHA>`） |
| 后端编排 | Docker Compose（无 `platform`/`admin` Nginx 容器，`5173`/`5174` 仅用于本地） |
| 同机其他服务 | `/data/apps/lorawan-v2`（采集端）及多个无关容器/站点，维护时互不干扰 |

### Caddy 路由规则（仅本项目部分）

- `/` → `/srv/ieswatch/current/index.html`（SPA 回退）
- `/admin` → 308 跳转 `/admin/`；`/admin/*` → `/srv/ieswatch/current/admin/index.html`
- `/api`、`/api/*`、`/healthz`、`/readyz` → `127.0.0.1:18081`（body 上限 `10MiB`，超时 `1800s`）
- `ieswatch.com` / `www.ieswatch.com` 关闭 HTTP-01，使用 TLS-ALPN-01（443）；`www` 及旧域名 `insitueco.com` 301 跳转主站

### 运行容器与持久卷

| 服务 | 容器名 | 端口映射 | 挂载卷（容器路径） |
| --- | --- | --- | --- |
| API | `thcpn-gin-api-1` | `127.0.0.1:18081→8080` | `platform_logs` (`/var/log/thcpn`)、`objectstore_data` (`/var/lib/thcpn/objectstore`)、`processor_artifacts` (`/var/lib/thcpn-processor/artifacts`) |
| Worker | `thcpn-gin-worker-1` | — | 同上 + `export_tmp` (`/var/lib/thcpn/export-tmp`) |
| Processor | `thcpn-gin-processor-1` | `127.0.0.1:18090→8090` | `processor_artifacts` |
| PostgreSQL 16 | `thcpn-gin-postgres-1` | `127.0.0.1:15432→5432` | `postgres_data` (`/var/lib/postgresql/data`) |
| Redis 7 | `thcpn-gin-redis-1` | `127.0.0.1:16379→6379` | `redis_data` (`/data`) |

> 卷名均带 `thcpn-gin_` 前缀。Worker 关键运行配置：`EXPORT_MAX_CONCURRENT_JOBS=3`、`EXPORT_TEMP_DIR=/var/lib/thcpn/export-tmp`、`EXPORT_MIN_FREE_MB=256`、`OBJECT_STORE_ENDPOINT=https://oss-cn-beijing-internal.aliyuncs.com`（仅服务端导出走内网，浏览器下载地址仍走公网 OSS）。

---

## 2. 当前线上版本与风险提示

| 组件 | 当前 SHA | 版本标记文件 |
| --- | --- | --- |
| API | `be81bb92300b3cedb253ff347a6eb69368fc21af` | `.deploy/api-deployed-commit` |
| Worker | `d8564e51ce523f52912cc27ae32bb8d87f9f6ff1` | `.deploy/worker-deployed-commit` |
| 用户端 | `d8564e51ce523f52912cc27ae32bb8d87f9f6ff1` | `.deploy/platform-deployed-commit` |
| 管理端 | `d8be0606def97148e7f2b50e9decf9c8b9fa6487` | `.deploy/admin-deployed-commit` |
| Caddy 入口 | `c11774e5bdc0cc6d708619ed049e759e77c160a3` | `.deploy/caddy-deployed-commit` |

- **数据库迁移**：版本 `61`，`dirty=false`。
- **静态软链**：`/srv/ieswatch/current -> releases/d8be0606def97148e7f2b50e9decf9c8b9fa6487`（组合了 `d8564e5` 用户端 + `d8be0606` 管理端）。
- **版本判断**：`.deploy/deployed-commit` 仅记录历史联合发布，已滞后于 API；以各组件独立标记和镜像 `org.opencontainers.image.revision` 标签为准。
- **磁盘与镜像风险**：
  - 系统盘 `/` `99G` 已用 `89G`（**95%**，仅剩 `5.0G`）；数据盘 `/data` `98G` 剩 `46G`。
  - 主要占用：Docker Images `41.7G`（可回收 `23.4G`）、Build Cache `17.7G`（可回收 `9.9G`）、`.deploy` `12G`（历史备份与发布包）。
  - 当前 `thcpn-gin-api:latest` 已膨胀至 `2.93G`（45 层），`thcpn-gin-worker:latest` `2.54G`（35 层），系多次基于运行镜像叠层覆盖导致；清理或重建时需核对回滚镜像与活跃任务。

---

## 3. 快速巡检命令

```bash
cd /home/hotuns/thcpn-gin

# 1. 组件版本与镜像 revision
head -n 1 .deploy/*-deployed-commit
docker inspect --format '{{.Name}} {{index .Config.Labels "org.opencontainers.image.revision"}}' \
  thcpn-gin-api-1 thcpn-gin-worker-1
readlink /srv/ieswatch/current

# 2. 容器状态与最近日志（跨发布日志在 platform_logs 卷内的 jsonl）
docker compose -f docker-compose.yml -f .deploy/docker-compose.prebuilt.yml -f .deploy/docker-compose.release.yml ps
docker logs --since=30m --tail=200 thcpn-gin-api-1
docker logs --since=30m --tail=200 thcpn-gin-worker-1

# 3. 数据库迁移版本
docker exec thcpn-gin-postgres-1 sh -c \
  'psql -U "${POSTGRES_USER:-thcpn}" -d "${POSTGRES_DB:-thcpn_platform}" -c "SELECT version, dirty FROM schema_migrations;"'

# 4. 磁盘与公网健康检查
df -h / /data && docker system df
curl -fsS https://ieswatch.com/healthz && echo ""
curl -fsS https://ieswatch.com/readyz && echo ""
python3 scripts/deploy/check-login-proxy.py --base https://ieswatch.com
```

> `check-login-proxy.py` 应全部 **6 项 PASS**（登录页与公开策略 `200`、匿名 `/api/v1/me` `401`、两端空登录 `400`）。Caddy 日志用 `journalctl -u caddy --since "10 minutes ago"` 查看。

---

## 4. 发布流程

通用前提：从已提交的精确 commit（`git archive`）本地构建并上传，不直接同步脏工作区；保留服务器 `.env`、Compose 覆盖文件、Caddyfile 及生产 `VITE_*`；不执行 `docker compose down`，不启动 `legacy-frontend` profile。

### 4.1 发布前端（用户端 / 管理端）

1. **本地构建**：从目标 commit 导出源码，在 `app/` 下带生产 `VITE_*` 执行 `npm ci && npm run generate:api` 及对应 workspace 构建。
2. **准备暂存目录**：`publish-frontend.sh` 要求同时存在 `platform/` 和 `admin/`。只发单端时，将当前 `/srv/ieswatch/current` 中**未更新的另一端**原样复制过来，禁止用旧暂存目录替代。
3. **原子发布**（无需重启后端或 reload Caddy）：
   ```bash
   bash scripts/deploy/publish-frontend.sh <完整40位SHA> <含platform与admin的暂存目录>
   ```
4. **验证与记录**：核对页面、关键静态资源及 `check-login-proxy.py`，仅更新本次变更端的 `.deploy/platform-deployed-commit` 或 `.deploy/admin-deployed-commit`。

### 4.2 发布后端（API / Worker）

1. **本地交叉编译**（按变更范围构建 `api` / `worker` / `adminctl`）：
   ```bash
   CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
     go build -trimpath -ldflags='-s -w' -o <产物目录>/api ./cmd/api
   ```
2. **备份**：在 `.deploy/backups/<SHA>/` 备份旧二进制与标记，给当前运行镜像打 `rollback-<短SHA>` 标签；有迁移时先用 `pg_dump -Fc` 备份数据库。
3. **数据库迁移（仅在新增迁移时执行）**：确认只放入本次迁移文件后运行：
   ```bash
   cd /home/hotuns/thcpn-gin
   export EXPORT_MAX_CONCURRENT_JOBS=3
   compose=(docker compose -f docker-compose.yml -f .deploy/docker-compose.prebuilt.yml -f .deploy/docker-compose.release.yml)
   "${compose[@]}" run --rm --no-deps -T migrate-init </dev/null
   ```
   确认 `schema_migrations` 版本正确且 `dirty=false` 后再切应用。
4. **切换服务**：更新 Worker 前先确认无活跃导出任务；**必须显式传 `EXPORT_MAX_CONCURRENT_JOBS=3`**（否则 `release.yml` 默认值 `1` 会覆盖 `prebuilt.yml`）：
   ```bash
   "${compose[@]}" up -d --no-deps api   # 按需换为 worker 或 api worker；使用已构建候选镜像时加 --no-build --pull never
   ```
5. **验证与记录**：核对容器健康、日志、镜像 revision 及公网检查，仅更新本次变更的 `.deploy/api-deployed-commit` 或 `.deploy/worker-deployed-commit`。

### 4.3 修改 Caddy（仅入口/域名/TLS 变更时）

备份 `/etc/caddy/Caddyfile` → 仅修改本项目块（保留同机其他站点）→ `caddy validate` → 持久写入后 `caddy reload` → 更新 `.deploy/caddy-deployed-commit`。详见 [deployment-domain.md](deployment-domain.md)。

---

## 5. 回滚

- **前端回滚**（原子切换已有 release）：
  ```bash
  cd /srv/ieswatch
  ln -s releases/<旧SHA> current.rollback && mv -Tf current.rollback current
  ```
  验证后将对应 `platform-deployed-commit` / `admin-deployed-commit` 改回旧 SHA。
- **后端回滚**：将目标服务镜像 retag 回 `rollback-<短SHA>`，用三份 Compose 文件加 `EXPORT_MAX_CONCURRENT_JOBS=3` 执行 `up -d --no-deps --no-build --pull never <service>`，并恢复版本标记。
- **数据库**：迁移后**不自动执行 down 或整库恢复**，避免丢失新写入业务数据。

### 当前最近回滚点（2026-11-27）

- 静态上一版：`/srv/ieswatch/releases/be81bb92300b3cedb253ff347a6eb69368fc21af`
- API 回滚镜像：`thcpn-gin-api:rollback-be81bb9`（数据库备份见 `.deploy/backups/be81bb92300b3cedb253ff347a6eb69368fc21af/postgres.dump`）
- 管理端备份：`.deploy/backups/2bd282c5e60b65e5fa1505023462b4ff7d0cf51b/`

---

## 6. 相关文件

- [README.md](../README.md) · [域名部署与迁移](deployment-domain.md)
- [publish-frontend.sh](../scripts/deploy/publish-frontend.sh) · [check-login-proxy.py](../scripts/deploy/check-login-proxy.py) · [Caddyfile.ieswatch](../scripts/deploy/Caddyfile.ieswatch)
