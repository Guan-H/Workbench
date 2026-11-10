# Workbench · 私有空间

Workbench 是可自托管的单用户私人工作台，将笔记、文件、阅读、英语学习和加密保险库集中在一个 Web 界面中，并通过 Windows 同步助手连接本地文件目录。

## 项目功能

- **笔记与文件**：Markdown 编辑、分栏预览、大纲、搜索、收藏、历史版本和回收站；支持目录管理、右键菜单、拖拽、批量导入与选择范围导出。
- **文档工作区**：TXT 在线编辑、PDF 只读预览；接入 ONLYOFFICE 后可编辑 Word/Excel，旧 DOC/XLS 转换为新格式另存。
- **书籍阅读**：独立书籍目录，支持 TXT、EPUB 和 Markdown；提供目录、阅读位置保存、排版、沉浸和全屏模式。加入书架的笔记共用源文件内容。
- **Windows 同步**：通过配对连接服务器，支持全库或指定目录同步、文件改名跟随、增量同步及手动冲突处理。
- **密码保险库**：浏览器端加密的账号与安全笔记，支持独立主密码、锁定、草稿箱、恢复密钥、加密备份、历史与回收站。普通笔记和附件由服务器明文存储，不应当作保险库使用；保险库的使用边界见 [安全说明](docs/security/M3-REVIEW.md)，仅用于测试秘密。
- **工作台与学习**：日期、月历、节假日、最近编辑与收藏；通过 Webhook 接收每日英文文章、句子和单词，支持配对、拼写练习及浏览器原生朗读。

文章内容由外部推送方提供，不自动抓取。原生朗读需要设备提供英文语音。功能操作说明见 [开发与使用说明](docs/DEVELOPMENT.md)；开发进度、验收及发布记录单独保存在 [进度文档](docs/PROGRESS.md) 和 [部署记录](docs/DEPLOYMENT.md)。

## 技术组成

- 前端：Vue 3、TypeScript、Ant Design Vue 4、CodeMirror、Markdown-it、PDF.js。
- 后端：Java 17、Spring Boot、MyBatis、Flyway，包名为 `com.privatespace`。
- 数据库：MySQL 8.4；普通文件对象保存于独立持久化目录或 Docker 卷。
- 同步助手：Python、Tkinter，面向 Windows。
- 保险库：浏览器 Worker 内使用 libsodium 加解密，服务器保存密文。
- 生产运行：Docker Compose 管理 MySQL、后端和 Caddy；Caddy 提供静态前端、HTTPS 和 API 反向代理。

ONLYOFFICE 是可选的独立文档服务。TXT、PDF、书籍阅读和单词练习不依赖它。

## 目录结构

```text
Workbench/
├── frontend/                 Vue Web 应用
│   ├── src/modules/          笔记、阅读、保险库、英语等业务模块
│   ├── src/shared/           公共组件和 API 客户端
│   ├── scripts/              构建辅助与浏览器验证脚本
│   └── office-host/          Office 独立来源适配页
├── backend/                  Spring Boot 后端
│   └── src/main/java/com/privatespace/
│       ├── modules/          按业务模块组织的接口和逻辑
│       ├── common/           公共基础能力
│       └── config/           认证、存储和服务配置
├── sync-client/              Windows 同步助手源码及构建配置
├── database/migrations/      Flyway 数据库迁移
├── deploy/
│   ├── production/           生产 Compose、Caddy 和配置示例
│   ├── compose.dev.yml       本地开发数据库
│   ├── compose.office.yml    ONLYOFFICE 本地联调配置
│   └── compose.integration.yml  独立集成测试数据库
├── scripts/                  本地启动、同步助手构建和集成检查
├── docs/                     需求、架构、部署、进度与验收说明
└── AGENTS.md                 Agent 开发规范入口
```

运行生成的 `data/`、密钥、真实 `.env`、依赖、构建和测试产物不提交仓库。

## 本地部署与启动

### 环境要求

