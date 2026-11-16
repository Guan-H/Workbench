import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
const phase=process.argv[2],output=process.env.LEDGER_OUTPUT,backend=process.env.LEDGER_BACKEND,port=Number(process.env.LEDGER_FRONTEND_PORT)
assert.ok(output&&port&&/^http:\/\/127\.0\.0\.1:\d+$/.test(backend))
const server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),plugins:[vue()],logLevel:'error',optimizeDeps:{include:['libsodium-wrappers-sumo']},server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':backend}}})
let browser,page
try{
  await server.listen();browser=await chromium.launch({channel:'chrome'})
  const context=await browser.newContext({viewport:{width:1440,height:1000},...(phase==='restart'?{storageState:output+'/browser.json'}:{})})
  page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`http://127.0.0.1:${port}`)
  const call=(path,method='GET',body,operation=crypto.randomUUID())=>page.evaluate(async({path,method,body,operation})=>{
    const{api}=await import('/src/shared/api/client.ts')
    try{return{status:200,value:await api(path,{method,body:body===undefined?undefined:JSON.stringify(body),headers:{'Idempotency-Key':operation}})}}catch(error){return{status:error.status,code:error.code}}
  },{path,method,body,operation})
  const root='/home/calendar',ledger=root+'/ledger',month='2026-11'
  const stats=async()=>{const result=await call(ledger+'?month='+month);assert.equal(result.status,200);return result.value}
  if(phase==='restart'){
    const saved=JSON.parse(await readFile(output+'/result.json','utf8'))
    assert.deepEqual(await stats(),saved.summary)
    assert.deepEqual((await call(ledger+'/opening','PUT',saved.change,saved.operation)).value,saved.opening)
    assert.deepEqual((await call(root+'/records?month='+month)).value.days,saved.days)
    console.log('PASS real calendar restart: totals, opening receipt, calendar markers and time-off survived restart')
  }else{
    assert.equal((await call('/auth/initialize','POST',{username:'ledger-it',password:process.env.LEDGER_PASSWORD,setupToken:process.env.LEDGER_SETUP_TOKEN})).status,200)
    const overtime=(date,start,end,minutes)=>({baseVersion:'0',kind:'overtime',date,title:'测试加班',notes:'虚构验收记录',time:null,completed:false,start:date+'T'+start,end,overtimeMinutes:minutes})
    const saveRecord=async(body)=>{const result=await call(root+'/records/'+crypto.randomUUID(),'PUT',body);assert.equal(result.status,200,JSON.stringify(result));return result.value}
    const old=await saveRecord(overtime('2026-10-31','22:00','2026-11-01T02:00',240))
    const november=await saveRecord(overtime('2026-11-02','18:00','2026-11-03T04:00',600))
    assert.equal((await stats()).monthly.overtimeMinutes,600)
    assert.equal((await stats()).cumulative.overtimeMinutes,840)
    assert.equal((await stats()).opening.startDate,null)
    const invalid={baseVersion:'0',kind:'time-off',date:'2026-11-16',title:'调休',notes:'',time:null,completed:false,start:null,end:null,overtimeMinutes:null,timeOffMinutes:0}
    assert.equal((await call(root+'/records/'+crypto.randomUUID(),'PUT',invalid)).status,400)
    await page.reload()
    await page.getByRole('button',{name:'添加记录',exact:true}).click()
    const editor=page.getByRole('dialog',{name:'日历记录',exact:true})
    await editor.locator('.ant-radio-button-wrapper').filter({hasText:/^调休$/}).click()
    await editor.getByLabel('调休日期',{exact:true}).fill('2026-11-16')
    await editor.locator('.ant-radio-button-wrapper').filter({hasText:'天（8小时）'}).click()
    await editor.getByRole('spinbutton',{name:'调休时长',exact:true}).fill('0.5')
    await editor.getByRole('button',{name:'保存记录',exact:true}).click();await editor.waitFor({state:'hidden'})
    await page.waitForFunction(()=>document.querySelector('.work-stats')?.textContent.includes('4小时'))
    assert.equal((await stats()).monthly.timeOffMinutes,240)
    const records=(await call(root+'/records?month='+month)).value
    const off=records.items.find(item=>item.kind==='time-off');assert.equal(off.timeOffMinutes,240)
    assert.equal(records.days.find(day=>day.date==='2026-11-16').timeOffMinutes,240)
    const day=page.locator('[data-calendar-date="2026-11-16"]');await day.hover()
    await page.getByText('调休 · 4小时',{exact:true}).waitFor()
    await page.mouse.move(10,10)
    await page.screenshot({path:output+'/home.png',animations:'disabled'})
    const home=await page.locator('.home-content').evaluate(el=>({bottom:el.getBoundingClientRect().bottom,height:innerHeight,recordHeight:document.querySelector('.calendar-record-list').clientHeight}))
    assert.ok(home.bottom<=home.height+1,JSON.stringify(home));assert.ok(home.recordHeight>30)
    await page.getByRole('button',{name:'历史统计',exact:true}).click()
    const history=page.getByRole('dialog',{name:'历史工时统计',exact:true})
    await history.getByRole('button',{name:'设置期初余额',exact:true}).click()
    const opening=()=>page.getByRole('dialog',{name:'设置期初余额',exact:true})
    await opening().getByLabel('起算日期',{exact:true}).fill('2026-11-01')
    await opening().getByRole('spinbutton',{name:'期初可调休时长（小时）',exact:true}).fill('16')
    await opening().getByRole('button',{name:'预览计算',exact:true}).click()
    await opening().getByText('保存后的余额：22小时',{exact:true}).waitFor()
    await page.screenshot({path:output+'/opening-preview.png',animations:'disabled'})
    let change,operation
    const pattern='**/api/v1'+ledger+'/opening'
    await page.route(pattern,async route=>{change=route.request().postDataJSON();operation=route.request().headers()['idempotency-key'];const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed')})
    await opening().getByRole('button',{name:'确认保存',exact:true}).click()
    await opening().locator('.ant-alert-error').waitFor()
    await page.unroute(pattern);await page.reload()
    await page.getByRole('button',{name:'历史统计',exact:true}).click()
    await history.getByRole('button',{name:'修改期初余额',exact:true}).click()
    await opening().getByRole('button',{name:'重试原保存',exact:true}).click();await opening().waitFor({state:'hidden'})
    assert.equal((await stats()).netMinutes,1320)
    assert.equal((await stats()).opening.version,1)
    assert.equal((await call(ledger+'/opening','PUT',{...change,openingMinutes:0},operation)).status,409)
    const current=await stats()
    const proposed={baseVersion:'1',recordsRevision:current.recordsRevision,startDate:'2026-11-01',openingMinutes:960}
    assert.equal((await call(ledger+'/opening-preview','POST',proposed)).status,200)
    const modified={...invalid,baseVersion:off.version,timeOffMinutes:480}
    assert.equal((await call(root+'/records/'+off.id,'PUT',modified)).status,200)
    assert.equal((await call(ledger+'/opening','PUT',proposed)).status,409)
    assert.equal((await stats()).netMinutes,1080)
    assert.equal((await call(root+'/records/'+off.id+'/delete','POST',{baseVersion:'2'})).status,200)
    assert.equal((await stats()).netMinutes,1560)
    const huge=await saveRecord({...invalid,timeOffMinutes:1800})
    assert.equal((await stats()).netMinutes,-240,'negative balances must not be clipped')
    for(let i=1;i<=11;i++) await saveRecord(overtime(`2025-${String(i).padStart(2,'0')}-01`,'18:00',`2025-${String(i).padStart(2,'0')}-01T19:00`,60))
    const hist=(await call(ledger+'/history')).value;assert.equal(hist.total,13);assert.equal(hist.items.length,10)
    assert.equal((await call(ledger+'/history?page=2')).value.items.length,3)
    await history.getByRole('button',{name:'关闭历史统计',exact:true}).click()
    await page.getByRole('button',{name:'历史统计',exact:true}).click()
    await history.getByText('共 13 个月 · 10个月/页',{exact:true}).waitFor()
    await history.getByRole('button',{name:'下一页',exact:true}).click()
    await history.getByText('第 2 / 2 页',{exact:true}).waitFor()
    await page.screenshot({path:output+'/history.png',animations:'disabled'})
    await page.setViewportSize({width:375,height:844})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:output+'/mobile-history.png',animations:'disabled'})
    await history.getByRole('button',{name:'关闭历史统计',exact:true}).click()
    await page.screenshot({path:output+'/mobile-home.png',animations:'disabled'})
    await writeFile(output+'/result.json',JSON.stringify({summary:await stats(),change,operation,opening:(await stats()).opening,days:(await call(root+'/records?month='+month)).value.days}))
    await context.storageState({path:output+'/browser.json'})
    assert.ok(old.id&&november.id&&huge.id)
    console.log('PASS real calendar ledger: hours/days, cross-month, positive/negative balances, version conflicts, lost-response retry, historical pagination and unchanged records')
  }
  assert.deepEqual(errors,[])
}catch(error){if(page)await page.screenshot({path:output+'/failure-'+phase+'.png',fullPage:true}).catch(()=>{});throw error}
finally{if(browser)await browser.close();await server.close()}
