import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'
const phase=process.argv[2],backend=process.env.FEATURE_BACKEND,port=Number(process.env.FEATURE_PORT),output=process.env.FEATURE_OUTPUT
assert.ok(output&&port&&/^http:\/\/127\.0\.0\.1:\d+$/.test(backend))
const server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),plugins:[vue()],logLevel:'error',optimizeDeps:{include:['libsodium-wrappers-sumo']},server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':backend}}})
let browser,page
try{
  await server.listen();browser=await chromium.launch({channel:'chrome'})
  const context=await browser.newContext({viewport:{width:1440,height:1000},...(phase==='restart'?{storageState:output+'/browser.json'}:{})})
  page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message))
  const requests=[];page.on('request',request=>requests.push(request.url()))
  await page.goto(`http://127.0.0.1:${port}`)
  const call=(path,method='GET',body,operation=crypto.randomUUID())=>page.evaluate(async({path,method,body,operation})=>{
    const{api}=await import('/src/shared/api/client.ts')
    try{return{status:200,value:await api(path,{method,body:body===undefined?undefined:JSON.stringify(body),headers:{'Idempotency-Key':operation}})}}catch(error){return{status:error.status,code:error.code,message:error.message}}
  },{path,method,body,operation})
  const go=name=>page.locator('.global-sidebar').getByRole('button',{name,exact:true}).click()
  const map=()=>page.getByRole('region',{name:'思维导图页面',exact:true})
  const saved=()=>map().locator('.mindmap-title [role=status]').filter({hasText:/^服务器已保存$/}).waitFor()
  const mapButton=id=>map().locator(`[data-map-id="${id}"]`)
  if(phase==='restart'){
    const result=JSON.parse(await readFile(output+'/result.json','utf8'))
    assert.deepEqual((await call('/mindmaps/'+result.id)).value,result.snapshot)
    await go('思维导图');await map().getByLabel('搜索导图',{exact:true}).fill(result.snapshot.title);await mapButton(result.id).click();await map().getByLabel('思维导图画布').locator('me-tpc').first().waitFor()
    assert.ok(await map().getByLabel('思维导图画布').textContent().then(text=>text.includes('服务器修改')))
    await go('学习');await page.getByRole('heading',{name:'Aligned test article',exact:true}).waitFor()
    assert.deepEqual(errors,[])
    console.log('PASS mindmap restart: exact diagram tree/version, learning batch and authenticated UI survived restart')
  }else{
    assert.equal((await call('/auth/initialize','POST',{username:'feature-it',password:process.env.FEATURE_PASSWORD,setupToken:process.env.FEATURE_SETUP})).status,200)
    const state=(await call('/home/english/webhook')).value,credential=(await call('/home/english/webhook','POST',{baseRevision:state.revision,action:'rotate'})).value
    const receipt=await context.request.post(`http://127.0.0.1:${port}/api/v1/hooks/english`,{headers:{Authorization:'Bearer '+credential.token},data:{requestId:'learning-migration',articles:[{title:'Aligned test article',text:'Keep learning.',translation:'坚持学习。',sentences:[{text:'Keep learning.',translation:'坚持学习。'}]}],words:[{word:'bright',meaning:'明亮的'},{word:'future',meaning:'未来'},{word:'convenient',meaning:'方便的'}]}})
    assert.equal(receipt.status(),200)
    requests.length=0;await page.reload();await page.getByRole('region',{name:'学习摘要',exact:true}).getByText(/今日 1 篇文章 · 3 个单词/).waitFor()
    assert.equal(requests.some(url=>/\/api\/v1\/home\/english\?/.test(url)),false,'home summary must not fetch full articles')
    await page.getByRole('button',{name:'继续学习',exact:true}).click();await page.getByRole('heading',{name:'Aligned test article',exact:true}).waitFor()
    await page.getByRole('button',{name:'今日学习与词库',exact:true}).click()
    const learning=page.getByRole('region',{name:'英语学习',exact:true})
    await learning.locator('.study-summary').waitFor();assert.equal(await page.getByRole('dialog',{name:'英语学习',exact:true}).count(),0)
    await learning.getByRole('button',{name:'生成今日计划',exact:true}).click();await learning.getByRole('heading',{name:/词汇任务/}).waitFor()
    await learning.locator('.study-tabs').getByText('个人词库',{exact:true}).click();await learning.locator('.study-word-list li').first().waitFor();assert.equal(await learning.locator('.study-word-list li').count(),3)
    await learning.getByRole('button',{name:/来源 /}).first().click();await page.locator('.english-words li').first().waitFor()
    await page.setViewportSize({width:375,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);await page.screenshot({path:output+'/learning-mobile.png',animations:'disabled'});await page.setViewportSize({width:1440,height:1000})
    await go('思维导图');await map().getByRole('button',{name:'新建导图',exact:true}).click()
    const create=page.getByRole('dialog',{name:'新建思维导图',exact:true});await create.getByLabel('新导图名称',{exact:true}).fill('学习导图')
    const creation=page.waitForResponse(response=>/\/mindmaps\/[a-f0-9-]+$/.test(new URL(response.url()).pathname)&&response.request().method()==='PUT'&&response.ok())
    await create.getByRole('button',{name:'创建并保存',exact:true}).click();const first=await(await creation).json();let snapshot=(await call('/mindmaps/'+first.id)).value
    const canvas=map().getByLabel('思维导图画布',{exact:true});await canvas.locator('me-tpc').first().waitFor()
    const editChild=async label=>{await map().getByRole('button',{name:'子节点',exact:true}).click();const editor=canvas.locator('#input-box');await editor.fill(label);await editor.press('Enter')}
    await editChild('词汇');await saved();snapshot=(await call('/mindmaps/'+first.id)).value;assert.equal(snapshot.document.nodeData.children[0].topic,'词汇')
    await map().getByRole('button',{name:'撤销',exact:true}).click();await saved();assert.equal((await call('/mindmaps/'+first.id)).value.document.nodeData.children[0].topic,'新节点')
    await map().getByRole('button',{name:'撤销',exact:true}).click();await saved();assert.equal((await call('/mindmaps/'+first.id)).value.document.nodeData.children.length,0)
    await map().getByRole('button',{name:'重做',exact:true}).click();await saved();await map().getByRole('button',{name:'重做',exact:true}).click();await saved();assert.equal((await call('/mindmaps/'+first.id)).value.document.nodeData.children[0].topic,'词汇')
    // Seed a second branch using the genuine versioned API, then use real pointer dragging.
    snapshot=(await call('/mindmaps/'+first.id)).value
    const document=snapshot.document;document.nodeData.children.push({id:'branch-b',topic:'文章',children:[]})
    assert.equal((await call('/mindmaps/'+first.id,'PUT',{baseVersion:snapshot.version,title:snapshot.title,document})).status,200)
    await go('学习');await go('思维导图');await mapButton(first.id).click();await canvas.getByText('文章',{exact:true}).waitFor()
    const branchA=canvas.locator('me-tpc').filter({hasText:'词汇'}),branchB=canvas.locator('me-tpc').filter({hasText:'文章'})
    const from=await branchA.boundingBox(),to=await branchB.boundingBox()
    await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(from.x+from.width/2+12,from.y+from.height/2+12,{steps:5});await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:20});await page.waitForTimeout(150);await page.mouse.up()
    await saved();snapshot=(await call('/mindmaps/'+first.id)).value
    assert.equal(snapshot.document.nodeData.children.length,1,'drag should move a branch inside the other branch')
    assert.equal(snapshot.document.nodeData.children[0].children[0].topic,'词汇')
    // Export is a real downloaded file; import it as a separate map.
    const download=page.waitForEvent('download');await map().getByRole('button',{name:'导出 JSON',exact:true}).click();const exported=JSON.parse(await readFile(await(await download).path(),'utf8'));assert.deepEqual(exported,snapshot.document)
    await map().locator('input[type=file]').setInputFiles({name:'副本.mindmap.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))})
    await create.getByRole('button',{name:'创建并保存',exact:true}).click();await saved()
    const imported=(await call('/mindmaps?query=副本&page=1')).value.items[0];assert.ok(imported.id!==first.id);assert.deepEqual((await call('/mindmaps/'+imported.id)).value.document,exported)
    await map().getByRole('button',{name:'删除导图',exact:true}).click();await page.getByRole('button',{name:'移入回收站',exact:true}).click();await map().getByRole('button',{name:'导图回收站',exact:true}).click();const restored=page.waitForResponse(response=>response.url().endsWith(`/mindmaps/${imported.id}/restore`)&&response.ok());await map().getByRole('button',{name:'恢复',exact:true}).click();await restored;assert.equal((await call('/mindmaps/'+imported.id)).value.deleted,false)
    assert.deepEqual((await call('/mindmaps/'+imported.id)).value.document,exported)
    await map().getByRole('button',{name:'返回导图',exact:true}).click();await mapButton(first.id).click();await canvas.locator('me-tpc').first().waitFor()
    // Lose an already committed response; preserve its original operation across a page reload.
    const lostPattern=`**/api/v1/mindmaps/${first.id}`;let lost=true
    await page.route(lostPattern,async route=>{if(lost&&route.request().method()==='PUT'){lost=false;await route.fetch();await route.abort('failed')}else await route.continue()})
    await map().getByLabel('导图名称',{exact:true}).fill('保存响应丢失测试');await map().locator('.mindmap-title').getByRole('button',{name:'保存',exact:true}).click()
    await map().getByRole('alert').waitFor();const committed=(await call('/mindmaps/'+first.id)).value
    await page.unroute(lostPattern);page.once('dialog',dialog=>dialog.accept());await page.reload();await go('思维导图');await saved()
    assert.equal((await call('/mindmaps/'+first.id)).value.version,committed.version,'retry must not create another version')
    // A real competing writer must reject an old editor, preserving its local draft.
    snapshot=(await call('/mindmaps/'+first.id)).value;const changed=structuredClone(snapshot.document);changed.nodeData.topic='服务器修改 <img src=x onerror="window.mapProbe=1">'
    await call('/mindmaps/'+first.id,'PUT',{baseVersion:snapshot.version,title:snapshot.title,document:changed})
    await map().getByLabel('导图名称',{exact:true}).fill('本机冲突草稿');await map().locator('.mindmap-title').getByRole('button',{name:'保存',exact:true}).click();await map().getByText('版本冲突，本机草稿保留',{exact:true}).waitFor()
    assert.equal((await call('/mindmaps/'+first.id)).value.title,snapshot.title)
    assert.ok(await page.evaluate(()=>localStorage.getItem('workbench-mindmap-draft:feature-it')?.includes('本机冲突草稿')))
    await map().getByRole('button',{name:'采用服务器版本',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'采用服务器版本',exact:true}).click();await saved()
    assert.equal(await canvas.locator('img').count(),0);assert.equal(await page.evaluate(()=>window.mapProbe),undefined)
    snapshot=(await call('/mindmaps/'+first.id)).value
    const operation=crypto.randomUUID(),request={baseVersion:snapshot.version,title:snapshot.title,document:snapshot.document}
    const once=await call('/mindmaps/'+first.id,'PUT',request,operation),twice=await call('/mindmaps/'+first.id,'PUT',request,operation);assert.deepEqual(once,twice)
    assert.equal((await call('/mindmaps/'+first.id,'PUT',{...request,title:'changed'},operation)).status,409)
    assert.equal((await call('/mindmaps/'+first.id,'PUT',{...request,baseVersion:once.value.version,document:{...request.document,nodeData:{...request.document.nodeData,dangerouslySetInnerHTML:'<img onerror=alert(1)>'}}})).status,400)
    assert.equal((await call('/mindmaps/'+first.id,'PUT',{...request,baseVersion:once.value.version,document:{}})).status,400)
    for(let index=0;index<11;index++)assert.equal((await call('/mindmaps/'+crypto.randomUUID(),'PUT',{baseVersion:'0',title:'分页 '+index,document:exported})).status,200)
    assert.equal((await call('/mindmaps?page=1')).value.items.length,10);assert.ok((await call('/mindmaps?page=2')).value.items.length>0)
    await map().getByRole('button',{name:'刷新列表',exact:true}).click();await map().getByText(/共 13 份/).waitFor()
    await page.setViewportSize({width:375,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);await page.screenshot({path:output+'/mindmap-mobile.png',animations:'disabled'});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:output+'/mindmap-desktop.png',animations:'disabled'})
    const anon=await browser.newContext();assert.equal((await anon.request.get(`http://127.0.0.1:${port}/api/v1/mindmaps`)).status(),401);assert.equal((await anon.request.get(`http://127.0.0.1:${port}/api/v1/mindmaps`,{headers:{Authorization:'Bearer '+credential.token}})).status(),401);await anon.close()
    assert.deepEqual(errors,[])
    // Reload latest persisted state for exact restart comparison.
    snapshot=(await call('/mindmaps/'+first.id)).value;await context.storageState({path:output+'/browser.json'});await writeFile(output+'/result.json',JSON.stringify({id:first.id,snapshot,drag:true,lostResponse:true,conflict:true,errors},null,2))
    console.log('PASS learning and mindmap: real summary/page/source, create/edit/undo/redo/drag, JSON roundtrip/trash, lost response, conflict, paging and auth')
  }
}catch(error){await page?.screenshot({path:output+'/failure-'+phase+'.png',fullPage:true}).catch(()=>{});throw error}
finally{await browser?.close();await server.close()}
