# 私有空间

部署在个人服务器上的单用户私人工作台。首版目标包含 Markdown 笔记与附件、Windows 本地双向同步，以及浏览器端加密的密码保险库。

M0 已完成并由用户确认验收关闭（2026-10-28）：加密候选、文件兼容与 Windows 同步原型均完成限定范围验证；Obsidian 由用户实际编辑确认，修改文件已通过真实接口回传并核对字节。M1 笔记工作台的已确认开发范围已完成，包含目录导入/选择导出、文件操作、回收站、历史分页与文本对比，以及可配置的 30 天保留清理；真实自动化整体验收已通过，等待用户手动验收确认。2026-10-30 已将当前功能作为公网预览版部署到 `https://sy.ggh.cool`，生产管理员仍待用户首次初始化；该部署不代表 M2–M4 或正式安全上线验收完成。权威需求见 `docs/prd/PRD.md`，已确认技术方案、验证结果与限制见 `docs/architecture/architecture.md`，实际部署状态和运维说明见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

## 当前进度（2026-10-30）

| 范围 | 状态与边界 |
| --- | --- |
| M0 技术风险验证 | 已验收关闭；仅代表架构文档记录的限定范围验证完成。 |
| M1 笔记编辑与文件操作 | 已实现初始化/登录、编辑预览、保存反馈、本机草稿、搜索/收藏/最近/大纲、附件、重命名与移动、右键与拖拽；新建支持名称/位置分离、空白处及文件夹右键入口和创建后定位。 |
| M1 目录导入与导出 | 已实现系统选择/应用内拖入、隐藏目录排除、默认收起的预检树、真实上传总进度、原子发布，以及复选框选择范围的 ZIP 导出。 |
| M1 回收站 | 已实现整目录回收、按删除批次只展示文件夹、右键恢复、整目录原位置恢复、多选文件原位置/指定目录平铺恢复；有真实回滚和幂等验证。 |
| M1 历史与保留 | 已实现每页 30 条的稳定游标分页、历史版本与服务器当前版本的文本对比、恢复到新版本；默认 30 天的历史/回收站/孤儿对象清理可配置，并保护删除快照、活跃对象和进行中的导出。 |
| M1 验收 | 已通过独立 MySQL、真实 Chrome/HTTP/文件存储的自动化整体验收；等待用户手动验收确认后关闭 M1。 |
| M2–M4 | 正式同步助手、正式保险库、安全加固、生产部署和备份恢复等尚未交付；M0 原型不替代这些功能。 |

下一步由用户手动核对 M1 历史与保留说明；确认关闭 M1 后进入 M2 正式同步产品。批量 2000 文件 / 1 GiB 满载性能、真实手机和屏幕阅读器仍未验收，前端主包体积告警仍待后续处理，这些边界未被自动化通过结论掩盖。

本批验证：前端类型检查、生产构建与 1 项单元测试通过（仍有既有 Vite 包体积告警）；后端 5 项单元测试、3 项真实集成测试通过，NotesIT 包含 Chrome/HTTP/MySQL/V5 迁移/文件链路及故障注入。历史与保留首轮因空首页游标判断失败，第二轮因旧验收脚本仍按数组读取分页接口，均判失败并修正；第三轮完整复验通过。详情及未验证范围见架构文档第 21 节。

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

登录后可以验证创建目录与笔记、Markdown 编辑/预览、保存、搜索、收藏、历史恢复、回收站、附件及目录导入/ZIP 导出。点击保存或按 Ctrl+S 时，页面顶部显示应用内 Message，明确反馈正在保存、服务器确认成功、无未保存修改或保存失败；成功/无修改消息 4 秒后消失，错误消息保留 8 秒，也可手动关闭。自动保存继续通过底部状态栏反馈。普通笔记及本机草稿为明文。历史弹窗每页显示 30 条并在区域内滚动，可用上一页/下一页切换；选择版本后以文字和颜色同时标记其与服务器当前版本的删除、增加内容，恢复会创建新版本，不覆盖历史。

工作台操作：分栏模式下拖动编辑区与预览区之间的竖向分隔线调整宽度；双击恢复各半，也可聚焦分隔线后用左右方向键微调，或点击工具栏“宽度”滑轨。窄屏仍为单栏。图标操作按钮悬停后使用浏览器原生提示显示操作名称。

