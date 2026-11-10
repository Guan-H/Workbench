# Agent 部署执行指南

本文供执行 Workbench 部署的 Agent 使用，依据仓库现有 Dockerfile、Compose、入口脚本与迁移编写。适用于 Ubuntu 上的首次部署和既有实例升级，不是本次已执行部署的证明。

## 1. 任务入口与权限

1. 先读根目录 `AGENTS.md`、`docs/rule/CODING.md`、`README.md`、`docs/prd/PRD.md`、`docs/architecture/architecture.md` 和本文。
2. 读取 [部署记录](DEPLOYMENT.md)，区分历史记录与服务器实时状态。旧记录中的版本、账户初始化状态、端口和容器 ID 不能直接当作当前事实。
3. 用户仅要求编写文档、评估或提交代码时，不执行生产部署。已明确授权本次部署时，继续完成授权范围，不为相同操作反复要求确认。
4. 遇到目标服务器不明、版本不明、备份不可用、额外服务冲突、数据库恢复或其他不可逆操作时，先说明具体影响并补齐必要确认。
5. 不把文档中的命令块作为无需检查的一键脚本。以下路径变量均为绝对路径，须在目标机器核对后设置。

本文不包含生产 IP、SSH 用户、私钥路径、真实密码或初始化凭证。连接信息通过用户指定的 SSH 别名或私有配置取得；保持主机密钥校验，不自动接受变化的主机密钥。

## 2. 发布前必须明确的输入

- 本次是首次部署还是升级，以及用户授权的功能范围和维护窗口。
- Git 仓库、分支与完整提交 SHA。默认分支不一定包含本次功能；发布已提交的确定版本，不直接打包工作区。
- SSH 连接入口、HTTPS 域名，以及当前和新发布的源码根目录。
- 实际 Compose project 名、当前镜像标签/ID、数据库迁移版本、持久化卷名称与容器挂载。
- 服务器可用内存/磁盘、HTTP/HTTPS 端口归属、备份目录和回滚依据。
- 是否包含 ONLYOFFICE，以及该服务是否已有经过确认的生产接入方案。

未取得的输入明确标为待确认，不从历史聊天、示例域名、开发口令或旧部署日志推测。

## 3. 仓库中的部署事实

- `deploy/production/compose.yml`：默认 project 为 `workbench`，服务名为 `mysql`、`backend`、`web`。生产环境不要使用 `deploy/compose.dev.yml` 或集成测试 Compose。
- `backend/Dockerfile`：构建 Java 17 应用；`backend/docker-entrypoint.sh` 读取文件型 secret 后降权运行。镜像构建跳过后端测试，构建成功不能代替业务验证。
- `frontend/Dockerfile`：Node 构建 Vue 静态文件，最终由 Caddy 镜像提供页面和反向代理。数据库运行在独立 MySQL 容器，不在前后端镜像内。
- 生产端口只由 `web` 映射 80、443/TCP 和 443/UDP。`backend` 与 `mysql` 不映射宿主机端口，内部 API 使用 8080。
- Compose 的逻辑卷为 `mysql_data`、`file_objects`、`caddy_data`、`caddy_config`。实际名称取决于既有 project，升级时必须复用，不能凭新目录名另建一套空卷。
- `.env` 至少包含 `WORKBENCH_DOMAIN` 和 `WORKBENCH_VERSION`。域名不带协议或路径；生产 Origin 由 Compose 设置为对应 HTTPS 来源。
- 文件型 secret 为 `secrets/db_password`、`secrets/db_root_password`、`secrets/setup_token`。它们只保存在目标机器受限目录，不能提交、回传到聊天或打入镜像。
- 当前源码迁移最高为 V20；执行时重新核对 `database/migrations/`。已记录的生产实例上次为 V14，必须在服务器实际查询，不能假定已升级。

### 功能与部署边界

- V15：保险库恢复密钥包装；V16：Office 会话与回调收据；V17：阅读进度；V18：独立书籍目录与引用；V19：每日文章 Webhook；V20：配对/拼写练习快照。
- V18 会收录此前实际阅读过的有效 TXT/EPUB，属于预期数据初始化，不是复制整个笔记库。
- TXT、PDF、书籍阅读、每日文章与单词挑战不需要 ONLYOFFICE；原生朗读依赖客户端英文语音，不需要服务器语音容器。
- **当前生产 Compose 未接通 ONLYOFFICE。** `deploy/compose.office.yml` 与 `scripts/start-office.ps1` 是本地联调配置。不能直接用于公网，也不能把主站发布成功描述为 Word/Excel 在线编辑已上线。
- Office 生产接入仍需确认资源、HTTPS、浏览器可达地址、服务端地址、JWT、回调网络、适配页及 CSP；现有后端 private 网络为 `internal: true`，不能假定可访问外部文档服务。沿用“先本地验证、生产另定”的已确认方案。
- 2FA 继续暂缓，保险库仍只使用测试秘密；本指南不改变这些需求或验收状态。

