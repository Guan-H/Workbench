import assert from 'node:assert/strict'

/** Exercises the rendered calendar using real authenticated server responses. */
export async function checkCalendarInteractions(page, output) {
  const calendar = page.locator('.home-calendar')
  const selected = page.getByTestId('selected-calendar-date')
  const info = page.getByRole('button', { name: '日期与假期说明', exact: true })
  const response = await page.request.get(new URL('/api/v1/home/calendar', page.url()).href)
  assert.equal(response.status(), 200)
  const initial = await response.json()
  await calendar.locator(`[data-calendar-date="${initial.today}"]`).waitFor()
  assert.equal(await calendar.locator(`[data-calendar-date="${initial.today}"]`).getAttribute('aria-pressed'), 'true')
  const another = initial.days.find(day => day.date !== initial.today)
  await calendar.locator(`[data-calendar-date="${another.date}"]`).click()
  assert.equal(await calendar.locator(`[data-calendar-date="${another.date}"]`).getAttribute('aria-pressed'), 'true')
  assert.equal(await calendar.locator(`[data-calendar-date="${initial.today}"]`).getAttribute('aria-pressed'), 'false')
  assert.equal(await selected.locator('time').getAttribute('datetime'), another.date)
  assert.ok((await selected.innerText()).includes('星期'))
  assert.equal(await calendar.locator('.home-calendar-day.selected').count(), 1)
  await info.hover()
  await page.getByRole('tooltip').filter({ hasText: initial.notice }).waitFor()
  await page.getByRole('tooltip').getByText('休：放假；班：调休上班；灰底为周末。', { exact: true }).waitFor()
  assert.equal(await calendar.locator('.home-calendar-legend').count(), 0)
  assert.equal(await calendar.getByRole('link', { name: '官方安排来源' }).count(), 0)
  await page.locator('.home-month-controls h3').hover()
  await page.getByRole('tooltip').waitFor({ state: 'hidden' })
  await info.focus()
  await page.getByRole('tooltip').filter({ hasText: initial.notice }).waitFor()
  assert.equal(await calendar.locator('.home-calendar-notice').count(), 0)
  const nextDate = initial.days.find(day => day.date !== initial.today && day.date !== another.date)
  const nextButton = calendar.locator(`[data-calendar-date="${nextDate.date}"]`)
  await nextButton.focus(); await page.keyboard.press('Enter')
  assert.equal(await nextButton.getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: '本月', exact: true }).click()
  await page.waitForFunction(today => document.querySelector('[data-testid="selected-calendar-date"] time')?.getAttribute('datetime') === today, initial.today)

  let displayed = initial.month
  async function navigate(month) {
    while (displayed !== month) {
      const offset = displayed < month ? 1 : -1
      await page.getByRole('button', { name: offset > 0 ? '下个月' : '上个月', exact: true }).click()
      const date = new Date(displayed + '-01T00:00:00Z')
      date.setUTCMonth(date.getUTCMonth() + offset)
      displayed = date.toISOString().slice(0, 7)
      await calendar.locator(`[data-calendar-date="${displayed}-01"]`).waitFor()
    }
  }
  await navigate('2026-10')
  await calendar.locator('[data-calendar-date="2026-10-01"]').click()
  assert.ok((await selected.innerText()).includes('国庆节放假'))
  await calendar.locator('[data-calendar-date="2026-10-10"]').click()
  assert.ok((await selected.innerText()).includes('调休上班'))
  await calendar.locator('[data-calendar-date="2026-10-10"]').click()
  assert.equal(await calendar.locator('.home-calendar-day.selected').count(), 1)
  await navigate('2027-01')
  await info.hover()
  await page.getByRole('tooltip').filter({ hasText: '暂未收录' }).waitFor()
  await calendar.locator('[data-calendar-date="2027-01-02"]').click()
  assert.ok((await selected.innerText()).includes('放假与调休安排待确认'))
  assert.equal(await calendar.locator('.home-calendar-day.holiday, .home-calendar-day.makeup').count(), 0)
  await page.getByRole('button', { name: '本月', exact: true }).click()
  await page.waitForFunction(today => document.querySelector('[data-testid="selected-calendar-date"] time')?.getAttribute('datetime') === today, initial.today)
  for (const [width, height] of [[1440, 900], [375, 812]]) {
    await page.setViewportSize({ width, height })
    await calendar.scrollIntoViewIfNeeded()
    await info.click()
    await page.getByRole('tooltip').filter({ hasText: initial.notice }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: output + '/calendar-interactions-' + width + '.png', fullPage: true })
    await page.locator('.home-month-controls h3').click()
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
