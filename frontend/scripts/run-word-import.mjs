import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'

const phase=process.argv[2],output=process.env.IMPORT_OUTPUT,backend=process.env.IMPORT_BACKEND,port=Number(process.env.IMPORT_FRONTEND_PORT)
assert.ok(output&&port&&/^http:\/\/127\.0\.0\.1:\d+$/.test(backend))
const server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),plugins:[vue()],logLevel:'error',optimizeDeps:{include:['libsodium-wrappers-sumo']},server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':backend}}})
let browser,page
try {
  await server.listen();browser=await chromium.launch({channel:'chrome'})
  const context=await browser.newContext({viewport:{width:1440,height:1000},...(phase==='restart'?{storageState:output+'/browser.json'}:{})})
  page=await context.newPage()
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`http://127.0.0.1:${port}`)
  const call=(path,method='GET',body,operation=crypto.randomUUID())=>page.evaluate(async({path,method,body,operation})=>{
    const{api}=await import('/src/shared/api/client.ts')
    try{return{status:200,value:await api(path,{method,body:body===undefined?undefined:JSON.stringify(body),headers:{'Idempotency-Key':operation}})}}
    catch(error){return{status:error.status,code:error.code}}
  },{path,method,body,operation})
  const study='/home/english/study',games='/home/english/word-games',imports=study+'/words/import'
  const learning=()=>page.getByRole('region',{name:'英语学习',exact:true})
  const choose=(root,label)=>root.locator('.ant-radio-button-wrapper').filter({hasText:new RegExp('^'+label+'$')}).click()
  const open=async()=>{
    await page.locator('.global-sidebar').getByRole('button',{name:'学习',exact:true}).click()
    await page.getByRole('button',{name:'词库与计划',exact:true}).click()
    await learning().locator('.study-summary').waitFor()
    await choose(learning(),'个人词库')
    await learning().getByRole('button',{name:'导入单词',exact:true}).waitFor()
  }
  if(phase==='restart') {
    const saved=JSON.parse(await readFile(output+'/result.json','utf8'))
    assert.deepEqual((await call(imports,'POST',{text:saved.text},saved.operation)).value,saved.result)
    assert.equal((await call(study)).value.words,14)
    const restored=(await call(games+'/'+saved.game.id)).value
    assert.ok(restored.elapsedSeconds>=saved.game.elapsedSeconds)
    const {elapsedSeconds:actualElapsed,...restoredState}=restored
    const {elapsedSeconds:savedElapsed,...savedState}=saved.game
    assert.deepEqual(restoredState,savedState)
    assert.deepEqual((await call(study+'/plans/'+saved.plan.id)).value,saved.plan)
    await open()
    await learning().getByRole('textbox',{name:'搜索学习词库'}).fill('convenient')
    await page.waitForFunction(()=>document.querySelectorAll('.study-word-list>li').length===2)
    await learning().locator('.study-word-details summary').first().click()
    await learning().getByText('手动导入',{exact:true}).first().waitFor()
    await page.screenshot({path:output+'/restart.png',animations:'disabled'})
    console.log('PASS import restart: real MySQL words, receipts, modes, plan and sources survived restart')
  } else {
    assert.equal((await call('/auth/initialize','POST',{username:'import-it',password:process.env.IMPORT_PASSWORD,setupToken:process.env.IMPORT_SETUP_TOKEN})).status,200)
    const invalid='valid: 有效的\r\nmissing separator\nwrong：\n：没有单词'
    const preview=(await call(imports+'-preview','POST',{text:invalid})).value
    assert.equal(preview.invalid,3);assert.equal(preview.newWords,1)
    assert.equal((await call(imports,'POST',{text:invalid})).status,400)
    assert.equal((await call(study)).value.words,0)
    assert.equal((await call(imports+'-preview','POST',{text:' \n '})).status,400)
    assert.equal((await call(imports+'-preview','POST',{text:Array(501).fill('word：词义').join('\n')})).status,400)
    await page.reload();await open()
    await learning().getByRole('button',{name:'导入单词',exact:true}).click()
    const dialog=()=>page.getByRole('dialog',{name:'导入单词',exact:true})
    await dialog().getByRole('textbox',{name:'单词与释义'}).fill(invalid)
    await dialog().getByRole('button',{name:'预览',exact:true}).click()
    await dialog().getByText('错误 3',{exact:true}).waitFor()
    assert.equal(await dialog().getByRole('button',{name:'确认导入',exact:true}).isEnabled(),false)
    const text='convenient：方便的\nimprove: 提高；改善\nlook forward to：期待\nput off：推迟\nachieve：实现\nborrow：借入\nconfident：自信的\ndecide：决定\nenough：足够的\nfollow：跟随\ngather：聚集\nhabit：习惯\nconvenient：方便的\n CONVENIENT : 方便的 \nconvenient：便利的'
    await dialog().getByRole('textbox',{name:'单词与释义'}).fill(text)
    await dialog().getByRole('button',{name:'预览',exact:true}).click()
    await dialog().getByText('新增 13',{exact:true}).waitFor();await dialog().getByText('重复 2',{exact:true}).waitFor()
    assert.equal((await call(study)).value.words,0,'preview must not import vocabulary')
    await page.screenshot({path:output+'/preview.png',animations:'disabled'})
    await page.mouse.click(10,10);assert.equal(await dialog().isVisible(),true)
    let operation,result
    const pattern='**/api/v1'+imports
    await page.route(pattern,async route=>{
      operation=route.request().headers()['idempotency-key']
      const response=await route.fetch();result=await response.json()
      assert.equal(response.status(),200);await route.abort('failed')
    })
    await dialog().getByRole('button',{name:'确认导入',exact:true}).click()
    await page.waitForFunction(()=>document.querySelector('.word-import .ant-alert-error')!==null)
    await page.unroute(pattern);await page.reload();await open()
    await learning().getByRole('button',{name:'导入单词',exact:true}).click()
    await dialog().getByRole('button',{name:'重试原导入',exact:true}).click()
    await dialog().waitFor({state:'hidden'})
    assert.deepEqual(result,{added:13,skipped:2})
    assert.equal((await call(imports,'POST',{text:'different：不同的'},operation)).status,409)
    const same=await Promise.all([call(imports,'POST',{text}),call(imports,'POST',{text})])
    same.forEach(value=>assert.deepEqual(value.value,{added:0,skipped:15}))
    const list=(await call(study+'/items')).value
    assert.equal(list.total,13);assert.ok(list.items.every(item=>item.manuallyImported&&item.sources.length===0))
    const today=(await call('/home/english')).value
    assert.equal(today.total,0,'imports must not create received batches')
    await page.waitForFunction(()=>document.querySelectorAll('.study-word-list>li').length===10)
    assert.match(await learning().locator('.study-pagination').innerText(),/第 1 \/ 2 页/)
    await page.screenshot({path:output+'/vocabulary.png',animations:'disabled'})
    await learning().locator('.study-pagination').getByRole('button',{name:'下一页',exact:true}).click()
    await page.waitForFunction(()=>document.querySelectorAll('.study-word-list>li').length===3)
    await page.setViewportSize({width:375,height:844})
    await learning().getByRole('button',{name:'导入单词',exact:true}).click()
    await dialog().getByRole('textbox',{name:'单词与释义'}).fill(text)
    await dialog().getByRole('button',{name:'预览',exact:true}).click()
    await dialog().getByText('重复 15',{exact:true}).waitFor()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:output+'/mobile-preview.png',animations:'disabled'})
    await dialog().getByRole('button',{name:'关闭',exact:true}).click()
    await page.setViewportSize({width:1440,height:1000})
    const creation=page.waitForResponse(response=>response.url().endsWith('/word-games')&&response.request().method()==='POST')
    await learning().getByRole('button',{name:'开始挑战',exact:true}).click()
    const game=(await(await creation).json())
    assert.equal(game.batchId,null);assert.equal(game.sourceCount,13);assert.equal(game.words.length,6)
    const challenge=page.getByRole('dialog',{name:'单词挑战',exact:true})
    const word=game.words[0]
    await challenge.locator(`[data-word-choice="${word.id}"]`).click()
    await challenge.locator(`[data-meaning-choice="${word.id}"]`).click()
    await challenge.getByText('本轮答题已同步',{exact:true}).waitFor()
    const savedGame=(await call(games+'/'+game.id)).value
    assert.equal(savedGame.matched.length,1)
    const progressBefore=(await call(study+'/items?query='+encodeURIComponent(word.label))).value.items
    assert.ok(progressBefore.some(item=>item.progress.length>0))
    await call(imports,'POST',{text})
    assert.deepEqual((await call(study+'/items?query='+encodeURIComponent(word.label))).value.items,progressBefore)
    await challenge.getByRole('button',{name:'暂时关闭',exact:true}).click()
    const plan=(await call(study+'/plans','POST')).value
    assert.equal(plan.batchId,null);assert.ok(plan.vocabulary.length>0)
    const planGame=(await call(games,'POST',{batchId:null,mode:'spelling',studyPlanId:plan.id})).value
    assert.ok(planGame.spellingPrompt);assert.equal(planGame.batchId,null)
    const spelling=(await call(games,'POST',{batchId:null,mode:'spelling'})).value
    const target=spelling.words.find(item=>item.id===spelling.spellingPrompt.wordId)
    const answer={baseRevision:spelling.revision,wordId:target.id,spelling:target.label}
    const answered=await call(games+'/'+spelling.id+'/answers','POST',answer)
    assert.equal(answered.value.feedback.correct,true)
    await call(imports,'POST',{text:'notice：注意到'})
    assert.deepEqual((await call(study+'/plans','POST')).value,(await call(study+'/plans/'+plan.id)).value)
    assert.ok(!(await call(study+'/plans/'+plan.id)).value.vocabulary.some(word=>word.word==='notice'),'fixed plan must not be changed by import')
    const hook=(await call('/home/english/webhook')).value
    const credential=(await call('/home/english/webhook','POST',{baseRevision:hook.revision,action:'rotate'})).value
    const pushed=await context.request.post(`http://127.0.0.1:${port}/api/v1/hooks/english`,{headers:{Authorization:'Bearer '+credential.token},data:{requestId:'import-compatibility',articles:[],words:[{word:'convenient',phonetic:'/kənˈviːniənt/',meaning:'方便的',example:'It is convenient.'}]}})
    assert.equal(pushed.status(),200)
    const receipt=await pushed.json()
    const batchGame=(await call(games,'POST',{batchId:receipt.id,mode:'matching'})).value
    assert.equal(batchGame.batchId,receipt.id)
    const batchTarget=batchGame.words[0]
    assert.equal((await call(games+'/'+batchGame.id+'/answers','POST',{baseRevision:batchGame.revision,wordId:batchTarget.id,meaningId:batchTarget.id})).value.completed,true)
    const combined=(await call(study+'/items?query=convenient')).value
    assert.equal(combined.total,2);assert.ok(combined.items.some(item=>item.sources.length===1&&item.manuallyImported))
    await writeFile(output+'/result.json',JSON.stringify({text,operation,result,game:(await call(games+'/'+savedGame.id)).value,plan:(await call(study+'/plans/'+plan.id)).value}))
    await context.storageState({path:output+'/browser.json'})
    console.log('PASS real import: validation/atomic rejection, duplicates, receipt recovery after lost response, library/plan games without batches, stable progress and push compatibility')
  }
  assert.deepEqual(errors,[])
} catch(error) {
  if(page)await page.screenshot({path:output+'/failure-'+phase+'.png',fullPage:true}).catch(()=>{})
  throw error
} finally { if(browser)await browser.close();await server.close() }
