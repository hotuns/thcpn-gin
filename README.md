# In-situ EcoCloud（原位生态云）

In-situ EcoCloud（原位生态云）是基于野外原位站点感知数据的生态监测云平台，提供设备接入、遥测与图片查看、数据处理、数据导出、工作区协作、订阅权益和系统后台管理。THCPN 仅指系统接入的源数据库。

## 项目组成

| 服务 | 说明 | 默认端口 |
| --- | --- | --- |
| `platform` | 用户平台（React + Vite） | `5173` |
| `admin` | 系统后台（React + Ant Design） | `5174` |
| `api` | Go HTTP API | `8080` |
| `worker` | 导出、同步与处理任务 Worker | 无 |
| `processor` | Python 数据处理服务 | `8090` |
| `postgres` | 平台主数据库 | `5432` |
| `redis` | 队列与缓存 | `6379` |

## Docker Compose 部署

部署以 Docker Compose 为主。服务器需要安装 Docker Engine 与 Compose v2。

### 1. 准备配置

```bash
cp .env.example .env
```

至少修改以下生产配置：

```dotenv
POSTGRES_PASSWORD=使用强密码
JWT_SECRET=使用足够长的随机字符串
ADMIN_JWT_SECRET=使用另一个随机字符串
AUTH_DEV_USER_HEADER_ENABLED=false
AUTH_DEV_REGISTER_ENABLED=false
PLATFORM_PUBLIC_URL=https://你的平台域名
```

使用 OSS 时填写 `OBJECT_STORE_*`；需要同步旧系统数据时填写对应数据源连接信息。不要把 `.env` 提交到 Git。

### 2. 构建并启动

```bash
docker compose up -d --build
```

首次部署可通过服务器命令创建系统管理员：

```bash
docker compose exec api adminctl create --name "系统管理员" --email admin@example.com
```

命令会输出一次性生成的初始密码。后续管理员账号可在系统后台的“管理员账号”页面维护。

启动时会先等待 PostgreSQL 就绪并自动执行数据库迁移，随后启动 API、Worker、数据处理服务和两个前端。

访问地址：

- 用户平台：<http://服务器地址:5173>
- 系统后台：<http://服务器地址:5174/admin/>
- API 健康检查：<http://服务器地址:8080/healthz>

用户平台也会把 `/admin/` 转发到后台，因此配置统一域名反向代理时可只暴露用户平台入口。

### 3. 常用运维命令

```bash
# 查看状态
docker compose ps

# 查看日志
docker compose logs -f api worker

# 更新代码后重建
docker compose up -d --build

# 停止服务（保留数据库与文件卷）
docker compose down

# 停止并删除持久化数据，请谨慎使用
docker compose down -v
```

持久化数据存放在 Compose volumes：PostgreSQL、Redis、处理产物、对象文件和平台日志不会因普通 `docker compose down` 删除。

## 本地开发

本地开发需要 Go、Node.js 24、Docker 和 Make。

```bash
cp .env.example .env
make app-install
make run-all
```

`make run-all` 会启动 PostgreSQL、Redis、迁移、处理器、API、Worker、用户前端和后台前端。

也可以分别运行：

```bash
make db-up
make migrate-up
make run-api
make run-worker
make run-platform
make run-admin
```

## 构建检查

```bash
# Go
go build ./cmd/api
go build ./cmd/worker

# 前端
cd app
npm ci
npm run build

# Compose 配置
docker compose config --quiet
docker compose build
```

GitHub Actions 会在推送到 `dev`、`main` 或创建 Pull Request 时执行后端构建、前端构建和 Docker Compose 镜像构建。

## 目录结构

```text
cmd/                 API 与 Worker 入口
internal/            Go 业务模块
migrations/          PostgreSQL 数据库迁移
sql/                 SQL 与 sqlc 查询
app/apps/platform/   用户平台
app/apps/admin/      系统后台
app/packages/        前端共享包
processor/           Python 数据处理服务
docs/                产品、架构与 OpenAPI 文档
```

接口定义位于 [`docs/openapi.yaml`](docs/openapi.yaml)，第三方接入说明位于 [`docs/open-api-guide.md`](docs/open-api-guide.md)，项目业务上下文位于 [`CONTEXT.md`](CONTEXT.md)。
