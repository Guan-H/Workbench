# 推送每日文章到工作台

本功能首版只接收文字，在主页展示英文文章、句子和单词。它不会创建或覆盖笔记，也不能访问保险库。当前仅本地实现，生产部署状态见 [部署记录](DEPLOYMENT.md)。

## 配置接收入口

1. 登录工作台，进入“设置”，找到“每日文章 Webhook”。
2. 点击“生成推送凭证”，确认后把凭证保存到推送程序。凭证只在当前页面显示，服务器仅存摘要；不要放到 URL、源码或公共日志。
3. 使用页面提供的接收地址发送下面的 JSON。生产地址必须使用 HTTPS，本机调试可用 `http://127.0.0.1:5173/api/v1/hooks/english`。
4. 回主页点击“刷新每日文章”，选择文章或单词。主页进入时读取一次，不持续轮询。桌面卡片位于日历旁；正文区域高至多 180px，超出内部滚动，分页保留。
5. 展开“日期与历史”，通过日期和接收批次查看历史内容。设置页“接收记录”显示已认证提交的接收、重复和拒绝结果。

停用后新请求返回 401，既有内容保留；重新启用沿用当前凭证。重置凭证会立即撤销旧凭证，既有批次及 requestId 收据保留。若生成请求响应丢失，先刷新配置，再明确重置；服务器不能重新展示旧凭证。

## 请求契约

向 `/api/v1/hooks/english` 发送 `POST`，设置 `Content-Type: application/json` 和 `Authorization: Bearer <凭证>`。不需要网页 Cookie 或 CSRF token；网页 Cookie 也不能代替推送凭证。调用方自行按计划发送，本项目不会主动抓取英语来源。

```json
{
  "requestId": "daily-english-20261110-001",
  "date": "2026-11-10",
  "articles": [
    {
      "title": "A small step",
      "text": "A small step every day can make a difference.",
      "translation": "每天迈出一小步，也能带来改变。"
    }
  ],
  "words": [
    {
      "word": "achieve",
      "phonetic": "/əˈtʃiːv/",
      "meaning": "实现；达到",
      "example": "You can achieve your goal."
    }
  ]
}
```

`requestId` 必填，为 1–128 个 ASCII 字母、数字、点、下划线、冒号或连字符。按接收入口全局唯一，不按天重新计算。推送程序需保存此编号，超时重试使用原请求；新批次使用新编号。

`date` 可省略，默认首次成功接收时的北京时间日期；显式提供时必须为有效的 `YYYY-MM-DD`。文章 `title`、`text` 必填，`translation` 可省略。单词 `word`、`meaning` 必填，`phonetic`、`example` 可省略。articles、words 两个数组均必填，可以为空，但合计至少一项。

**每次请求是完整快照。** 只推送 words 而让 articles 为空时，最新展示中就没有文章。它不会和当天旧批次合并。当天最新以首次成功入库顺序确定，旧批次保留。重复请求返回原批次，不改变当前最新内容；相同 requestId 换内容返回 409。省略日期的重试需继续省略，不能改为显式日期。

成功返回 `200`，例如 `{"id":"12","date":"2026-11-10","duplicate":false}`；重复确认时 `duplicate` 为 `true`。返回成功后，数据已真实提交数据库。接口不返回网页其他数据。

## 限制与错误

- JSON 请求体最多 1 MiB，文章最多 10 篇，单词最多 400 个。
- 文章标题最多 200、正文和译文各最多 100000 个 Java 字符；单词 100、音标 200、释义 2000、例句 4000。中文和英文字母通常各占一个字符，部分表情占两个。
- 已认证提交每分钟最多 60 次，包含重复和格式错误请求；重置凭证不清除此计数。
- `400 INVALID_ENGLISH_PAYLOAD` 表示字段、日期、数量或长度无效；`401 WEBHOOK_UNAUTHORIZED` 表示凭证无效或入口停用；`409 WEBHOOK_REQUEST_CONFLICT` 表示同编号内容不同；`413 ENGLISH_TOO_LARGE` 表示请求体过大；`429 WEBHOOK_RATE_LIMIT` 表示稍后重试。
- 无效凭证不计入接收记录，限流拒绝也不增加日志。已认证格式错误和同编号冲突只记录安全错误代码，不保存失败正文。意外数据库故障按公共错误处理，不保证另写接收日志。
- 推送内容以普通文字展示，不执行 HTML，不抓取 URL、不接收附件，不提供原生平台载荷映射、定时发送或对外通知。

旧历史中的 cet4/cet6 词条按原数组顺序合并展示，原始快照和收据不改写。新推送只接收 articles、words，cet4/cet6 已停止接收；不要用原 requestId 改发新格式，应为新批次使用新编号。

历史目前不自动清理。不要把密码和安全笔记放进该入口。

## 网页接口

以下接口均要求网页登录，并沿用网页写入的 Origin 与 CSRF 检查。推送凭证不能调用它们。

