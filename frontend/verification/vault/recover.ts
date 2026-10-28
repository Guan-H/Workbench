/** Offline candidate-format verifier. Password is read from stdin, never from argv or environment. */
import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'

import { openEnvelope, parseEnvelope } from './crypto.ts'

const [file, mode, destination] = process.argv.slice(2)
if (!file || !['--check', '--output'].includes(mode ?? '') || (mode === '--output' && !destination)) {
  console.error('M0 fake-data candidate only. Usage: recover.ts backup.json --check | --output new-file.json; password via stdin')
  process.exitCode = 2
} else {
  try {
    if ((await stat(file)).size > 2 * 1024 * 1024) throw new Error('OVERSIZED')
    const chunks: Buffer[] = []
    let length = 0
    for await (const chunk of process.stdin) {
      const part = Buffer.from(chunk as Uint8Array)
      chunks.push(part)
      length += part.length
      if (length > 1024) throw new Error('PASSWORD_TOO_LONG')
    }
    const input = Buffer.concat(chunks)
    const password = input.toString('utf8')
    input.fill(0)
    for (const chunk of chunks) chunk.fill(0)
    const envelope = await parseEnvelope(await readFile(file, 'utf8'))
    const plaintext = await openEnvelope(envelope, password, envelope.vaultId, 'backup')
    if (mode === '--output') {
      // Explicit output only; wx prevents overwriting an existing recovery file.
      await writeFile(destination!, plaintext, { flag: 'wx', mode: 0o600 })
    }
    console.log(JSON.stringify({ sha256: createHash('sha256').update(plaintext).digest('hex'), bytes: Buffer.byteLength(plaintext) }))
  } catch {
    console.error('RECOVERY_REJECTED: invalid format/password, authentication failure or inaccessible file')
    process.exitCode = 1
  }
}
