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
  const saveAndRead = async () => { await saved(); return call('/mindmaps/'+id) }
  snapshot = await saveAndRead()
  snapshot.document.nodeData.children.push({id:'palette-branch',topic:'另一条主分支',children:Array.from({length:9}, (_, index) => ({
    id:`palette-leaf-${index}`,topic:`需要校验连线的第 ${index + 1} 个子节点`,children:[],
  }))})
  await call('/mindmaps/'+id,'PUT',{baseVersion:snapshot.version,title:snapshot.title,document:snapshot.document})
  await page.reload();await page.locator('.global-sidebar').getByRole('button',{name:'思维导图',exact:true}).click()
  await list.locator(`[data-map-id="${id}"]`).click();await node('palette-branch').waitFor()
  const background = id => node(id).evaluate(el=>getComputedStyle(el).backgroundColor)
  assert.equal(await background('root'), 'rgb(38, 54, 75)')
  assert.equal(await background('branch'), 'rgb(202, 220, 245)')
  assert.equal(await background('leaf'), 'rgb(225, 235, 252)')
  assert.equal(await background('palette-branch'), 'rgb(203, 229, 208)')
  const paths = canvas.locator('me-nodes > .lines path')
  const assertPorts = async () => {
    const errors = await canvas.evaluate(host => {
      const nodes = [...host.querySelectorAll('me-tpc[data-nodeid]')]
      const topics = new Map(nodes.map(topic=>[topic.nodeObj.id, topic]))
      const paths = [...host.querySelectorAll('me-nodes > .lines path')]
      const children = nodes.filter(topic=>topic.nodeObj.parent)
      const failures = []
      if (paths.length !== children.length) return [`Found ${paths.length} paths for ${children.length} visible children`]
      for (const [index, child] of children.entries()) {
        const path = paths[index], parent = topics.get(child.nodeObj.parent.id)
        const childRect = child.getBoundingClientRect(), parentRect = parent.getBoundingClientRect()
        const direction = child.closest('me-main').className
        const centerX = box => (box.left + box.right) / 2
        const centerY = box => (box.top + box.bottom) / 2
        const expected = direction === 'down' ? [[centerX(parentRect),parentRect.bottom],[centerX(childRect),childRect.top]] :
          [[direction === 'lhs' ? parentRect.left : parentRect.right,centerY(parentRect)],
           [direction === 'lhs' ? childRect.right : childRect.left,centerY(childRect)]]
        const matrix = path.getScreenCTM()
        const endpoints = [path.getPointAtLength(0),path.getPointAtLength(path.getTotalLength())]
        const positioned = child.nodeObj.metadata?.position || parent.nodeObj.metadata?.position
        for (const [end, point] of endpoints.entries()) {
          const actual = point.matrixTransform(matrix)
          if (positioned) {
            const rect = end === 0 ? parentRect : childRect
            const nearX = Math.min(Math.abs(actual.x-rect.left),Math.abs(actual.x-rect.right))<1.5
            const nearY = Math.min(Math.abs(actual.y-rect.top),Math.abs(actual.y-rect.bottom))<1.5
            if (!(nearX && Math.abs(actual.y-centerY(rect))<1.5 || nearY && Math.abs(actual.x-centerX(rect))<1.5))
              failures.push(`${child.nodeObj.id}: custom endpoint ${end} is detached`)
          } else if (Math.hypot(actual.x-expected[end][0],actual.y-expected[end][1])>1.5) {
            failures.push(`${child.nodeObj.id}: ${direction} endpoint ${end} is on the wrong edge`)
          }
        }
      }
      return failures
    })
    assert.deepEqual(errors,[])
  }
  assert.deepEqual([...new Set(await paths.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('stroke'))))].sort(), ['#537fb6','#538367'])
  const styleButton = maps.getByRole('button', {name:'样式',exact:true})
  const drawer = maps.getByRole('complementary', {name:'导图样式'})
  const openDrawer = async () => { if (!(await drawer.isVisible())) await styleButton.click(); await drawer.waitFor() }
  const closeDrawer = async () => { await drawer.getByRole('button',{name:'关闭样式'}).click(); await drawer.waitFor({state:'detached'}) }
  const chooseLine = async label => {
    await openDrawer()
    await drawer.getByRole('button',{name:label,exact:true}).click()
    return saveAndRead()
  }
  await node('branch').click()
  const rootBeforeDrawer = await node('root').boundingBox()
  await openDrawer()
  assert.deepEqual(await node('root').boundingBox(), rootBeforeDrawer)
  await drawer.getByRole('button', {name:'紫色',exact:true}).click()
  snapshot = await saveAndRead()
  assert.equal(snapshot.document.nodeData.children[0].color, 'purple')
  assert.equal(await node('branch').evaluate(el=>getComputedStyle(el).backgroundColor), 'rgb(236, 227, 248)')
  assert.equal(await background('leaf'), 'rgb(225, 235, 252)')
  const chooseLayout = async (label,direction) => {
    await openDrawer()
    await drawer.locator('.ant-select-selector').click()
    await page.locator('.ant-select-dropdown:visible').getByText(label,{exact:true}).click()
    assert.equal((await saveAndRead()).document.direction,direction)
  }
  for (const [label,direction] of [['向下布局',3],['向左布局',0],['向右布局',1],['两侧布局',2]]) {
    await chooseLayout(label,direction)
    await assertPorts()
  }
  snapshot = await chooseLine('直角折线')
  assert.equal(snapshot.document.lineStyle, 'elbow')
  assert.ok((await paths.first().getAttribute('d')).includes(' H '))
  await assertPorts()
  snapshot = await chooseLine('直线')
  assert.equal(snapshot.document.lineStyle, 'straight')
  const originalPath = await paths.first().getAttribute('d')
  assert.match(originalPath, /^M .* L /)
  await page.screenshot({path:output+'/mindmap-style-desktop.png',animations:'disabled'})
  await closeDrawer()

  const handle = floating().getByRole('button', {name:'自由摆放节点'})
  const start = await handle.boundingBox(), before = await node('branch').boundingBox()
  const x = start.x + start.width / 2, y = start.y + start.height / 2
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 135, y + 110, {steps:12}); await page.mouse.up()
  snapshot = await saveAndRead()
  const freePosition = snapshot.document.nodeData.children[0].position
  assert.ok(Number.isInteger(freePosition.x) && Number.isInteger(freePosition.y))
  assert.ok(snapshot.document.nodeData.children[0].children.some(child=>child.id==='leaf'))
  const after = await node('branch').boundingBox()
  assert.ok(Math.abs(after.x - before.x - 135) <= 2 && Math.abs(after.y - before.y - 110) <= 2)
  assert.notEqual(await paths.first().getAttribute('d'), originalPath)
  await assertPorts()
  const download = page.waitForEvent('download')
  await maps.getByRole('button', {name:'导出 JSON',exact:true}).click()
  assert.deepEqual(JSON.parse(await readFile(await (await download).path(),'utf8')), snapshot.document)
  await maps.getByRole('button', {name:'撤销',exact:true}).click()
  assert.equal((await saveAndRead()).document.nodeData.children[0].position, undefined)
  await maps.getByRole('button', {name:'重做',exact:true}).click()
  assert.deepEqual((await saveAndRead()).document.nodeData.children[0].position, freePosition)
  await page.reload();await page.locator('.global-sidebar').getByRole('button',{name:'思维导图',exact:true}).click()
  await list.locator(`[data-map-id="${id}"]`).click();await node('branch').waitFor()
  await page.waitForFunction(({x,y})=>{
    const root=document.querySelector('[data-nodeid="meroot"]').getBoundingClientRect()
    const child=document.querySelector('[data-nodeid="mebranch"]').getBoundingClientRect()
    const scale=Number(document.querySelector('.mindmap-zoom').textContent.replace('%',''))/100
    return Math.abs(child.x+child.width/2-root.x-root.width/2-x*scale)<3 && Math.abs(child.y+child.height/2-root.y-root.height/2-y*scale)<3
  },freePosition)
  assert.equal(await node('branch').evaluate(el=>getComputedStyle(el).backgroundColor), 'rgb(236, 227, 248)')
  snapshot = await chooseLine('曲线')
  assert.equal(snapshot.document.lineStyle, undefined)
  assert.match(await paths.first().getAttribute('d'), /^M .* C /)
  await chooseLayout('向下布局',3)
  assert.deepEqual((await call('/mindmaps/'+id)).document.nodeData.children[0].position,freePosition)
  await assertPorts()
  await chooseLayout('两侧布局',2)
  await assertPorts()
  await closeDrawer()

  const leaf = await node('leaf').boundingBox(), root = await node('root').boundingBox()
  const fromX = leaf.x + leaf.width / 2, fromY = leaf.y + leaf.height / 2
  const dropped = page.waitForResponse(response=>response.url().endsWith('/mindmaps/'+id) && response.request().method()==='PUT' && response.ok())
  await page.mouse.move(fromX, fromY); await page.mouse.down(); await page.mouse.move(fromX+12, fromY+12, {steps:5})
  await page.mouse.move(root.x + root.width / 2, root.y + root.height / 2, {steps:18}); await page.mouse.up()
  await dropped
  snapshot = await saveAndRead()
  assert.ok(snapshot.document.nodeData.children.some(child=>child.id==='leaf'), 'structural drag reparents the leaf')
  assert.deepEqual(snapshot.document.nodeData.children.find(child=>child.id==='branch').position, freePosition)
  await node('branch').click({button:'right'});await menu().getByRole('menuitem',{name:'恢复自动位置'}).click()
  snapshot = await saveAndRead()
  assert.equal(snapshot.document.nodeData.children.find(child=>child.id==='branch').position, undefined)

  const invalidStyle = {...document, lineStyle:'forged'}
  const invalidPoint = {...document, nodeData:{...document.nodeData, position:{x:20001,y:0}}}
  for (const invalid of [invalidStyle, invalidPoint, {...document, nodeData:{...document.nodeData, color:'url(https://example.invalid)'}}]) {
    await assert.rejects(call('/mindmaps/'+crypto.randomUUID(),'PUT',{baseVersion:'0',title:'非法样式',document:invalid}), /有效的导图 JSON/)
  }
  for(let index=0;index<11;index++)await call('/mindmaps/'+crypto.randomUUID(),'PUT',{baseVersion:'0',title:'B 分页 '+index,document})
  await maps.getByRole('button',{name:'刷新列表',exact:true}).click();await footer().getByText(/共 12 份/).waitFor()
  a=await list.boundingBox();b=await footer().boundingBox();assert.ok(Math.abs(a.y+a.height-(b.y+b.height)-16)<3,'pagination must not move when item count changes')
  const scroll=await maps.getByLabel('导图条目',{exact:true}).evaluate(element=>({overflow:getComputedStyle(element).overflowY,client:element.clientHeight,scroll:element.scrollHeight}));assert.equal(scroll.overflow,'auto')
  await page.screenshot({path:output+'/mindmap-ux-desktop.png',animations:'disabled'})
  await page.setViewportSize({width:1440,height:600});await page.waitForFunction(()=>{const list=document.querySelector('.mindmap-list-scroll');return list.scrollHeight>list.clientHeight});a=await list.boundingBox();b=await footer().boundingBox();assert.ok(Math.abs(a.y+a.height-(b.y+b.height)-16)<3);await page.screenshot({path:output+'/mindmap-ux-short.png',animations:'disabled'})
  await page.setViewportSize({width:375,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth)
  await openDrawer();assert.ok((await drawer.boundingBox()).width<=375)
  await page.screenshot({path:output+'/mindmap-style-mobile.png',animations:'disabled'})
  await closeDrawer()
  await list.scrollIntoViewIfNeeded();await page.screenshot({path:output+'/mindmap-ux-mobile.png',animations:'disabled'})
  a=await list.boundingBox();b=await footer().boundingBox();assert.ok(b.y+b.height<=a.y+a.height+1)
  assert.deepEqual(errors,[]);await writeFile(output+'/ux-result.json',JSON.stringify({paginationBottom:true,realNodeWrites:true,keyboardUndoOnce:true,context:true,zoom:true,scroll,errors},null,2))
  console.log('PASS mindmap UX: real server-backed edits, colors and line styles, free positioning and hierarchy drag, undo/reload, context/folding and 375px')
}catch(error){if(page)await page.screenshot({path:output+'/failure-ux.png',fullPage:true}).catch(()=>{});throw error}
finally{await browser?.close();await server.close()}
