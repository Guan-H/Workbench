import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
const phase=process.argv[2],output=process.env.SESSIONS_OUTPUT,port=Number(process.env.SESSIONS_FRONTEND_PORT),backend=process.env.SESSIONS_BACKEND
assert.ok(output&&port&&/^http:\/\/127\.0\.0\.1:\d+$/.test(backend))
const root=fileURLToPath(new URL('../',import.meta.url)),fixtures=fileURLToPath(new URL('../../data/novel-fixtures/',import.meta.url))
const server=await createServer({configFile:false,root,plugins:[vue()],logLevel:'error',server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':backend}}})
let browser,page
try{
 await server.listen();browser=await chromium.launch({channel:'chrome'})
 const context=await browser.newContext({viewport:{width:1440,height:900},storageState:output+'/browser-a.json'})
 page=await context.newPage();const errors=[],dialogs=[],unwanted=[]
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss()});page.on('request',request=>{if(request.url().includes('blocked.reader.test'))unwanted.push(request.url())})
 await page.goto(`http://127.0.0.1:${port}`)
 const api=(path,method='GET',body,operation=crypto.randomUUID())=>page.evaluate(async({path,method,body,operation})=>{const {api,write}=await import('/src/shared/api/client.ts');try{return {status:200,value:method==='GET'?await api(path):await write(path,method,body,operation)}}catch(error){return {status:error.status,code:error.code,message:error.message}}},{path,method,body,operation})
 const nav=async name=>{await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name,exact:true}).click()}
 const catalog=async()=>(await api('/reader/library')).value
 const command=async(action,values={},operation=crypto.randomUUID())=>{const state=await catalog();return api('/reader/library','POST',{baseRevision:state.revision,action,...values},operation)}
 const add=async(file,parentId='')=>{const response=await command('add-book',{id:file.id,parentId});assert.equal(response.status,200);return response}
 const upload=async(name,data)=>page.evaluate(async({name,data})=>{const {apiResponse}=await import('/src/shared/api/client.ts');const bytes=Uint8Array.from(atob(data),char=>char.charCodeAt(0)),form=new FormData();form.append('path',name);form.append('file',new Blob([bytes]),name);return (await apiResponse('/files',{method:'POST',body:form,headers:{'Idempotency-Key':crypto.randomUUID()}})).json()},{name,data:Buffer.from(data).toString('base64')})
 const open=async name=>{
   const back=page.getByRole('button',{name:'返回书目',exact:true});if(await back.count())await back.click()
   await page.getByRole('textbox',{name:'搜索阅读书目',exact:true}).fill(name)
   await page.locator(`[data-reading-path="${name}"]`).click()
   await page.waitForFunction(()=>document.querySelector('.reader-scroll')?.getAttribute('aria-busy')==='false')
 }
 const captureDialog=async label=>{
   await page.getByRole('dialog').waitFor()
   for(const [size,width,height] of [['desktop',1440,900],['narrow',375,850]]){
     await page.setViewportSize({width,height});await page.waitForTimeout(350);await page.screenshot({path:`${output}/reading-dialog-${label}-${size}.png`,fullPage:true,animations:'disabled'})
   }
   await page.setViewportSize({width:1440,height:900})
 }
 const progress=async id=>(await api(`/reader/files/${id}/progress`)).value
 async function waitProgress(id,predicate){for(let i=0;i<140;i++){const result=await progress(id);if(predicate(result))return result;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('Actual progress not persisted')}
 if(phase==='novel-library-restart'){
   const saved=JSON.parse(await readFile(output+'/novel-library-result.json','utf8'))
   const state=await catalog();assert.ok(state.books.some(book=>book.fileId===saved.md.id));assert.ok(state.folders.some(folder=>folder.name==='书籍分类'))
   await nav('阅读');await open(saved.md.path)
   await page.getByRole('button',{name:'章节目录',exact:true}).click();await page.getByRole('tree').getByText('第三章 新增',{exact:true}).waitFor();await page.getByRole('button',{name:'关闭阅读面板',exact:true}).click()
   assert.equal((await progress(saved.md.id)).sourceHash,saved.md.sha256)
   console.log('PASS: account-sessions-novel-library-restart genuine references and updated source survived backend restart')
 }else{
   const mdText='# 第一章 起程\n\n唯一定位段落 ALPHA。这个段落会在原文前插入内容后继续定位。\n\n'+Array.from({length:35},(_,i)=>`段落 ${i} ${'虚构正文，用于真实阅读验证。'.repeat(5)}`).join('\n\n')+'\n\n# 第二章 归来\n\n第二章的末尾。'
   const md=(await api('/notes','POST',{path:'source.md',type:'note',content:mdText})).value
   const txt=await upload('source.txt',Buffer.from('第一章 起程\n虚构的 TXT 原文。\n第二章 归来\n另一段原文。'))
   const epub=await upload('reference.epub',await readFile(fixtures+'epub3.epub'))
   await api('/notes','POST',{path:'仅笔记文件夹',type:'folder',content:''})
   assert.equal((await catalog()).books.length,0,'Ordinary files must not automatically appear in the novel catalogue')
   await nav('阅读');await page.getByRole('button',{name:'新建目录',exact:true}).click();await page.getByRole('textbox',{name:'书籍目录名称',exact:true}).fill('书籍分类');await captureDialog('folder');await page.getByRole('dialog',{name:'管理阅读目录'}).getByRole('button',{name:'确认',exact:true}).click()
   await page.getByRole('dialog',{name:'管理阅读目录'}).waitFor({state:'detached'})
   let state=await catalog();const folder=state.folders.find(item=>item.name==='书籍分类');assert.ok(folder);assert.ok(!state.folders.some(item=>item.name==='仅笔记文件夹'))
   await nav('笔记');await page.getByRole('button',{name:'刷新目录',exact:true}).click();await page.locator('[data-file-path="source.md"]').click({button:'right'})
   await page.getByRole('menuitem',{name:'复制到书架',exact:true}).click();await captureDialog('reference')
   await page.locator('.novel-copy-body .ant-select').click();await page.getByText('书籍分类',{exact:true}).last().click();await page.getByRole('button',{name:'确认加入书架',exact:true}).click()
   await page.getByRole('dialog',{name:'复制到书架'}).waitFor({state:'detached'})
   state=await catalog();assert.equal(state.books.length,1);assert.equal(state.books[0].fileId,md.id);assert.equal(state.books[0].folderId,folder.id)
   assert.equal((await api(`/notes/${md.id}`)).value.version,'1','Adding a reference must not copy or edit bytes')
   assert.equal((await command('add-book',{id:md.id})).code,'NOVEL_ALREADY_ADDED')
   assert.equal((await command('update-folder',{id:folder.id,parentId:folder.id,name:'书籍分类'})).status,400)
   const stale=await catalog();await command('create-folder',{parentId:'',name:'待删除分类'});assert.equal((await api('/reader/library','POST',{baseRevision:stale.revision,action:'create-folder',parentId:'',name:'陈旧操作'})).code,'NOVEL_LIBRARY_CHANGED')
   await nav('阅读');await open(md.path)
   await page.getByText('唯一定位段落 ALPHA。这个段落会在原文前插入内容后继续定位。',{exact:true}).waitFor()
   await page.locator('.reader-scroll').evaluate(element=>{const paragraph=[...element.querySelectorAll('[data-reader-block]')].find(item=>item.textContent.startsWith('唯一定位段落'));element.scrollTop+=paragraph.getBoundingClientRect().top-element.getBoundingClientRect().top-16})
   await waitProgress(md.id,item=>item.revision!=='0'&&item.locator?.includes('ALPHA'))
   await page.getByRole('button',{name:'全屏阅读',exact:true}).click();await page.waitForFunction(()=>document.fullscreenElement!==null)
   const updatedText='# 新增前言\n\n这段内容是在笔记中增加的。\n\n'+mdText+'\n\n# 第三章 新增\n\n新增后缀内容'
   const updated=(await api(`/notes/${md.id}`,'PUT',{path:md.path,type:'note',content:updatedText,baseVersion:md.version})).value
   assert.equal(updated.id,md.id)
   await waitProgress(md.id,item=>item.sourceHash===updated.sha256)
   assert.ok(await page.evaluate(()=>document.fullscreenElement!==null),'Automatic source refresh must retain the reader/fullscreen root')
   await page.getByRole('button',{name:'章节目录',exact:true}).click();await page.getByRole('tree').getByText('第三章 新增',{exact:true}).waitFor();await page.getByRole('button',{name:'关闭阅读面板',exact:true}).click()
   assert.ok(await page.locator('[data-reader-block]').filter({hasText:'唯一定位段落 ALPHA'}).evaluate(element=>{const view=element.closest('.reader-scroll').getBoundingClientRect(),rect=element.getBoundingClientRect();return rect.bottom>view.top&&rect.top<view.bottom}))
   await page.getByRole('button',{name:'退出沉浸阅读',exact:true}).click()
   await page.screenshot({path:output+'/novel-reference-updated.png',fullPage:true})
   await page.getByRole('button',{name:'返回书目',exact:true}).click()
   const before=(await api(`/notes/${md.id}`)).value
   await command('move-book',{id:md.id,parentId:''});assert.equal((await api(`/notes/${md.id}`)).value.path,md.path)
   await command('remove-book',{id:md.id});assert.equal((await api(`/notes/${md.id}`)).value.sha256,before.sha256)
   await add(updated);await add(txt);await add(epub)
   const op=crypto.randomUUID(),snapshot=await catalog(),request={baseRevision:snapshot.revision,action:'create-folder',parentId:'',name:'幂等分类'}
   const first=await api('/reader/library','POST',request,op),retry=await api('/reader/library','POST',request,op);assert.equal(first.value.revision,retry.value.revision)
   const disposable=(await catalog()).folders.find(item=>item.name==='待删除分类');await command('move-book',{id:txt.id,parentId:disposable.id});await command('delete-folder',{id:disposable.id});assert.equal((await api(`/notes/${txt.id}`)).value.deleted,false);await add(txt)
   await page.getByRole('button',{name:'刷新书目',exact:true}).click();await open(txt.path)
   const txtNew=(await api(`/files/${txt.id}/text`,'PUT',{baseVersion:txt.version,path:txt.path,content:'第一章 全新正文\nTXT 自动同步的新内容。',encoding:'UTF-8',bom:false})).value
   await page.getByText('TXT 自动同步的新内容。',{exact:true}).waitFor({timeout:20000});assert.equal(txtNew.id,txt.id)
   await page.getByRole('button',{name:'返回书目',exact:true}).click();await open(epub.path);await page.getByRole('button',{name:'章节目录',exact:true}).click();await page.getByRole('tree').getByText('第一部 起程',{exact:true}).waitFor();await page.getByRole('button',{name:'关闭阅读面板',exact:true}).click()
   await page.getByRole('button',{name:'返回书目',exact:true}).click();await page.getByRole('textbox',{name:'搜索阅读书目',exact:true}).fill('')
   await page.screenshot({path:output+'/novel-independent-library.png',fullPage:true})
   await page.setViewportSize({width:375,height:850});await page.screenshot({path:output+'/novel-independent-narrow.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1440,height:900})
   await open(md.path);await page.setViewportSize({width:375,height:850})
   await page.getByRole('button',{name:'阅读设置',exact:true}).click()
   await page.getByRole('button',{name:'进入沉浸模式',exact:true}).click()
   const reader=page.getByRole('region',{name:'书籍阅读器',exact:true})
   await page.getByRole('button',{name:'显示阅读菜单',exact:true}).waitFor()
   assert.equal(await reader.getByRole('button').count(),1,'Only the discoverable menu should remain in mobile immersive reading')
   await page.screenshot({path:output+'/reader-mobile-immersive-paper.png',animations:'disabled'})
   const scrollTop=await page.locator('.reader-scroll').evaluate(element=>element.scrollTop)
   await page.locator('.reader-scroll').click({position:{x:180,y:180}})
   await page.getByRole('button',{name:'收起阅读菜单',exact:true}).waitFor()
   assert.ok(Math.abs(await page.locator('.reader-scroll').evaluate(element=>element.scrollTop)-scrollTop)<2,'Opening controls must not shift the reading viewport')
   await page.getByRole('button',{name:'收起阅读菜单',exact:true}).click()
   await page.locator('.reader-content p').first().evaluate(element=>{const range=document.createRange();range.selectNodeContents(element);const selection=getSelection();selection.removeAllRanges();selection.addRange(range)})
   await page.locator('.reader-scroll').dispatchEvent('click',{detail:0})
   await page.getByRole('button',{name:'显示阅读菜单',exact:true}).waitFor()
   await page.evaluate(()=>getSelection().removeAllRanges())
   await page.getByRole('button',{name:'显示阅读菜单',exact:true}).click()
   await page.getByRole('button',{name:'阅读设置',exact:true}).click()
   await page.locator('.reader-settings label').filter({hasText:'背景'}).locator('.ant-select').click()
   await page.getByText('夜间',{exact:true}).last().click()
   await page.screenshot({path:output+'/reader-mobile-night-settings.png',animations:'disabled'})
   await page.getByRole('button',{name:'关闭阅读面板',exact:true}).click()
   await page.getByRole('button',{name:'收起阅读菜单',exact:true}).click()
   await page.screenshot({path:output+'/reader-mobile-immersive-night.png',animations:'disabled'})
   assert.equal(await reader.evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(32, 37, 34)')
   await page.getByRole('button',{name:'显示阅读菜单',exact:true}).click()
   await page.getByRole('button',{name:'章节目录',exact:true}).click()
   await page.getByRole('dialog',{name:'书籍章节目录'}).getByRole('tree').getByText('第二章 归来',{exact:true}).click()
   await page.getByRole('button',{name:'退出沉浸阅读',exact:true}).click()
   await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'返回书目',exact:true}).click()
   const picker=page.waitForEvent('filechooser');await page.getByRole('button',{name:'上传书籍',exact:true}).click();await(await picker).setFiles({name:'uploaded-novel.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 上传验证\n通过真实页面上传到书籍分类。')})
   await captureDialog('upload');await page.getByRole('dialog',{name:'上传书籍'}).locator('.ant-select').click();await page.getByText('书籍分类',{exact:true}).last().click();await page.getByRole('button',{name:'确认上传书籍',exact:true}).click()
   await page.getByText('通过真实页面上传到书籍分类。',{exact:true}).waitFor()
   const uploaded=(await catalog()).books.find(book=>book.file?.path==='uploaded-novel.txt');assert.equal(uploaded.folderId,folder.id);assert.equal(uploaded.file.type,'attachment')
   const uploadRevision=(await catalog()).revision,uploadOperation=crypto.randomUUID()
   const sendMarkdown=()=>page.evaluate(async({baseRevision,operation})=>{
     const{apiResponse}=await import('/src/shared/api/client.ts'),form=new FormData();form.append('baseRevision',baseRevision);form.append('parentId','');form.append('name','uploaded.md');form.append('file',new Blob(['# 上传章节\n\n虚构 Markdown 正文。'],{type:'text/markdown'}),'uploaded.md')
     return(await apiResponse('/reader/library/upload',{method:'POST',body:form,headers:{'Idempotency-Key':operation}})).json()
   },{baseRevision:uploadRevision,operation:uploadOperation})
   const mdUpload=await sendMarkdown(),mdRetry=await sendMarkdown();assert.equal(mdUpload.id,mdRetry.id);assert.equal(mdUpload.revision,mdRetry.revision);assert.equal((await api(`/notes/${mdUpload.id}`)).value.type,'note')
   await open(txt.path);const removed=(await api(`/notes/${txt.id}?baseVersion=${txtNew.version}`,'DELETE')).value
   await page.getByText('书籍入口或源文件已移除，恢复源文件或重新加入后可继续。',{exact:true}).waitFor({timeout:20000})
   assert.ok((await catalog()).books.some(book=>book.fileId===txt.id&&!book.file))
   await api(`/notes/${txt.id}/restore?version=${txtNew.version}&baseVersion=${removed.version}`,'POST');assert.ok((await catalog()).books.find(book=>book.fileId===txt.id).file)
   const anon=await browser.newContext();assert.equal((await anon.request.get(`http://127.0.0.1:${port}/api/v1/reader/library`)).status(),401);await anon.close()
   assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);assert.deepEqual(unwanted,[])
   await writeFile(output+'/novel-library-result.json',JSON.stringify({md:updated}))
   console.log('PASS: account-sessions-novel-library real independent folders, UI reference, Markdown/TXT live refresh, same identity, source deletion/restore and idempotency')
 }
}catch(error){if(page)await page.screenshot({path:output+'/failure-'+phase+'.png',fullPage:true}).catch(()=>{});throw error}
finally{await browser?.close();await server.close()}
