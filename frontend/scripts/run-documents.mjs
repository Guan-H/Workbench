import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'
import { checkPdfReader } from './check-pdf-reader.mjs'
const phase=process.argv[2], output=process.env.SESSIONS_OUTPUT, port=Number(process.env.SESSIONS_FRONTEND_PORT), backend=process.env.SESSIONS_BACKEND
assert.ok(['documents-base','documents-office'].includes(phase) && output && port && /^http:\/\/127\.0\.0\.1:\d+$/.test(backend))
const root=fileURLToPath(new URL('../',import.meta.url)), fixtures=fileURLToPath(new URL('../../data/document-fixtures/',import.meta.url))
const server=await createServer({configFile:false,root,plugins:[vue()],logLevel:'error',server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':backend}}})
let browser,page
try {
 await server.listen(); browser=await chromium.launch({channel:'chrome'})
 const context=await browser.newContext({viewport:{width:1440,height:900},storageState:output+'/browser-a.json'})
 page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`http://127.0.0.1:${port}`)
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'笔记',exact:true}).click()
 const upload=async name=>page.evaluate(async({name,data})=>{
  const {refreshCsrf,apiResponse}=await import('/src/shared/api/client.ts')
  const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)), form=new FormData(); form.append('path',name); form.append('file',new Blob([bytes]),name)
  return (await apiResponse('/files',{method:'POST',body:form,headers:{'Idempotency-Key':crypto.randomUUID()}})).json()
 },{name,data:(await readFile(fixtures+name)).toString('base64')})
 const refresh=async()=>{await page.getByRole('button',{name:'刷新目录',exact:true}).click()}
 const open=async name=>{await page.locator(`[data-file-path="${name}"]`).click(); await page.waitForFunction(name=>document.querySelector('.document-workspace > header strong')?.textContent===name,name)}
 const workspace=page.locator('.document-workspace')
 const fetchBytes=async note=>Buffer.from(await page.evaluate(async file=>{
  const response=await fetch(`/api/v1/files/${file.id}/content?version=${file.version}`)
  if(!response.ok) throw new Error('Actual file unavailable')
  return Array.from(new Uint8Array(await response.arrayBuffer()))
 },note))
 const read=async id=>(await (await page.request.get(`http://127.0.0.1:${port}/api/v1/notes/${id}`)).json())
 if(phase==='documents-base') {
  await page.getByRole('button',{name:'导入/导出',exact:true}).click()
  const chooser=page.waitForEvent('filechooser')
  await page.getByRole('menuitem',{name:'上传文档（TXT / EPUB / PDF / Office）',exact:true}).click()
  await (await chooser).setFiles(fixtures+'sample.txt')
  await page.getByRole('button',{name:'确认上传',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.document-workspace > header strong')?.textContent==='sample.txt')
  const txt=await page.evaluate(async()=>{const {listNotes}=await import('/src/shared/api/client.ts');return (await listNotes()).find(f=>f.path==='sample.txt')})
  const gbk=await upload('gbk.txt'), pdf=await upload('sample.pdf'), word=await upload('sample.docx')
  await upload('reader.pdf')
  await refresh()
  const editor=workspace.getByRole('textbox',{name:'TXT 正文',exact:true}); await editor.waitFor()
  assert.ok((await editor.textContent()).includes('第一行'))
  await editor.fill('TXT_FAKE_EDITED\n第二行'); await page.keyboard.press('Control+s')
  await page.getByText('TXT 文件已保存到服务器。',{exact:true}).waitFor()
  const saved=await read(txt.id), bytes=await fetchBytes(saved)
  assert.equal(saved.version,'2'); assert.ok(bytes.subarray(0,3).equals(Buffer.from([239,187,191])))
  assert.equal(bytes.subarray(3).toString('utf8'),'TXT_FAKE_EDITED\r\n第二行')
  // A genuine competing file publication rejects the old UI baseline and leaves its draft intact.
  const changed=await page.evaluate(async file=>{
    const {write}=await import('/src/shared/api/client.ts')
    return write(`/files/${file.id}/text`,'PUT',{baseVersion:file.version,path:file.path,encoding:'UTF-8',bom:true,content:'TXT_FAKE_OTHER_SIDE'})
  },saved)
  await editor.fill('TXT_FAKE_LOCAL_CONFLICT'); await workspace.getByRole('button',{name:'保存 TXT',exact:true}).click()
  await workspace.getByRole('alert').filter({hasText:'服务器已有新版本'}).waitFor()
  assert.equal((await read(txt.id)).version,changed.version)
  assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).content,`private-space:txt-draft:sessions-it:${txt.id}`),'TXT_FAKE_LOCAL_CONFLICT')
  await workspace.getByRole('button',{name:'放弃草稿并重新读取',exact:true}).click()
  await page.getByRole('button',{name:'放弃本机草稿',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('[aria-label="TXT 正文"]')?.textContent.includes('TXT_FAKE_OTHER_SIDE'))
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),`private-space:txt-draft:sessions-it:${txt.id}`),null)
  for(const width of [1440,375]){await page.setViewportSize({width,height:850});await page.screenshot({path:output+`/documents-txt-${width}.png`,fullPage:true})}
  await page.setViewportSize({width:1440,height:900})
  // Deliberately leave the genuine pending conflict in browser A and inspect other files in a new context.
  const extra=await browser.newContext({viewport:{width:1440,height:900},storageState:output+'/browser-a.json'})
  const p=await extra.newPage();await p.goto(`http://127.0.0.1:${port}`);await p.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'笔记',exact:true}).click()
  await p.locator('[data-file-path="gbk.txt"]').click()
  await p.getByRole('alert').filter({hasText:'请选择正确编码'}).waitFor()
  await p.locator('.document-workspace .ant-select').click();await p.getByText('GB18030',{exact:true}).click();await p.getByRole('button',{name:'重新读取',exact:true}).click()
  await p.getByRole('textbox',{name:'TXT 正文',exact:true}).waitFor();assert.ok((await p.getByRole('textbox',{name:'TXT 正文',exact:true}).textContent()).includes('中文编码验证'))
  await p.locator('[data-file-path="sample.pdf"]').click();await p.getByText('第 1 / 2 页',{exact:true}).waitFor()
  await p.waitForFunction(()=>{const c=document.querySelector('.pdf-pages canvas');return c&&c.width>0})
  const first=await p.locator('.pdf-pages .page[data-page-number="1"] canvas').evaluate(c=>c.toDataURL())
  await p.getByRole('button',{name:'下一页',exact:true}).click();await p.getByText('第 2 / 2 页',{exact:true}).waitFor()
  await p.waitForFunction(()=>document.querySelector('.pdf-pages')?.getAttribute('aria-busy')==='false')
  await p.waitForFunction(()=>{const c=document.querySelector('.pdf-pages .page[data-page-number="2"] canvas');return c&&c.width>0})
  assert.notEqual(await p.locator('.pdf-pages .page[data-page-number="2"] canvas').evaluate(c=>c.toDataURL()),first)
  await p.screenshot({path:output+'/documents-pdf-1440.png',fullPage:true})
  try { await checkPdfReader(p, output, fixtures) }
  catch (error) { await p.screenshot({path:output+'/pdf-reader-failure.png',fullPage:true}); throw error }
  await p.locator('[data-file-path="sample.docx"]').click();await p.getByRole('alert').filter({hasText:'文档服务尚未启用'}).waitFor()
  assert.deepEqual(await fetchBytes(word),await readFile(fixtures+'sample.docx'))
  await extra.close()
  const anon=await browser.newContext()
  assert.equal((await anon.request.get(`http://127.0.0.1:${port}/api/v1/files/${pdf.id}/content?version=1`)).status(),401)
  assert.equal((await anon.request.get(`http://127.0.0.1:${port}/api/v1/office-bridge/${crypto.randomUUID()}/source?ticket=bad`)).status(),401)
  await anon.close()
 } else {
  for(const name of ['sample.docx','sample.xlsx','legacy.doc','legacy.xls']) await upload(name)
  await refresh();await open('sample.docx')
  await workspace.getByRole('button',{name:'保存到服务器',exact:true}).waitFor({state:'visible',timeout:120000})
  await page.waitForFunction(()=>{const button=document.querySelector('.office-toolbar button');return !!button&&!button.disabled},{timeout:120000})
  await page.screenshot({path:output+'/documents-office-ready.png',fullPage:true})
  async function awaitVersion(id, previous) {
   for(let i=0;i<120;i++) { const file=await read(id); if(BigInt(file.version)>BigInt(previous))return file;await new Promise(resolve=>setTimeout(resolve,500)) }
   throw new Error('Actual Office result never reached persistent file version')
  }
  const list=await page.evaluate(async()=>{const {listNotes}=await import('/src/shared/api/client.ts');return listNotes()})
  const word=list.find(f=>f.path==='sample.docx'),sheet=list.find(f=>f.path==='sample.xlsx')
  assert.equal(await page.evaluate(()=>typeof window.DocsAPI),'undefined','Office SDK must not execute in the vault/main window')
  const wordFrame=page.frames().find(f=>f.url().includes('/documenteditor/'))
  assert.ok(wordFrame)
  await wordFrame.locator('#area_id').focus();await page.keyboard.press('Control+End');await page.keyboard.type(' DOCUMENT_FAKE_WORD_EDITED',{delay:35});await page.keyboard.press('Control+s')
  await page.screenshot({path:output+'/documents-word-edited.png',fullPage:true})
  const savedWord=await awaitVersion(word.id,word.version)
  const wordBytes=await fetchBytes(savedWord)
  const wordXml=execFileSync('python',['-c',"import sys,io,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).read('word/document.xml'))"],{input:wordBytes}).toString('utf8')
  assert.ok(wordXml.includes('DOCUMENT_FAKE_WORD_EDITED'),'Real word editor content must be saved in the DOCX bytes')
  assert.equal((await page.request.get(`http://127.0.0.1:${port}/api/v1/notes/${word.id}/history`)).status(),200)
  await open('sample.xlsx')
  await page.waitForFunction(()=>{const button=document.querySelector('.office-toolbar button');return !!button&&!button.disabled},{timeout:120000})
  const cellFrame=page.frames().find(f=>f.url().includes('/spreadsheeteditor/'))
  assert.ok(cellFrame)
  async function editCell(address,value) {
   await cellFrame.locator('#ce-cell-name').fill(address);await cellFrame.locator('#ce-cell-name').press('Enter')
   await cellFrame.locator('#area_id').focus();await page.keyboard.type(value,{delay:40});await page.keyboard.press('Enter')
  }
  await editCell('B2','DOCUMENT_FAKE_SHEET_EDITED');await editCell('C2','=SUM(B1,2)')
  let savedSheet
  for(let i=0;i<120;i++) {
   const current=await read(sheet.id)
   if(BigInt(current.version)>1n) {
    const xml=execFileSync('python',['-c',"import sys,io,zipfile;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));sys.stdout.buffer.write(b'\\n'.join(z.read(n) for n in z.namelist() if n.endswith('.xml')))"],{input:await fetchBytes(current)}).toString('utf8')
    if(xml.includes('DOCUMENT_FAKE_SHEET_EDITED')&&xml.includes('SUM(B1,2)')){savedSheet=current;break}
   }
   await new Promise(resolve=>setTimeout(resolve,500))
  }
  assert.ok(savedSheet,'Real cell and formula edits must be persisted in XLSX')
  await page.screenshot({path:output+'/documents-sheet-edited.png',fullPage:true})
  const device=await page.evaluate(async()=>{
   const {write}=await import('/src/shared/api/client.ts')
   const pairing=await write('/sync-devices/pairing-code','POST',{name:'DOCUMENT_FAKE_DEVICE',scope:{all:true,folders:[]}})
   const paired=await fetch('/api/v1/sync/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:pairing.code})})
   if(!paired.ok)throw new Error('Actual pairing failed')
   const device=await paired.json(),snapshot=await (await fetch('/api/v1/sync/snapshot',{headers:{Authorization:'Bearer '+device.token}})).json()
   return {...device,scopeVersion:snapshot.scopeVersion}
  })
  const syncHeaders={Authorization:'Bearer '+device.token,'X-Sync-Scope-Version':device.scopeVersion}
  const syncedDownload=await page.request.get(`http://127.0.0.1:${port}/api/v1/sync/files/${savedSheet.id}?version=${savedSheet.version}`,{headers:syncHeaders})
  assert.equal(syncedDownload.status(),200);assert.deepEqual(await syncedDownload.body(),await fetchBytes(savedSheet))
  const remoteBytes=await readFile(fixtures+'sample.xlsx')
  const crypto=await import('node:crypto')
  const syncWrite=await page.request.post(`http://127.0.0.1:${port}/api/v1/sync/files`,{headers:{...syncHeaders,'Idempotency-Key':crypto.randomUUID()},data:{id:savedSheet.id,path:savedSheet.path,baseVersion:savedSheet.version,deleted:false,sha256:crypto.createHash('sha256').update(remoteBytes).digest('hex'),contentBase64:remoteBytes.toString('base64')}})
  assert.equal(syncWrite.status(),200);const other=await syncWrite.json()
  await editCell('D2','DOCUMENT_FAKE_CONFLICT_LOCAL')
  await page.getByRole('alert').filter({hasText:'双方内容保留'}).waitFor({timeout:60000})
  assert.deepEqual(await fetchBytes(other),remoteBytes)
  const conflict=await page.evaluate(async()=>{const {listNotes}=await import('/src/shared/api/client.ts');return (await listNotes()).find(f=>f.path.includes('.office-conflict-'))})
  assert.ok(conflict)
  const conflictXml=execFileSync('python',['-c',"import sys,io,zipfile;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));sys.stdout.buffer.write(b'\\n'.join(z.read(n) for n in z.namelist() if n.endswith('.xml')))"],{input:await fetchBytes(conflict)}).toString('utf8')
  assert.ok(conflictXml.includes('DOCUMENT_FAKE_CONFLICT_LOCAL'))
  await page.getByRole('checkbox',{name:'我已另行保管编辑结果，允许离开此编辑页面',exact:true}).check()
  for(const legacy of ['legacy.doc','legacy.xls']) {
   await open(legacy);await page.getByRole('button',{name:'转换并另存为新格式',exact:true}).click()
   await page.getByRole('button',{name:'确认转换并另存',exact:true}).click()
   const target=legacy+'x'
   await page.waitForFunction(target=>document.querySelector('.document-workspace > header strong')?.textContent===target,target,{timeout:90000})
   await page.waitForFunction(()=>{const b=document.querySelector('.office-toolbar button');return !!b&&!b.disabled},{timeout:120000})
   const source=list.find(f=>f.path===legacy),original=await read(source.id)
   assert.equal(original.version,'1');assert.deepEqual(await fetchBytes(original),await readFile(fixtures+legacy))
  }
  const anonymous=await browser.newContext()
  assert.equal((await anonymous.request.post(`http://127.0.0.1:${port}/api/v1/office-bridge/${crypto.randomUUID()}/callback`,{data:{status:2,key:crypto.randomUUID(),url:'http://169.254.169.254/latest/meta-data'}})).status(),401)
  await anonymous.close()
  console.log('Real DOCX/XLSX keyboard editing, callback persistence, formula, device download/upload conflict, and DOC/XLS conversion passed')
 }
 assert.deepEqual(errors,[])
 console.log('PASS: account-sessions-'+phase+' actual file upload/HTTP/MySQL/browser')
} catch(error){if(page)await page.screenshot({path:output+'/failure-'+phase+'.png',fullPage:true}).catch(()=>{});throw error}
finally{if(browser)await browser.close();await server.close()}
