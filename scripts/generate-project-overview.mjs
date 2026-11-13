import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
const esc = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
const files = readdirSync('database/migrations').filter(x=>x.endsWith('.sql')).sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1)))
const tables=[], relations=[]
for(const file of files){
 const sql=readFileSync('database/migrations/'+file,'utf8')
 for(const m of sql.matchAll(/CREATE TABLE (\w+)\s*\(([\s\S]*?)\)\s*ENGINE/gi)){
  tables.push({name:m[1],file,ddl:m[0]})
  for(const f of m[2].matchAll(/FOREIGN KEY\s*\(([^)]+)\) REFERENCES (\w+)\(([^)]+)\)/gi)) relations.push([m[1],f[2],f[1]+' → '+f[3]])
 }
}
const groups=[
 ['账户认证',n=>/^(account|web_session|login_attempt)$/.test(n)],
 ['笔记与文件',n=>/^(note|notebook|file_object)/.test(n)],
 ['设备同步',n=>n.startsWith('sync_')],
 ['加密保险库',n=>n.startsWith('vault_')],
 ['Office 文档',n=>n.startsWith('office_')],
 ['书架与阅读',n=>/^(novel_|reading_)/.test(n)],
 ['文章与英语学习',n=>n.startsWith('english_')],
 ['日历记录',n=>n.startsWith('calendar_')],
]
function diagram(nodes,edges){
 const w=1000,h=nodes.length*95+30
 return '<svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="关系或流程图"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#7a91ad"/></marker></defs>'+nodes.map((n,i)=>'<rect x="30" y="'+(20+i*95)+'" width="600" height="62" rx="10" fill="#182c47" stroke="#668bb9"/><text x="50" y="'+(57+i*95)+'" fill="#eef5ff" font-size="18">'+esc(n)+'</text>').join('')+edges.map(([a,b,label])=>'<path d="M630 '+(51+a*95)+' H'+(700+a*15)+' V'+(51+b*95)+' H635" fill="none" stroke="#7a91ad" marker-end="url(#arrow)"/><text x="650" y="'+(40+a*95)+'" fill="#b7d4f5" font-size="13">'+esc(label)+'</text>').join('')+'</svg>'
}
const flows=[
 ['部署与模块 UML',['Vue 3 浏览器 / Ant Design Vue','Caddy：HTTPS、静态前端、API 代理','Java Spring Boot：模块化单体','MySQL：元数据、正文索引、密文与业务状态','文件卷：普通文件及不可变版本','Windows Python/Tkinter 助手 + 本地 SQLite','ONLYOFFICE：可选独立文档编辑服务'],[[0,1,'HTTPS'],[1,2,'/api'],[2,3,'SQL'],[2,4,'文件对象'],[5,2,'设备令牌同步'],[6,2,'文档回调']]],
 ['笔记保存流程',['编辑 Markdown / TXT','提交基线版本与幂等操作编号','服务端核验身份、路径及版本','版本不符：返回冲突，保留本机内容','版本匹配：写入文件对象并发布数据库事务','记录历史与变更，返回服务器确认'],[[0,1,'保存'],[1,2,'请求'],[2,3,'冲突分支'],[2,4,'成功分支'],[4,5,'提交']]],
 ['同步与冲突流程',['助手配对，获得限权设备令牌','读取同步范围、目录快照和增量变更','比较本机文件、基线与服务器版本','无冲突：上传 / 下载 / 改名并确认版本','有冲突：保留双方，生成待处理项','用户选择处理方案，重新核验版本后执行'],[[0,1,'连接'],[1,2,'对比'],[2,3,'正常'],[2,4,'冲突'],[4,5,'人工确认']]],
 ['保险库流程',['账户登录：尚未解锁保险库','输入独立主密码，在浏览器 Worker 解锁','浏览器中编辑条目 / 安全笔记','Worker 加密完整快照','服务端条件保存密文及历史','锁定：释放解密状态；服务器仍只有密文'],[[0,1,'解锁'],[1,2,'读取'],[2,3,'保存'],[3,4,'密文上传'],[2,5,'锁定']]],
 ['每日文章与学习流程',['外部请求携带独立 Bearer 凭证','Webhook 校验并保存文章 / 单词批次','学习页读取当日最新或历史批次','词库、计划与复习任务','配对 / 拼写 / 翻译自评','后端校验并持久化进度与下次复习日期'],[[0,1,'提交'],[1,2,'展示'],[2,3,'学习'],[3,4,'练习'],[4,5,'确认']]]
]
const sqlite=new Set()
for(const file of readdirSync('sync-client/privatespace_sync').filter(x=>x.endsWith('.py'))){
 for(const m of readFileSync('sync-client/privatespace_sync/'+file,'utf8').matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g))sqlite.add(m[1])
}
const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workbench 项目结构与流程</title><style>body{margin:0;background:#0d1726;color:#dce7f5;font:16px/1.7 system-ui}main{max-width:1100px;margin:auto;padding:40px 24px}h1{font-size:36px}h2{margin-top:48px;color:#fff}a{color:#9bc7ff}section,details{background:#122138;border:1px solid #2a405e;border-radius:12px;padding:20px;margin:12px 0}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}svg{width:100%;max-height:none}nav{display:flex;gap:20px;flex-wrap:wrap}.count{font-size:40px;color:#9bc7ff}.muted{color:#a6b8ce}input{padding:12px;width:90%;background:#20344f;color:white;border:1px solid #668bb9;border-radius:8px}@media print{body{background:white;color:black}section,details{break-inside:avoid}nav,input{display:none}}</style><main><h1>Workbench · 项目结构地图</h1><p>根据当前工作区 SQL 迁移 V1–V23、README 和架构说明生成。含尚未提交的本地功能；没有查询生产数据库。</p><section><span class="count">'+tables.length+'</span> 张服务端业务表（包括锁、状态和操作回执表）<p>另有 Flyway 自动维护的 flyway_schema_history，完整迁移的 MySQL 实例通常合计 '+(tables.length+1)+' 张。同步助手另定义 '+sqlite.size+' 张 SQLite 表，不计入 MySQL。</p></section><nav><a href="#tables">表清单</a><a href="#relations">数据库 UML</a><a href="#flows">核心流程</a><a href="#local">本机数据</a></nav><h2 id="tables">按模块浏览全部表</h2><input id="search" placeholder="搜索表名，例如 note、vault、english"><p class="muted">展开查看建表语句。语句为最初 CREATE 定义，后续 ALTER 字段请结合对应迁移读取，不等同于最终完整字段字典。</p>'+groups.map(([name,pred])=>{const ts=tables.filter(t=>pred(t.name));return '<section><h3>'+name+' · '+ts.length+' 张</h3>'+ts.map(t=>'<details data-name="'+t.name+'"><summary>'+t.name+' · '+t.file+'</summary><pre>'+esc(t.ddl)+'</pre></details>').join('')+'</section>'}).join('')+'<h2 id="relations">数据库 UML：物理外键关系</h2><p>类框代表数据表，箭头从引用表指向被引用表。仅绘制 SQL 明确声明的外键；未声明外键不代表业务上没有关联。为保持可读性，按关系单独展示。</p>'+relations.map(([a,b,l])=>'<section>'+diagram([a,b],[[0,1,l]])+'</section>').join('')+'<section><h3>重要逻辑关联（非物理外键）</h3><p>书架 novel_book.file_id 引用普通文件身份，阅读不会另存一份正文。学习 source 连接词条与推送批次，task 连接 plan 和 item；这些迁移未声明对应外键。保险库条目、头像和安全笔记位于加密快照中，并非每种内容各建一张明文表。</p></section><h2 id="flows">架构 UML 与核心业务流程</h2>'+flows.map(([title,n,e])=>'<section><h3>'+title+'</h3>'+diagram(n,e)+'</section>').join('')+'<h2 id="local">同步助手与浏览器本地数据</h2><section><p>SQLite 表：'+[...sqlite].join('、')+'。</p><p>浏览器另保存外观偏好、普通草稿和加密暂存等数据，不计入服务端表数。普通文件卷也不是数据库表。</p><p>统计依据：database/migrations/*.sql；助手依据 sync-client/privatespace_sync 中实际 CREATE TABLE 语句。流程图为便于理解的主要成功/冲突路径，不展开每个异常分支。</p></section></main><script>document.querySelector("#search").oninput=e=>document.querySelectorAll("details[data-name]").forEach(d=>d.hidden=!d.dataset.name.includes(e.target.value.toLowerCase()))</script></html>'
mkdirSync('data/project-overview',{recursive:true})
writeFileSync('data/project-overview/index.html',html)
console.log(JSON.stringify({mysqlBusinessTables:tables.length,mysqlWithFlyway:tables.length+1,sqliteTables:sqlite.size,foreignKeys:relations.length,groups:groups.map(([n,p])=>[n,tables.filter(t=>p(t.name)).length]),output:'data/project-overview/index.html'}))
