# 私有空间

部署在个人服务器上的单用户私人工作台。首版目标包含 Markdown 笔记与附件、Windows 本地双向同步，以及浏览器端加密的密码保险库。

当前仓库处于“最小工程初始化”阶段，尚未实现业务功能。权威需求见 `docs/prd/PRD.md`，已确认技术方案见 `docs/architecture/architecture.md`。

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

本机若 `java -version` 命中了异常启动器，可直接使用 `JAVA_HOME` 指向的 JDK，或调整 `PATH` 使 `%JAVA_HOME%\bin` 优先。

## 本地启动

### 1. MySQL

```powershell
Copy-Item deploy/.env.example deploy/.env
docker compose --env-file deploy/.env -f deploy/compose.dev.yml up -d
```

示例配置只用于本地开发。首次启动前请修改 `deploy/.env` 中的密码，禁止把该文件提交仓库。

### 2. 后端

```powershell
cd backend
$env:DB_URL = 'jdbc:mysql://localhost:3306/private_space?useUnicode=true&characterEncoding=utf8&serverTimezone=UTC'
$env:DB_USERNAME = 'private_space'
$env:DB_PASSWORD = '<与 deploy/.env 一致的密码>'
mvn spring-boot:run
```

健康检查：`GET http://localhost:8080/actuator/health`。

### 3. 前端

```powershell
cd frontend
npm install
npm run dev
```

默认访问地址：`http://localhost:5173`。

### 4. 同步助手骨架

```powershell
cd sync-client
python -m privatespace_sync --version
python -m unittest discover -s tests -v
```

当前仅提供可运行入口，不包含文件监听、配对或同步实现。

## 检查命令

```powershell
cd frontend
npm run type-check
npm run test
npm run build

cd ../backend
mvn test
```

业务开发按 `docs/prd/PRD.md` 的 M1–M4 分阶段执行。密码功能在完成专项安全验证前只能使用虚构测试数据。
