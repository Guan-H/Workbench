import assert from 'node:assert/strict'
import {readFile, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'

const phase = process.argv[2], output = process.env.WORD_GAME_OUTPUT, backend = process.env.WORD_GAME_BACKEND
const port = Number(process.env.WORD_GAME_FRONTEND_PORT)
assert.ok(output && port && /^http:\/\/127\.0\.0\.1:\d+$/.test(backend))
const server = await createServer({configFile:false, root:fileURLToPath(new URL('../',import.meta.url)), plugins:[vue()],
  logLevel:'error', server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':backend}}})
let browser, page
try {
  await server.listen()
  browser = await chromium.launch({channel:'chrome'})
  const context = await browser.newContext({viewport:{width:1440,height:1000}, ...(phase==='restart'?{storageState:output+'/browser.json'}:{})})
  page = await context.newPage()
  const errors = [], nativeDialogs = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.type()); await dialog.dismiss() })
  await page.goto(`http://127.0.0.1:${port}`)
  const call = (path,method='GET',body,operation=crypto.randomUUID()) => page.evaluate(async ({path,method,body,operation}) => {
    const {api} = await import('/src/shared/api/client.ts')
    try { return {status:200,value:await api(path,{method,body:body===undefined?undefined:JSON.stringify(body),headers:{'Idempotency-Key':operation}})} }
    catch(error) { return {status:error.status,code:error.code} }
  }, {path,method,body,operation})
  const games = '/home/english/word-games'
  if (phase === 'restart') {
    const saved = JSON.parse(await readFile(output+'/result.json','utf8'))
    const result = await call(games+'/'+saved.id)
    assert.equal(result.status,200); assert.deepEqual(result.value,saved.game)
    assert.equal((await call(games+'/'+saved.reviewId)).value.completed,true)
    assert.deepEqual((await call(games+'/'+saved.spelling.id)).value,saved.spelling)
    assert.equal((await call(games+'/'+saved.spellReviewId)).value.completed,true)
    assert.deepEqual(errors,[])
    console.log('PASS word-game restart: exact persisted round, score, card order and wrong-word review survived a real backend restart')
  } else {
    const initialized = await call('/auth/initialize','POST',{username:'word-game-it',password:process.env.WORD_GAME_PASSWORD,setupToken:process.env.WORD_GAME_SETUP_TOKEN})
    assert.equal(initialized.status,200)
    const status = (await call('/home/english/webhook')).value
    const credential = (await call('/home/english/webhook','POST',{baseRevision:status.revision,action:'rotate'})).value
    const words = Array.from({length:7},(_,i)=>({word:`fixture-${i}`,phonetic:'/test/',meaning:`真实推送释义 ${i}`,example:`The word fixture-${i} comes from a persisted webhook batch.`}))
    words.push({...words[0],word:'FIXTURE-0'},{...words[1],word:'another-name'})
    const receipt = await context.request.post(`http://127.0.0.1:${port}/api/v1/hooks/english`,{
      headers:{Authorization:`Bearer ${credential.token}`},data:{requestId:'word-game-fixture',articles:[],words}})
    assert.equal(receipt.status(),200)
    const batchId = (await receipt.json()).id
    await page.reload(); await page.locator('.global-sidebar').getByRole('button',{name:'学习',exact:true}).click();await page.getByText('单词',{exact:true}).click()
    const card = page.getByRole('complementary',{name:'单词挑战',exact:true})
    await card.getByRole('button',{name:'开始挑战',exact:true}).waitFor()
    await page.screenshot({path:output+'/entry-desktop.png'})
    const createResponse = page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/word-games')&&response.ok())
    await card.getByRole('button',{name:'开始挑战',exact:true}).click()
    let game = await (await createResponse).json()
    const dialog = page.getByRole('dialog',{name:'单词挑战',exact:true})
    await dialog.getByRole('heading',{name:'找到属于它的另一半',exact:true}).waitFor()
    assert.equal(game.words.length,6); assert.equal(game.eligibleCount,7); assert.equal(game.sourceCount,9)
    assert.ok(game.words.every(choice=>words.some(word=>word.word===choice.label)))
    await page.mouse.click(8,8); assert.equal(await dialog.count(),1)
    await page.screenshot({path:output+'/board-desktop.png'})
    await page.setViewportSize({width:390,height:844})
    await page.screenshot({path:output+'/board-mobile.png'})
    const rectangle = await dialog.boundingBox()
    assert.ok(rectangle.x>=-1 && rectangle.x+rectangle.width<=391 && rectangle.y>=-1 && rectangle.y+rectangle.height<=845)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
    await page.setViewportSize({width:1440,height:1000})
    // Lose an actual committed response. The retry still executes the real endpoint, without a mocked reply.
    const answerPattern = `**/word-games/${game.id}/answers`
    let loseResponse = true
    await page.route(answerPattern,async route=>{
      if (loseResponse) { loseResponse=false; await route.fetch(); await route.abort('failed') }
      else await route.continue()
    })
    await dialog.locator('[data-word-choice="0"]').press('Enter')
    await dialog.locator('[data-meaning-choice="1"]').click()
    await dialog.getByRole('button',{name:'重试上次操作',exact:true}).waitFor()
    const retried = page.waitForResponse(response=>response.url().endsWith(`/word-games/${game.id}/answers`)&&response.ok())
    await dialog.getByRole('button',{name:'重试上次操作',exact:true}).click()
    game = await (await retried).json()
    assert.equal(game.attempts,1); assert.equal(game.revision,'1'); assert.equal(game.mistakes.length,2)
    await dialog.getByText('这两个还不是一对，再试一次。',{exact:true}).waitFor()
    await page.unroute(answerPattern)
    for(const id of game.words.map(choice=>choice.id)) {
      const response=page.waitForResponse(response=>response.url().endsWith(`/word-games/${game.id}/answers`)&&response.ok())
      await dialog.locator(`[data-word-choice="${id}"]`).click()
      await dialog.locator(`[data-meaning-choice="${id}"]`).click()
      game=await (await response).json()
    }
    assert.equal(game.completed,true); assert.equal(game.attempts,7); assert.equal(game.matched.length,6)
    await dialog.getByText('7 次配对 · 正确率 86% · 最长连对 6',{exact:true}).waitFor()
    await page.screenshot({path:output+'/result-desktop.png'})
    const completed = game
    const reviewResponse=page.waitForResponse(response=>response.url().endsWith('/word-games')&&response.request().method()==='POST'&&response.ok())
    await dialog.getByRole('button',{name:'再练错词（2）',exact:true}).click()
    let review=await (await reviewResponse).json()
    assert.equal(review.words.length,2)
    assert.deepEqual(new Set(review.words.map(choice=>choice.label)),new Set(completed.mistakes.map(word=>word.word)))
    for(const id of review.words.map(choice=>choice.id)) {
      const response=page.waitForResponse(response=>response.url().endsWith(`/word-games/${review.id}/answers`)&&response.ok())
      await dialog.locator(`[data-word-choice="${id}"]`).click(); await dialog.locator(`[data-meaning-choice="${id}"]`).click()
      review=await (await response).json()
    }
    assert.equal(review.completed,true); assert.equal(review.mistakes.length,0)
    // Start/retry and concurrent grading must converge through real row locks, not frontend disabling alone.
    const createOperation=crypto.randomUUID()
    const twins=await Promise.all([call(games,'POST',{batchId},createOperation),call(games,'POST',{batchId},createOperation)])
    assert.deepEqual(twins.map(value=>value.status),[200,200],JSON.stringify(twins))
    assert.equal(twins[0].value.id,twins[1].value.id)
    const current=twins[0].value, answer={baseRevision:'0',wordId:0,meaningId:0},operation=crypto.randomUUID()
    const concurrent=await Promise.all([call(games+'/'+current.id+'/answers','POST',answer,operation),call(games+'/'+current.id+'/answers','POST',answer)])
    assert.deepEqual(concurrent.map(value=>value.status).sort(),[200,409])
    const persisted=(await call(games+'/'+current.id)).value
    assert.equal(persisted.attempts,1); assert.equal(persisted.revision,'1')
    assert.equal((await call(games,'POST',{batchId,reviewOf:current.id})).status,409)
    assert.equal((await call(games,'POST',{batchId:'999999999'})).status,404)
    assert.equal((await call(games+'/'+current.id+'/answers','POST',{baseRevision:'1',wordId:999,meaningId:0})).status,400)
    assert.equal((await call(games+'/'+current.id+'/answers','POST',{baseRevision:'1',wordId:-1,meaningId:0})).status,400)
    assert.equal((await call(games,'POST',{batchId},'not-a-uuid')).status,400)
    // Spelling uses the same real batch, grading lock and persisted retry rules.
    await dialog.getByRole('button',{name:'完成',exact:true}).click()
    await card.getByText('拼写',{exact:true}).click()
    const spellStart=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/word-games')&&response.ok())
    await card.getByRole('button',{name:'开始挑战',exact:true}).click()
    let spelling=await (await spellStart).json()
    assert.equal(spelling.mode,'spelling'); assert.equal(spelling.words.length,6)
    const firstPrompt=spelling.spellingPrompt
    assert.ok(firstPrompt.example.includes('____'))
    await dialog.getByRole('button',{name:'首字母提示',exact:true}).click()
    await dialog.getByText(/首字母：/).waitFor()
    const spellInput=dialog.getByRole('textbox',{name:'英文拼写',exact:true})
    const incorrect=page.waitForResponse(response=>response.url().endsWith(`/word-games/${spelling.id}/answers`)&&response.ok())
    await spellInput.fill('incorrect-fixture'); await spellInput.press('Enter'); spelling=await (await incorrect).json()
    assert.equal(spelling.attempts,1); assert.equal(spelling.matched.length,0); assert.equal(spelling.mistakes.length,1)
    assert.equal(spelling.spellingPrompt.wordId,firstPrompt.wordId)
    await dialog.getByText('还没有拼对，请修改后再试。',{exact:true}).waitFor()
    await page.screenshot({path:output+'/spelling-desktop.png',animations:'disabled'})
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/spelling-mobile.png',animations:'disabled'})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1440,height:1000})
    const finishPronunciation=async()=>{
      // Wait for the native engine; an unavailable voice uses the real UI fallback.
      await page.waitForFunction(()=>{const panel=document.querySelector('.word-spelling-readback');return !panel||panel.textContent.includes('本次朗读未完成。')},undefined,{timeout:30000})
      const next=dialog.getByRole('button',{name:/^(继续下一题|查看本轮结果)$/})
      if(await next.count())await next.click()
    }
    while(!spelling.completed) {
      const question=spelling.spellingPrompt
      const expected=spelling.words.find(word=>word.id===question.wordId).label
      const response=page.waitForResponse(response=>response.url().endsWith(`/word-games/${spelling.id}/answers`)&&response.ok())
      await spellInput.fill('  '+expected.toUpperCase()+'  ');await spellInput.press('Enter');spelling=await (await response).json()
      await finishPronunciation()
    }
    assert.equal(spelling.attempts,7);assert.equal(spelling.mistakes.length,1)
    await dialog.getByText('7 次提交 · 正确率 86% · 最长连对 6',{exact:true}).waitFor()
    const spellReviewResponse=page.waitForResponse(response=>response.url().endsWith('/word-games')&&response.request().method()==='POST'&&response.ok())
    await dialog.getByRole('button',{name:'再练错词（1）',exact:true}).click()
    const spellReview=await (await spellReviewResponse).json();assert.equal(spellReview.words.length,1);assert.equal(spellReview.mode,'spelling')
    assert.equal((await call(games+'/'+spellReview.id+'/answers','POST',{baseRevision:'0',wordId:0,meaningId:0})).status,400)
    const spellResponse=page.waitForResponse(response=>response.url().endsWith(`/word-games/${spellReview.id}/answers`)&&response.ok())
    await spellInput.fill(spellReview.words[0].label);await spellInput.press('Enter');const finishedSpellReview=await (await spellResponse).json();assert.equal(finishedSpellReview.completed,true)
    await finishPronunciation()
    const anon=await browser.newContext()
    assert.equal((await anon.request.get(`http://127.0.0.1:${port}/api/v1${games}/${current.id}`)).status(),401)
    assert.equal((await anon.request.get(`http://127.0.0.1:${port}/api/v1${games}/${current.id}`,{headers:{Authorization:`Bearer ${credential.token}`}})).status(),401)
    await anon.close()
    assert.deepEqual(errors,[]); assert.deepEqual(nativeDialogs,[])
    await context.storageState({path:output+'/browser.json'})
    await writeFile(output+'/result.json',JSON.stringify({id:completed.id,reviewId:review.id,game:completed,spelling,spellReviewId:finishedSpellReview.id},null,2))
    console.log('PASS word-game real webhook/MySQL/browser: selected batch, duplicate labels, 6 pairs, keyboard/touch layout, wrong-word review, genuine lost-response retry, concurrent grading, auth and validation')
  }
} catch(error) { await page?.screenshot({path:output+'/failure-'+phase+'.png',fullPage:true}).catch(()=>{}); throw error }
finally { await browser?.close(); await server.close() }