## 4. 本地准备与源码交付

先检查 `git status --short`、目标提交及相关验证记录。根据本次变更选择必要检查，已有有效结果可复用，不为纯文档改动重复全量业务回归；如有未验证项，随发布说明如实保留。

构建入口为 `frontend/` 的 `npm ci`、`npm run build`，后端为 `backend/` 的 Maven 工程。单词挑战专项为 `scripts/test-word-game.ps1`；其他人工/专项入口见 `docs/acceptance/`。这些专项使用独立测试环境，不能向生产导入测试夹具。

在开发电脑生成已提交源码归档，例如：

```bash
COMMIT='<经核对的完整提交 SHA>'
git rev-parse --verify "$COMMIT^{commit}"
git archive --format=tar.gz --output=workbench-release.tar.gz "$COMMIT"
sha256sum workbench-release.tar.gz
```

上传前检查归档清单，不应含 `.git`、`.env`、`secrets/`、`data/`、数据库导出或私钥。使用已确认的 SSH 入口传输，目标机器重新校验 SHA-256。不要传输开发目录整体或依赖包目录。

源码解压到新的独立发布根目录，确认归档无绝对路径或 `..` 越界条目；目录非空时先核对其已有发布身份，不能直接覆盖。保留旧源码和镜像，后续构建使用新发布目录。服务器不必有 Git，也不要在其中保存 GitHub 写入凭证。

## 5. 服务器只读预检

检查 Docker/Compose 可用性、资源、DNS/TLS、端口和已有容器。缺少依赖时说明所需环境，在已有授权范围内处理；不要停止其他项目来释放端口。

以下命令在 Bash 中执行，需具备本项目所需 Docker 和配置目录权限。已有实例先设置已确认的 `PROD_DIR` 和 `COMPOSE_PROJECT`；首次部署仅做宿主环境预检，待第 6 节创建配置和容器后再执行实例查询：

```bash
set -euo pipefail
umask 077
PROD_DIR='<当前源码根目录>/deploy/production'
COMPOSE_PROJECT='<从现有实例核实的 project 名>'
dc() {
  docker compose -p "$COMPOSE_PROJECT" --project-directory "$PROD_DIR" \
    --env-file "$PROD_DIR/.env" -f "$PROD_DIR/compose.yml" "$@"
}
dc config --quiet
dc ps
```

不要将 `docker compose config` 的完整输出贴到聊天，使用 `--quiet` 校验。检查现有容器的 Compose 标签、镜像 ID 和挂载，确认 `COMPOSE_PROJECT` 对应用户要更新的实例。无需修改容器时不要重建 MySQL。

查询当前迁移版本，秘密只在容器进程内读取：

```bash
MYSQL_ID="$(dc ps -q mysql)"
test -n "$MYSQL_ID"
docker exec "$MYSQL_ID" sh -c '
  export MYSQL_PWD="$(cat /run/secrets/db_password)"
  exec mysql -u private_space private_space -N -B -e \
    "SELECT version,success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1;"
'
```

核对版本、迁移成功状态、预期新增表、既有对象完整性和保留清理策略。未发现预期实例或存在失败迁移时先排查，不自动执行 Flyway repair、删表或重新初始化。

## 6. 首次部署

首次部署才创建新的配置和 secret。已初始化实例升级时不得重新生成数据库口令、setup token 或覆盖配置。

1. 在新源码根目录下准备 `deploy/production/.env`，填入已确认域名和唯一发布版本。版本使用可追溯标签，例如提交短 SHA；不要用浮动 `latest`。
2. `secrets/` 权限设为 700，文件权限设为 600。可以在目标机器以 `umask 077` 和 `openssl rand -hex 32` 生成三个独立 secret，直接重定向到对应文件；不要输出真实值。存在同名文件时停止核对，不覆盖。
3. `COMPOSE_PROJECT` 首次可使用仓库默认 `workbench`，但先确认没有同名实例或待恢复的旧卷。
4. 验证 Compose 后按顺序构建 `backend`、`web`，执行 `dc up -d --no-build --wait --wait-timeout 300`。
5. 通过第 9 节检查后，由用户在自己的受信终端读取一次性初始化凭证并填入 HTTPS 页面；不要求用户发送凭证到聊天。初始化后验证真实登录和持久化，后续部署不得再次初始化。

