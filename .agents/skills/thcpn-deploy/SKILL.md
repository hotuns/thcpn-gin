---
name: thcpn-deploy
description: 提交并部署 thcpn-gin 原位生态云项目到既有 Docker Compose 服务器，处理前后台构建、Go 二进制、数据库迁移、备份、验证和回滚。用于该项目的提交、推送、部署请求。
---

# THCPN 提交部署

用于本仓库已有服务器。用户只要求提交时，仅提交；只要求检查时，执行只读检查；要求提交并部署时可继续推送和上线。技能本身不授权部署其他项目、清理用户文件、重置账号或更改生产配置。

## 已验证的环境

- 仓库通常位于 /Users/hotuns/code/thcpn-gin；用 git rev-parse 确认实际路径。
- SSH 目标 hotuns@8.131.103.198，服务目录 /home/hotuns/thcpn-gin。
- 服务器目录不是 Git checkout，不能直接 git pull。
- Compose 文件：docker-compose.yml + .deploy/docker-compose.prebuilt.yml。
- 若存在 .deploy/docker-compose.release.yml，后续 build/run/up/ps/回滚均追加该 overlay；它维护 Worker 导出临时卷和预构建前端，不能在后续发布中意外移除。
- 切换前核对运行中 Worker 的 EXPORT_* 配置和挂载。release overlay 的默认导出并发可能覆盖原 prebuilt overlay 的值；未要求调参时，按运行事实显式传入 EXPORT_MAX_CONCURRENT_JOBS，保留既有并发，不因部署顺便调整。
- 后端使用 .deploy/Dockerfile.prebuilt，COPY .deploy/api、worker、adminctl。
- 服务器 x86_64；本地交叉编译 CGO_ENABLED=0 GOOS=linux GOARCH=amd64。
- 用户端和后台 Docker 镜像由 app/Dockerfile 的 platform/admin target 构建。
- 公网 https://www.insitueco.com；用户端 5173、后台 5174、API 127.0.0.1:18081。
- 数据库和 Redis 容器为 thcpn-gin-postgres-1 / thcpn-gin-redis-1。
- .deploy/deployed-commit 记录后端版本；platform-deployed-commit / admin-deployed-commit 分别记录两套前端版本。纯前端发布不要改后端标记。
- 本地 make run-all 的 API 使用 18080，不能当作服务器端口。
- 执行前只读核对服务、架构、Compose 和版本标记；运行事实优先于此处历史值。

## 提交与验证

1. 阅读仓库 AGENT.md，检查当前分支、git status、diff 和未跟踪文件。只纳入用户本轮授权的已完成改动；不顺手提交手册、临时文件、凭证等无关内容。
2. 按模块提交 Conventional Commits。不自动切换分支、不版本递增、不创建 tag 或 GitHub Release，除非用户要求。
3. 按实际改动验证：
   - Go：go test ./...；共享状态/认证/并发改动遵守仓库 race 检查要求。
   - 前端：在 app 运行 NODE_OPTIONS=--no-experimental-webstorage npm test；构建涉及的 @thcpn/platform / @thcpn/admin。
   - SQL 查询：make sqlc；API：npm run generate:api，核对 OpenAPI。
   - migration：用 internal/testdb 的隔离数据库验证空库 up 与新增 down/up，不能用生产 down 验证。
4. 保留短日志路径，输出摘要；不要打印 .env、完整 DSN 或 token。
5. git diff --check；明确 staged 路径后提交、推送当前分支。用 git rev-parse HEAD 得到精确部署版本。

## 打包、备份、部署

1. 用 mktemp -d 创建临时产物目录。从已提交 HEAD 用 git archive 打包所需源码；禁止将脏工作树或 node_modules 直接同步到服务器。
2. 后端改变时构建 Linux 二进制：
   CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o <artifact-dir>/api ./cmd/api
   同样构建 worker、adminctl。不要把产物提交到 Git。
3. 先在 .deploy/backups/<commit> 备份将覆盖的源文件和二进制、已有版本标记，并给当前镜像加 rollback-<commit> 标签。数据库迁移前使用容器内 pg_dump -Fc 备份，保护备份目录权限。不要回显凭证。
4. 通过 scp 或 git archive | ssh ... tar 传送指定产物。保留服务器 docker-compose.yml、.env、configs、.deploy/Dockerfile.prebuilt 和 Compose override，不能用本地配置覆盖它们。
5. 在服务器构建变更服务：
   docker compose -f docker-compose.yml -f .deploy/docker-compose.prebuilt.yml build <services>
   构建输出写入 .deploy/<commit>-build.log，按需读取尾部。失败时保留现有运行容器。
   服务器磁盘紧张时使用 scripts/deploy/ 中的 docker-compose.release.yml 与 Dockerfile.frontend-prebuilt，复制到 .deploy/ 并追加 overlay。前端在本地 git archive 的已提交源码目录 npm ci/build，产物分别放 .deploy/frontend/platform、admin；构建时保留生产 VITE_TIANDITU_TOKEN 与 VITE_PLATFORM_URL，密钥只传给构建进程，不回显或提交。新 overlay 提供 export_tmp 卷，不覆盖已有生产配置；后续仍需带上它。macOS 传 tar 可使用 --no-xattrs 避免无意义的扩展属性警告。
6. 有迁移时，镜像构建成功后再使用服务器配置执行：
   docker compose -f docker-compose.yml -f .deploy/docker-compose.prebuilt.yml run --rm migrate-init
   核对 schema_migrations 的版本和 dirty 状态。迁移失败不启动新程序，不自行清 dirty。
7. 更新变更服务：
   docker compose -f docker-compose.yml -f .deploy/docker-compose.prebuilt.yml up -d --no-deps <services>
   后端改变更新 api/worker；前端改变更新 platform/admin。不要 docker compose down，不重启无关数据源或数据库。

## 上线验证与版本记录

- API /healthz 与 /readyz，容器运行状态，必要的 processor 依赖。
- 服务器本地 5173/login、5174/admin/login 和公网 HTTPS 返回正常。
- 核对新静态资源或关键响应字段，不能只凭首页 200 认定业务变更生效。
- 检查启动后的 API/Worker 错误日志；针对变更做非破坏性的业务验证。
- 不用真实设备创建、固件发布、用户密码重置来验证部署，除非用户明确要求。
- 只有验证成功后才更新相关 .deploy/*-deployed-commit 标记为完整 SHA，并保留未更新服务原来的 SHA。
- 失败时先诊断。可回滚本次应用镜像；不要自动执行 migration down 或还原生产数据库，新列可能已有用户数据。出现不兼容迁移时报告具体状态和恢复选项。
- 最终回复包含提交 SHA、部署范围、验证结果，以及必要的刷新提示。保留仍未完成的事项，不宣称只测到的 HTTP 响应等于端到端设备验证。

## 本技能的维护

本文件记录实际可复用的流程。遇到新的部署方式或已经证实的遗漏时更新；不要记录凭证、一次性运行日志或任务进度。
