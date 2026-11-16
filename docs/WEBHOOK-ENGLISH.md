# 推送每日文章到工作台

本功能只接收文字，独立“学习”页展示英文文章、句子和单词，主页保留轻量摘要。它不会创建或覆盖笔记，也不能访问保险库。双语对照与学习计划已随 2026-11-12 V21 发布，后续独立页面改动的实际生产状态见 [部署记录](DEPLOYMENT.md)。

## 配置接收入口

设置页展开“请求格式与限制”后，可点击“复制请求格式与限制”复制当前地址、方法、请求头占位、JSON 示例、字段规则及限制；也可只复制 JSON。完整说明始终使用 `<凭证>` 占位，不包含当前生成的真实凭证。复制成功显示 2 秒 Message，浏览器拒绝剪贴板时提示手动复制；localhost 或 HTTPS 可使用浏览器剪贴板能力。

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
      "translation": "每天迈出一小步，也能带来改变。",
      "sentences": [
        {
          "text": "A small step every day can make a difference.",
          "translation": "每天迈出一小步，也能带来改变。"
        }
      ]
    }
  ],
  "words": [
    {
      "word": "achieve",
      "phonetic": "/əˈtʃiːv/",
      "meaning": "实现；达到",
      "example": "You can achieve your goal.",
      "exampleTranslation": "你可以实现自己的目标。"
    }
  ]
}
```

`requestId` 必填，为 1–128 个 ASCII 字母、数字、点、下划线、冒号或连字符。按接收入口全局唯一，不按天重新计算。推送程序需保存此编号，超时重试使用原请求；新批次使用新编号。

`date` 可省略，默认首次成功接收时的北京时间日期；显式提供时必须为有效的 `YYYY-MM-DD`。文章 `title`、`text` 必填，`translation` 可省略。单词 `word`、`meaning` 必填，`phonetic`、`example` 可省略。articles、words 两个数组均必填，可以为空，但合计至少一项。

`sentences` 可省略；提供时须为非空数组，每篇最多 2000 对，每对的 text、translation 必填，各最多 4000 个 Java 字符。按顺序拼接各句后，须分别与全文 text、translation 一致（比较忽略 Unicode 空白差异）。不一致返回 `400 SENTENCE_TEXT_MISMATCH`，不接收半篇对照。全文和整个请求仍受下方原限制约束。旧全文记录保持可读，没有对照数据时明确显示未提供，不自动切句、翻译或猜测对应关系；补充对照须使用新 requestId，不能改写旧收据。

`words[].exampleTranslation` 为可选的例句译文，最多 4000 个 Java 字符；非空时须提供非空 `example`。单词列表和词库默认隐藏译文，点击“查看例句译文”后展开，再次点击收起。旧推送无需补字段，缺少译文时显示“尚未提供例句译文”，不自动翻译；补充内容须推送新 requestId，不能改写旧批次。词库仍按词形与释义归并并保留首次收录例句，可从来源查看后续批次的例句与译文，不覆盖历史词条。

文章阅读提供原文、译文、逐句对照、全文对照。全文对照直接使用 `text` 和完整 `translation`，不要求 `sentences`；桌面左右两栏，手机上下排版，缺译文时如实提示。

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
- `GET /api/v1/home/english/summary`：主页轻量摘要，返回北京时间 date、当日最新批次的 articles/words 数量和首篇 latestTitle，不返回文章正文或整个词表。完整文章、历史、词库和练习移到独立“学习”页面，原读取、推送与成绩接口保持。
- `GET /api/v1/home/english/webhook`：返回 `revision`、`configured`、`enabled`，不返回凭证或摘要。
- `POST /api/v1/home/english/webhook`：提交 `baseRevision` 和 `action`，action 为 `rotate`、`disable`、`enable`；旧 revision 返回 409，避免迟到操作覆盖新配置。只有 rotate 响应带新 token。
- `GET /api/v1/home/english/webhook/logs?page=1`：分页读取接收记录，每页 10 条。

## 原创课程库（独立于 Webhook，2026-11-16）

学习页布局：头部导航/筛选与底部分页固定，只有文章或列表体滚动；分页显示当前/总页数及数量，切页回到列表顶部。推送单词与个人词库为响应式卡片，常规桌面4列、大屏5列、手机2列；词库的学习记录与来源按需展开。接口和每页条数保持原契约。

### 添加文章与同步来源（2026-11-16 后续追加）

阅读页可“添加文章”或打开“内容来源”。新增内容只进入阅读库，不生成推送批次、词库或课程题目。未提供译文/句子解析时明确提示。手动文章来源链接为元数据，不触发网络读取。

- `POST /api/v1/home/english/courses`：Cookie/Origin/CSRF 认证及 UUID `Idempotency-Key`。JSON `{title,text,translation?,sourceUrl?}`，标题与原文非空，标题最多200、正文和译文各100000个Java字符，来源链接最多2000字符，只允许无用户信息的HTTP(S)地址。服务端生成稳定 `manual-<操作号>` ID，同号同请求返回已保存文章，同号不同内容409；网络结果未知时网页保留完整原请求到当前账户的 sessionStorage，刷新后从添加弹窗重试。正文按纯文本展示，不执行HTML。已保存文章可朗读、收藏；不自动生成题目。
- 列表摘要新增 `kind=original|manual|nasa`，来源文章不标成入门或四级。详情新增可空 `origin={kind,url,publishedAt,provider,licenseUrl}`。旧记录没有此字段仍可读。新文章按入库时间倒序，原入门材料的顺序保持。
- `GET /api/v1/home/english/courses/sources`：单个已支持来源状态 `{id,name,revision,enabled,running,lastAttemptAt,lastSuccessAt,added,skipped,error,retryAfterAt}`，时间为UTC偏移时间串。来源429/503时保存Retry-After退避时间，缺少有效时间时等待15分钟；等待期不访问来源，界面显示可重试时间。
- `PUT /api/v1/home/english/courses/sources/nasa`：JSON `{baseRevision,enabled}` 条件更新自动同步开关，旧版本409，未知结果须重新读取核对；默认 false，开启后后台每6小时检查近期内容，暂停不删除文章。
- `POST /api/v1/home/english/courses/sources/nasa/sync`：启动后台同步并立即返回状态；并发触发合并，客户端读取状态确认结束，HTTP成功仅表示任务接收。单后台线程、2分钟可恢复运行标记；关闭弹窗不取消后台任务。失败保留已有文章，错误与部分新增数量可查询。

NASA 固定[官方RSS](https://www.nasa.gov/feed/)地址在服务端维护，每批处理近期最多5项、2MiB响应、25秒请求期限，禁用跳转和任意网址参数。只读取RSS内嵌完整正文，不拿摘要冒充全文；XML禁止DTD/外部实体，正文去除HTML/脚本/样式、图片不下载。无有效文本、超限、非官方链接及带明确第三方保留版权标识的条目跳过；只允许www.nasa.gov和science.nasa.gov的出处链接，这些链接本身不被再次抓取。保存来源/发布时间及[官方使用说明](https://www.nasa.gov/nasa-brand-center/images-and-media/)，不声称已逐篇完成版权审查。按RSS GUID摘要唯一去重，保留首次正文，来源后续修改不覆盖本库记录。只查近期5篇，不是完整历史归档，不保证每批一定新增。

本机REST探测HTTP200并取得2026-11-12的正文，但实际Java联调返回429，未将探测成功当作后台接通；改验证专用RSS订阅入口，实际取得10条记录，最新2026-11-16，含完整content:encoded。实际Java同步结果另记进度，不以探测或缓存样本代替。Wikinews候选最新停在2026年5月，未采用；Simple Wikipedia可访问但本轮未接入。网络证据在忽略目录 `data/reading-source-probe/`，生产服务器可达性未验证。

网络配置：`PRIVATE_SPACE_READING_PROXY_URL` 可设置不含凭据的HTTP代理地址，仅影响阅读来源请求。Windows本地启动脚本在该变量未设置时读取已有系统代理，不修改系统设置；来源验证脚本同样遵循这一路径。生产Compose默认直连，可通过同名环境变量配置容器能访问的代理，容器中的127.0.0.1不是宿主机。Java直连与本机探测代理路径不同时，可出现不同结果；不得用单一路径的成功代替另一环境的真实验证。429/503需遵守退避，不自动换地址或反复请求。

同日形态调整：页面入口改为“阅读 / 短句 / 我的积累”，保留内部 courses 路径和已有记录。V26 将五课改为无序号的文章标题；页面不再要求完成整课，可自由阅读和选题。`finish` 仅保留兼容早期接口，不再由网页调用，旧 completed 字段不阻止继续阅读。

- 列表新增可选 `filter=all|favorite|review`，默认 all。筛选在服务端分页前执行。
- 摘要新增 `favorite`；写请求新增 `action=favorite`，提供布尔 `favorite`，仍需 baseRevision 和幂等键；旧进度缺省 false。这个新请求字段为 null 时不参与序列化，保留旧请求摘要。
- 新增 `GET /api/v1/home/english/courses/sentences?page=1&markedOnly=false`，返回 items/total/page，每页10句；每项含 courseId/title/sentenceIndex/text/marked。可直接定位原文的句子，也能只查看已标记的句子。阅读“换一篇”从当前页其余材料中选择，不调用推荐模型。

### 内容来源实测（2026-11-16，本机只读验证）

已实测 [VOA 官方 RSS 入口](https://learningenglish.voanews.com/rssfeeds) 的科技与语法两个订阅，各 HTTP200 / text/xml、20条记录；完整解析20条发布日期后，最新分别为2025-03-17和2025-03-20。每条订阅抽查一篇文章均 HTTP200，正文容器实际提取约482/803词。订阅的 description 只是短摘要，不能当全文。证据保存于忽略目录 `data/learning-source-check/result.json`、原始 XML/HTML 与提取文本。生产服务器可达性、持续更新和完整转载适用性尚未验证；没有向业务库导入样例或配置自动抓取。

因此该候选目前只可考虑历史素材，不作为每日新内容保证。其[官方使用说明](https://learningenglish.voanews.com/p/6021.html)区分 VOA 独立制作内容和第三方授权材料，后续接入必须识别来源并保留出处，不能把全站材料统一视为可转载。当前材料仍为五篇原创入门短文；自动获取、动态翻译/解析以及独立 AI 模块均未实现。

学习页“课程学习”提供 5 课原创基础/四级准备材料（AI 辅助编写，非真题）。内容由数据库迁移保存，读取与答题均走真实后端，推送端无需新增请求。每课包含短文、词语、3 个重点句和 3 道理解题。词义/词形/结构/译文按需展开；理解题提交后返回参考答案、解析和原文依据。标记句子与答错题保留为待复习清单，重新答对或明确标记已理解后移出。完成本课要求全部题目已提交，不要求全部答对，不宣称已掌握。此清单独立于原每日计划，不自动安排复习日期。

- `GET /api/v1/home/english/courses?page=1`：课程摘要（id/title/focus/source/revision/position/completed/answered/reviewCount），每页 10 课及 total/page。
- `GET /api/v1/home/english/courses/{id}`：summary、article、sentences（text/translation/vocabulary/forms/structure）、words、questions、marked 和 wrong。questions 的 selected/answer/explanation/evidence 在该题未提交时为 null；已提交题目返回已选值及参考内容。marked/wrong 为从 0 开始的句子/题目索引。
- `PUT /api/v1/home/english/courses/{id}/progress`：网页 Cookie/Origin/CSRF 认证，`Idempotency-Key` 为小写 UUID。JSON 必填 baseRevision/action；position 操作提供 position（article、sentence-0/1/2、practice），answer 提供 index/choice（从 0 开始），mark 提供 index/marked，finish 无额外字段。成功返回完整课程详情与新 revision。答错加入 wrong，正确清除该错题；句子标记独立保存。课程不存在404，非法位置/索引400，旧版本或未完成所有题目却申请完成409。
- 幂等键按课程隔离，同号同请求返回首次结果，不重复增加版本；同号换内容返回409。网页保存原待确认操作到当前标签页 sessionStorage，断线后可重试，冲突须确认重新读取。普通已保存进度跨浏览器读取；未提交选项不保证刷新保留，阅读位置为课程章节级，非滚动像素位置。

## 单词挑战操作

配对时点击未消除的英文卡片即朗读一遍，每次点击重新读，不因重复点词增加答题次数。拼写答对后先保留本题、显示正确英文并读一遍，正常读完再切到下一题，最后一题读完显示结果；发音固定一次，不受朗读设置的重复次数影响。答题继续沿用后台顺序保存，声音不代表成绩已同步。朗读失败或缺少英语声音时提供重听和手动继续，不假装读完，也不会卡住；关闭或切换仍停止播放。原主动发音提示可继续使用。

Chrome/蓝牙耳机兼容：朗读前会尝试静音预热输出，首次可能短暂显示准备状态，快速切换时只播放最后选择的内容；文字完整传给原生引擎。静音预热无法保证唤醒所有耳机，若仍缺少开头，需对比同浏览器扬声器和蓝牙耳机的实际试听，不能仅根据播放按钮状态判断完整发声。

文章/句子正文、单词及英文例句可点击喇叭朗读；挑战英文卡片和错词亦提供独立按钮，不触发配对。再次点击可停止，切换内容停止上一段。采用浏览器原生语音，效果取决于当前设备提供的英文声音；缺少声音、浏览器不支持或播放失败会弹出应用内消息。文章按短段连续朗读，不新增音频上传字段或语音服务接口。桌面挑战弹窗为 640px，超高内部滚动；手机保持全屏。

本地追加循环跟读：主页“每日文章”旁、学习窗口及挑战弹窗内提供“朗读设置”。单词默认 3 遍，双语对照的单句、例句及短句练习英文默认 2 遍；可选 1/2/3/5 遍，间隔可选 1/2/3/5 秒、默认 2 秒，给跟读留时间。设置仅存当前浏览器，用于下次播放，不改变当前轮次。播放显示当前遍数，间隔显示等待；再次点击停止，切换内容/关闭弹窗、页面隐藏或离开也会取消后续循环。整篇文章只读一次，不自动播放，不按听过次数更新学习记录；中译英提交前仍隐藏参考发音。循环使用同一真实原生语音服务，不新增请求字段、后端或语音供应商。该追加尚未发布生产，实际英文循环和蓝牙听感仍待可用设备试听。

主页切到“单词”，旁边的“单词挑战”使用当前选中的历史或最新批次，每轮最多 6 对。英文或释义完全重复时只取一条出题，不改写原始推送。错误配对两端的词都会记入本轮错词，完成后可重练。关闭后可在当前页面继续；刷新/跨页面后不自动续练。

入口新增“配对 / 拼写”模式。拼写展示中文释义和遮住当前答案的例句，每轮最多 6 题；输入英文后提交或回车，忽略大小写与首尾空格。首字母/字符数和手动发音作为提示，不计入尝试；答错停留当前题，答对进入下一题。两种模式的当前轮次在本次页面分别保留，错词重练使用原模式。

2026-11-11 交互调整：配对和拼写先在浏览器即时反馈，记录后台逐条提交，卡片不等待每个接口返回。底部“待同步”表示当前成绩尚未全部保存；全部确认后才显示已同步。网络异常可继续答题并重试原操作，当前标签页刷新后可恢复未同步请求；关闭标签页不保证保留未同步操作。版本/判定冲突会暂停并保留本机记录，需在应用内确认是否采用服务器进度。服务器仍负责逐条校验与真实持久化，不改变下列接口和计分契约，不新增离线成绩接口或迁移。

已读历史批次在当前主页内存中复用；“刷新每日文章”会清除缓存并重新读取当前日期最新批次。最新批次仍会核对服务器，切换时取消过时请求，离开主页释放缓存。服务器读取失败时保留已有内容并提示失败，不把缓存当成新推送。

新增网页接口沿用 Cookie、Origin 和 CSRF 校验，推送 Bearer 不能调用：

- `POST /api/v1/home/english/word-games`：JSON `{ "batchId": "12", "mode": "spelling" }`，mode 为 `matching` 或 `spelling`，省略时普通练习默认 matching，重练继承来源模式。`Idempotency-Key` 为小写 UUID；返回练习快照，`id` 与该操作编号相同。相同编号、来源与模式重试返回已有练习，不重复创建；改变模式返回 409。
- `GET /api/v1/home/english/word-games/{id}`：读取已保存的练习和成绩。
- `POST /api/v1/home/english/word-games/{id}/answers`：JSON `{ "baseRevision": "0", "wordId": 0, "meaningId": 1 }`，每次新尝试使用新 `Idempotency-Key`；同一未确认尝试必须保留原请求和原编号重试。并发或旧 revision 返回 `409 WORD_GAME_CHANGED`，先重新读取；已确认的重复提交不重复计分。
- 拼写使用同一 answers 路径，JSON `{ "baseRevision": "0", "wordId": 0, "spelling": "apple" }`；spelling 最多 100 个字符，不能与 meaningId 混用。只允许回答 `spellingPrompt.wordId` 当前题，跳题返回 `409 WORD_QUESTION_CHANGED`。空白、模式不匹配返回 `400 INVALID_WORD_ANSWER`。
- 重练错词使用创建接口，另加 `reviewOf` 为已完成练习 ID，并使用新的操作 UUID。批次须与原练习相同，仅取原练习错词。未完成练习返回 `409 WORD_REVIEW_NOT_READY`，没有词可练返回 `409 NO_PRACTICE_WORDS`。

快照包含 `id/batchId/revision`、候选词数量 `sourceCount`、去重数量 `eligibleCount`、独立排序的 `words/meanings` 卡片、`matched` 卡片 ID、`attempts/streak/bestStreak`、本轮错词 `mistakes`、`completed/elapsedSeconds` 和最近一次 `feedback`。普通练习的候选词为原批次词汇，重练为上一轮错词。时间由服务器起始时刻计算，完成后固定；关闭弹窗的时间也包含在内，不是学习时长统计。正确率为成功配对数 / 尝试数。V20 的 `english_word_game` 记录仅属于普通学习数据，首版不自动清理，不展示长期成绩或自动跨页面续练。

快照另含 `mode` 和 `spellingPrompt`；未完成的拼写轮次带 `{ wordId, meaning, example }`，其中 example 的原词已替换为 `____`，其他情况为 null。`words/meanings` 继续作为本轮词汇源返回，首版没有防作弊或排行榜机制，不将前端隐藏答案视为权限控制。旧 V20 记录没有 mode 时按 matching 解释，旧配对请求与结果保持可读。拼写正确率为正确题数 / 总提交次数。

## 双语阅读与每日学习（V21）

文章支持“原文 / 译文 / 双语对照”，双语逐句英文在上、中文在下，可朗读单句英文。短句练习仅使用推送端已对齐的句子，旧全文不会自动生成题目。主页“今日学习与词库”可查看个人词库、累计错词/自评错句和短句练习；列表每页 10 项、超高内部滚动，来源可回到历史批次及对应文章。

词库汇总所有已接收历史批次（含旧 cet4/cet6 数组），按规范化单词和释义合并，相同词的不同释义保留，来源不丢失。先从四级学习由推送端控制内容，本项目不自带完整四级词表，也不根据词形推断考纲。

每日北京时间生成一份固定计划；默认新词 10 个、复习 20 个模式任务、短句每方向 3 句，可分别设置为 1–50、1–100、1–20。修改设置影响下次新计划，不重排已生成计划。配对与拼写分别记进度，一天的新词最多选择同一词形的一种待学释义；两模式会形成独立任务，因此“新词数”不等于任务数。到期任务优先，词汇轮次先完成待复习内容，再开始新词；每轮仍最多 6 个，未完成计划轮次支持重新打开/刷新后续练。

间隔为 1、3、7、14 天；只有跨日正确或自评基本正确才推进，同一天重复成功不跳级，答错或自评需要改进/不会安排次日复习。同日答错后再答对不会立即升级，累计错误次数不清零。这是固定间隔安排，不承诺记忆效果，不将完成度称为考试分数。普通批次配对/拼写也累计进度；已同步的普通轮次仍不提供跨页自动续练。

短句支持英译中和中译英：先写译文，再提交查看参考，最后自评“基本表达正确 / 需要改进 / 不会”。不做字符串自动评分或 AI 批改。中译英提交前不提供参考英文发音。输入约 1 秒后自动保存，可手动保存；本机草稿与待确认操作按账户及任务暂存，网络恢复后按原操作编号重试。并发冲突保留草稿，明确确认后才采用服务器版本。自评和配对/拼写由真实后端与 MySQL 保存，参考表达不是唯一标准答案。

网页接口仍要求 Cookie、Origin、CSRF，推送凭证不能调用。编号和 revision 均为字符串：

- `GET /api/v1/home/english/study`：返回 settings、词句/错词/到期数量与当天 plan。
- `PUT /study/settings`：相对上述 study 路径，JSON `{ "baseRevision":"0", "newLimit":10, "reviewLimit":20, "sentenceLimit":3 }`，版本变化返回 409。
- `GET /study/items?kind=word&query=&wrong=false&page=1`：kind 为 word/sentence，每页 10 条，含 sources 和各模式 progress；wrong 查看累计错误。
- `POST /study/plans`：`Idempotency-Key` 为小写 UUID；当天重复创建返回既有计划。`GET /study/plans/{id}` 读取已保存任务。
- `PUT /study/tasks/{uuid}`：`Idempotency-Key` 为小写 UUID，JSON `{ "baseRevision":"0", "answer":"我的译文", "action":"draft" }`。action 为 draft/submit/rate；submit 必须有实际输入，之后才返回 reference；rate 另带 rating=good/improve/unknown，必须已提交且答案不变。每次新动作使用新编号，未知结果重试原编号和原请求；旧版本返回 409，禁止覆盖他处保存。
- 计划词汇沿用 `/api/v1/home/english/word-games` 创建，额外传 `studyPlanId`（计划 ID）和计划的 batchId。可能返回该计划该模式已有活动轮次，响应 id 不保证等于本次操作编号；普通批次契约保持不变。

前端、Java 与 V21 新表需配套发布；V21 只新增学习表，不改写原始批次/收据或保险库。生产已于 2026-11-12 更新到 V21，旧文章没有逐句配对时仍需推送方使用新编号提供数据。

## 个人词库导入（2026-11-16，本地新增）

入口：学习→词库与计划→个人词库→导入单词。粘贴一行一个“单词：释义”，支持中英文冒号、忽略空行。示例：`convenient：方便的；便利的`。每批最多500行、文本100000字符；英文单词/短语最多100字符，允许字母、空格、连字符和撇号；释义最多4000字符。先预览，有错误时修正后重新预览，确认才入库。

- `POST /api/v1/home/english/study/words/import-preview`，请求 `{ "text":"improve：提高；改善\nput off: 推迟" }`；返回 `entries:[{line,word,meaning,status,message}]` 和 `newWords/duplicates/invalid`。status为new/duplicate/invalid；不导入本次输入，沿用历史推送索引同步。
- `POST /api/v1/home/english/study/words/import`，相同请求，另带UUID `Idempotency-Key`；返回 `{added,skipped}`。格式错误整批400无部分导入；同词同释义跳过，原例句和进度不覆盖。相同操作与原文返回原结果，不同原文409。确认时按实际库状态重新去重，所以新增数可能少于预览。
- `/study/items` 的Item增加 `manuallyImported` 布尔值，与原sources并存。全库挑战创建省略或传空batchId，无studyPlanId时取全部个人词库，不受搜索/分页限制；计划挑战保留studyPlanId及计划的可空batchId。Snapshot的batchId可空，新增vocabulary为本轮选中词条，供即时反馈使用。服务端仍逐次判题、幂等保存与累计模式进度，普通批次挑战契约保持。

前后端须配套V28更新。手动导入不建立english_batch，不影响每日推送摘要/历史；新词参与下一份计划，既有当日任务不变。待确认操作按账户在当前标签页sessionStorage暂存，刷新后重新打开导入弹窗可重试；不承诺关闭标签页后的恢复。

## 人工核对

用虚构内容按请求示例推送，核对主页文章、译文、合并单词和超过 10 个单词后的分页。再推送新编号的新内容，核对当天最新和历史切换；重复发送首批，最新不能倒退。同编号改正文需拒绝。停用及重置后分别检查旧凭证拒绝，接收记录和历史仍在。

当前来源系统尚未确定。开发专项不能替代实际推送方的请求格式和网络联调；手机真机、长时间连续推送与网络故障恢复另行验证。
