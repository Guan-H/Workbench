# 独立思维导图

2026-11-12 用户确认独立导图：手动编辑节点、拖动层级，单独保存。正式生产是否已包含本功能，以 [部署记录](DEPLOYMENT.md) 为准。

## 使用与保存

从左侧“思维导图”进入。新建时确认名称，或导入 Workbench JSON 另存为新导图；导入不会覆盖已有导图。列表可搜索，每页 10 份，超高内部滚动。

导图侧栏的搜索框固定在上方，只有条目区域滚动，分页固定在底部，显示总数、当前/总页数和 10 份/页。手机在自身的列表面板底部显示分页，避免被条目挤出面板。

选中节点后，可通过工具栏添加子节点、同级节点、编辑或删除，双击也能编辑。画布支持拖动调整层级、折叠分支、缩放、适应画布、左右/两侧/向下布局和撤销重做。撤销以操作为单位，例如先撤销文字编辑，再撤销新增节点。手机浏览器提供同一工具栏，实际触屏手势仍需真机确认。

2026-11-12 按用户要求参考 [XMind 节点旁快捷栏](https://xmind.com/user-guide/floating-toolbar) 与 [主题操作](https://xmind.com/user-guide/topic-editing-new) 调整交互：选中单个节点后，在附近显示子节点、编辑、展开/收起和更多操作；编辑文字、平移/缩放时收起快捷栏。右键节点可插入子/同级/父节点、编辑、折叠及删除；中心主题禁止插入父/同级或删除。右键空白处可添加主分支、展开/收起全部、适应画布、居中或恢复 100%。菜单支持方向键、Enter、Escape、Shift+F10 打开，靠近窗口边缘自动避让。顶部“插入”菜单提供同级、前置同级与父节点入口，右下角集中放置缩放百分比、加减、适应及居中。

画布获得焦点时，Tab 新增子节点，Enter 新增同级（中心主题时为主分支），Shift+Enter 新增前置同级，Ctrl/Command+Enter 新增父节点；F2 编辑，方向键导航/展开收起，Delete 删除所选分支，Ctrl/Command+Z 撤销、Ctrl/Command+Y 或 Ctrl/Command+Shift+Z 重做。Shift+Tab 可离开画布返回工具栏。文字编辑期间保留原生输入、换行、文本撤销与文本右键菜单；Ctrl+S 先确认当前文字编辑，再调用真实保存。空格配合拖动可平移，Ctrl/Command+滚轮缩放，Ctrl/Command 加减号缩放、0 恢复 100%。这些快捷键只在画布内生效。

修改后约 1 秒自动保存，或按 Ctrl+S / 点击保存。只有收到后端确认才显示服务器已保存；待确认操作保留原编号和请求重试，重复确认不会增加版本。本机草稿保存在当前浏览器、当前账户的 localStorage，属于普通明文内容。服务器版本变化时暂停写入并保留草稿，可先导出本机 JSON，再明确确认采用服务器版本。刷新列表只更新列表，不替换当前编辑内容。

删除移入导图自己的回收站，恢复保持整份节点结构。首版不提供永久删除或自动清理。导图单独存于 MySQL，不是笔记附件，不进入保险库，也不参与现有 Windows 文件同步。生产整库 SQL 备份会包含导图表；单份可通过 JSON 导出迁移。

2026-11-13 折叠修复：选中中心主题时，快捷栏和右键菜单显示“收起全部分支／展开全部分支”；普通主题仍只折叠当前分支。中心主题上的方向键使用相同规则。批量折叠也会触发自动保存，重新打开保留折叠状态及完整节点，不删除隐藏的内容。

## 数据格式

首版只支持 Workbench 纯文本导图 JSON，扩展名建议 `.mindmap.json`：

```json
{
  "format": "workbench-mindmap",
  "schemaVersion": 1,
  "direction": 2,
  "nodeData": {
    "id": "root",
    "topic": "中心主题",
    "expanded": true,
    "children": [
      { "id": "child-1", "topic": "分支", "children": [] }
    ]
  }
}
```

direction 为 0 左、1 右、2 两侧、3 向下；节点可以带 expanded 布尔值及 direction 0/1。所有节点都有唯一 id、topic 和 children 数组。每份 JSON 最大 1 MiB、最多 1000 节点、40 层；每节点文本 1–1000 个 Java 字符，id 为 1–64 个 ASCII 字母、数字、下划线或连字符。名称为 1–120 字。限制不表示已经通过满载性能验收。

前后端均校验结构和额度。拒绝未知格式、重复 ID、HTML 字段、外部图片/链接和任意样式。节点按纯文本渲染，不启用 Markdown/HTML 解析。导入/导出保持节点顺序、方向和折叠状态，不声明兼容 XMind、FreeMind 或其他导图格式。

## 网页接口

所有接口要求现有网页登录、Origin 和 CSRF 校验，Webhook Bearer 凭证不能访问。沿用 JSON 错误结构和 `api/client`。接口返回普通明文内容。

- `GET /api/v1/mindmaps?deleted=false&query=&page=1`：每页 10 份，返回 items、total、page。items 含 id/title/version/deleted/updatedAt，document 为 null，不传完整树。
- `GET /api/v1/mindmaps/{id}`：返回完整 document 及元信息，回收站内容仍可由登录账户读取。
- `PUT /api/v1/mindmaps/{id}`：`Idempotency-Key` 为 UUID；JSON 为 `{ "baseVersion": "0", "title": "名称", "document": { ... } }`。ID 为小写 UUID；不存在且 baseVersion 为 0 时创建，已有记录要求当前版本一致且未删除。返回 id/version/deleted/updatedAt。
- `POST /api/v1/mindmaps/{id}/delete`、`POST /api/v1/mindmaps/{id}/restore`：携带新 `Idempotency-Key`，JSON 为 `{ "baseVersion": "当前版本" }`。状态不同时更改状态并递增版本，正文保持。

同一操作编号、相同请求重试返回原结果，不重复改版本；同编号换内容返回 `409 MINDMAP_OPERATION_REUSED`。版本不一致返回 `409 MINDMAP_CHANGED`；已删除不能保存，返回 `409 MINDMAP_DELETED`。格式/额度错误为 `400 INVALID_MINDMAP`，不存在为 `404 MINDMAP_NOT_FOUND`。版本是条件写入控制，本版不提供导图历史版本浏览。

V22 只新增 mind_map_lock、mind_map、mind_map_operation。锁与事务保证版本检查、状态变更和收据原子提交。收据只存小型写入结果，不重复保存完整导图。没有新增服务器服务或中间件。

## 前端依赖

Mind Elixir 固定正式版 5.15.1，按需加载在独立模块中；npm latest 当时指向预发布版，未直接采用。关闭库的 HTML/Markdown、默认工具栏/右键扩展与默认快捷键，使用现有 Ant Design 工具栏和受控纯文本粘贴，仅保存允许的字段。上游项目为 [Mind Elixir Core](https://github.com/SSShooter/mind-elixir-core)，MIT 版权许可随 Web 产物分发于 [许可证](../frontend/public/licenses/mind-elixir.txt)。

真实联调、故障注入及未验证边界见 [开发进度](PROGRESS.md)。
