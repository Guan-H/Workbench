# 常用文档格式：本地人工确认

本次为新增功能，未代填用户结果。仅本地运行，生产尚未更新。请使用测试文档，不用真实秘密验证保险库。

## 启动与入口

1. 启动 Docker Desktop，按 README 原步骤启动本地 MySQL。
2. 项目根目录执行 `./scripts/start-office.ps1`，首次需下载较大的固定版本镜像。服务监听 `127.0.0.1:8082`；本机需要空闲内存供文档服务使用。
3. 执行 `./scripts/start-backend.ps1`。已运行的后端须重启才能读取新生成的 Office 配置。`deploy/office.local` 含密钥，不要提交或分享。
4. `frontend/` 下执行 `npm ci`、`npm run dev`，Node 需不低于 22.13。打开 http://127.0.0.1:5173/ 并登录。
5. 笔记页“导入/导出 → 上传文档（TXT / EPUB / PDF / Office）”，确认目标目录后上传；也可打开原有文件。不是在浏览器访问本机 C 盘路径。

## 手动检查

- TXT：上传带中文的文本，修改后点击“保存 TXT”或 Ctrl+S，观察 Message，切换回来确认内容；刷新确认持久化。自动读取失败时可选择 GB18030 后重新读取。在线编辑最大 1 MiB，正文按纯文本展示。未保存草稿可下载；“放弃草稿并重新读取”需要明确确认。
- PDF：打开带内置书签的多页文件，左侧切换目录/缩略图，展开子章节并定位；没有书签时应明确提示。核对页码跳转、连续滚动、适合宽度/整页、放大缩小和旋转；文字可选择复制，Ctrl+F 打开文内搜索，Enter/Shift+Enter 切换匹配，Escape 关闭。扫描页没有文本层时无法搜索，不提供 OCR。核对下载文件字节及原文件名，点击打印核对浏览器打印预览、方向、分页和实际输出；准备期间可取消，较大文档超过打印内存预算会提示下载后打印。窄屏可收起侧栏，选择目录后返回正文。密码保护文件仍下载原件查看；PDF 只读，不提供批注或编辑。
- Word：上传 DOCX，编辑文字，点击“保存到服务器”或 Ctrl+S，等待服务器确认；下载原件用桌面软件查看。编辑器缓存不是本站保存成功依据。
- Excel：上传 XLSX，修改单元格并输入公式，保存后下载，用桌面软件核对内容及公式。用自己的代表性测试文档核对排版、字体和格式兼容性。
- DOC/XLS：打开旧文件，确认新格式目标路径后转换；新文件可编辑，原文件仍在。已有目标同名时应拒绝覆盖。
- 并发保护：Office 打开后由同步端修改同一文件，再在网页编辑保存；原文件保留，网页提示另存的冲突文件，可下载核对，不静默覆盖。
- 服务不可用：Office 不可用时应如实显示错误并保留下载入口，不出现伪编辑器。未确认保存时保留编辑页面，尤其不要依赖关闭标签、离线或崩溃后恢复最后输入；首版没有 Office 完整本机离线草稿保证。

## 已执行的自动检查与边界

真实独立 MySQL、HTTP、Chrome 和本机 ONLYOFFICE 已覆盖上传、TXT 编码/保存/冲突、PDF 两页渲染、DOCX 文字、XLSX 公式、签名回调持久化、同步读取/竞争写入以及旧格式转换。使用虚构测试内容，未使用业务 Mock；执行记录见架构文档第 70 节。

11 月 10 日新增 PDF 阅读专项已通过：真实 12 页文件的嵌套目录/命名目标、搜索高亮/无结果、文字选择、缩略图、滚动渲染、旋转、下载原字节、窄屏交互和无目录提示；打印页实际生成并解码成功。只做打印页面准备检查，系统打印预览、物理输出及大文档打印边界仍待人工核对。详情见架构第 71 节；未代用户确认。

未执行所有 Office 格式的兼容性、手机真机、屏幕阅读器、长期离线、满载性能或生产 Office 部署验收。当前生产约 4 GiB 服务器是否扩容或独立部署，仍需另行决定。

开发者复现专项：先执行 `node frontend/scripts/prepare-document-fixtures.mjs --legacy`（旧格式样本来自公开 Apache POI 仓库，下载后校验摘要），再在 PowerShell 执行以下命令。测试使用独立 MySQL，不往开发库创建测试账户/文件；需要 Docker、JDK/Maven、Chrome 和 Python。

```powershell
$env:CHECK_DOCUMENTS = 'base'
./scripts/test-integration.ps1 -OnlyAccountSessions

# Office 已通过 start-office.ps1 启动后：
$env:CHECK_DOCUMENTS = 'office'
$officeConfig = Get-Content deploy/office.local | ConvertFrom-StringData
$env:IT_OFFICE_SECRET = $officeConfig.ONLYOFFICE_JWT_SECRET
try {
    ./scripts/test-integration.ps1 -OnlyAccountSessions
} finally {
    Remove-Item Env:CHECK_DOCUMENTS, Env:IT_OFFICE_SECRET -ErrorAction SilentlyContinue
}
```
