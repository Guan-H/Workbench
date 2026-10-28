# 私有空间

部署在个人服务器上的单用户私人工作台。首版目标包含 Markdown 笔记与附件、Windows 本地双向同步，以及浏览器端加密的密码保险库。

M0 已完成并由用户确认验收关闭（2026-10-28）：加密候选、文件兼容与 Windows 同步原型均完成限定范围验证；Obsidian 由用户实际编辑确认，修改文件已通过真实接口回传并核对字节。M1 笔记工作台已实现主要功能，批量导入、ZIP 导出与历史保留等仍待完成；正式 M2 同步产品和 M3 保险库尚未交付。权威需求见 `docs/prd/PRD.md`，已确认技术方案、验证结果与限制见 `docs/architecture/architecture.md`。

## 目录

```text
frontend/                 Vue 3 + TypeScript Web 工程
backend/                  Java + Spring Boot 模块化单体
sync-client/              Windows 同步助手工程
database/migrations/      Flyway 数据库迁移
deploy/                   本地开发与后续部署配置
docs/                     PRD、开发规范和架构文档
```

## 环境要求

- JDK 17
- Maven 3.9+
- Node.js 22 LTS 与 npm 10+
- Python 3.13+
- Docker Desktop（用于本地 MySQL）
- Google Chrome（仅真实浏览器验证脚本使用；也可设置 `BROWSER_CHANNEL=msedge` 使用本机 Edge）

本机若 `java -version` 命中了异常启动器，可直接使用 `JAVA_HOME` 指向的 JDK，或调整 `PATH` 使 `%JAVA_HOME%\bin` 优先。

## 本地启动

### 1. MySQL（项目根目录执行，PowerShell 7）

```powershell
./scripts/start-local.ps1
```

先启动 Docker Desktop。脚本在 `deploy/.env` 不存在时生成随机密码，随后等待 MySQL 健康；重复运行不会改已有密码。已有 `.env` 时沿用其配置。默认仅绑定本机 `3306`，端口被占用时先调整 `.env` 的 `MYSQL_PORT`。源码中的 `.env.example` 仅是配置格式示例。不要提交 `.env`，也不要删除数据卷来解决密码不匹配。

### 2. 后端

```powershell
./scripts/start-backend.ps1
```

脚本读取 `deploy/.env` 并将私有文件卷指向根目录 `data/objects`；默认仅监听 `127.0.0.1:8080`。Maven 缓存位于被忽略的 `.m2-cache/repository`。首次运行需要联网下载依赖。IntelliJ IDEA 可导入 `backend/pom.xml` 并运行 `com.privatespace.PrivateSpaceApplication`；配置相同的 `DB_URL`、`DB_USERNAME`、`DB_PASSWORD` 和绝对路径 `PRIVATE_SPACE_STORAGE_PATH`。

真实就绪检查：`GET http://127.0.0.1:8080/api/system/health/readiness`。返回 `200 {"status":"UP"}` 表示本次数据库查询、文件卷读写和磁盘检查通过；失败返回 `503`。活性检查为 `/api/system/health/liveness`，只证明进程存活。公开响应不包含路径、异常、数据库地址或凭据。旧 `/actuator/health` 路径不再使用。

### 3. 前端

```powershell
cd frontend
npm ci
npm run dev
```

访问 `http://127.0.0.1:5173`。首次启动会显示账户初始化页：自行设置用户名与登录口令，并从本机 `deploy/setup-token.local` 文件读取一次性初始化凭证。不要把凭证发到聊天或提交仓库。账户建立后入口关闭；以后用自己的口令登录。Vite 将 `/api` 代理到 `127.0.0.1:8080`；端口被占用时启动失败，不会悄悄换端口。

