# 私有空间部署记录

> 本文记录 `sy.ggh.cool` 的实际部署状态、验证结果、运维入口和已知限制。密码、私钥、Cookie、初始化凭证及 `.env` 实际值不得写入本文或提交 Git。

## 1. 当前状态

| 项目 | 当前记录 |
| --- | --- |
| 部署状态 | 2026-10-30 已部署公网预览版；MySQL、后端和 Web 容器健康，公网真实就绪接口返回 `200 {"status":"UP"}` |
| 发布性质 | 公网预览版，只使用当前已实现的普通文档功能 |
| 域名 | `sy.ggh.cool` |
| DNS 检查 | 2026-10-30 查询到 A 记录 `119.91.26.81` |
| 服务器系统 | Ubuntu 26.04 LTS，x86_64，4 vCPU，3.6 GiB 内存，2 GiB Swap |
| 服务器磁盘 | 根分区 ext4 约 59 GiB，清理后可用约 49 GiB |
| 公网端口检查 | 主机只对外监听 `22`、`80`、`443/tcp` 和 `443/udp`；MySQL 3306 与后端 8080 未映射到主机 |
| HTTP/HTTPS 检查 | `http://sy.ggh.cool` 返回 308 到 HTTPS；`https://sy.ggh.cool` 返回 200，证书有效并由 Caddy 自动维护 |
| SSH 入口 | `ubuntu@sy.ggh.cool:22`，临时 ED25519 部署密钥已授权；`ubuntu` 具备非交互 sudo |
| 反向代理 | Workbench 自带固定摘要的 Caddy 2 Alpine 镜像，负责 TLS、前端静态文件、安全响应头和 `/api/*` 反向代理 |
| 旧服务处理 | 用户在部署前自行清理旧 Caddy/Vaultwarden 容器、镜像和数据卷；旧主目录配置文件及孤立网络未由本次部署删除 |
| 容器环境 | Docker 29.1.3，Docker Compose 2.40.3，部署目录 `/opt/workbench`，Docker 根目录 `/var/lib/docker` |
| 主机防火墙 | UFW 当前 inactive；云平台安全组状态尚未核实 |

## 2. 本次发布范围

计划发布当前 M1 已实现并经过真实自动化验证的能力：

- 单用户初始化与用户名/密码登录；
- Markdown 笔记、目录、附件、搜索、收藏、最近访问和大纲；
- 保存、历史分页与对比、回收站删除和恢复；
- 文件重命名、移动、链接影响预览；
- 目录批量导入和选择范围的 ZIP 导出；
- 默认 30 天的历史、回收站及孤儿对象保留清理。

以下内容不属于本次已交付范围：

- TOTP 2FA 与正式账户恢复；
- M2 正式 Windows 同步产品；
- M3 正式加密保险库和真实秘密存储；
- M4 完整生产加固、性能验收、异机备份和灾难恢复验收。

本次只能标记为“公网预览版”，不得描述为已满足 PRD 正式公网发布或完整安全上线门槛。普通笔记与附件当前由服务器明文保存，不应放入密码、API Key、身份证件或其他敏感信息。

## 3. 当前生产实现

- 前端：Vue 3 + TypeScript，经 `npm ci`、类型检查和 Vite 生产构建后写入只读 Caddy 镜像。
- 后端：Java 17 + Spring Boot，以非 root `privatespace` 用户运行；入口仅以 root 读取 Docker 文件型 secret，随后立即降权启动 Java。
- 数据库：固定摘要的 MySQL 8.4，位于 Docker 内部网络，不映射主机端口。
- 数据对象：生产对象使用 `workbench_file_objects` 持久化卷，数据库使用 `workbench_mysql_data` 持久化卷。
- 数据结构：首次启动从空库真实执行 Flyway V1–V5，日志确认 5 项迁移全部成功。
- 健康检查：`/api/system/health/readiness` 检查真实数据库、文件卷和磁盘状态；后端就绪前 Caddy 不启动。
- 秘密：数据库密码、root 密码和一次性初始化凭证保存在 `/opt/workbench/deploy/production/secrets/`，权限为 `600`，不在镜像或 Git 中。
- 镜像版本：`preview-20261030-92a9f52-dirty`。该版本包含当时未提交的工作区快照，不能只靠 Git 提交 `92a9f52` 完整重现，后续应提交并标记正式版本。

## 4. 已部署的公网预览架构

```text
Internet
  -> sy.ggh.cool:443
  -> Workbench Caddy（TLS、静态前端、安全响应头）
  -> Spring Boot API（仅容器内部网络）
  -> MySQL 8.4（仅容器内部网络，不映射公网端口）
  -> 私有文件持久化卷
```

当前已落实：

- HTTP 自动跳转 HTTPS，证书申请及续期状态可检查；
- `PRIVATE_SPACE_SECURE_COOKIE=true`；
- `PRIVATE_SPACE_ALLOWED_ORIGINS` 必须设置为最终确认的 Workbench HTTPS 域名；
- 数据库、初始化凭证和其他秘密从服务器本地受限配置加载，不写入镜像和 Git；
- 后端和数据库不直接暴露公网端口；
- 主机当前只监听 SSH、HTTP 和 HTTPS相关端口；UFW 未启用，云平台安全组仍需用户在云控制台核实；
- 容器使用固定版本或摘要，不使用浮动 `latest`；
- 为导入请求配置明确的反向代理请求体上限和超时；
- 日志不得输出口令、会话令牌、初始化凭证、数据库密码或文档正文。

