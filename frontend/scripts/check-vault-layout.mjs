import assert from 'node:assert/strict'

// Use only a page opened by the real vault fixture, which already holds test-only encrypted records.
export async function checkVaultLayout(page, output, mode) {
  for (const [width, height] of [[1440, 900], [1440, 640], [1024, 768], [375, 900], [812, 375]]) {
    await page.setViewportSize({ width, height })
    await page.locator('.vault-entry-detail').scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Vault must not overflow the viewport')
    assert.equal(await page.locator('.vault-entry-list.ant-card').count(), 1)
    assert.equal(await page.locator('.vault-entry-detail.ant-card').count(), 1)
    if (mode === 'editor') {
      assert.equal(await page.locator('.vault-editor-form.ant-form-vertical').count(), 1)
      assert.ok(await page.locator('.vault-form-scroll').evaluate(element => element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === 'auto'))
      const footer = await page.locator('.vault-edit-actions').boundingBox()
      const detail = await page.locator('.vault-entry-detail').boundingBox()
      assert.ok(footer && detail && footer.y >= detail.y && footer.y + footer.height <= detail.y + detail.height + 2, 'Save actions must stay inside the detail card')
      if (width === 1440) assert.ok(footer.y + footer.height <= height, 'Desktop save actions must remain visible')
      await page.locator('.vault-form-scroll').evaluate(element => { element.scrollTop = 0 })
    } else {
      assert.equal(await page.locator('.vault-account-description.ant-descriptions').count(), 1)
      assert.equal(await page.getByLabel('密码', { exact: true }).getAttribute('type'), 'password')
    }
    await page.screenshot({ path: output + '/vault-ui-' + mode + '-' + width + '-' + height + '.png', fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