登录后可以验证创建目录与笔记、Markdown 编辑/预览、保存、搜索、收藏、历史恢复、回收站及附件。点击保存或按 Ctrl+S 时，编辑区上方显示正在保存、服务器确认成功、无未保存修改或保存失败；自动保存继续通过底部状态栏反馈。普通笔记及本机草稿为明文。当前不含目录批量导入、完整 ZIP 导出和 30 天清理任务；这些仍属于 M1 待开发范围。真实联调结果以架构文档的验收记录为准。

工作台操作：分栏模式下拖动编辑区与预览区之间的竖向分隔线调整宽度；双击恢复各半，也可聚焦分隔线后用左右方向键微调，或点击工具栏“宽度”滑轨。窄屏仍为单栏。图标操作按钮悬停后使用浏览器原生提示显示操作名称。

文件操作：在文件树或普通搜索/收藏/最近列表中右键打开“重命名 / 移动到…”；键盘可聚焦文件后按 Shift+F10。也可将文件或文件夹拖到目标文件夹，或拖到“根目录 /”。两种入口均先展示路径和标准相对链接的变更预览，确认后才提交；遇到重名、版本变化或自身子目录会拒绝执行。有受影响的本机草稿时，先打开并保存草稿。双链、多行或含转义等无法可靠定位的链接会列出提示并保留原文。历史内容不被改写，恢复到当前路径后仍需检查当时使用的相对链接。

### 4. M0 Windows 同步原型（仅独立验收目录）

```powershell
cd sync-client
python -m privatespace_sync --version
python -m unittest discover -s tests -v
```

原型使用 Windows ReadDirectoryChangesW、SQLite 持久化队列和用户范围 DPAPI；支持真实普通文件往返、版本条件写入、冲突副本、批量删除预览和本地回收副本。它是 M0 风险验证工具，不是 M2 正式助手：目前使用有 5000 对象上限的全量快照，配对只接受新空目录；远端重命名要求重新对账，冲突仅保留并报告，尚无正式处理界面、托盘、自动启动和升级机制。不要用它接管自己的既有笔记库。

需要手动实验时，在已登录的 Web 会话通过 `POST /api/v1/sync-devices/pairing-code` 创建五分钟一次性配对码（请求 `{ "name": "M0测试电脑" }`，仍需 CSRF 和 Origin 校验）；原型只接受独立的新空目录，状态目录必须在同步目录之外。命令会隐藏输入配对码，不要把码或设备令牌放进命令参数、Markdown、配置明文或日志。

```powershell
cd sync-client
python -m privatespace_sync pair --url http://127.0.0.1:8080 --root D:/ai_project/Workbench/data/m0-manual-vault --state D:/ai_project/Workbench/data/m0-manual-state
python -m privatespace_sync once --state D:/ai_project/Workbench/data/m0-manual-state
python -m privatespace_sync watch --state D:/ai_project/Workbench/data/m0-manual-state
```

`once` 打印真实队列、冲突和错误状态；返回的 `OK` 只表示本轮对账执行完成，应同时查看 issues/conflicts，不表示所有问题已解决。`watch` 监听变化并重扫，网络失败按间隔重试；授权、路径、空间或删除确认问题会暂停。批量删除须核对 `deletionPreview.changes`，再用 `once --confirm-deletions <本次预览的fingerprint>` 确认，不能用旧预览代替当前影响确认。令牌撤销接口为 `DELETE /api/v1/sync-devices/{id}`，仍须 Web 登录与 CSRF。

Windows 打包验证（根目录）：

```powershell
./scripts/build-sync-prototype.ps1
./sync-client/dist/privatespace-sync-m0/privatespace-sync-m0.exe --version
```

构建依赖固定在 `sync-client/requirements-build.txt`，安装到独立 `.venv`；产物目录约 21.7 MB，为本机单次构建结果，不是跨平台、签名或性能验收结论。

## 检查命令

```powershell
cd frontend
npm run type-check
npm run test
npm run build

cd ../backend
mvn "-Dmaven.repo.local=../.m2-cache/repository" test
```

根目录执行真实集成验证：

```powershell
./scripts/test-integration.ps1
```

