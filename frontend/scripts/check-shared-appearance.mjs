import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
const port = Number(process.env.FEATURE_PORT)
const server = await createServer({server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':process.env.FEATURE_BACKEND}}})
await server.listen()
const browser = await chromium.launch({channel:'chrome'})
try {
  const write = process.argv[2] === 'write'
  const page = await browser.newPage({viewport:{width:write ? 1400 : 390,height:900}})
  await page.goto('http://127.0.0.1:'+port)
  await page.evaluate(async ({write,password,setupToken})=>{
    const {api}=await import('/src/shared/api/client.ts')
    await api(write?'/auth/initialize':'/auth/login',{method:'POST',body:JSON.stringify({username:'appearance-it',password,...(write?{setupToken}:{})})})
  },{write,password:process.env.FEATURE_PASSWORD,setupToken:process.env.FEATURE_SETUP})
  await page.reload()
  if(write){
    await page.locator('[data-nav="settings"]').click()
    const file=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=c.height=32
      const ctx=c.getContext('2d');ctx.fillStyle='#754528';ctx.fillRect(0,0,32,32)
      return c.toDataURL().split(',')[1]
    })
    await page.locator('.background-settings input[type=file]').first().setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from(file,'base64')})
    await page.getByRole('button',{name:/使用推荐配色/}).click()
    await page.getByRole('button',{name:'应用并同步'}).click()
    await page.getByText('外观已保存，其他设备刷新后生效').waitFor()
  }
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.workspace')).backgroundImage.includes('/settings/appearance/images/'))
  const result=await page.evaluate(async()=>{
    const {api}=await import('/src/shared/api/client.ts')
    const theme=await api('/settings/appearance')
    const image=await fetch('/api/v1/settings/appearance/images/'+theme.settings.desktop)
    return [theme.version,theme.settings.accent,image.status,image.headers.get('Content-Type')]
  })
  assert.deepEqual(result,[1,'#8b5f47',200,'image/jpeg'])
} finally {await browser.close();await server.close()}
