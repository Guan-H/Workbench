import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'

const phase=process.argv[2], output=process.env.READING_OUTPUT, backend=process.env.READING_BACKEND
const port=Number(process.env.READING_FRONTEND_PORT)
assert.ok(output&&port&&/^http:\/\/127\.0\.0\.1:\d+$/.test(backend))
const server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),plugins:[vue()],
  logLevel:'error',optimizeDeps:{include:['libsodium-wrappers-sumo']},
  server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':backend}}})
let browser,page
try {
  await server.listen()
  browser=await chromium.launch({channel:'chrome'})
  const context=await browser.newContext({viewport:{width:1440,height:1000},...(phase==='restart'?{storageState:output+'/browser.json'}:{})})
  page=await context.newPage()
  const errors=[]
  page.on('pageerror',error=>errors.push(error.stack||error.message))
  page.on('dialog',async dialog=>{errors.push('Unexpected native dialog: '+dialog.type());await dialog.dismiss()})
  await page.goto('http://127.0.0.1:'+port)
  const call=(path,method='GET',body,operation=crypto.randomUUID())=>page.evaluate(async args=>{
    const {api}=await import('/src/shared/api/client.ts')
    try{return{status:200,value:await api(args.path,{method:args.method,body:args.body===undefined?undefined:JSON.stringify(args.body),headers:{'Idempotency-Key':args.operation}})}}
    catch(error){return{status:error.status,code:error.code,message:error.message}}
  },{path,method,body,operation})
  const base='/home/english/courses'
  const choose=async name=>page.locator('.learning-page > header .ant-radio-button-wrapper').filter({hasText:new RegExp('^'+name+'$')}).click()
  const openReading=async()=>{
    await page.locator('.global-sidebar').getByRole('button',{name:'学习',exact:true}).click()
    await choose('阅读')
    await page.getByRole('button',{name:'添加文章',exact:true}).waitFor()
  }
  const all=async()=>{
    const first=(await call(base)).value
    let items=[...first.items]
    for(let page=2;items.length<first.total;page++)items.push(...(await call(base+'?page='+page)).value.items)
    return items
  }
  const waitSync=async()=>{
    const end=Date.now()+40000
    let status
    do {
      status=(await call(base+'/sources')).value
      if(!status.running)break
      await new Promise(resolve=>setTimeout(resolve,250))
    }while(Date.now()<end)
    assert.equal(status.running,false)
    assert.equal(status.error,null,JSON.stringify(status))
    return status
  }
  if(phase==='restart'){
    const saved=JSON.parse(await readFile(output+'/result.json','utf8'))
    const detail=(await call(base+'/'+saved.manual.summary.id)).value
    assert.deepEqual(detail,saved.manual)
    const items=await all()
    for(const id of saved.nasaIds)assert.ok(items.some(item=>item.id===id),'remote source must persist')
    const status=(await call(base+'/sources')).value
    assert.equal(status.enabled,false)
    assert.ok(status.lastSuccessAt)
    assert.equal(status.error,null)
    await openReading()
    await page.locator('.course-card').filter({has:page.getByRole('heading',{name:saved.manual.summary.title,exact:true})}).getByRole('button',{name:'继续阅读',exact:true}).click()
    await page.getByRole('button',{name:'取消收藏',exact:true}).waitFor()
    console.log('PASS reading import restart: manual content, source attribution, favorites and actual NASA text persist')
  }else{
    const anon=await browser.newContext()
    assert.equal((await anon.request.get('http://127.0.0.1:'+port+'/api/v1'+base+'/sources')).status(),401)
    await anon.close()
    assert.equal((await call('/auth/initialize','POST',{username:'reading-import-it',password:process.env.READING_PASSWORD,setupToken:process.env.READING_SETUP_TOKEN})).status,200)
    assert.equal((await call(base+'/sources')).value.enabled,false)
    const request={title:'A concurrent reading check',text:'A good reading habit starts with a short text.',translation:null,sourceUrl:null}
    const operation=crypto.randomUUID()
    const concurrent=await Promise.all([call(base,'POST',request,operation),call(base,'POST',request,operation)])
    concurrent.forEach(value=>assert.equal(value.status,200,JSON.stringify(value)))
    assert.equal(concurrent[0].value.summary.id,concurrent[1].value.summary.id)
    assert.equal((await call(base,'POST',{...request,text:'Changed text.'},operation)).status,409)
    assert.equal((await call(base,'POST',{...request,title:' '.repeat(3)})).status,400)
    assert.equal((await call(base,'POST',{...request,text:'x'.repeat(100001)})).status,400)
    assert.equal((await call(base,'POST',{...request,sourceUrl:'https://user:password@example.com/'})).status,400)
    await page.reload();await openReading()
    await page.getByRole('button',{name:'添加文章',exact:true}).click()
    const dialog=()=>page.getByRole('dialog',{name:'添加阅读文章'})
    await dialog().waitFor()
    await page.mouse.click(5,5)
    assert.ok(await dialog().isVisible())
    await page.getByLabel('标题',{exact:true}).fill('My own short article')
    const body='A clear sentence helps us understand a new idea.\n<script>window.readingInjection=true</script>\nWe can read it again tomorrow.'
    await page.getByLabel('原文',{exact:true}).fill(body)
    await page.getByLabel('来源链接（可选）',{exact:true}).fill('javascript:alert(1)')
    await dialog().getByRole('button',{name:'保存文章',exact:true}).click()
    await dialog().getByText('来源链接请使用不含账号密码的 HTTP 或 HTTPS 地址。',{exact:true}).waitFor()
    assert.equal(await page.getByLabel('原文',{exact:true}).inputValue(),body)
    await page.getByLabel('来源链接（可选）',{exact:true}).fill('https://example.com/my-reading')
    let lost=true
    await page.route('**/api/v1/home/english/courses',async route=>{
      if(lost&&route.request().method()==='POST'){lost=false;await route.fetch();await route.abort('failed')}
      else await route.continue()
    })
    await dialog().getByRole('button',{name:'保存文章',exact:true}).click()
    await dialog().getByRole('button',{name:'重试原保存',exact:true}).waitFor()
    assert.ok(await page.getByLabel('原文',{exact:true}).isDisabled())
    await page.reload();await openReading()
    await page.getByRole('button',{name:'添加文章',exact:true}).click()
    assert.equal(await page.getByLabel('原文',{exact:true}).inputValue(),body)
    await dialog().getByRole('button',{name:'重试原保存',exact:true}).click()
    await page.locator('.course-learning > h2').waitFor()
    await page.unroute('**/api/v1/home/english/courses')
    assert.equal(await page.evaluate(()=>window.readingInjection),undefined)
    assert.equal(await page.getByRole('button',{name:'随手练习',exact:true}).count(),0)
    await page.getByRole('button',{name:'收藏文章',exact:true}).click()
    await page.getByRole('button',{name:'取消收藏',exact:true}).waitFor()
    const manualSummary=(await all()).find(item=>item.title==='My own short article')
    const manual=(await call(base+'/'+manualSummary.id)).value
    assert.equal(manual.article.text,body)
    assert.equal(manual.article.translation,null)
    assert.equal(manual.origin.url,'https://example.com/my-reading')
    assert.equal((await all()).filter(item=>item.kind==='manual').length,2)
    await page.screenshot({path:output+'/manual-desktop.png',animations:'disabled'})
    await page.setViewportSize({width:375,height:844})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:output+'/manual-mobile.png',animations:'disabled'})
    await page.setViewportSize({width:1440,height:1000})
    await page.getByRole('button',{name:'返回列表',exact:true}).click()
    await page.getByRole('button',{name:'内容来源',exact:true}).click()
    const sources=page.getByRole('dialog',{name:'阅读内容来源'})
    await sources.getByText('自动同步已关闭',{exact:true}).waitFor()
    const started=page.waitForResponse(response=>response.url().endsWith('/courses/sources/nasa/sync')&&response.request().method()==='POST')
    await sources.getByRole('button',{name:'立即同步',exact:true}).click()
    assert.equal((await started).status(),200)
    const first=await waitSync()
    assert.ok(first.added>0,'real remote article required: '+JSON.stringify(first))
    const nasa=(await all()).filter(item=>item.kind==='nasa')
    assert.ok(nasa.length>0)
    const remote=(await call(base+'/'+nasa[0].id)).value
    assert.equal(remote.article.translation,null)
    assert.ok(remote.article.text.length>100)
    assert.ok(!remote.article.text.includes('<script'))
    assert.ok(['www.nasa.gov','science.nasa.gov'].includes(new URL(remote.origin.url).hostname))
    await sources.getByRole('button',{name:'刷新状态',exact:true}).click()
    await sources.getByText('自动同步已关闭',{exact:true}).waitFor()
    await page.screenshot({path:output+'/sources-desktop.png',animations:'disabled'})
    await call(base+'/sources/nasa/sync','POST')
    const repeated=await waitSync()
    assert.equal(repeated.added,0)
    assert.ok(repeated.skipped>0)
    const config=(await call(base+'/sources')).value
    assert.equal((await call(base+'/sources/nasa','PUT',{baseRevision:config.revision,enabled:false})).status,200)
    assert.equal((await call(base+'/sources/nasa','PUT',{baseRevision:config.revision,enabled:true})).status,409)
    await context.storageState({path:output+'/browser.json'})
    await writeFile(output+'/result.json',JSON.stringify({manual,nasaIds:nasa.map(item=>item.id)}))
    console.log('PASS real reading import: conditional creation, native-dialog-free modal, preserved unknown request, actual NASA HTTP import and deduplication')
  }
  assert.deepEqual(errors,[])
}catch(error){
  await page?.screenshot({path:output+'/failure-'+phase+'.png',fullPage:true}).catch(()=>{})
  throw error
}finally{await browser?.close();await server.close()}
