import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'

const backend=process.env.FEATURE_BACKEND,port=Number(process.env.FEATURE_PORT),output=process.env.FEATURE_OUTPUT
assert.ok(output&&port&&/^http:\/\/127\.0\.0\.1:\d+$/.test(backend))
const server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),plugins:[vue()],logLevel:'error',server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':backend}}})
let browser,page
try{
  await server.listen();browser=await chromium.launch({channel:'chrome'});const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage()
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://127.0.0.1:${port}`)
  const call=(path,method='GET',body)=>page.evaluate(async({path,method,body})=>{const{api}=await import('/src/shared/api/client.ts');return api(path,{method,body:body===undefined?undefined:JSON.stringify(body),headers:{'Idempotency-Key':crypto.randomUUID()}})},{path,method,body})
  await call('/auth/initialize','POST',{username:'map-ux-it',password:process.env.FEATURE_PASSWORD,setupToken:process.env.FEATURE_SETUP})
  const id=crypto.randomUUID(),document={format:'workbench-mindmap',schemaVersion:1,direction:2,nodeData:{id:'root',topic:'交互验证',children:[{id:'branch',topic:'一个分支',children:[{id:'leaf',topic:'叶节点',children:[]}]}]}}
  await call('/mindmaps/'+id,'PUT',{baseVersion:'0',title:'A 交互导图',document})
  await page.reload();await page.locator('.global-sidebar').getByRole('button',{name:'思维导图',exact:true}).click()
  const maps=page.getByRole('region',{name:'思维导图页面',exact:true}),list=maps.getByLabel('导图列表',{exact:true})
  await list.locator(`[data-map-id="${id}"]`).click()
  const canvas=maps.getByLabel('思维导图画布',{exact:true}),editor=()=>canvas.locator('#input-box'),node=id=>canvas.locator(`[data-nodeid="me${id}"]`)
  await node('root').waitFor()
  const canvasBox=await canvas.boundingBox(),frameBox=await maps.locator('.mindmap-frame').boundingBox();assert.ok(Math.abs(canvasBox.height-frameBox.height)<2,'the editable canvas must fill its whole frame')
  const footer=()=>list.locator('footer')
  let a=await list.boundingBox(),b=await footer().boundingBox();assert.ok(Math.abs(a.y+a.height-(b.y+b.height)-16)<3,'one-item pagination must sit at the sidebar bottom')
  await node('branch').click();await maps.getByRole('toolbar',{name:'当前节点快捷操作',exact:true}).waitFor()
  await node('branch').click({button:'right'});const menu=()=>page.getByRole('menu',{name:'导图右键菜单',exact:true})
  await menu().waitFor();await menu().getByRole('menuitem',{name:/插入子节点/}).click();await editor().fill('右键新增');await editor().press('Enter')
  const saved=()=>maps.locator('.mindmap-title [role=status]').filter({hasText:/^服务器已保存$/}).waitFor()
  await saved();let snapshot=await call('/mindmaps/'+id);assert.ok(snapshot.document.nodeData.children[0].children.some(child=>child.topic==='右键新增'))
  // One keyboard undo must undo exactly one edit, then redo restores it.
  await canvas.focus();await canvas.press('Control+z');await saved();snapshot=await call('/mindmaps/'+id);assert.ok(snapshot.document.nodeData.children[0].children.some(child=>child.topic==='新节点'))
  await canvas.press('Control+y');await saved();snapshot=await call('/mindmaps/'+id);assert.ok(snapshot.document.nodeData.children[0].children.some(child=>child.topic==='右键新增'))
  const added=snapshot.document.nodeData.children[0].children.find(child=>child.topic==='右键新增')
  await node(added.id).click();await canvas.focus();await canvas.press('F2');await editor().fill('快捷键编辑');await editor().press('Control+s');await saved()
  assert.ok((await call('/mindmaps/'+id)).document.nodeData.children[0].children.some(child=>child.topic==='快捷键编辑'))
  // Floating controls act on the selected node and folding persists through the real API.
  await node('branch').click();const floating=()=>maps.getByRole('toolbar',{name:'当前节点快捷操作',exact:true})
  await floating().getByRole('button',{name:'收起当前分支',exact:true}).click();await saved();assert.equal((await call('/mindmaps/'+id)).document.nodeData.children[0].expanded,false)
  await node('branch').click();await floating().getByRole('button',{name:'展开当前分支',exact:true}).click();await saved();assert.equal((await call('/mindmaps/'+id)).document.nodeData.children[0].expanded,true)
  // The center topic has no ordinary expander. Its controls fold all branches and must persist.
  await node('root').click();await floating().getByRole('button',{name:'收起全部分支',exact:true}).click();await saved()
  assert.ok((await call('/mindmaps/'+id)).document.nodeData.children.every(child=>child.expanded===false))
  assert.equal(await node('leaf').count(),0)
  await node('root').click();await floating().getByRole('button',{name:'展开全部分支',exact:true}).click();await saved();await node('leaf').waitFor()
  await canvas.focus();await canvas.press('ArrowLeft');await saved()
  assert.ok((await call('/mindmaps/'+id)).document.nodeData.children.every(child=>child.expanded===false))
  await canvas.press('ArrowRight');await saved();await node('leaf').waitFor()
  const allBranches=async label=>{
    await canvas.click({button:'right',position:{x:20,y:20}});await menu().waitFor()
    await menu().getByRole('menuitem',{name:label,exact:true}).click();await saved()
  }
  await allBranches('收起全部分支');const collapsed=(await call('/mindmaps/'+id)).document
  assert.ok(collapsed.nodeData.children.every(child=>child.expanded===false))
  await page.reload();await page.locator('.global-sidebar').getByRole('button',{name:'思维导图',exact:true}).click()
  await list.locator(`[data-map-id="${id}"]`).click();await node('root').waitFor()
  assert.deepEqual((await call('/mindmaps/'+id)).document,collapsed);assert.equal(await node('leaf').count(),0)
  await allBranches('展开全部分支');await node('leaf').waitFor()
  await node('root').click({button:'right'});await menu().waitFor();assert.ok(await menu().getByRole('menuitem',{name:/删除节点/}).getAttribute('aria-disabled').then(value=>value==='true'));await page.keyboard.press('Escape')
  // Context menu at the bottom edge stays within the actual browser viewport.
  const c=await canvas.boundingBox();await canvas.click({button:'right',position:{x:c.width-8,y:c.height-8}});await menu().waitFor()
  const menuBox=await page.locator('.mindmap-context-menu').boundingBox();assert.ok(menuBox.y+menuBox.height<=1000&&menuBox.x+menuBox.width<=1440)
  await page.keyboard.press('Escape');await maps.getByRole('button',{name:'恢复 100% 缩放',exact:true}).click();assert.equal(await maps.locator('.mindmap-zoom').textContent(),'100%')
  await maps.getByRole('button',{name:'放大画布',exact:true}).click();assert.equal(await maps.locator('.mindmap-zoom').textContent(),'110%')
  await maps.getByRole('button',{name:'缩小画布',exact:true}).click();assert.equal(await maps.locator('.mindmap-zoom').textContent(),'100%')
  for(let index=0;index<11;index++)await call('/mindmaps/'+crypto.randomUUID(),'PUT',{baseVersion:'0',title:'B 分页 '+index,document})
  await maps.getByRole('button',{name:'刷新列表',exact:true}).click();await footer().getByText(/共 12 份/).waitFor()
  a=await list.boundingBox();b=await footer().boundingBox();assert.ok(Math.abs(a.y+a.height-(b.y+b.height)-16)<3,'pagination must not move when item count changes')
  const scroll=await maps.getByLabel('导图条目',{exact:true}).evaluate(element=>({overflow:getComputedStyle(element).overflowY,client:element.clientHeight,scroll:element.scrollHeight}));assert.equal(scroll.overflow,'auto')
  await page.screenshot({path:output+'/mindmap-ux-desktop.png',animations:'disabled'})
  await page.setViewportSize({width:1440,height:600});await page.waitForFunction(()=>{const list=document.querySelector('.mindmap-list-scroll');return list.scrollHeight>list.clientHeight});a=await list.boundingBox();b=await footer().boundingBox();assert.ok(Math.abs(a.y+a.height-(b.y+b.height)-16)<3);await page.screenshot({path:output+'/mindmap-ux-short.png',animations:'disabled'})
  await page.setViewportSize({width:375,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth)
  await list.scrollIntoViewIfNeeded();await page.screenshot({path:output+'/mindmap-ux-mobile.png',animations:'disabled'})
  a=await list.boundingBox();b=await footer().boundingBox();assert.ok(b.y+b.height<=a.y+a.height+1)
  assert.deepEqual(errors,[]);await writeFile(output+'/ux-result.json',JSON.stringify({paginationBottom:true,realNodeWrites:true,keyboardUndoOnce:true,context:true,zoom:true,scroll,errors},null,2))
  console.log('PASS mindmap UX: real server-backed edits, bottom pagination, context/floating controls, F2/Ctrl+S/one undo, fold/zoom and 375px')
}catch(error){if(page)await page.screenshot({path:output+'/failure-ux.png',fullPage:true}).catch(()=>{});throw error}
finally{await browser?.close();await server.close()}