## 5. 本次上线检查结果

1. 已核实 Ubuntu、资源、时区、Docker、Compose、DNS 和主机监听端口。
2. 用户已清理原有 Vaultwarden/Caddy，并确认由 Workbench 使用根域名。
3. 生产镜像、Compose、Caddy、secret 加载和持久化卷已创建；镜像基础版本均固定摘要。
4. 前后端生产构建通过；MySQL 从空库真实迁移到 V5；三个容器健康。
5. 服务器本机及开发电脑公网链路均验证 HTTPS 首页 200、就绪接口 `UP`；HTTP 会跳转 HTTPS；匿名访问笔记接口返回 401，CSRF Cookie 带 `Secure`、`HttpOnly`、`SameSite=Strict`。
6. 当前生产账户状态为 `initialized:false`，尚未创建管理员；开发口令 `admin123` 未迁移到生产库。
7. 已完成一次全栈停止/启动，数据库仍为 Flyway v5 且三个容器恢复健康；Java 进程在容器内 UID 100（`privatespace`）运行。仍未完成：首次一致性备份、异机恢复演练、云安全组核验、生产登录后的 CSRF/Origin/限速及业务数据重启持久化验收、真实浏览器人工验收。
8. npm 构建报告 5 个依赖安全告警（1 moderate、2 high、2 critical）；在线 `npm audit --omit=dev` 未获执行权限，尚不能判断是否仅为开发依赖。

## 6. 备份边界

- 数据库、文件对象卷和必要配置必须作为同一恢复单元。
- 不能直接复制正在写入的 MySQL 数据目录并声称备份一致。
- 首次公网预览至少应保留上线前备份和最近一次成功部署备份。
- PRD 要求的每日自动备份、7 份日备份、4 份周备份及异机/离线副本尚未实施；完成前不得宣称具备整机故障保护。
- 缩短历史、回收站或孤儿对象保留周期前必须先备份。

## 7. 运维与首次初始化

生产配置目录：

```bash
cd /opt/workbench/deploy/production
sudo docker compose ps
sudo docker compose logs --tail=200 backend web mysql
sudo docker compose up -d --wait --wait-timeout 240
```

首次访问 `https://sy.ggh.cool` 时创建全新的生产管理员账户，不要沿用开发口令。初始化凭证只应由用户在自己的 PowerShell 终端读取并直接填入页面，不要发到聊天或写进文档：

```powershell
& "$env:WINDIR\System32\OpenSSH\ssh.exe" -i "$env:USERPROFILE\.ssh\workbench_deploy" -p 22 ubuntu@sy.ggh.cool "sudo cat /opt/workbench/deploy/production/secrets/setup_token"
```

初始化完成后应再次验证登录、创建/保存/重命名/移动/删除恢复、导入导出、附件、退出登录和容器重启后的持久化。一次性凭证是否作废以真实接口结果为准，不手工猜测或删除。

## 8. 待用户或服务器确认

- 备份保存位置、容量及是否有异机或离线目标；
- 云平台安全组是否仅开放 22、80、443；SSH 是否需要进一步限制来源地址；
- 公网预览允许的维护窗口和可接受停机时间。

## 9. 部署变更记录

| 日期 | 状态 | 记录 |
| --- | --- | --- |
| 2026-10-30 | 信息收集 | 用户确认公网预览域名为 `sy.ggh.cool`、服务器系统为 Ubuntu，现阶段只记录普通文档。DNS 查询到 `119.91.26.81`；22/80/443 可建立连接，但 HTTP/HTTPS 未在 10 秒内返回响应。尚未登录服务器、修改 DNS、申请证书或部署应用。 |
| 2026-10-30 | 服务器盘点 | 使用临时 ED25519 公钥以 `ubuntu` 登录并完成只读检查。确认 Ubuntu 26.04 LTS、4 vCPU、3.6 GiB 内存、约 48 GiB 可用磁盘、Docker/Compose 已安装、非交互 sudo 可用。现有 Caddy 与 Vaultwarden 容器占用 80/443，`sy.ggh.cool` 根域名全部代理到 Vaultwarden且证书有效；UFW 未启用。未安装软件、停止容器、修改代理或写入业务数据。 |
| 2026-10-30 | 用户清理 | 用户自行清理旧 Caddy/Vaultwarden；复核确认无运行容器、80/443 空闲、Vaultwarden 数据卷不存在。旧主目录配置文件和孤立 Docker 网络保留，未擅自删除。 |
| 2026-10-30 | 公网预览部署 | 将当前工作区快照部署到 `/opt/workbench`，创建随机生产 secret 和持久化卷，构建固定摘要基础镜像的前后端，真实执行 Flyway V1–V5。修复非 root 后端读取 Compose secret 的权限问题及 Caddy API/SPA 路由顺序后，MySQL、后端、Web 均健康。HTTPS 首页、公网就绪接口、认证状态、HTTP 跳转、安全头和端口暴露检查通过。生产管理员尚未初始化，备份恢复及登录后人工验收尚待完成。 |
