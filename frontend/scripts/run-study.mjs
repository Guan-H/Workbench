import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'

const phase=process.argv[2],output=process.env.WORD_GAME_OUTPUT,backend=process.env.WORD_GAME_BACKEND,port=Number(process.env.WORD_GAME_FRONTEND_PORT)
assert.ok(output&&port&&/^http:\/\/127\.0\.0\.1:\d+$/.test(backend))
const server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),plugins:[vue()],logLevel:'error',optimizeDeps:{include:['libsodium-wrappers-sumo']},server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':backend}}})
let browser,page
try{
  await server.listen();browser=await chromium.launch({channel:'chrome'})
  const context=await browser.newContext({viewport:{width:1440,height:1000},...(phase!=='play'?{storageState:output+'/browser.json'}:{})})
  page=await context.newPage()
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`http://127.0.0.1:${port}`)
  const call=(path,method='GET',body,operation=crypto.randomUUID())=>page.evaluate(async({path,method,body,operation})=>{
    const{api}=await import('/src/shared/api/client.ts')
    try{return{status:200,value:await api(path,{method,body:body===undefined?undefined:JSON.stringify(body),headers:{'Idempotency-Key':operation}})}}
    catch(error){return{status:error.status,code:error.code}}
  },{path,method,body,operation})
  const study='/home/english/study',games='/home/english/word-games'
  const openStudy=async()=>{await page.locator('.global-sidebar').getByRole('button',{name:'学习',exact:true}).click();await page.getByRole('button',{name:'今日学习与词库',exact:true}).click();await learning().locator('.study-summary').waitFor()}
  const learning=()=>page.getByRole('region',{name:'英语学习',exact:true})
  const closeStudy=()=>learning().getByRole('button',{name:'返回每日文章',exact:true}).click()
  const chooseRadio=(root,name)=>root.locator('.ant-radio-button-wrapper').filter({hasText:new RegExp('^'+name+'$')}).click()
  const studyTab=name=>chooseRadio(learning(),name)
  const push=async(payload,token)=>{
    const response=await context.request.post(`http://127.0.0.1:${port}/api/v1/hooks/english`,{headers:{Authorization:'Bearer '+token},data:payload})
    return{status:response.status(),value:await response.json()}
  }
  if(phase==='restart'){
    const saved=JSON.parse(await readFile(output+'/result.json','utf8'))
    const dashboard=(await call(study)).value
    assert.equal(dashboard.plan.id,saved.plan.id)
    assert.deepEqual(dashboard.plan.tasks,saved.plan.tasks)
    assert.equal((await call(games+'/'+saved.gameId)).value.completed,true)
    assert.equal((await push(saved.legacy,saved.token)).value.duplicate,true)
    await openStudy();await studyTab('短句练习')
    await learning().getByText('自评已保存：需要改进。后续复习已安排。',{exact:true}).waitFor()
    console.log('PASS study restart: exact persisted plan/tasks, self-assessments, word game and old-format receipt survived a real backend restart')
  }else if(phase==='review'){
    const before=(await call(study)).value;assert.equal(before.plan,null)
    const created=await call(study+'/plans','POST');assert.equal(created.status,200)
    assert.ok(created.value.tasks.some(task=>task.kind==='review'))
    assert.ok(created.value.tasks.some(task=>task.mode==='en-zh'))
    for(const mode of ['matching','spelling']){
      const reviews=created.value.tasks.filter(task=>task.kind==='review'&&task.mode===mode)
      if(!reviews.length)continue
      const round=(await call(games,'POST',{batchId:created.value.batchId,mode,studyPlanId:created.value.id})).value
      assert.ok(round.words.length>0)
      for(const word of round.words)assert.ok(reviews.some(task=>task.prompt===word.label),'due reviews must precede new vocabulary')
    }
    console.log('PASS study review: real date-shift fixture selects due word/sentence tasks and rounds prioritize pending reviews over new vocabulary')
  }else{
    assert.equal((await call('/auth/initialize','POST',{username:'study-it',password:process.env.WORD_GAME_PASSWORD,setupToken:process.env.WORD_GAME_SETUP_TOKEN})).status,200)
    const state=(await call('/home/english/webhook')).value
    const credential=(await call('/home/english/webhook','POST',{baseRevision:state.revision,action:'rotate'})).value
    const words=['apple','bright','create','dream','effort','future'].map((word,index)=>({word,phonetic:null,meaning:'测试释义'+index,example:'We use '+word+' today.'}))
    const legacy={requestId:'study-old',date:'2000-01-01',articles:[{title:'Legacy article',text:'Keep learning.',translation:'坚持学习。'}],words}
    assert.equal((await push(legacy,credential.token)).status,200)
    const sentences=[{text:'Learning takes time.',translation:'学习需要时间。'},{text:'Small steps help.',translation:'小小的进步也有帮助。'}]
    const payload={requestId:'study-paired',articles:[{title:'Paired article',text:'Learning takes time. Small steps help.',translation:'学习需要时间。小小的进步也有帮助。',sentences}],words:[...words,{word:'apple',phonetic:null,meaning:'另一种释义',example:'Another apple.'}]}
    const received=await push(payload,credential.token);assert.equal(received.status,200)
    assert.equal((await push(legacy,credential.token)).value.duplicate,true)
    assert.equal((await push({...payload,requestId:'bad-pair',articles:[{...payload.articles[0],text:'Unrelated full text.'}]},credential.token)).value.code,'SENTENCE_TEXT_MISMATCH')
    await page.reload();await page.locator('.global-sidebar').getByRole('button',{name:'学习',exact:true}).click();await page.getByText('Paired article',{exact:true}).waitFor()
    await chooseRadio(page,'双语对照')
    assert.equal(await page.getByLabel('逐句英中对照').locator('li').count(),2)
    assert.equal(await page.getByRole('button',{name:'朗读第 1 句',exact:true}).count(),1)
    await page.screenshot({path:output+'/bilingual.png'})
    const dashboard=(await call(study)).value
    assert.equal(dashboard.words,7);assert.equal(dashboard.sentences,2)
    assert.equal(dashboard.settings.newLimit,10);assert.equal(dashboard.settings.reviewLimit,20);assert.equal(dashboard.settings.sentenceLimit,3)
    assert.equal((await call(study+'/settings','PUT',{baseRevision:dashboard.settings.revision,newLimit:2,reviewLimit:2,sentenceLimit:1})).status,200)
    const emptyVocabulary=(await call(study+'/items')).value
    assert.ok(emptyVocabulary.items.some(item=>item.sources.length===2))
    assert.equal(emptyVocabulary.total,7)
    await openStudy()
    await learning().getByRole('button',{name:'生成今日计划',exact:true}).click()
    await learning().getByRole('heading',{name:/词汇任务 0 \/ 4/}).waitFor()
    let plan=(await call(study)).value.plan
    assert.equal(plan.tasks.filter(task=>task.kind==='sentence').length,2)
    assert.equal(plan.tasks.filter(task=>task.kind==='sentence')[0].reference,null)
    const originalPlan=plan.id
    assert.equal((await call(study+'/plans','POST')).value.id,originalPlan)
    const create=page.waitForResponse(response=>response.url().endsWith('/word-games')&&response.request().method()==='POST'&&response.ok())
    await learning().getByRole('button',{name:'开始挑战',exact:true}).click()
    let game=await(await create).json()
    const challenge=page.getByRole('dialog',{name:'单词挑战',exact:true})
    assert.equal(game.words.length,2)
    const answer=async(wordId,meaningId)=>{
      await challenge.locator(`[data-word-choice="${wordId}"]`).click();await challenge.locator(`[data-meaning-choice="${meaningId}"]`).click()
      await challenge.getByText('本轮答题已同步',{exact:true}).waitFor()
    }
    await answer(0,1)
    for(const id of [0,1])await answer(id,id)
    assert.equal((await call(games+'/'+game.id)).value.completed,true)
    await challenge.locator('.word-game-footer button').click()
    await learning().getByRole('heading',{name:/词汇任务 2 \/ 4/}).waitFor()
    await chooseRadio(learning(),'拼写')
    const spellCreate=page.waitForResponse(response=>response.url().endsWith('/word-games')&&response.request().method()==='POST'&&response.ok())
    await learning().getByRole('button',{name:'开始挑战',exact:true}).click()
    const spelling=await(await spellCreate).json()
    const spellingInput=challenge.getByRole('textbox',{name:'英文拼写',exact:true})
    await spellingInput.fill(spelling.words[0].label);await spellingInput.press('Enter')
    await challenge.getByText('本轮答题已同步',{exact:true}).waitFor()
    await challenge.locator('.word-game-footer button').click();await closeStudy();await openStudy()
    await chooseRadio(learning(),'拼写')
    await learning().getByRole('button',{name:'继续挑战',exact:true}).click()
    await challenge.getByRole('textbox',{name:'英文拼写',exact:true}).fill(spelling.words[1].label)
    await challenge.getByRole('textbox',{name:'英文拼写',exact:true}).press('Enter')
    await challenge.getByText('本轮答题已同步',{exact:true}).waitFor()
    await challenge.locator('.word-game-footer button').click()
    await learning().getByRole('heading',{name:/词汇任务 4 \/ 4/}).waitFor()
    await studyTab('累计错词');await learning().locator('.study-word-list li').first().waitFor()
    assert.equal(await learning().locator('.study-word-list li').count(),2)
    await studyTab('短句练习')
    const translation=learning().getByRole('textbox',{name:'我的译文',exact:true})
    await translation.fill('我的测试译文')
    await learning().getByRole('button',{name:'保存译文草稿',exact:true}).click()
    await learning().getByText('服务器译文已保存',{exact:true}).waitFor()
    await closeStudy();await openStudy();await studyTab('短句练习')
    assert.equal(await translation.inputValue(),'我的测试译文')
    await learning().getByRole('button',{name:'提交并查看参考译文',exact:true}).click()
    await learning().getByRole('heading',{name:'参考译文',exact:true}).waitFor()
    await learning().getByRole('button',{name:'需要改进',exact:true}).click()
    await learning().getByText('自评已保存：需要改进。后续复习已安排。',{exact:true}).waitFor()
    await chooseRadio(learning(),'中译英')
    assert.equal(await learning().getByRole('button',{name:'朗读参考英文',exact:true}).count(),0)
    await translation.fill('A different expression for my practice.')
    await learning().getByRole('button',{name:'提交并查看参考译文',exact:true}).click()
    await learning().getByRole('button',{name:'朗读参考英文',exact:true}).waitFor()
    const taskPattern='**/study/tasks/*'
    let lose=true
    await page.route(taskPattern,async route=>{
      if(lose&&route.request().postDataJSON()?.action==='rate'){lose=false;await route.fetch();await route.abort('failed')}
      else await route.continue()
    })
    await learning().getByRole('button',{name:'基本表达正确',exact:true}).click()
    await learning().getByRole('button',{name:'重试保存',exact:true}).waitFor()
    await closeStudy();await openStudy();await studyTab('短句练习')
    await chooseRadio(learning(),'中译英')
    await learning().getByText('自评已保存：基本表达正确。后续复习已安排。',{exact:true}).waitFor()
    await page.unroute(taskPattern)
    plan=(await call(study)).value.plan
    assert.equal(plan.tasks.filter(task=>task.completed).length,6)
    assert.equal((await call(study+'/items?kind=sentence&wrong=true')).value.total,1)
    await page.setViewportSize({width:375,height:844})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:output+'/translation-mobile.png',animations:'disabled'})
    await page.setViewportSize({width:1440,height:1000})
    await page.screenshot({path:output+'/translation-desktop.png',animations:'disabled'})
    const anon=await browser.newContext()
    assert.equal((await anon.request.get(`http://127.0.0.1:${port}/api/v1${study}`)).status(),401)
    assert.equal((await anon.request.get(`http://127.0.0.1:${port}/api/v1${study}`,{headers:{Authorization:'Bearer '+credential.token}})).status(),401)
    await anon.close()
    await context.storageState({path:output+'/browser.json'})
    await writeFile(output+'/result.json',JSON.stringify({plan,gameId:game.id,legacy,token:credential.token}))
    console.log('PASS real study: aligned/legacy articles, old receipts, historical senses/sources, fixed daily plan, matching/spelling resume, persistent drafts, self-assessment, lost-response retry, cumulative mistakes and narrow layout')
  }
  assert.deepEqual(errors,[])
}catch(error){await page?.screenshot({path:output+'/failure-'+phase+'.png',fullPage:true}).catch(()=>{});throw error}
finally{await browser?.close();await server.close()}
