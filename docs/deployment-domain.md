# 平台访问域名

公有云的目标主地址为 `https://ieswatch.com`，后台为 `https://ieswatch.com/admin/`。`www.ieswatch.com` 和旧 `insitueco.com` / `www.insitueco.com` 保留路径及查询参数跳转到主地址。

## 应用中的部署地址

系统管理员可在「系统设置 → 部署地址」保存完整访问地址，并填写修改原因。保存值进入平台数据库，记录修改前后地址、管理员、时间和原因。恢复默认会清除覆盖值，使用启动环境 `PLATFORM_PUBLIC_URL`（或 YAML `deployment.public_base_url`）。

- 后台返回用户端、设备认领二维码、用户端公开设备链接优先使用该地址。
- 预警邮件在发送时读取地址，生成完整预警链接；站内通知仍使用相对路径。未配置时邮件保留正文，不附不可用的相对跳转链接。
- API 请求仍访问同源 `/api/v1` 或既有 API 配置，不因为修改展示地址切换 API 源。
- 仅支持 `http://主机[:端口]` 或 `https://主机[:端口]`，不支持子目录部署、凭证、查询参数和片段。允许局域网 IP 和端口。
- 保存不会自动修改 DNS、证书、代理规则、天地图 Token 白名单或设备固件配置；先使新域名可访问，再切换生成链接的地址。
- 已经发出的邮件和印刷二维码不能重写，因此需要保留旧域名跳转。浏览器登录信息按域名隔离，新域名首次使用需要重新登录。

## 切换前只读核查（2026-11-07）

- `ieswatch.com` 和 `www.ieswatch.com` 在服务器 DNS 查询中均指向现有服务器 `8.131.103.198`。
- 当前入口是主机 Caddy，配置路径 `/etc/caddy/Caddyfile`；仅配置了旧域名。新域名 HTTPS 握手尚未成功。
- 服务器 `.env` 的 `PLATFORM_PUBLIC_URL` 仍指向 `https://www.insitueco.com`。
- Caddyfile 归 root 所有，当时部署账号没有免密 sudo。此节记录切换前状态，不代表当前部署验收结果。

## 切换后状态（2026-11-07）

- `https://ieswatch.com` 已作为主站，后台为 `/admin/`；登录页、健康接口和公开策略均已通过受信 HTTPS 检查。
- `www.ieswatch.com`、`insitueco.com` 和 `www.insitueco.com` 的 HTTPS 入口保留路径及查询参数跳转至主站。
- 生产公开地址、API/Worker 环境及后台前端回退地址已更新为 `https://ieswatch.com`。运行程序版本为 `3ec2f6d5ae2a29a52d697657f11746a3432b7e8e`，数据库版本为 56。
- Caddy 持久配置在 `/etc/caddy/Caddyfile`，相关数据库、配置及镜像备份在服务器项目 `.deploy/backups/3ec2f6d5ae2a29a52d697657f11746a3432b7e8e/`；其他站点保持原配置。

## 新域名证书验证方式

本环境新域名的 HTTP-01 验证请求受到上游 HTTP 403 阻断，因此站点配置仅对 `ieswatch.com` 和 `www.ieswatch.com` 设置 `tls { issuer acme { disable_http_challenge } }`，保留 TLS-ALPN-01。Caddy 通过公网 TCP 443 完成验证，继续自动签发和续期证书；443 的挑战握手必须能够抵达 Caddy，不能被其他 TLS 终结代理截断。参见 [Caddy TLS 配置](https://caddyserver.com/docs/caddyfile/directives/tls#issuers) 和 [自动 HTTPS 挑战说明](https://caddyserver.com/docs/automatic-https#acme-challenges)。

关闭 HTTP-01 不会关闭正常的 HTTP 到 HTTPS 跳转，也不会修复上游对 HTTP 请求的 403；HTTPS 可用时，HTTP 入口仍需单独验证。旧域名和其他业务站点保留原证书配置。

## 切换操作

1. 保留旧域名 DNS，确认新主域名及 `www` 已解析到服务器；公网 TCP 443 直达 Caddy，用于新域名 TLS-ALPN-01 验证和 HTTPS。80 端口用于正常 HTTP 跳转，单独检查是否仍受上游 403 影响。
2. 备份 `/etc/caddy/Caddyfile`。将 [Caddy 站点配置](../scripts/deploy/Caddyfile.ieswatch) 合并到现有文件，替换旧站点块，保留其他业务的代理配置。使用管理员权限运行 `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`，成功后按当前 Caddy 服务方式 reload。
3. 验证 `https://ieswatch.com/login`、`/admin/login`、`/healthz`，以及 `www` 和旧域名的跳转；确认 HTTPS 证书覆盖各入口。
4. 服务器 `.env` 设置 `PLATFORM_PUBLIC_URL=https://ieswatch.com`。部署本次 API、Worker、前后台构建及数据库迁移后，在后台「部署地址」核对有效值；如已有覆盖值，也改成新域名。API/Worker 使用启动配置时需要重建容器加载新环境值。
5. 在天地图控制台更新当前 Token 对应的域名授权（如已启用），验证设备地图和一张图；使用其他按来源域名校验的地图、视频或对象存储服务时，核对对应 Referer/CORS 白名单。
6. 使用新域名重新登录，核对返回用户端、认领二维码、公开设备链接和测试预警邮件地址；验证原二维码经旧域名仍能打开对应页面。

业务平台域名与 MQTT、LoRaWAN 凭证/配置/日志接口、数据源 API、OSS Bucket 域名是独立配置。本次不替换这些服务地址，也不改采集历史中的 URL。若某个外部服务实际使用旧平台域名，需要按该服务的路径和访问方式单独迁移。
