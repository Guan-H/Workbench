import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'

const phase = process.argv[2], output = process.env.COURSE_OUTPUT
const backend = process.env.COURSE_BACKEND, port = Number(process.env.COURSE_FRONTEND_PORT)
assert.ok(output && port && /^http:\/\/127\.0\.0\.1:\d+$/.test(backend))
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)),
  plugins: [vue()], logLevel: 'error', optimizeDeps: { include: ['libsodium-wrappers-sumo'] },
  server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': backend } } })
let browser, page
try {
  await server.listen()
  browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
    ...(phase === 'restart' ? { storageState: output + '/browser.json' } : {}) })
  page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.stack || error.message))
  await page.goto('http://127.0.0.1:' + port)
  const call = (path, method = 'GET', body, operation = crypto.randomUUID()) => page.evaluate(async args => {
    const { api } = await import('/src/shared/api/client.ts')
    try { return { status: 200, value: await api(args.path, { method: args.method,
      body: args.body === undefined ? undefined : JSON.stringify(args.body),
      headers: { 'Idempotency-Key': args.operation } }) } }
    catch (error) { return { status: error.status, code: error.code } }
  }, { path, method, body, operation })
  const base = '/home/english/courses', id = 'sentence-basics', path = base + '/' + id
  const choose = async name => page.locator('.learning-page > header .ant-radio-button-wrapper').filter({ hasText: new RegExp('^' + name + '$') }).click()
  const open = async () => {
    await page.locator('.global-sidebar').getByRole('button', { name: '学习', exact: true }).click()
    await choose('阅读')
    await page.locator('.course-card').first().getByRole('button', { name: /打开阅读|继续阅读/ }).click()
    await page.locator('.course-learning > h2').waitFor()
  }
  const read = async () => (await call(path)).value
  const waitPosition = async position => {
    await page.waitForFunction(position => {
      const button = [...document.querySelectorAll('.course-learning nav button')].find(el => el.classList.contains('ant-btn-primary'))
      return button?.textContent?.includes(position)
    }, position)
    await page.getByRole('button', { name: /^(收藏文章|取消收藏)$/ }).filter({ visible: true }).waitFor()
    await page.waitForFunction(() => !document.querySelector('.course-learning')?.getAttribute('aria-busy')?.includes('true'))
  }
  if (phase === 'restart') {
    const saved = JSON.parse(await readFile(output + '/result.json', 'utf8'))
    assert.deepEqual(await read(), saved)
    await open()
    await waitPosition('句子 2')
    await page.getByText('词形变化', { exact: true }).click()
    assert.ok(await page.locator('.course-sentence details').nth(1).locator('p').isVisible())
    await page.getByRole('button', { name: '返回列表', exact: true }).click()
    await choose('我的积累')
    await page.locator('.course-card').first().waitFor()
    assert.equal(await page.locator('.course-card').count(), 1)
    await page.getByRole('button', { name: '标记短句', exact: true }).click()
    await page.locator('.sentence-card').first().waitFor()
    assert.equal(await page.locator('.sentence-card').count(), 1)
    await choose('短句')
    await page.locator('.sentence-card').first().waitFor()
    assert.equal(await page.locator('.sentence-card').count(), 10)
    await page.getByRole('button', { name: '看看怎么理解', exact: true }).first().click()
    await waitPosition('句子 1')
    await page.screenshot({ path: output + '/short-sentence-desktop.png', animations: 'disabled' })
    await page.getByRole('button', { name: '返回列表', exact: true }).click()
    await choose('阅读')
    await page.locator('.course-card').first().getByRole('button', { name: '继续阅读', exact: true }).click()
    await page.getByRole('button', { name: '换一篇', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.course-learning > h2')?.textContent?.includes('图书馆'))
    await page.getByRole('button', { name: '返回列表', exact: true }).click()
    await choose('我的积累')
    await page.locator('.course-card').first().getByRole('button', { name: '继续阅读', exact: true }).click()
    await page.getByRole('button', { name: '取消收藏', exact: true }).click()
    await page.getByRole('button', { name: '收藏文章', exact: true }).waitFor()
    assert.equal((await call(base + '?filter=favorite')).value.total, 0)
    assert.equal((await call(base + '/sentences?markedOnly=true')).value.total, 1)
    console.log('PASS course restart: exact answer/position/completion/review state survived MySQL/backend restart')
  } else {
    const anon = await browser.newContext()
    assert.equal((await anon.request.get('http://127.0.0.1:' + port + '/api/v1' + base)).status(), 401)
    await anon.close()
    assert.equal((await call('/auth/initialize', 'POST', { username: 'course-it', password: process.env.COURSE_PASSWORD, setupToken: process.env.COURSE_SETUP_TOKEN })).status, 200)
    assert.equal((await context.request.put('http://127.0.0.1:' + port + '/api/v1' + path + '/progress', { headers: { Origin: 'http://127.0.0.1:' + port }, data: { action: 'position', baseRevision: '0', position: 'article' } })).status(), 403)
    assert.equal((await context.request.put('http://127.0.0.1:' + port + '/api/v1' + path + '/progress', { data: { action: 'position', baseRevision: '0', position: 'article' } })).status(), 403)
    const catalog = (await call(base)).value
    const legacyProgress = (await call(base + '/word-forms')).value.summary
    assert.equal(legacyProgress.favorite, false)
    assert.equal(legacyProgress.completed, true)
    assert.equal(legacyProgress.position, 'sentence-1')
    assert.equal(catalog.total, 5)
    assert.equal((await call(base + '/sentences')).value.total, 15)
    assert.equal((await call(base + '/sentences')).value.items.length, 10)
    assert.equal((await call(base + '/sentences?page=2')).value.items.length, 5)
    assert.equal((await call(base + '/sentences?markedOnly=true')).value.total, 0)
    assert.equal((await call(base + '?filter=favorite')).value.total, 0)
    assert.equal((await call(base + '?filter=invalid')).status, 400)
    assert.ok(catalog.items.every(item => !/^第.+课/.test(item.title)))
    for (const item of catalog.items) {
      const course = (await call(base + '/' + item.id)).value
      assert.match(item.source, /原创.*非真题/)
      assert.ok(course.article.text.split(/\s+/).length >= 80)
      assert.equal(course.sentences.length, 3); assert.equal(course.words.length, 5); assert.equal(course.questions.length, 3)
      for (const sentence of course.sentences) assert.ok(course.article.text.includes(sentence.text))
      for (const question of course.questions) assert.equal(question.answer, null)
    }
    assert.equal((await call(base + '/missing')).status, 404)
    const operation = crypto.randomUUID(), request = { action: 'position', baseRevision: '0', position: 'sentence-0' }
    const concurrent = await Promise.all([call(path + '/progress', 'PUT', request, operation), call(path + '/progress', 'PUT', request, operation)])
    concurrent.forEach(value => assert.equal(value.status, 200))
    assert.deepEqual(concurrent[0].value, concurrent[1].value)
    assert.equal((await read()).summary.revision, '1')
    assert.equal((await call(path + '/progress', 'PUT', { ...request, position: 'practice' }, operation)).status, 409)
    assert.equal((await call(path + '/progress', 'PUT', request)).status, 409)
    assert.equal((await call(path + '/progress', 'PUT', { action: 'answer', baseRevision: '1', index: 50, choice: 0 })).status, 400)
    assert.equal((await call(path + '/progress', 'PUT', { action: 'position', baseRevision: '1', position: 'sentence-99' })).status, 400)
    assert.equal((await call(path + '/progress', 'PUT', { action: 'finish', baseRevision: '1' })).status, 409)
    assert.equal((await read()).summary.revision, '1')
    await page.reload(); await open(); await waitPosition('句子 1')
    const details = page.locator('.course-sentence details')
    assert.equal(await details.locator('p:visible').count(), 0)
    await details.nth(2).locator('summary').click()
    assert.ok(await details.nth(2).locator('p').isVisible())
    await page.getByRole('button', { name: '还不理解，加入复习', exact: true }).click()
    await page.getByRole('button', { name: '已理解，移出复习', exact: true }).waitFor()
    let lost = true
    await page.route('**/courses/sentence-basics/progress', async route => {
      if (lost) { lost = false; await route.fetch(); await route.abort('failed') }
      else await route.continue()
    })
    await page.getByRole('button', { name: '句子 2', exact: true }).click()
    await page.getByRole('button', { name: '重试保存', exact: true }).waitFor()
    const committedRevision = (await read()).summary.revision
    await page.reload(); await open()
    await page.getByRole('button', { name: '重试保存', exact: true }).click()
    await waitPosition('句子 2')
    assert.equal((await read()).summary.revision, committedRevision)
    await page.unroute('**/courses/sentence-basics/progress')
    await page.getByRole('button', { name: '阅读短文', exact: true }).click(); await waitPosition('阅读短文')
    await page.screenshot({ path: output + '/article-desktop.png', animations: 'disabled' })
    await page.getByRole('button', { name: '随手练习', exact: true }).click(); await waitPosition('随手练习')
    const question = index => page.getByLabel('理解题 ' + (index + 1), { exact: true })
    assert.equal(await page.locator('.course-feedback').count(), 0)
    for (const [index, choice] of [0, 0, 2].entries()) {
      await question(index).locator('.ant-radio-wrapper').nth(choice).click()
      await question(index).getByRole('button', { name: '提交第 ' + (index + 1) + ' 题', exact: true }).click()
      await question(index).locator('.course-feedback').waitFor()
      assert.ok((await question(index).locator('blockquote').innerText()).length > 10)
    }
    assert.equal((await read()).wrong.length, 1)
    await question(0).getByRole('button', { name: '再练一次', exact: true }).click()
    await question(0).locator('.ant-radio-wrapper').nth(1).click()
    await question(0).getByRole('button', { name: '提交第 1 题', exact: true }).click()
    await question(0).getByText('回答正确', { exact: true }).waitFor()
    assert.equal((await read()).wrong.length, 0)
    assert.equal(await page.getByRole('button', { name: '完成本课', exact: true }).count(), 0)
    assert.equal((await read()).summary.completed, false)
    await page.getByRole('button', { name: '收藏文章', exact: true }).click()
    await page.getByRole('button', { name: '取消收藏', exact: true }).waitFor()
    assert.equal((await call(base + '?filter=favorite')).value.total, 1)
    // Another real browser/API write changes revision; old confirmation must not overwrite it.
    const before = await read()
    await call(path + '/progress', 'PUT', { action: 'position', baseRevision: before.summary.revision, position: 'sentence-1' })
    await page.getByRole('button', { name: '阅读短文', exact: true }).click()
    await page.getByRole('button', { name: '核对服务器进度', exact: true }).click()
    await page.getByRole('button', { name: '采用服务器进度', exact: true }).click()
    await waitPosition('句子 2')
    await page.setViewportSize({ width: 375, height: 844 })
    await page.locator('.course-sentence summary').nth(2).click()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: output + '/sentence-mobile.png', animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: output + '/sentence-desktop.png', animations: 'disabled' })
    await context.storageState({ path: output + '/browser.json' })
    await writeFile(output + '/result.json', JSON.stringify(await read()))
    console.log('PASS real courses: 5 lessons, hidden answers, grading, review, reading resume, conditional writes, concurrent retries, lost response and mobile layout')
  }
  assert.deepEqual(errors, [])
} catch (error) {
  await page?.screenshot({ path: output + '/failure-' + phase + '.png', fullPage: true }).catch(() => {})
  throw error
} finally { await browser?.close(); await server.close() }
