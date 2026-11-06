let generation = 0
let authenticated = false
const listeners = new Set<() => void>()

export function setAuthenticatedSession(value: boolean) {
  generation++
  authenticated = value
}

export function sessionGeneration() { return generation }

/** Ignore late responses from a session that has already ended or been replaced. */
export function reportUnauthorized(expected: number) {
  if (!authenticated || expected !== generation) return
  setAuthenticatedSession(false)
  listeners.forEach(listener => listener())
}

export function onSessionExpired(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