- JDK 17、Maven 3.9+。
- Node.js 22.13+ 与 npm。
- Docker Desktop，用于运行本地 MySQL 和可选的 ONLYOFFICE。
- PowerShell 7，用于仓库的 Windows 启动脚本。
- Python 3.13+，仅开发或运行同步助手时需要。

### 1. 启动数据库

先启动 Docker Desktop，在项目根目录执行：

```powershell
./scripts/start-local.ps1
```

脚本首次生成 `deploy/.env` 并启动 MySQL，重复运行保留已有配置。默认数据库端口为本机 `3306`；冲突时调整该文件的 `MYSQL_PORT`，不要删除数据卷解决配置问题。

### 2. 启动后端

在另一个终端的项目根目录执行：

```powershell
./scripts/start-backend.ps1
```

后端默认监听 `http://127.0.0.1:8080`，文件对象位于 `data/objects`。就绪检查为 `GET /api/system/health/readiness`。

需要本地 Word/Excel 编辑时，先在项目根目录运行 `./scripts/start-office.ps1`，再启动或重启后端。该脚本生成不提交 Git 的 `deploy/office.local`，并启动本机 `8082` 端口上的文档服务。它需要额外的内存和镜像下载空间。

### 3. 启动前端并初始化账户

在另一个终端执行：

```powershell
cd frontend
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173/`。首次启动时设置自己的账户，并在本机读取 `deploy/setup-token.local` 中的一次性初始化凭证填写到页面；不要发送凭证到聊天或提交仓库。已初始化的实例直接登录。

前端将 `/api` 代理到本机后端。需要手机或局域网访问时，来源白名单、防火墙和可信 HTTPS 的配置见 [详细运行说明](docs/DEVELOPMENT.md#本地启动)；保险库应在 localhost 或可信 HTTPS 安全上下文使用。

### 4. Windows 同步助手

同步助手在 Windows 上单独运行和更新，通过网页“同步中心”生成配对码。配置、启动和构建方式见 [同步助手说明](docs/M2-SYNC.md)。网站部署不会自动安装或更新助手。

停止本地开发数据库并保留数据卷：

```powershell
docker compose --env-file deploy/.env -f deploy/compose.dev.yml stop
```

## 生产部署

生产使用 Ubuntu 与 Docker Compose，入口配置为 `deploy/production/compose.yml`：

1. 准备确定的源码提交、已解析的域名、HTTPS 所需端口及独立持久化存储。
2. 在目标机器配置 `deploy/production/.env`，设置 `WORKBENCH_DOMAIN` 和可追溯的 `WORKBENCH_VERSION`；在受限的 `secrets/` 目录配置数据库密码与初始化凭证。
3. 分别构建后端和 Web 镜像。升级前停止本项目写入，并一致性备份数据库、文件对象和配置。
4. 使用原 Compose project 和持久化卷启动后端，核对迁移及数据，再启动 Web 并检查 HTTPS、登录与本次发布的真实业务流程。

MySQL、后端与 Web 分别运行在独立容器中，数据库和文件数据不打进应用镜像；只有 Web 映射 HTTP/HTTPS 端口。

完整的首次部署、升级、备份、回滚和验证步骤见 [Agent 部署执行指南](docs/DEPLOYMENT-AGENT.md)。生产 Compose 没有接通 ONLYOFFICE，发布 Office 编辑能力需要单独确认资源与网络接入方案。不要直接把本地 Office 配置用于公网。

## 文档入口

- [产品需求](docs/prd/PRD.md) 与 [技术架构](docs/architecture/architecture.md)。
- [开发进度与验收记录](docs/PROGRESS.md)。
- [详细运行、操作与验证说明](docs/DEVELOPMENT.md)。
- [部署指南](docs/DEPLOYMENT-AGENT.md) 与 [实际部署记录](docs/DEPLOYMENT.md)。
- [每日文章 Webhook](docs/WEBHOOK-ENGLISH.md) 与 [人工验收清单](docs/acceptance/)。
