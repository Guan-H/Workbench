import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

/** Real directory picker, product HTTP, MySQL and immutable files; no response interception. */
export async function checkNoteImports(page, request, context, origin, output) {
  async function catalog() {
    const items = []
    let cursor = ''
    do {
      const response = await request('/notes?cursor=' + cursor)
      assert.equal(response.status, 200)
      items.push(...response.body.items)
      cursor = response.body.nextCursor
    } while (cursor)
    return items
  }
  const multipart = async (paths, bytes, fingerprint, operation = crypto.randomUUID(), target = '') => page.evaluate(async ({ paths, bytes, fingerprint, operation, target }) => {
    const { token } = await (await fetch('/api/v1/auth/csrf')).json()
    const data = new FormData()
    data.append('target', target)
    data.append('paths', JSON.stringify(paths))
    bytes.forEach((value, index) => data.append('files', new Blob([new Uint8Array(value)]), 'file-' + index))
    if (fingerprint !== undefined) data.append('fingerprint', fingerprint)
    const response = await fetch('/api/v1/note-imports' + (fingerprint === undefined ? '/preview' : ''), {
      method: 'POST', body: data, headers: { 'X-CSRF-TOKEN': token, 'Idempotency-Key': operation },
    })
    return { status: response.status, body: await response.json() }
  }, { paths, bytes: bytes.map(value => Array.from(value)), fingerprint, operation, target })
  const utf8 = text => Buffer.from(text, 'utf8')
  const download = async path => {
    const response = await context.request.get(origin + '/api/v1/files/content?path=' + encodeURIComponent(path))
    assert.equal(response.status(), 200)
    return response.body()
  }
  const before = (await catalog()).length
  const nativeDialogs = []
  const trackDialogs = dialog => nativeDialogs.push(dialog.type())
  page.on('dialog', trackDialogs)
  const largePaths = Array.from({ length: 1178 }, (_, index) => `数量验收/${index}.bin`)
  const largePreview = await page.evaluate(async paths => {
    const { token } = await (await fetch('/api/v1/auth/csrf')).json()
    const data = new FormData(); data.append('target', ''); data.append('paths', JSON.stringify(paths))
    const blob = new Blob([new Uint8Array(25 * 1024)])
    paths.forEach((_, index) => data.append('files', blob, index + '.bin'))
    const response = await fetch('/api/v1/note-imports/preview', { method: 'POST', body: data, headers: { 'X-CSRF-TOKEN': token } })
    return { status: response.status, body: await response.json() }
  }, largePaths)
  assert.equal(largePreview.status, 200, '1178-file multipart preview must reach the product handler')
  assert.equal(largePreview.body.canImport, true)
  const invalid = await multipart(['../越界.md', '.obsidian/config.json', 'CON.md', '非法?.md', '无效编码.md', '超限.md'],
    [utf8('a'), utf8('{}'), utf8('a'), utf8('a'), Buffer.from([0xff]), Buffer.alloc(1048577)])
  assert.equal(invalid.status, 200)
  assert.equal(invalid.body.canImport, false)
  assert.equal(invalid.body.entries.filter(entry => entry.status === 'BLOCKED').length, 6)
  assert.equal((await multipart(['../越界.md'], [utf8('x')], invalid.body.fingerprint)).status, 409)
  assert.equal((await catalog()).length, before, 'preview and blocked commit publish no files or folders')
  for (const paths of [['重名.md', '重名.MD'], ['父文件', '父文件/子.md'], ['大小写/A.md', '大小写/a.md'], ['别名/σ.md', '别名/ς.md']]) {
    const preview = await multipart(paths, paths.map(() => utf8('保留')))
    assert.equal(preview.status, 200)
    assert.equal(preview.body.canImport, false, 'colliding paths must not pass preview: ' + paths)
  }

  const fixtureRoot = new URL('批量目录/', output)
  await mkdir(new URL('assets/', fixtureRoot), { recursive: true })
  await mkdir(new URL('子目录/', fixtureRoot), { recursive: true })
  await mkdir(new URL('.隐藏目录/', fixtureRoot), { recursive: true })
  await writeFile(new URL('.隐藏目录/不上传.txt', fixtureRoot), '虚构排除测试')
  const note = utf8('\uFEFF---\r\ntitle: "中文 📝"\r\ncustom: "A & B"\r\n---\r\n# 批量导入\r\n[[保留双链]]\r\n![相对图片](assets/可视图.png)\r\n')
  const image = await readFile(new URL('../../sync-client/verification/fixtures/visual-check.png', import.meta.url))
  await writeFile(new URL('中文, 特殊.md', fixtureRoot), note)
  await writeFile(new URL('assets/可视图.png', fixtureRoot), image)
  await writeFile(new URL('子目录/说明.MD', fixtureRoot), '# 大写后缀\n')
  await writeFile(new URL('进度验收.bin', fixtureRoot), Buffer.alloc(512 * 1024))
  await mkdir(new URL('多批次/', fixtureRoot), { recursive: true })
  for (let index = 0; index < 128; index++) await writeFile(new URL(`多批次/${String(index).padStart(3, '0')}.bin`, fixtureRoot), Buffer.from([index]))
  const dialog = page.getByRole('dialog', { name: '批量导入目录', exact: true })
  async function importTarget(path) {
    await dialog.getByRole('button', { name: '选择导入目标目录', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择导入目标目录', exact: true })
    if (path) {
      await picker.getByLabel('查找目录', { exact: true }).fill(path)
      await picker.getByRole('button', { name: '选择目录：' + path, exact: true }).click()
    } else await picker.getByRole('button', { name: '根目录 /', exact: true }).click()
    assert.equal(await picker.getByRole('button', { name: /选择目录：.*\.md$/i }).count(), 0, 'only folders appear in the directory picker')
    await page.screenshot({ path: fileURLToPath(new URL('import-target-picker.png', output)), fullPage: true })
    await picker.getByRole('button', { name: '使用此目录', exact: true }).click()
  }
  const open = async (useDrop = false) => {
    await page.getByRole('button', { name: '批量导入目录', exact: true }).click()
    await dialog.getByRole('button', { name: '选择目录', exact: true }).waitFor({ state: 'visible' })
    await importTarget('')
    if (useDrop) {
      const session = await context.newCDPSession(page)
      const zone = dialog.getByRole('region', { name: '拖入目录', exact: true })
      await zone.scrollIntoViewIfNeeded()
      const bounds = await zone.boundingBox()
      const data = { items: [], files: [fileURLToPath(fixtureRoot).replace(/[\\/]+$/, '')], dragOperationsMask: 1 }
      const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2
      for (const type of ['dragEnter', 'dragOver', 'drop']) await session.send('Input.dispatchDragEvent', { type, x, y, data })
      await dialog.getByText('已跳过 1 个隐藏目录，其内容不会读取或上传。', { exact: true }).waitFor()
      await dialog.getByText(/^已选择 132 个文件/).waitFor()
      await session.detach()
      assert.equal((await catalog()).length, before, 'dropping a real directory does not publish files')
    } else {
      await page.getByLabel('选择导入目录', { exact: true }).setInputFiles(fileURLToPath(fixtureRoot))
      await dialog.getByText('已排除隐藏目录内 1 个文件，不会上传。', { exact: true }).waitFor()
    }
    await dialog.getByRole('button', { name: '重新预检', exact: true }).click()
    await dialog.getByRole('button', { name: '确认导入', exact: true }).waitFor()
    const root = dialog.getByRole('button', { name: '展开预检目录：批量目录', exact: true })
    assert.equal(await root.getAttribute('aria-expanded'), 'false')
    assert.equal(await dialog.locator('.import-tree-file').count(), 0, 'successful preview starts collapsed')
  }
  const connection = await context.newCDPSession(page)
  await connection.send('Network.enable')
  await connection.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: 512 * 1024 })
  await page.evaluate(() => {
    window.uploadEvidence = []
    window.uploadObserver = new MutationObserver(() => document.querySelectorAll('progress[aria-label="总上传进度"]').forEach(element => {
      if (element.hasAttribute('value')) window.uploadEvidence.push(Number(element.getAttribute('value')))
    }))
    window.uploadObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['value'] })
  })
  await open()
  const evidence = await page.evaluate(() => { window.uploadObserver.disconnect(); return window.uploadEvidence })
  assert.ok(evidence.some(value => value > 0 && value < 100), 'real throttled batch upload reports intermediate byte progress')
  await connection.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await connection.detach()
  await page.locator('.modal-backdrop').click({ position: { x: 2, y: 2 } })
  assert.equal(await dialog.isVisible(), true, 'backdrop click does not dismiss import')
  assert.equal((await catalog()).length, before)
  for (const [width, height] of [[1440, 960], [375, 812], [812, 375]]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: fileURLToPath(new URL(`import-preview-${width}.png`, output)), fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await dialog.getByRole('button', { name: '展开预检目录：批量目录', exact: true }).click()
  await dialog.getByText('中文, 特殊.md', { exact: true }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: '展开预检目录：批量目录/子目录', exact: true }).getAttribute('aria-expanded'), 'false')
  await dialog.getByRole('button', { name: '展开预检目录：批量目录/多批次', exact: true }).click()
  await dialog.getByRole('navigation', { name: '批量目录/多批次预检分页', exact: true }).getByRole('button', { name: '下一页', exact: true }).click()
  await dialog.getByText('030.bin', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal((await catalog()).length, before, 'cancelling a reviewed import does not write')
  await open(true)
  await context.setOffline(true)
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click()
  await dialog.getByRole('alert').waitFor()
  await context.setOffline(false)
  assert.equal((await catalog()).length, before, 'offline submission cannot claim or publish success')
  await dialog.getByRole('button', { name: '重试确认', exact: true }).click()
  await dialog.getByRole('heading', { name: '导入成功', exact: true }).waitFor()
  await page.screenshot({ path: fileURLToPath(new URL('import-success.png', output)) })
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  await page.getByRole('button', { name: '展开文件夹：批量目录', exact: true }).click()
  await page.locator('.tree-row[data-file-path="批量目录/中文, 特殊.md"]').click()
  await page.waitForFunction(() => {
    const image = document.querySelector('.markdown-preview img[alt="相对图片"]')
    return image?.complete && image.naturalWidth === 640
  })
  await page.screenshot({ path: fileURLToPath(new URL('import-relative-image.png', output)), fullPage: true })
  await page.locator('.outline-sidebar').getByRole('button', { name: '批量导入', exact: true }).click()
  assert.equal(await page.locator('.markdown-preview .outline-highlight').count(), 1, 'only the clicked heading is highlighted')
  assert.equal(await page.locator('.markdown-preview .outline-highlight img').count(), 0)
  assert.equal(await page.locator('.markdown-preview h1.outline-highlight').innerText(), '批量导入')
  assert.equal(await page.locator('.outline-highlight').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(255, 240, 179)')
  await page.locator('.markdown-preview h1').click()
  assert.equal(await page.locator('.outline-highlight').count(), 0)
  for (const name of ['收藏', '最近访问']) {
    await page.getByRole('button', { name, exact: true }).click()
    await page.getByRole('button', { name, exact: true }).click()
    await page.getByRole('button', { name: '根目录 /', exact: true }).waitFor()
  }
  assert.deepEqual(await download('批量目录/中文, 特殊.md'), note)
  assert.deepEqual(await download('批量目录/assets/可视图.png'), image)
  const imported = (await catalog()).find(item => item.path === '批量目录/子目录/说明.MD')
  assert.equal(imported.type, 'note')
  const move = { targetPath: '批量目录/子目录/说明更名.MD', baseVersion: imported.version }
  const movePreview = await request(`/notes/${imported.id}/move-preview`, 'POST', move)
  assert.equal(movePreview.status, 200)
  assert.equal((await request(`/notes/${imported.id}/move`, 'POST', { ...move, fingerprint: movePreview.body.fingerprint })).status, 200)
  const existing = await multipart(['批量目录/中文, 特殊.md'], [utf8('不能覆盖')])
  assert.equal(existing.body.canImport, false)
  assert.deepEqual(await download('批量目录/中文, 特殊.md'), note)

  const paths = ['幂等导入/原字节.md', '幂等导入/附件.bin']
  const bytes = [note, Buffer.from([0, 1, 255, 128, 3])]
  const preview = await multipart(paths, bytes)
  assert.equal(preview.body.canImport, true)
  const changed = await multipart(paths, [utf8('改变输入'), bytes[1]], preview.body.fingerprint)
  assert.equal(changed.status, 409)
  const operation = crypto.randomUUID()
  const first = await multipart(paths, bytes, preview.body.fingerprint, operation)
  assert.equal(first.status, 200)
  const repeated = await multipart(paths, bytes, preview.body.fingerprint, operation)
  assert.equal(repeated.status, 200)
  assert.deepEqual(repeated.body, first.body)
  assert.equal((await multipart(paths, [utf8('不同请求'), bytes[1]], preview.body.fingerprint, operation)).body.code, 'IDEMPOTENCY_CONFLICT')
  assert.deepEqual(await download(paths[0]), note)
  assert.deepEqual(await download(paths[1]), bytes[1])
  const original = (await catalog()).find(item => item.path === paths[0])
  assert.equal((await request(`/notes/${original.id}/history`)).body.length, 1, 'retry does not publish duplicate history')
  await request(`/notes/${original.id}?baseVersion=${original.version}`, 'DELETE')
  assert.equal((await multipart([paths[0]], [note])).body.canImport, false, 'trash paths are protected')
  const stale = await multipart(['过期预检/保留.md'], [note])
  assert.equal((await request('/notes', 'POST', { path: '预检后新建', type: 'folder', content: '' })).status, 200)
  assert.equal((await multipart(['过期预检/保留.md'], [note], stale.body.fingerprint)).body.code, 'PREVIEW_EXPIRED')
  assert.ok(!(await catalog()).some(item => item.path.startsWith('过期预检')))

  // NotesIT installs a temporary MySQL CHECK constraint that rejects the second file publication.
  const rollbackPaths = ['导入事务/已写入.md', '导入事务/失败.md']
  const rollbackBytes = rollbackPaths.map(() => utf8('# 原子导入\n'))
  const rollbackPreview = await multipart(rollbackPaths, rollbackBytes)
  assert.equal(rollbackPreview.body.canImport, true)
  assert.equal((await multipart(rollbackPaths, rollbackBytes, rollbackPreview.body.fingerprint)).status, 503)
  assert.ok(!(await catalog()).some(item => item.path.startsWith('导入事务')), 'database failure rolls back directories and earlier files')

  // More than Tomcat's default multipart part limit: real configured parsing and atomic publication.
  const many = Array.from({ length: 64 }, (_, index) => `多文件验收/${index}.md`)
  const manyBytes = many.map(() => utf8('# 真实多文件\n'))
  const manyPreview = await multipart(many, manyBytes)
  assert.equal(manyPreview.status, 200)
  assert.equal(manyPreview.body.canImport, true)
  assert.equal((await multipart(many, manyBytes, manyPreview.body.fingerprint)).body.filesCreated, 64)
  const anonymous = await context.browser().newContext()
  assert.equal((await anonymous.request.get(origin + '/api/v1/note-imports/limits')).status(), 401)
  assert.equal((await anonymous.request.get(origin + '/api/v1/note-exports')).status(), 401)
  await anonymous.close()

  await page.getByRole('button', { name: '导出笔记 ZIP', exact: true }).click()
  const selectionDialog = page.getByRole('dialog', { name: '导出笔记', exact: true })
  assert.equal(await selectionDialog.locator('input[type=checkbox]:checked').count(), 0, 'export opens with nothing selected')
  assert.equal(await selectionDialog.getByRole('button', { name: '确认导出', exact: true }).isDisabled(), true)
  await selectionDialog.getByLabel('筛选路径', { exact: true }).fill('批量目录/中文, 特殊.md')
  await selectionDialog.getByRole('checkbox', { name: '批量目录/中文, 特殊.md', exact: true }).check()
  const selectedDownload = page.waitForEvent('download')
  await selectionDialog.getByRole('button', { name: '确认导出', exact: true }).click()
  const selectedArchive = fileURLToPath(new URL('selected.zip', output)); await (await selectedDownload).saveAs(selectedArchive)
  const selectedNames = JSON.parse(execFileSync('python', ['-c', 'import zipfile,json,sys; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist(),ensure_ascii=True))', selectedArchive], { encoding: 'utf8' }))
  assert.deepEqual(selectedNames.sort(), ['批量目录/assets/可视图.png', '批量目录/中文, 特殊.md'].sort(), 'selected note exports only its referenced attachment')
  await page.getByRole('button', { name: '导出笔记 ZIP', exact: true }).click()
  await selectionDialog.getByRole('button', { name: '展开目录：批量目录', exact: true }).click()
  await selectionDialog.getByRole('checkbox', { name: '目录：批量目录', exact: true }).check()
  await selectionDialog.getByRole('checkbox', { name: '批量目录/中文, 特殊.md', exact: true }).check()
  await page.screenshot({ path: fileURLToPath(new URL('export-selection.png', output)), fullPage: true })
  const folderDownload = page.waitForEvent('download')
  await selectionDialog.getByRole('button', { name: '确认导出', exact: true }).click()
  const folderArchive = fileURLToPath(new URL('folder.zip', output)); await (await folderDownload).saveAs(folderArchive)
  const folderNames = JSON.parse(execFileSync('python', ['-c', 'import zipfile,json,sys; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist(),ensure_ascii=True))', folderArchive], { encoding: 'utf8' }))
  assert.equal(new Set(folderNames).size, folderNames.length)
  assert.equal(folderNames.length, (await catalog()).filter(item => item.path === '批量目录' || item.path.startsWith('批量目录/')).length)

  // Download the actual ZIP through the UI, inspect with the standard ZIP reader and import it back.
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出笔记 ZIP', exact: true }).click()
  await page.getByRole('dialog', { name: '导出笔记', exact: true }).getByRole('button', { name: '全选', exact: true }).click()
  await page.getByRole('dialog', { name: '导出笔记', exact: true }).getByRole('button', { name: '确认导出', exact: true }).click()
  const downloadFile = await downloaded
  const archivePath = fileURLToPath(new URL('ordinary-notes.zip', output))
  await downloadFile.saveAs(archivePath)
  const unpacked = fileURLToPath(new URL('zip-expanded/', output))
  const archiveNames = JSON.parse(execFileSync('python', ['-c', [
    'import json,sys,zipfile,pathlib',
    'with zipfile.ZipFile(sys.argv[1]) as z:',
    ' assert z.testzip() is None',
    ' names=z.namelist()',
    ' assert all(not n.startswith("/") and ".." not in n.split("/") for n in names)',
    ' z.extractall(sys.argv[2])',
    ' print(json.dumps(names,ensure_ascii=True))',
  ].join('\n'), archivePath, unpacked], { encoding: 'utf8' }))
  const current = await catalog()
  assert.equal(archiveNames.length, current.length)
  assert.ok(!archiveNames.includes(paths[0]), 'trash does not enter ordinary ZIP')
  assert.ok(!archiveNames.some(name => /(^|\/)(\.obsidian|\.git|account|web_session|vault)(\/|$)/.test(name)))
  assert.deepEqual(await readFile(new URL('zip-expanded/批量目录/中文, 特殊.md', output)), note)
  assert.deepEqual(await readFile(new URL('zip-expanded/批量目录/assets/可视图.png', output)), image)
  await request('/notes', 'POST', { path: 'ZIP往返', type: 'folder', content: '' })
  await page.getByRole('button', { name: '刷新目录', exact: true }).click()
  await page.getByRole('button', { name: '批量导入目录', exact: true }).click()
  await importTarget('ZIP往返')
  await page.getByLabel('选择导入目录', { exact: true }).setInputFiles(fileURLToPath(new URL('zip-expanded/批量目录/', output)))
  await dialog.getByRole('button', { name: '重新预检', exact: true }).click()
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click()
  await dialog.getByRole('heading', { name: '导入成功', exact: true }).waitFor()
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  assert.deepEqual(await download('ZIP往返/批量目录/中文, 特殊.md'), note)
  assert.deepEqual(await download('ZIP往返/批量目录/assets/可视图.png'), image)
  assert.deepEqual(nativeDialogs, [], 'import and export use application dialogs')
  page.off('dialog', trackDialogs)
  return { path: '批量目录/中文, 特殊.md', sha256: (await catalog()).find(item => item.path === '批量目录/中文, 特殊.md').sha256 }
}
