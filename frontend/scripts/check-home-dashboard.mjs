import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** Verifies homepage actions against real Spring HTTP, MySQL and file storage. */
export async function checkHomeDashboard(page, request, output) {
  const externalRequests = []
  const trackRequest = request => {
    if (new URL(request.url()).origin !== new URL(page.url()).origin) externalRequests.push(request.url())
  }
  page.on('request', trackRequest)
  async function catalog() {
    const items = []
    let cursor = ''
    do {
      const response = await request('/notes?cursor=' + encodeURIComponent(cursor))
      assert.equal(response.status, 200)
      items.push(...response.body.items)
      cursor = response.body.nextCursor
    } while (cursor)
    return items
  }
  const january = await request('/home/calendar?month=2026-01')
  assert.equal(january.status, 200)
  assert.equal(january.body.days.length, 31)
  assert.equal(january.body.days[0].holiday, '元旦')
  assert.equal(january.body.days[3].kind, 'makeup')
  assert.equal(january.body.timeZone, 'Asia/Shanghai')
  assert.ok(january.body.source.url.startsWith('https://www.wuhan.gov.cn/'))
  assert.equal((await request('/home/calendar?month=2026-13')).status, 400)
  const unknown = await request('/home/calendar?month=2028-02')
  assert.equal(unknown.body.days.length, 29)
  assert.equal(unknown.body.available, false)
  assert.equal(unknown.body.source, null)
  assert.ok(unknown.body.days.every(day => !['holiday', 'makeup'].includes(day.kind)))
  const anonymous = await page.context().browser().newContext()
  try { assert.equal((await anonymous.request.get(new URL('/api/v1/home/calendar', page.url()).href)).status(), 401) }
  finally { await anonymous.close() }

  for (let index = 1; index <= 8; index++) {
    const result = await request('/notes', 'POST', { path: `首页验收-${index}.md`, type: 'note', content: `# 首页真实记录 ${index}\n` })
    assert.equal(result.status, 200)
    assert.equal((await request(`/notes/${result.body.id}/favorite?value=true`, 'PUT')).status, 200)
  }
  const deleted = await request('/notes', 'POST', { path: '首页不可显示的回收站.md', type: 'note', content: '# 已删除' })
  assert.equal((await request(`/notes/${deleted.body.id}?baseVersion=${deleted.body.version}`, 'DELETE')).status, 200)
  assert.equal((await request('/notes', 'POST', { path: '首页不可列为笔记的目录', type: 'folder' })).status, 200)
  const nav = page.getByRole('navigation', { name: '主要导航' })
  async function home() {
    await nav.getByRole('button', { name: '工作台', exact: true }).click()
    await page.locator('.home-note-list [data-home-note]').first().waitFor()
    await page.locator('.home-month').waitFor()
  }
  await home()
  const active = (await catalog()).filter(note => !note.deleted && note.type === 'note')
  const expectedRecent = [...active].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.path.localeCompare(b.path)).slice(0, 3)
  const expectedFavorites = active.filter(note => note.favorite).sort((a, b) => a.path.localeCompare(b.path)).slice(0, 3)
  assert.deepEqual(await page.locator('[data-home-note]').evaluateAll(elements => elements.map(element => element.dataset.homeNote)), expectedRecent.map(note => note.id))
  await page.getByRole('tab', { name: '最近编辑', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('tab', { name: '常用收藏', exact: true }).getAttribute('aria-selected'), 'true')
  assert.deepEqual(await page.locator('[data-home-favorite]').evaluateAll(elements => elements.map(element => element.dataset.homeFavorite)), expectedFavorites.map(note => note.id))
  await page.keyboard.press('Home')
  assert.equal(await page.getByRole('tab', { name: '最近编辑', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.locator(`[data-home-note="${deleted.body.id}"]`).count(), 0)

  const latest = expectedRecent[0]
  const latestContent = (await request('/notes/' + latest.id)).body.content
  await page.locator(`[data-home-note="${latest.id}"]`).click()
  await page.waitForFunction(path => document.querySelector('.document-tab')?.textContent.includes(path), latest.path)
  assert.ok((await page.getByTestId('markdown-editor').innerText()).includes(latestContent.trim()))
  await home()
  const favorite = expectedFavorites[0]
  await page.getByRole('tab', { name: '常用收藏', exact: true }).click()
  await page.locator(`[data-home-favorite="${favorite.id}"]`).click()
  await page.waitForFunction(path => document.querySelector('.document-tab')?.textContent.includes(path), favorite.path)
  await home()
  await page.getByRole('tab', { name: '常用收藏', exact: true }).click()
  await page.getByRole('button', { name: '全部收藏', exact: true }).click()
  assert.ok(await page.getByRole('button', { name: '收藏', exact: true }).evaluate(element => element.classList.contains('active')))

  await home()
  for (const name of ['新建笔记', '新建文件夹', '导入目录']) {
    assert.equal(await page.locator('.home-content').getByRole('button', { name, exact: true }).count(), 0)
  }
  const calendarBox = await page.locator('.home-calendar').boundingBox()
  assert.ok(calendarBox.width >= 332 && calendarBox.width <= 400)
  assert.ok((await page.locator('.home-documents').boundingBox()).height <= 340)

  // Navigate the actual month controls, including year rollover and unpublished schedule states.
  const current = (await request('/home/calendar')).body.month
  let displayed = current
  for (let step = 0; displayed !== '2026-10' && step < 2400; step++) {
    const direction = displayed < '2026-10' ? 1 : -1
    const date = new Date(displayed + '-01T00:00:00Z')
    date.setUTCMonth(date.getUTCMonth() + direction)
    displayed = date.toISOString().slice(0, 7)
    await page.getByRole('button', { name: direction === 1 ? '下个月' : '上个月', exact: true }).click()
    await page.locator(`[data-calendar-date="${displayed}-01"]`).waitFor()
  }
  assert.equal((await page.locator('[data-calendar-date="2026-10-01"]').innerText()).replace(/\s/g, ''), '1休')
  assert.equal((await page.locator('[data-calendar-date="2026-10-10"]').innerText()).replace(/\s/g, ''), '10班')
  await page.screenshot({ path: fileURLToPath(new URL('home-official-october.png', output)) })
  for (let step = 0; step < 3; step++) {
    await page.getByRole('button', { name: '下个月', exact: true }).click()
    const date = new Date(displayed + '-01T00:00:00Z')
    date.setUTCMonth(date.getUTCMonth() + 1)
    displayed = date.toISOString().slice(0, 7)
    await page.locator(`[data-calendar-date="${displayed}-01"]`).waitFor()
  }
  assert.equal(displayed, '2027-01')
  await page.getByRole('button', { name: '日期与假期说明', exact: true }).hover()
  await page.getByRole('tooltip').filter({ hasText: '暂未收录' }).waitFor()
  assert.equal(await page.locator('.home-calendar-day.holiday, .home-calendar-day.makeup').count(), 0)
  await page.getByRole('button', { name: '本月', exact: true }).click()
  await page.locator(`[data-calendar-date="${current}-01"]`).waitFor()

  for (const [width, height] of [[1440, 960], [375, 812], [812, 375]]) {
    await page.setViewportSize({ width, height })
    await page.getByRole('tab', { name: '最近编辑', exact: true }).click()
    await page.locator('.home-content').evaluate(element => { element.scrollTop = 0 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.ok(await page.locator('.home-content').evaluate(element => element.scrollWidth <= element.clientWidth))
    assert.ok(await page.locator('.home-content').evaluate(element => {
      const styles = getComputedStyle(element)
      const dashboard = element.querySelector('.home-dashboard').getBoundingClientRect()
      const outer = element.getBoundingClientRect()
      return Math.abs(dashboard.x - outer.x - parseFloat(styles.paddingLeft)) < 2
        && Math.abs(dashboard.width - (element.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight))) < 2
    }), 'dashboard fills available content width without centered maximum-width gutters')
    await page.screenshot({ path: fileURLToPath(new URL(`home-dashboard-${width}.png`, output)) })
    await page.getByRole('tab', { name: '常用收藏', exact: true }).click()
    await page.locator('[data-home-favorite]').last().scrollIntoViewIfNeeded()
    assert.ok(await page.locator('[data-home-favorite]').last().isVisible())
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  page.off('request', trackRequest)
  assert.deepEqual(externalRequests, [], 'homepage makes no external hot-list or news requests')
  await writeFile(new URL('home-dashboard.json', output), JSON.stringify({
    calendar: 'authenticated real calendar API; official holiday and makeup dates; leap year, invalid month, unknown-year and rollover checks passed',
    notes: 'real MySQL-backed recent and favorite tabs, 3 records each; keyboard tab switching, deleted/folder exclusion and real editor links verified',
    actions: 'homepage creation/import shortcuts removed; existing note-page actions covered by the original regression suite; no external news requests',
    layout: '1440, 375 and 812 px; full content width and no horizontal overflow; desktop calendar 332–400 px; compact document panel <=340 px high; internal scrolling reaches favorites',
  }, null, 2))
}