不要把开发口令或示例密码用到公网。账户登录口令、保险库主密码和恢复密钥分别管理。

## 7. 既有实例升级

### 7.1 准备新版本，先不切换服务

将旧 `PROD_DIR` 记录为 `OLD_PROD_DIR`。确定新的源码根目录 `NEW_SOURCE_ROOT`、唯一 `VERSION` 和独立备份目录 `BACKUP_DIR`。备份目录必须位于发布目录之外，受限存储，不能被 Web 服务访问。

将旧 `.env` 与 `secrets/` 以原权限复制到新源码的 `deploy/production/`，仅更新副本中的 `WORKBENCH_VERSION`。保留域名及用户已设置的其他选项。核对 `.env` 实际存在且版本不是占位符，不能用 `.env.example` 覆盖生产配置。

设置 `PROD_DIR="$NEW_SOURCE_ROOT/deploy/production"`，继续使用原 `COMPOSE_PROJECT`。执行：

```bash
dc config --quiet
dc build backend
dc build web
docker run --rm --network none --env WORKBENCH_DOMAIN="$DOMAIN" \
  "workbench-web:$VERSION" caddy validate --config /etc/caddy/Caddyfile
```

`DOMAIN` 必须与新 `.env` 的域名一致，`VERSION` 必须与新 `.env` 的版本一致。在资源有限的服务器顺序构建，不默认并行；构建失败则保持旧实例运行，不进入切换阶段。

### 7.2 停止写入并取得一致性备份

将 `PROD_DIR` 切回 `OLD_PROD_DIR`。记录旧镜像标签/ID、旧源码身份、现有容器 ID、挂载、迁移版本和业务表计数，并保存旧 `.env`、Compose、Caddyfile、secret 与可还原的旧源码；这些备份不得提交 Git。

暂停本项目 `web`、`backend`，MySQL 保持运行。确认没有独立 Office 回调或其他写入方继续访问；本项目的同步客户端通过后端写入，后端停止期间应保留队列等待重试。随后在同一停止写入窗口备份数据库和文件对象：

```bash
dc stop web backend
MYSQL_ID="$(dc ps -q mysql)"
test -n "$MYSQL_ID"
test -d "$BACKUP_DIR"
test ! -e "$BACKUP_DIR/database.sql.gz"
test ! -e "$BACKUP_DIR/file-objects.tar.gz"
docker exec "$MYSQL_ID" sh -c '
  export MYSQL_PWD="$(cat /run/secrets/db_password)"
  exec mysqldump --single-transaction --no-tablespaces --hex-blob \
    --set-gtid-purged=OFF -u private_space private_space
' | gzip > "$BACKUP_DIR/database.sql.gz"

BACKEND_ID="$(dc ps -a -q backend)"
test -n "$BACKEND_ID"
OBJECT_VOLUME="$(docker inspect "$BACKEND_ID" --format \
  '{{range .Mounts}}{{if eq .Destination "/data/objects"}}{{.Name}}{{end}}{{end}}')"
test -n "$OBJECT_VOLUME"
MYSQL_IMAGE="$(docker inspect "$MYSQL_ID" --format '{{.Image}}')"
docker run --rm --network none --entrypoint /bin/sh \
  --mount "type=volume,source=$OBJECT_VOLUME,target=/source,readonly" \
  --mount "type=bind,source=$BACKUP_DIR,target=/backup" "$MYSQL_IMAGE" \
  -c 'tar -C /source -czf /backup/file-objects.tar.gz .'
gzip -t "$BACKUP_DIR/database.sql.gz"
tar -tzf "$BACKUP_DIR/file-objects.tar.gz" > /dev/null
(cd "$BACKUP_DIR" && sha256sum database.sql.gz file-objects.tar.gz > SHA256SUMS)
(cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS)
```

该片段适用于仓库当前 secret 路径和命名卷挂载；若现场使用绑定目录或其他数据库配置，先按真实挂载调整，不猜测卷名。备份压缩与摘要校验只证明文件可读取及传输一致，不代表已经完成数据库恢复演练。核对旧配置/源码备份也可用后才能继续。同机备份不代替异机副本。

任一步骤失败时保持备份，判断旧数据是否尚未变化；在安全的情况下恢复旧实例访问，报告实际停机与未完成步骤，不能跳过备份发布。

