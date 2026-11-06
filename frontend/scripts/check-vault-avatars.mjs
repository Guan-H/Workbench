import assert from 'node:assert/strict'

export async function chooseAvatar(page, label) {
  await page.getByRole('button', { name: '选择头像', exact: true }).click()
  await page.keyboard.press('Control+s')
  await page.getByRole('heading', { name: '选择条目头像', exact: true }).waitFor()
  await page.locator('.vault-entry-detail form').waitFor()
  await page.getByRole('button', { name: `选择 ${label} 头像`, exact: true }).click()
  await page.getByRole('button', { name: '使用此头像', exact: true }).click()
}

export async function checkAvatarPicker(page, output) {
  const avatar = page.locator('.vault-avatar-editor')
  await avatar.getByRole('img', { name: '默认首字头像', exact: true }).waitFor()
  await page.getByRole('button', { name: '选择头像', exact: true }).click()
  for (const label of ['X', 'YouTube', '哔哩哔哩', '微博', '抖音', 'TikTok', 'Google', 'ChatGPT']) {
    const option = page.getByRole('button', { name: `选择 ${label} 头像`, exact: true })
    await option.click()
    assert.equal(await option.getAttribute('aria-pressed'), 'true')
    const image = option.locator('img')
    assert.ok((await image.getAttribute('src')).startsWith('data:image/svg+xml,'))
    assert.ok(await image.evaluate(image => image.complete && image.naturalWidth > 0), 'Bundled platform SVG must actually decode')
  }
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await avatar.getByRole('img', { name: '默认首字头像', exact: true }).waitFor()
  await page.getByRole('button', { name: '选择头像', exact: true }).click()
  const pagination = page.getByRole('navigation', { name: '平台头像分页', exact: true })
  await pagination.getByRole('button', { name: '下一页', exact: true }).click()
  await page.getByRole('button', { name: '选择 GitHub 头像', exact: true }).waitFor()
  await page.getByLabel('搜索平台', { exact: true }).fill('谷歌')
  await page.getByRole('button', { name: '选择 Google 头像', exact: true }).waitFor()
  await page.getByLabel('搜索平台', { exact: true }).fill('chatgpt')
  await page.getByRole('button', { name: '选择 ChatGPT 头像', exact: true }).waitFor()
  await page.getByLabel('搜索平台', { exact: true }).fill('油管')
  assert.equal(await page.locator('.vault-avatar-options > button').count(), 1)
  await page.getByRole('button', { name: '选择 YouTube 头像', exact: true }).waitFor()
  await page.getByLabel('搜索平台', { exact: true }).fill('missing-platform-test')
  await page.getByRole('status').filter({ hasText: '没有匹配的平台' }).waitFor()
  await page.getByLabel('搜索平台', { exact: true }).fill('')
  for (const [width, height] of [[1440, 900], [375, 700]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const button = await page.getByRole('button', { name: '使用此头像', exact: true }).boundingBox()
    assert.ok(button && button.y >= 0 && button.y + button.height <= height, 'Picker actions must remain visible')
    await page.screenshot({ path: output + '/vault-avatar-picker-' + width + '.png', fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: '选择 X 头像', exact: true }).click()
  await page.getByRole('button', { name: '使用此头像', exact: true }).click()
  await avatar.getByRole('img', { name: 'X 头像', exact: true }).waitFor()
}

export async function checkCustomAvatarPicker(page, output) {
  const fixtures = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 160
    const context = canvas.getContext('2d')
    context.fillStyle = '#1756ad'; context.fillRect(0, 0, 320, 160)
    context.fillStyle = '#fff'; context.fillRect(90, 40, 140, 80)
    return { png: canvas.toDataURL('image/png').split(',')[1], jpeg: canvas.toDataURL('image/jpeg').split(',')[1] }
  })
  const avatar = page.locator('.vault-avatar-editor')
  const input = () => page.getByLabel('自定义头像图片', { exact: true })
  const customImage = () => page.locator('.vault-avatar-picker').getByRole('img', { name: '自定义头像', exact: true }).locator('img')
  await page.getByRole('button', { name: '选择头像', exact: true }).click()
  await input().setInputFiles({ name: 'M3_CUSTOM_AVATAR_ORIGINAL.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(fixtures.jpeg, 'base64') })
  await page.getByRole('button', { name: '更换图片', exact: true }).waitFor()
  await customImage().waitFor()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await avatar.getByRole('img', { name: '默认首字头像', exact: true }).waitFor()
  await page.getByRole('button', { name: '选择头像', exact: true }).click()
  await input().setInputFiles({ name: 'M3_CUSTOM_AVATAR_ORIGINAL.png', mimeType: 'image/png', buffer: Buffer.from(fixtures.png, 'base64') })
  await page.getByRole('button', { name: '更换图片', exact: true }).waitFor()
  const image = customImage()
  const source = await image.getAttribute('src')
  assert.ok(source.startsWith('data:image/png;base64,'))
  const geometry = await image.evaluate(async image => {
    await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
    return { width: image.naturalWidth, height: image.naturalHeight, topAlpha: context.getImageData(0, 0, 1, 1).data[3], centerAlpha: context.getImageData(64, 64, 1, 1).data[3] }
  })
  assert.deepEqual(geometry, { width: 128, height: 128, topAlpha: 0, centerAlpha: 255 }, 'Normalization must preserve the whole landscape image without stretching or cropping')
  assert.ok(Buffer.from(source.split(',')[1], 'base64').length <= 32768)
  await input().setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') })
  await page.getByRole('alert').filter({ hasText: '仅支持 PNG 和 JPEG' }).waitFor()
  assert.equal(await image.getAttribute('src'), source, 'Rejected image must preserve the prior candidate')
  await input().setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024 + 1) })
  await page.getByRole('alert').filter({ hasText: '不超过 2 MiB' }).waitFor()
  assert.equal(await image.getAttribute('src'), source)
  for (const [width, height] of [[1440, 900], [375, 700]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const button = await page.getByRole('button', { name: '使用此头像', exact: true }).boundingBox()
    assert.ok(button && button.y + button.height <= height && button.y >= 0)
    await page.screenshot({ path: output + '/vault-custom-avatar-' + width + '.png', fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: '使用此头像', exact: true }).click()
  await avatar.getByRole('img', { name: '自定义头像', exact: true }).waitFor()
  return source
}

export async function resetAvatar(page) {
  await page.getByRole('button', { name: '选择头像', exact: true }).click()
  await page.getByRole('button', { name: '默认首字头像', exact: true }).click()
  await page.getByRole('button', { name: '使用此头像', exact: true }).click()
  await page.locator('.vault-avatar-editor').getByRole('img', { name: '默认首字头像', exact: true }).waitFor()
}