新建笔记/文件夹：单击目录名称选中创建位置，双击目录名称切换展开/收起，独立箭头仍只控制展开与收起；当前“新建位置”显示在文件树上方。可用顶部按钮，也可右键文件树空白处选择“新建笔记 / 新建文件夹”；右键文件夹选择“在此新建…”，右键“根目录 /”固定在根目录新建。弹窗只填名称，位置可通过目录选择器更改，笔记未填写 .md 时自动补齐。Enter 创建、Escape 取消，重名或非法名称在输入旁提示并保留内容；创建成功后自动展开、定位并高亮新项目。回收站不显示新建入口。结果未知时保持原输入，用同一操作重试确认，关闭后先刷新核对。

文件树只高亮最后选中的一个文件、文件夹或根目录。选中文件夹后，正文仍保留已打开的笔记，保存正文不会让文件重新高亮；再次点击该文件即可选中。创建位置单独显示，不再以文件夹持续高亮表达。

文件操作：在文件树或普通搜索/收藏/最近列表中右键打开“重命名 / 移动到… / 删除”；键盘可聚焦文件后按 Shift+F10。也可将文件或文件夹拖到目标文件夹，或拖到“根目录 /”。两种入口均先展示路径和标准相对链接的变更预览，确认后才提交；预览只包含本次路径变化真正影响的文件、引用和相关警告，不会顺带规范化全库其他链接。遇到重名、版本变化或自身子目录会拒绝执行。有受影响的本机草稿时，先打开并保存草稿。双链、多行或含转义等无法可靠定位且可能指向本次目标的链接会列出提示并保留原文。新建、重命名、移动、导入、导出、恢复、历史和冲突弹窗点击遮罩不会关闭，只能提交完成、点取消/关闭按钮或按 Escape。历史内容不被改写，恢复到当前路径后仍需检查当时使用的相对链接。

目录导入：文件树底部点击“批量导入目录”，选择目标目录，再选择本机目录或多个文件，也可从资源管理器拖入目录，点击“重新预检”。保留系统选择入口，其文件选择/授权窗口由浏览器或系统控制；应用内拖入不打开系统选择窗口。拖入后仅在本机收集文件信息，预检前不上传。目录选择保留所选根目录名称与内部层级；多文件选择导入到目标目录。预检实际上传文件，检查 UTF-8、Windows 路径、重名、回收站占用、大小写与大小限制，但不发布笔记。全部通过后点击“确认导入”才统一发布；预检后目录或内容变化会要求重新预检。断网或确认结果未知时保留同一次操作重试，不显示虚假成功。当前不导入空目录；以 `.` 开头的目录（包括 `.git`、`.obsidian`）在文件选择后默认排除并显示数量，不会上传；其他非法路径仍阻止本批。点击导入弹窗外部不会关闭；上传/导入/导出确认使用应用内弹窗。原始 Markdown 字节、Frontmatter、双链文本和附件不改写，`.md` / `.MD` 均作为笔记识别。

默认每批最多 2000 文件、总计 1 GiB，单笔记 1 MiB、单附件 50 MiB。服务端可设置 `PRIVATE_SPACE_IMPORT_MAX_FILES`、`PRIVATE_SPACE_IMPORT_MAX_BYTES` 调整批次限制；提高它们时还需协调 `PRIVATE_SPACE_IMPORT_REQUEST_SIZE`（默认 1030 MiB）、`server.tomcat.max-parameter-count`（默认 10000）、`server.tomcat.max-swallow-size`（默认跟随请求大小）和 `server.tomcat.max-part-count`（默认 4100），并核对实际临时磁盘与资源。前端从真实接口读取批次限制。尚未验证 1 GiB / 2000 文件满载性能，不承诺大批次断点续传。

