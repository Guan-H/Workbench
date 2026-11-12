import assert from 'node:assert/strict'
import {writeFile,readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
const phase=process.argv[2],output=process.env.SESSIONS_OUTPUT,port=Number(process.env.SESSIONS_FRONTEND_PORT),backend=process.env.SESSIONS_BACKEND
assert.ok(output&&port&&/^http:\/\/127\.0\.0\.1:\d+$/.test(backend))
const server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),plugins:[vue()],logLevel:'error',server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':backend}}})
let browser,page
try {
 await server.listen();browser=await chromium.launch({channel:'chrome'});const context=await browser.newContext({viewport:{width:1440,height:1000},storageState:output+'/browser-a.json'});page=await context.newPage();const errors=[],dialogs=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss()})
 await page.goto(`http://127.0.0.1:${port}`)
 const api=(path,method='GET',body)=>page.evaluate(async({path,method,body})=>{const {api}=await import('/src/shared/api/client.ts');try{return{status:200,value:await api(path,{method,body:body===undefined?undefined:JSON.stringify(body)})}}catch(error){return{status:error.status,code:error.code}}},{path,method,body})
 const nav=async name=>page.getByRole('button',{name,exact:true}).click()
 const daily=()=>api('/home/english')
 const card=()=>page.getByRole('region',{name:'每日文章',exact:true})
 await nav('学习')
 if(phase==='english-restart'){
  const saved=JSON.parse(await readFile(output+'/english-result.json','utf8'));const result=(await daily()).value;assert.equal(result.latest.id,saved.latestId);assert.equal(result.total,13);assert.equal((await api('/home/english/webhook')).value.enabled,true);const legacy=(await api('/home/english?date=2026-01-03')).value.latest.content;assert.deepEqual(legacy.words.map(item=>item.word),['legacy-a','legacy-b']);assert.equal(legacy.cet4,undefined);assert.equal(legacy.cet6,undefined)
  await page.getByText('PAGED ARTICLE',{exact:true}).waitFor();await page.getByText('单词',{exact:true}).click();await page.getByText('fixture-0',{exact:true}).waitFor();assert.deepEqual(errors,[]);console.log('PASS: account-sessions-english-restart English batch history, latest snapshot and hashed credential config survive backend restart')
 } else {
  assert.equal((await daily()).value.latest,null)
  await page.getByText('这一天还没有收到英语推送。可在设置中配置接收入口。',{exact:true}).waitFor()
  await nav('设置');await page.getByRole('button',{name:'生成推送凭证',exact:true}).click();await page.getByRole('dialog',{name:'确认接收配置'}).getByRole('button',{name:'确认',exact:true}).click();await page.getByRole('textbox',{name:'新推送凭证',exact:true}).waitFor();let token=await page.getByRole('textbox',{name:'新推送凭证',exact:true}).inputValue();assert.match(token,/^[A-Za-z0-9_-]{43}$/);await page.getByRole('button',{name:'隐藏凭证',exact:true}).click()
  const send=async(body,secret=token)=>{const response=await page.request.post(`http://127.0.0.1:${port}/api/v1/hooks/english`,{headers:{Authorization:`Bearer ${secret}`},data:body});return{status:response.status(),body:await response.json()}}
  const first={requestId:'english-first',articles:[{title:'FIRST ARTICLE',text:'Original English sentence.',translation:'第一批译文。'}],words:[]}
  assert.equal((await send(first,'not-a-token')).status,401)
  assert.equal((await page.request.post(`http://127.0.0.1:${port}/api/v1/hooks/english`,{data:first})).status(),401,'Web cookie must not grant hook access')
  let result=await send(first);assert.equal(result.status,200);const firstId=result.body.id;const firstDate=result.body.date
  assert.equal((await send(first)).body.duplicate,true)
  assert.equal((await send({...first,articles:[{title:'tampered',text:'changed'}]})).status,409)
  assert.equal((await send({requestId:'invalid',articles:[],words:[]})).status,400)
  assert.equal((await send({requestId:'obsolete-input',articles:[],cet4:[],cet6:[]})).status,400)
  assert.equal((await send({...first,requestId:'too-large',articles:[{title:'oversized',text:'x'.repeat(1024*1024)}]})).status,413)
  assert.equal((await send({...first,requestId:'bad-date',date:'2026-02-30'})).status,400)
  for(let i=0;i<10;i++)assert.equal((await send({...first,requestId:`batch-${i}`})).status,200)
  const latest={requestId:'english-latest',articles:[{title:'LATEST ARTICLE',text:'<script>alert("not executed")</script>\nReal persisted English text.',translation:'最新批次译文。'}],words:[...Array.from({length:12},(_,i)=>({word:`fixture-${i}`,phonetic:'/test/',meaning:'虚构测试释义',example:'This is a test sentence.'})),{word:'resilience',phonetic:'/test/',meaning:'韧性',example:'Practice builds resilience.'}]}
  const concurrent=await Promise.all([send(latest),send(latest)]);assert.ok(concurrent.every(item=>item.status===200));assert.equal(concurrent.filter(item=>item.body.duplicate).length,1)
  const latestId=concurrent[0].body.id;assert.equal((await send(first)).body.duplicate,true);assert.equal((await daily()).value.latest.id,latestId,'Replay must not republish older snapshot')
  const historic={requestId:'historical-day',date:'2026-01-02',articles:[{title:'HISTORICAL ARTICLE',text:'History kept in real MySQL.'}],words:[]};assert.equal((await send(historic)).status,200)
  assert.equal((await api('/home/english?date=2026-01-02')).value.latest.content.articles[0].title,'HISTORICAL ARTICLE')
  assert.equal((await daily()).value.total,12)
  assert.equal((await api(`/home/english?date=${firstDate}&batch=${firstId}`)).value.latest.content.articles[0].title,'FIRST ARTICLE')
  assert.equal((await api('/home/english?page=2')).value.history.length,2)
  const anon=await browser.newContext();assert.equal((await anon.request.get(`http://127.0.0.1:${port}/api/v1/home/english`)).status(),401);const attempted=await anon.request.get(`http://127.0.0.1:${port}/api/v1/notes`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(attempted.status(),401);await anon.close()
  await nav('学习');await page.getByText('LATEST ARTICLE',{exact:true}).waitFor();await page.getByText('单词',{exact:true}).click();await page.getByText('fixture-0',{exact:true}).waitFor();assert.equal(await page.getByText('fixture-10',{exact:true}).count(),0);await card().getByRole('button',{name:'下一页',exact:true}).last().click();await page.getByText('fixture-10',{exact:true}).waitFor()
  await page.getByText('resilience',{exact:true}).waitFor();assert.equal(await card().getByText('四级单词',{exact:true}).count(),0);assert.equal(await card().getByText('六级单词',{exact:true}).count(),0)
  await page.getByText('文章 / 句子',{exact:true}).click();await page.getByText('LATEST ARTICLE',{exact:true}).waitFor();assert.equal(await card().locator('script').count(),0)
  assert.ok(await card().locator('.english-scroll').evaluate(element=>getComputedStyle(element).overflowY==='auto'),'Learning content must keep internal scrolling');assert.ok(await card().locator('.english-history').evaluate(element=>!element.open));await page.screenshot({path:output+'/english-home-desktop.png',fullPage:true});await page.setViewportSize({width:375,height:850});await card().scrollIntoViewIfNeeded();await card().screenshot({path:output+'/english-home-narrow.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1440,height:1000})
  await card().locator('.english-history>summary').click();await page.getByLabel('英语学习日期',{exact:true}).fill('2026-01-02');await page.getByText('HISTORICAL ARTICLE',{exact:true}).waitFor();await page.getByLabel('英语学习日期',{exact:true}).fill(firstDate);await page.getByText('LATEST ARTICLE',{exact:true}).waitFor()
  await nav('设置');await page.getByRole('button',{name:'停用接收',exact:true}).click();await page.getByRole('dialog',{name:'确认接收配置'}).getByRole('button',{name:'确认',exact:true}).click();await page.getByRole('button',{name:'启用接收',exact:true}).waitFor();assert.equal((await send(first)).status,401)
  await page.getByRole('button',{name:'启用接收',exact:true}).click();await page.getByRole('dialog',{name:'确认接收配置'}).getByRole('button',{name:'确认',exact:true}).click();await page.getByRole('button',{name:'停用接收',exact:true}).waitFor();assert.equal((await send(first)).status,200)
  const old=token;await page.getByRole('button',{name:'重置推送凭证',exact:true}).click();await page.getByRole('dialog',{name:'确认接收配置'}).getByRole('button',{name:'确认',exact:true}).click();await page.getByRole('textbox',{name:'新推送凭证',exact:true}).waitFor();token=await page.getByRole('textbox',{name:'新推送凭证',exact:true}).inputValue();assert.notEqual(token,old);await page.getByRole('button',{name:'隐藏凭证',exact:true}).click();assert.equal((await send(first,old)).status,401);assert.equal((await send(first)).status,200)
  assert.equal((await send({...latest,requestId:'extra-article',articles:[{title:'PAGED ARTICLE',text:'Second page'},{title:'SECOND PAGE',text:'Article pagination.'}]})).status,200)
  await nav('学习');await page.getByText('PAGED ARTICLE',{exact:true}).waitFor();await card().getByRole('button',{name:'下一页',exact:true}).last().click();await page.getByText('SECOND PAGE',{exact:true}).waitFor()
  const finalId=(await daily()).value.latest.id
  await nav('设置');await page.getByRole('button',{name:'刷新接收记录',exact:true}).click();await page.getByText('已接收',{exact:true}).first().waitFor();assert.ok((await api('/home/english/webhook/logs?page=2')).value.items.some(item=>item.status==='rejected'));await page.screenshot({path:output+'/english-settings.png',fullPage:true})
  let limited=false;for(let i=0;i<65;i++){const value=await send(first);if(value.status===429){limited=true;break}assert.equal(value.status,200)}assert.equal(limited,true,'Authenticated rate limit must be enforced by real persistence');
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);await writeFile(output+'/english-result.json',JSON.stringify({latestId:finalId}));console.log('PASS: account-sessions-english real English webhook auth isolation, duplicate/concurrent snapshots, historical dates, rotation/disable, dashboard and pagination')
 }
} catch(error){if(page)await page.screenshot({path:output+'/failure-'+phase+'.png',fullPage:true}).catch(()=>{});throw error}
finally {await browser?.close();await server.close()}
