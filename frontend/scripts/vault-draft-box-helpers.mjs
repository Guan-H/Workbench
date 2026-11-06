export async function openDraftBox(page) {
  await page.getByRole('menuitem', { name: /草稿箱/ }).click()
  await page.getByRole('heading', { name: /^草稿箱/ }).waitFor()
}
export async function recoverFirstDraft(page) {
  await openDraftBox(page)
  await page.locator('.vault-draft-box').getByRole('button', { name: '继续编辑', exact: true }).first().click()
  await page.locator('.vault-draft-box').waitFor({ state: 'detached' })
}
export async function waitForNoDrafts(page) {
  await page.waitForFunction(async () => {
    const { listVaultDrafts } = await import('/src/modules/vault/draft-store.ts')
    const snapshot = await (await fetch('/api/v1/vault')).json()
    return (await listVaultDrafts(snapshot.vaultId)).length === 0
  })
}