- `GET /api/v1/home/english?date=YYYY-MM-DD&page=1&batch=12`：日期默认今天；批次编号可省略，省略时返回当天最新。历史每页 10 条，正文只返回选定批次。
- `GET /api/v1/home/english/webhook`：返回 `revision`、`configured`、`enabled`，不返回凭证或摘要。
- `POST /api/v1/home/english/webhook`：提交 `baseRevision` 和 `action`，action 为 `rotate`、`disable`、`enable`；旧 revision 返回 409，避免迟到操作覆盖新配置。只有 rotate 响应带新 token。
- `GET /api/v1/home/english/webhook/logs?page=1`：分页读取接收记录，每页 10 条。

## 单词挑战

文章/句子正文、单词及英文例句可点击喇叭朗读；挑战英文卡片和错词亦提供独立按钮，不触发配对。再次点击可停止，切换内容停止上一段。采用浏览器原生语音，效果取决于当前设备提供的英文声音；缺少声音、浏览器不支持或播放失败会弹出应用内消息。文章按短段连续朗读，不新增音频上传字段或语音服务接口。桌面挑战弹窗为 640px，超高内部滚动；手机保持全屏。

主页切到“单词”，旁边的“单词挑战”使用当前选中的历史或最新批次，每轮最多 6 对。英文或释义完全重复时只取一条出题，不改写原始推送。错误配对两端的词都会记入本轮错词，完成后可重练。关闭后可在当前页面继续；刷新/跨页面后不自动续练。

入口新增“配对 / 拼写”模式。拼写展示中文释义和遮住当前答案的例句，每轮最多 6 题；输入英文后提交或回车，忽略大小写与首尾空格。首字母/字符数和手动发音作为提示，不计入尝试；答错停留当前题，答对进入下一题。两种模式的当前轮次在本次页面分别保留，错词重练使用原模式。

新增网页接口沿用 Cookie、Origin 和 CSRF 校验，推送 Bearer 不能调用：

- `POST /api/v1/home/english/word-games`：JSON `{ "batchId": "12", "mode": "spelling" }`，mode 为 `matching` 或 `spelling`，省略时普通练习默认 matching，重练继承来源模式。`Idempotency-Key` 为小写 UUID；返回练习快照，`id` 与该操作编号相同。相同编号、来源与模式重试返回已有练习，不重复创建；改变模式返回 409。
- `GET /api/v1/home/english/word-games/{id}`：读取已保存的练习和成绩。
- `POST /api/v1/home/english/word-games/{id}/answers`：JSON `{ "baseRevision": "0", "wordId": 0, "meaningId": 1 }`，每次新尝试使用新 `Idempotency-Key`；同一未确认尝试必须保留原请求和原编号重试。并发或旧 revision 返回 `409 WORD_GAME_CHANGED`，先重新读取；已确认的重复提交不重复计分。
- 拼写使用同一 answers 路径，JSON `{ "baseRevision": "0", "wordId": 0, "spelling": "apple" }`；spelling 最多 100 个字符，不能与 meaningId 混用。只允许回答 `spellingPrompt.wordId` 当前题，跳题返回 `409 WORD_QUESTION_CHANGED`。空白、模式不匹配返回 `400 INVALID_WORD_ANSWER`。
- 重练错词使用创建接口，另加 `reviewOf` 为已完成练习 ID，并使用新的操作 UUID。批次须与原练习相同，仅取原练习错词。未完成练习返回 `409 WORD_REVIEW_NOT_READY`，没有词可练返回 `409 NO_PRACTICE_WORDS`。

快照包含 `id/batchId/revision`、候选词数量 `sourceCount`、去重数量 `eligibleCount`、独立排序的 `words/meanings` 卡片、`matched` 卡片 ID、`attempts/streak/bestStreak`、本轮错词 `mistakes`、`completed/elapsedSeconds` 和最近一次 `feedback`。普通练习的候选词为原批次词汇，重练为上一轮错词。时间由服务器起始时刻计算，完成后固定；关闭弹窗的时间也包含在内，不是学习时长统计。正确率为成功配对数 / 尝试数。V20 的 `english_word_game` 记录仅属于普通学习数据，首版不自动清理，不展示长期成绩或自动跨页面续练。

快照另含 `mode` 和 `spellingPrompt`；未完成的拼写轮次带 `{ wordId, meaning, example }`，其中 example 的原词已替换为 `____`，其他情况为 null。`words/meanings` 继续作为本轮词汇源返回，首版没有防作弊或排行榜机制，不将前端隐藏答案视为权限控制。旧 V20 记录没有 mode 时按 matching 解释，旧配对请求与结果保持可读。拼写正确率为正确题数 / 总提交次数。

## 人工核对

用虚构内容按请求示例推送，核对主页文章、译文、合并单词和超过 10 个单词后的分页。再推送新编号的新内容，核对当天最新和历史切换；重复发送首批，最新不能倒退。同编号改正文需拒绝。停用及重置后分别检查旧凭证拒绝，接收记录和历史仍在。

当前来源系统尚未确定。开发专项不能替代实际推送方的请求格式和网络联调；手机真机、长时间连续推送与网络故障恢复另行验证。