ZIP 导出：点击“导出笔记 ZIP”，保存当前笔记后，弹出默认不勾选的目录树，可展开目录并勾选文档或目录（包含全部子项），点击“全选”按钮才选中所有内容；也可清空选择。单篇文档自动带上标准 Markdown 相对链接引用的库内附件；重复勾选只打包一次，保留中文目录、空目录及文件原始字节。ZIP 不含回收站、历史、本机未提交草稿、账户信息或保险库。文件损坏或生成失败时不会发布一个伪装完整的 ZIP。重新导入 ZIP 时先在本机解压，再用目录导入入口选择解压后的目录；直接上传 ZIP 不会自动解包。

保留清理：历史、回收站和无引用孤儿对象默认均保留 30 天，后台默认启动 1 分钟后首次检查、之后每 6 小时检查。可设置 `PRIVATE_SPACE_HISTORY_RETENTION_DAYS`、`PRIVATE_SPACE_RECYCLE_RETENTION_DAYS`、`PRIVATE_SPACE_ORPHAN_RETENTION_DAYS` 调整天数（最小 1），或用 `PRIVATE_SPACE_RETENTION_ENABLED=false` 暂停自动清理；`PRIVATE_SPACE_RETENTION_CLEANUP_INTERVAL` 和 `PRIVATE_SPACE_RETENTION_CLEANUP_INITIAL_DELAY` 接受 ISO-8601 时长。到期清理是不可逆操作，升级和缩短周期前必须备份数据库与 `data/objects`。仍被目录删除快照、当前文件或有效导出租约引用的对象不会清理；变更日志/墓碑不在本轮 30 天清理内。

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

收藏或最近访问再次点击会取消筛选并返回根目录。点击大纲会定位预览并只高亮对应标题，点击预览正文后取消高亮。

上传时显示当前请求的总进度（目录预检、确认导入、附件及单 Markdown 导入均支持）；按浏览器真实上传字节计算，包含 Multipart/JSON 请求开销。传输 100% 后仍等待服务器预检或持久化确认，不表示文件已经保存。浏览器未给出总长度时显示不确定进度，不编造百分比。

右键“删除”和编辑区删除按钮均先显示应用内确认，再通过真实版本条件请求移入回收站；取消不执行。目录会连同本次确认范围中的子目录与文件整批删除，此前单独删除的文件不进入本批。有本机草稿的其他笔记须先打开处理，删除当前笔记前先保存；失败或冲突不显示成功。恢复、冲突处理、草稿切换和需确认的退出也使用应用内对话框。关闭/刷新浏览器标签页的未保存提醒仍由浏览器 beforeunload 控制，不能替换成页面弹窗。

导入预检结果以目录树展示，目录默认全部收起，点击箭头展开子目录或文件；收起目录仍显示文件总数和内部问题数量。拖入时整段跳过隐藏目录，显示跳过的目录数；系统选择入口按浏览器给出的 FileList 显示排除文件数。读取失败或超限会停止收集，不提交部分目录；空目录暂不导入。

目录删除确认展示文件与子目录数量，确认后范围若变化会要求重新确认；删除或恢复中途失败会整批回滚。历史、路径或版本冲突时保留回收站内容，不覆盖当前文件。

回收站列表只展示本批删除的文件夹条目，内部子目录和文件不单独平铺；此前单独删除的文件仍是独立条目。需要查看内部文件时打开文件夹的恢复弹窗。回收站右键“恢复”：文件直接恢复到原位置；目录打开应用内弹窗，选择“恢复整个文件夹”或“选择文件恢复”。整个文件夹仅将当前删除批次的剩余项目恢复到原位置。选择文件时展开目录树并多选，下一步选择原目录或指定目录；指定目录会平铺放入，例如 `A/子目录/笔记.md` 恢复为 `B/笔记.md`。确认前展示路径、必要目录和相对链接变化，同名文件会阻止整批。附件需一并勾选，未选项目保留在回收站；恢复必要父目录后，若仍有待恢复子项，该目录会继续作为回收站容器显示。再次恢复整个文件夹不会把已恢复到其他位置的文件移回来。预览文件清单每页 20 条，目录树同级每页 30 条，超出弹窗高度时内部滚动。

“导入到”改为应用内目录选择器，显示文件夹图标、树形层级和目录搜索，只能选已有目录或根目录；选定后点击“使用此目录”。标题定位高亮改为浅琥珀色背景与深色文字，点击预览正文取消。