脚本创建独立 MySQL 8.4 容器、随机密码、随机本机端口和内存文件系统上的测试数据库；启动真实 Spring HTTP 服务，执行 RuntimeIT 与 NotesIT，覆盖运行基础链路及笔记浏览器流程。结束后移除本次测试容器和网络，不接触开发数据库卷。测试报告在 `backend/target/failsafe-reports`，失败不能当作验收通过；测试数据库和私有文件目录均为独立临时资源。

加入 M0 同步验收：`./scripts/test-integration.ps1 -IncludeSync`。先完成打包后，可使用 `-UsePackagedSync` 验证 EXE 的断网与进程终止恢复。完整的已验证命令如下（需要本机 Windows/Python/Chrome/Docker 及指定镜像）：

```powershell
./scripts/build-sync-prototype.ps1
docker pull eclipse-temurin@sha256:4faa9eaf440514dd4f7ef71fecb92526e13679aea039bed5d2fc98e885c60dee
./scripts/test-integration.ps1 -IncludeCrypto -IncludeSync -UsePackagedSync -FullDiskImage 'eclipse-temurin@sha256:4faa9eaf440514dd4f7ef71fecb92526e13679aea039bed5d2fc98e885c60dee'
```

磁盘满测试只填充本次创建的 Docker tmpfs，不填充 Windows 或开发卷。报告位于 `frontend/test-results/sync-<随机ID>/`，包含真实内核 ENOSPC、HTTP 507、旧版本可读、并发、断网、进程终止及设备撤销记录；不输出原始令牌。用户已在 Obsidian 中实际编辑 `data/m0-obsidian-vault` 并确认显示正常；修改文件经真实同步接口回传后，与 Web 私有下载及第二份 Windows 文件字节一致。复核该人工编辑结果时，在上述命令追加 `-ObsidianVault 'D:\ai_project\Workbench\data\m0-obsidian-vault'`，检查记录为 `obsidian-manual.json`。本地语料、Obsidian 配置和报告均不提交 Git。

前后端和开发数据库启动后，可执行真实浏览器检查：

```powershell
cd frontend
npm run test:runtime -- ready
```

`test:runtime` 是早期健康启动页的历史验证脚本，当前工作台入口已替换，该脚本正在调整，暂不作为当前界面的验收命令。笔记浏览器验收使用根目录集成验证命令；截图写入被忽略的 `frontend/test-results/`。不应对含有未保存工作内容的开发数据库执行故障测试。

### M0 加密候选验证（仅虚构秘密）

```powershell
cd frontend
npm ci
npm run type-check:verification
cd ..
./scripts/test-integration.ps1 -IncludeCrypto
```

验证使用真实 Chrome Web Worker、随机令牌保护的测试 HTTP 入口和 MySQL，覆盖 500 条虚构条目、篡改拒绝、并发 CAS、改主密码、加密草稿、下载备份、后端应用上下文重建、新浏览器会话及独立本地解密进程。浏览器验证脚本会自行启动随机端口的 Vite，不依赖常驻开发页面。额外需要本机 Node 与 Chrome，Node 恢复验证使用 `--experimental-strip-types`。

加密候选代码和页面位于 `frontend/verification/vault/`，不进入正常生产构建；测试 HTTP 代码仅位于后端测试目录，正式 JAR 不包含。运行结果和加密备份写入被忽略的 `frontend/test-results/vault-<随机ID>/`；报告不包含密码或条目明文。设计、历史旧包装限制及审查边界见架构文档第 12 节。此验证不代表正式密码功能完成或允许使用真实秘密。

停止开发数据库（保留数据卷）：

```powershell
docker compose --env-file deploy/.env -f deploy/compose.dev.yml stop
```

启动脚本没有配置公网 HTTPS 或生产鉴权，上线仍须完成 PRD 的安全与部署阶段。

业务开发按 `docs/prd/PRD.md` 的 M1–M4 分阶段执行。密码功能在完成专项安全验证前只能使用虚构测试数据。
