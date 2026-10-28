import * as candidate from './crypto'

export type Command =
  | { action: 'create'; plaintext: string; password: string; id: string; purpose?: candidate.Envelope['purpose'] }
  | { action: 'open'; envelope: candidate.Envelope; password: string; id: string; purpose?: candidate.Envelope['purpose'] }
  | { action: 'change'; envelope: candidate.Envelope; oldPassword: string; newPassword: string }
  | { action: 'update'; envelope: candidate.Envelope; password: string; plaintext: string }
  | { action: 'history'; history: candidate.Envelope; current: candidate.Envelope; password: string }

self.onmessage = async (event: MessageEvent<Command>) => {
  const command = event.data
  try {
    let result: candidate.Envelope | string
    switch (command.action) {
      case 'create': result = await candidate.createEnvelope(command.plaintext, command.password, command.id, command.purpose); break
      case 'open': result = await candidate.openEnvelope(command.envelope, command.password, command.id, command.purpose); break
      case 'change': result = await candidate.changePassword(command.envelope, command.oldPassword, command.newPassword); break
      case 'update': result = await candidate.updateContent(command.envelope, command.password, command.plaintext); break
      case 'history': result = await candidate.openHistory(command.history, command.current, command.password); break
    }
    self.postMessage({ ok: true, result })
  } catch {
    // Errors crossing the worker boundary never serialize plaintext, passwords or library internals.
    self.postMessage({ ok: false, error: 'CRYPTO_OPERATION_REJECTED' })
  } finally {
    self.close()
  }
}
