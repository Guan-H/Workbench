import assert from 'node:assert/strict'

/** Real signed-in page and Web Crypto; only the explicit clipboard-denial case injects a failure. */
export async function checkPasswordGenerator(page, output) {
  const panel = page.locator('.password-generator')
  const field = panel.getByLabel('生成的密码', { exact: true })
  const requests = []
  const generated = []
  const record = request => { requests.push({ url: request.url(), body: request.postData() ?? '' }) }
  page.on('request', record)
  try {
    await panel.scrollIntoViewIfNeeded()
    assert.equal(await panel.getByLabel('密码长度', { exact: true }).inputValue(), '20')
    assert.equal(await field.count(), 0, 'no password is generated before an explicit action')
    await panel.getByRole('button', { name: '生成密码', exact: true }).click()
    const first = await field.inputValue(); generated.push(first)
    assert.equal(first.length, 20)
    for (const pattern of [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/]) assert.ok(pattern.test(first))
    assert.equal(await field.getAttribute('type'), 'password')
    await panel.getByRole('button', { name: '显示生成的密码', exact: true }).click()
    assert.equal(await field.getAttribute('type'), 'text')
    await page.waitForFunction(() => document.getElementById('generated-password')?.getAttribute('type') === 'password', undefined, { timeout: 35000 })
    assert.equal(await field.inputValue(), first, 'auto-hide preserves the current result for copying')
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await panel.getByRole('button', { name: '复制密码', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '密码已复制' }).waitFor()
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), first)

    // Verify failure feedback without pretending the copy succeeded.
    await page.evaluate(() => {
      window.originalGeneratorClipboardWrite = navigator.clipboard.writeText.bind(navigator.clipboard)
      navigator.clipboard.writeText = () => Promise.reject(new DOMException('Denied in fault injection', 'NotAllowedError'))
    })
    try {
      await panel.getByRole('button', { name: '复制密码', exact: true }).click()
      await panel.getByRole('alert').filter({ hasText: '复制失败' }).waitFor()
      await panel.getByRole('button', { name: '显示生成的密码', exact: true }).click()
      assert.equal(await field.getAttribute('type'), 'text')
      await field.focus(); await page.keyboard.press('Control+a')
      assert.equal(await page.evaluate(() => window.getSelection()?.toString() || document.getElementById('generated-password')?.value.slice(document.getElementById('generated-password')?.selectionStart, document.getElementById('generated-password')?.selectionEnd)), first)
    } finally { await page.evaluate(() => { navigator.clipboard.writeText = window.originalGeneratorClipboardWrite; delete window.originalGeneratorClipboardWrite }) }

    for (const name of ['大写字母', '小写字母', '符号']) await panel.getByRole('checkbox', { name, exact: false }).uncheck()
    assert.equal(await field.count(), 0, 'changing options clears the previous result')
    await panel.getByLabel('密码长度', { exact: true }).fill('32')
    await panel.getByRole('button', { name: '生成密码', exact: true }).click()
    const digits = await field.inputValue(); generated.push(digits)
    assert.match(digits, /^[0-9]{32}$/)
    for (const [width, height] of [[1440, 900], [375, 812]]) {
      await page.setViewportSize({ width, height }); await panel.scrollIntoViewIfNeeded()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      assert.equal(await field.getAttribute('type'), 'password')
      await page.screenshot({ path: output + '/password-generator-' + width + '.png', fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await panel.getByRole('checkbox', { name: '数字', exact: false }).uncheck()
    assert.ok(await panel.getByRole('button', { name: '生成密码', exact: true }).isDisabled())
    await panel.getByRole('alert').filter({ hasText: '至少选择一种字符类型' }).waitFor()
    await panel.getByRole('checkbox', { name: '数字', exact: false }).check()
    await panel.getByRole('button', { name: '生成密码', exact: true }).click()
    generated.push(await field.inputValue())
    await panel.getByRole('button', { name: '清除结果', exact: true }).click()
    assert.equal(await field.count(), 0)
    await panel.getByRole('button', { name: '生成密码', exact: true }).click()
    generated.push(await field.inputValue())
    await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '工作台', exact: true }).click()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await panel.waitFor()
    assert.equal(await field.count(), 0, 'leaving the settings page clears the generated password')
    const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
    for (const password of generated) {
      assert.ok(!stored.includes(password), 'generated value is absent from Web Storage')
      assert.ok(requests.every(request => !request.url.includes(password) && !request.body.includes(password)), 'generated value is never sent over HTTP')
    }
  } finally { page.off('request', record) }
}
