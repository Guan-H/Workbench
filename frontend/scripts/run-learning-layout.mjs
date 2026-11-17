import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'

const output=process.env.LAYOUT_OUTPUT,backend=process.env.LAYOUT_BACKEND,port=Number(process.env.LAYOUT_FRONTEND_PORT)
assert.ok(output&&port&&/^http:\/\/127\.0\.0\.1:\d+$/.test(backend))
const server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),plugins:[vue()],logLevel:'error',
  optimizeDeps:{include:['libsodium-wrappers-sumo']},server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':backend}}})
const articleOnly=process.env.LAYOUT_ARTICLE_ONLY==='true'
let browser,page
try{
  await mkdir(output,{recursive:true});await server.listen();browser=await chromium.launch({channel:'chrome'})
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
  page=await context.newPage()
  const errors=[];page.on('pageerror',error=>errors.push(error.stack||error.message))
  await page.goto('http://127.0.0.1:'+port)
  const call=(path,method='GET',body)=>page.evaluate(async({path,method,body})=>{
    const{api}=await import('/src/shared/api/client.ts')
    return api(path,{method,body:body===undefined?undefined:JSON.stringify(body),headers:{'Idempotency-Key':crypto.randomUUID()}})
  },{path,method,body})
  await call('/auth/initialize','POST',{username:'layout-it',password:process.env.LAYOUT_PASSWORD,setupToken:process.env.LAYOUT_SETUP_TOKEN})
  const credential=await call('/home/english/webhook','POST',{baseRevision:'0',action:'rotate'})
  const text=Array.from({length:150},(_,i)=>'Paragraph '+i+': We learn to understand useful words in everyday sentences.').join('\n\n')
  const paragraphs=text.split('\n\n')
  const sentences=paragraphs.map((text,i)=>({text,translation:'第'+i+'句，用于真实布局检查的译文。'}))
  const translation=sentences.map(item=>item.translation).join('\n\n')
  const words=Array.from({length:25},(_,i)=>({word:'term'+String(i+1).padStart(2,'0'),phonetic:'/tɜːm/',meaning:'用于验证卡片布局的真实推送词条 '+i,example:'We use this term in a short sentence.',exampleTranslation:'我们在一个短句中使用这个词语。'}))
  for(let i=0;i<(articleOnly?1:11);i++){
    const response=await context.request.post('http://127.0.0.1:'+port+'/api/v1/hooks/english',{headers:{Authorization:'Bearer '+credential.token},
      data:{requestId:'layout-'+i,articles:[{title:'Long reading '+i,text,translation,sentences},{title:'Second reading '+i,text,translation:'这是用于检查短译文持续可见的本地测试内容。'}],words}})
    assert.equal(response.status(),200)
  }
  for(let i=0;i<(articleOnly?0:11);i++){
    const item=await call('/home/english/courses','POST',{title:'Reading card '+i,text:'A short reading entry '+i+'.',translation:null,sourceUrl:null})
    await call('/home/english/courses/'+item.summary.id+'/progress','PUT',{baseRevision:item.summary.revision,action:'favorite',favorite:true})
  }
  await page.reload()
  await page.locator('.global-sidebar').getByRole('button',{name:'学习',exact:true}).click()
  await page.getByRole('heading',{name:'Long reading '+(articleOnly?0:10),exact:true}).waitFor()
  const choose=async(root,label)=>root.locator('.ant-radio-button-wrapper').filter({hasText:new RegExp('^'+label+'$')}).click()
  const nav=()=>page.locator('.learning-page > header')
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  const fixed=async(scrollSelector,footerSelector)=>{
    await settle()
    const before=await page.evaluate(({scrollSelector,footerSelector})=>{
      const scroll=document.querySelector(scrollSelector),footer=document.querySelector(footerSelector)
      const header=document.querySelector('.learning-page > header')
      return{scroll:scroll.scrollHeight,height:scroll.clientHeight,header:header.getBoundingClientRect().top,footer:footer.getBoundingClientRect().top,bottom:footer.getBoundingClientRect().bottom,outer:getComputedStyle(document.querySelector('.learning-scroll')).overflowY}
    },{scrollSelector,footerSelector})
    assert.equal(before.outer,'hidden')
    assert.ok(before.height>40,JSON.stringify(before))
    assert.ok(before.scroll>before.height+10,'fixture must overflow: '+JSON.stringify(before))
    assert.ok(before.bottom<=await page.evaluate(()=>innerHeight)+1,JSON.stringify(before))
    await page.locator(scrollSelector).evaluate(el=>{el.scrollTop=el.scrollHeight})
    await settle()
    const after=await page.evaluate(({scrollSelector,footerSelector})=>({
      top:document.querySelector(scrollSelector).scrollTop,
      header:document.querySelector('.learning-page > header').getBoundingClientRect().top,
      footer:document.querySelector(footerSelector).getBoundingClientRect().top,
      overflow:document.documentElement.scrollWidth>innerWidth
    }),{scrollSelector,footerSelector})
    assert.ok(after.top>0)
    assert.ok(Math.abs(before.header-after.header)<1)
    assert.ok(Math.abs(before.footer-after.footer)<1)
    assert.equal(after.overflow,false)
  }
  const columns=async(selector,expected)=>{
    await settle()
    const count=await page.locator(selector).evaluateAll(items=>{
      const top=items[0].getBoundingClientRect().top
      return items.filter(item=>Math.abs(item.getBoundingClientRect().top-top)<1).length
    })
    assert.equal(count,expected)
  }
  await page.locator('.english-history>summary').click()
  await page.getByRole('textbox',{name:'英语学习日期',exact:true}).waitFor()
  const historyBox=await page.locator('.english-history-panel').boundingBox()
  assert.ok(historyBox.x>=0 && historyBox.x+historyBox.width<=1440)
  await page.locator('.english-history').getByRole('button',{name:'收起',exact:true}).click()
  await fixed('.article-body','.english-pagination')
  await page.screenshot({path:output+'/article-fixed.png',animations:'disabled'})
  for(const width of [1440,375]) {
    await page.setViewportSize({width,height:width===375?844:1000})
    for(const mode of ['原文','译文','逐句对照','全文对照']) {
      await choose(page.locator('.english-article'),mode)
      const body=page.locator('.english-article-fixed>.article-body')
      await body.evaluate(el=>el.scrollTop=0);await settle()
      const before=await page.locator('.english-article').evaluate(el=>({title:el.querySelector('h3').getBoundingClientRect().top,mode:el.querySelector('.article-mode').getBoundingClientRect().top,headerBottom:el.querySelector('.article-header').getBoundingClientRect().bottom,bodyTop:el.querySelector('.article-body').getBoundingClientRect().top}))
      assert.ok(before.headerBottom<=before.bodyTop+1,'header must not cover article text')
      assert.ok(before.bodyTop<(width===375?500:400),JSON.stringify({width,bodyTop:before.bodyTop}))
      const columnsMode=width>600&&mode==='全文对照'
      const original='.article-full-bilingual p[lang="en"]',translated='.article-full-bilingual p[lang="zh-CN"]'
      if(columnsMode){
        await page.locator(translated).evaluate(el=>el.scrollTop=0)
        await fixed(original,'.english-pagination')
        assert.equal(await page.locator(translated).evaluate(el=>el.scrollTop),0)
        const originalTop=await page.locator(original).evaluate(el=>el.scrollTop)
        await fixed(translated,'.english-pagination')
        assert.equal(await page.locator(original).evaluate(el=>el.scrollTop),originalTop)
        assert.equal(await body.evaluate(el=>el.scrollTop),0)
      }else await fixed('.article-body','.english-pagination')
      const after=await page.locator('.english-article').evaluate(el=>({title:el.querySelector('h3').getBoundingClientRect().top,mode:el.querySelector('.article-mode').getBoundingClientRect().top}))
      assert.ok(Math.abs(before.title-after.title)<1,JSON.stringify({width,mode,before,after}))
      assert.ok(Math.abs(before.mode-after.mode)<1,JSON.stringify({width,mode,before,after}))
    }
    await page.screenshot({path:output+`/article-header-${width}.png`,animations:'disabled'})
  }
  await page.setViewportSize({width:1440,height:1000})
  await page.locator('.english-pagination').getByRole('button',{name:'下一页',exact:true}).click()
  await page.getByRole('heading',{name:'Second reading '+(articleOnly?0:10),exact:true}).waitFor()
  await settle()
  assert.equal(await page.locator('.article-body').evaluate(el=>el.scrollTop),0)
  const original=page.locator('.article-full-bilingual p[lang="en"]'),translated=page.locator('.article-full-bilingual p[lang="zh-CN"]')
  assert.equal(await original.evaluate(el=>el.scrollTop),0)
  await original.evaluate(el=>el.scrollTop=el.scrollHeight)
  const shortTranslation=await translated.evaluate(el=>({top:el.scrollTop,box:el.getBoundingClientRect().top,text:el.textContent,height:el.clientHeight,scroll:el.scrollHeight}))
  assert.equal(shortTranslation.top,0);assert.ok(shortTranslation.box>0);assert.equal(shortTranslation.height,shortTranslation.scroll)
  await page.screenshot({path:output+'/short-translation-visible.png',animations:'disabled'})
  await page.locator('.english-pagination').getByRole('button',{name:'上一页',exact:true}).click()
  await page.getByRole('heading',{name:'Long reading '+(articleOnly?0:10),exact:true}).waitFor()
  await page.setViewportSize({width:1440,height:1000})
  if(!articleOnly){
  await choose(page.locator('.daily-english'),'单词')
  await page.locator('.english-words li').first().waitFor()
  await columns('.english-words li',4)
  await fixed('.english-scroll','.english-pagination')
  assert.match(await page.locator('.english-pagination').innerText(),/第 1 \/ 3 页/)
  await page.locator('.english-pagination').getByRole('button',{name:'下一页',exact:true}).click()
  await page.locator('.english-words strong').filter({hasText:'term11'}).waitFor()
  assert.match(await page.locator('.english-pagination').innerText(),/第 2 \/ 3 页/)
  assert.equal(await page.locator('.english-scroll').evaluate(el=>el.scrollTop),0)
  await page.screenshot({path:output+'/words-four-columns.png',animations:'disabled'})
  await page.setViewportSize({width:1920,height:1080})
  await columns('.english-words li',5)
  await page.screenshot({path:output+'/words-five-columns.png',animations:'disabled'})
  await page.setViewportSize({width:375,height:844})
  await columns('.english-words li',2)
  await fixed('.english-scroll','.english-pagination')
  await page.screenshot({path:output+'/words-mobile.png',animations:'disabled'})
  await page.setViewportSize({width:1440,height:1000})
  await choose(nav(),'阅读')
  await page.locator('.course-card').first().waitFor()
  await fixed('.course-list-scroll','.course-pagination')
  assert.match(await page.locator('.course-pagination').innerText(),/第 1 \/ 2 页/)
  await page.locator('.course-pagination').getByRole('button',{name:'下一页',exact:true}).click()
  await page.waitForFunction(()=>document.querySelectorAll('.course-card').length===6)
  assert.match(await page.locator('.course-pagination').innerText(),/第 2 \/ 2 页/)
  await page.screenshot({path:output+'/reading-fixed.png',animations:'disabled'})
  await choose(nav(),'短句')
  await page.locator('.sentence-card').first().waitFor()
  await columns('.sentence-card',3)
  await fixed('.course-list-scroll','.course-pagination')
  assert.match(await page.locator('.course-pagination').innerText(),/第 1 \/ 2 页/)
  await choose(nav(),'我的积累')
  await page.locator('.course-card').first().waitFor()
  await fixed('.course-list-scroll','.course-pagination')
  await page.getByRole('button',{name:'词库与计划',exact:true}).click()
  await page.getByRole('region',{name:'英语学习',exact:true}).locator('.study-summary').waitFor()
  const study=()=>page.getByRole('region',{name:'英语学习',exact:true})
  await choose(study(),'个人词库')
  await page.locator('.study-word-grid li').first().waitFor()
  await columns('.study-word-grid li',4)
  await fixed('.study-scroll','.study-pagination')
  await page.locator('.study-pagination').getByRole('button',{name:'下一页',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.study-pagination')?.textContent.includes('第 2 / 3 页'))
  await page.waitForFunction(()=>document.querySelector('.study-word-grid strong')?.textContent==='term11')
  await page.screenshot({path:output+'/vocabulary-fixed.png',animations:'disabled'})
  await page.setViewportSize({width:1920,height:1080});await columns('.study-word-grid li',5)
  await page.setViewportSize({width:375,height:844});await columns('.study-word-grid li',2)
  await fixed('.study-scroll','.study-pagination')
  await page.screenshot({path:output+'/vocabulary-mobile.png',animations:'disabled'})
  await page.setViewportSize({width:1440,height:1000})
  await choose(study(),'今日学习')
  await study().getByRole('button',{name:'生成今日计划',exact:true}).click()
  await page.locator('.study-pagination').waitFor()
  await fixed('.study-scroll','.study-pagination')
  assert.match(await page.locator('.study-pagination').innerText(),/第 1 \/ 2 页/)
  }
  assert.deepEqual(errors,[])
  console.log(articleOnly?'PASS real pushed articles: four modes, fixed title/tabs/footer, body scrolling and page reset at desktop/mobile; no mocked APIs':'PASS real learning layout: fixed headers/pagination, 4/5/2 word grids, scrolling, page changes, vocabulary and plan; no mocked APIs')
}catch(error){await page?.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});throw error}
finally{await browser?.close();await server.close()}