### 7.3 启动新版后端，再开放网页

设置 `PROD_DIR="$NEW_SOURCE_ROOT/deploy/production"`，保留原 project 名和原卷，不重建 MySQL：

```bash
dc up -d --no-build --no-deps --wait --wait-timeout 300 backend
```

后端启动会执行 Flyway。使用第 5 节查询核对预期版本和全部成功状态，再检查既有业务数据、附件摘要和新增表。升级前后迁移表、V18 书籍初始化或已配置的保留清理可能造成预期差异，不能要求跨版本全库 SQL 字节完全相同；每个差异需有明确依据。异常数据变化必须先排查。

后端就绪、数据核对完成后：

```bash
dc up -d --no-build --no-deps --wait --wait-timeout 300 web
dc ps
```

不要先部署前端再让用户调用旧后端。新拼写页面需要带 mode 的新版练习接口；旧响应兼容不能代替后端发布。

## 8. 回滚分支

- **尚未迁移且没有不兼容的新数据：** 确认旧程序仍兼容后，将 `PROD_DIR` 指回旧发布目录，用原配置及镜像 `--no-build` 启动本项目服务，复用原卷并检查健康。
- **已执行新迁移或写入不兼容数据：** 不能只换回旧镜像，更不能手动删除 Flyway 行或新表。停止写入，先保存失败后的数据副本，在隔离实例恢复升级前的数据库、对象、配置与旧镜像并验证，再按已确认的恢复方案切换。
- 恢复升级前备份会放弃备份后的新写入，执行覆盖/切换前必须说明范围并获得必要授权。没有可验证恢复副本时报告阻塞，不以删除卷或空库初始化掩盖失败。
- 不执行 `docker compose down -v`、删除业务卷或全局 prune 来修复部署；不回滚其他项目。

## 9. 部署后的真实检查

使用已确认的 `DOMAIN`，保留 TLS 校验：

```bash
curl --fail --silent --show-error --max-time 20 "https://$DOMAIN/" > /dev/null
curl --fail --silent --show-error --max-time 20 \
  "https://$DOMAIN/api/system/health/readiness"
curl --silent --output /dev/null --write-out '%{http_code}\n' --max-time 20 \
  "https://$DOMAIN/api/v1/notes"
```

首页应为 200，就绪响应应为 `{"status":"UP"}`，匿名笔记接口应为 401；检查 HTTP 跳转 HTTPS、Secure Cookie、Origin/CSRF、主机只开放已确认端口，以及本项目 Java 进程非 root。

按本次发布范围执行真实浏览器检查，使用专用测试内容，不写入用户真实秘密：

- 笔记保存并回读、附件读取、已有账户与同步设备继续有效。
- 恢复密钥、保险库备份/历史相关变更使用虚构秘密检查，不读取用户秘密作为测试资料。
- 阅读页面的独立目录、书籍打开和进度；TXT/PDF 与 Office 按实际服务配置分别核对。
- 每日文章真实接收/展示；单词配对和拼写能打开题目、提交并读取后端成绩。需要新增测试推送或调整凭证时说明其对现有批次/推送方的影响，不能无声重置用户入口。
- 原生发音在有英文语音的实际设备试听；服务缺失或无法试听如实记录，不能模拟事件宣称发声通过。

仅首页、健康检查或构建通过不能称为业务验收。缺少生产账户授权时先完成匿名与基础设施检查，再请用户按清单验证账户内操作，不索取真实密码或验证码。

## 10. 发布记录与交付

成功或失败都要更新 `docs/DEPLOYMENT.md` 的实际状态；运行方式或能力变化时同步 README 和相关验收说明。记录：

- 时间及所在时区、实际提交 SHA/源码归档摘要、发布版本、镜像 ID。
- 旧/新数据库版本、已执行迁移与数据核对结论。
- 备份是否完整、恢复演练范围、实际回滚或停机情况。
- 实际验证过的基础设施、接口、持久化和浏览器流程，以及未验证部分。
- Windows 助手是否单独更新；网站发布不会自动更新已安装助手。

公开文档只保留可公开的发布信息。真实连接信息、备份私有位置、secret、账户数据和完整敏感日志保存在受限运维记录中；涉及既有部署记录的脱敏或 Git 历史清理时另行确认范围，不擅自改写历史。

完成后按用户要求提交/推送文档。不要在只有“提交代码”的授权时顺便发布生产，也不要把尚未执行的本文步骤写成已完成。
