let context: AudioContext | undefined
let source: AudioBufferSourceNode | undefined
let releaseTimer: ReturnType<typeof setTimeout> | undefined

/** Best-effort output warm-up. Silence is not guaranteed to wake every Bluetooth device. */
export async function prepareSpeechOutput() {
  clearTimeout(releaseTimer)
  if (typeof window.AudioContext !== 'function') return
  try {
    const cold = !context || context.state !== 'running'
    if (!context || context.state === 'closed') {
      context = new AudioContext({ latencyHint: 'playback' })
      source = context.createBufferSource()
      source.buffer = context.createBuffer(1, 128, context.sampleRate)
      source.loop = true
      source.connect(context.destination)
      source.start()
    }
    const current = context
    // resume() is invoked within the original click, before yielding user activation.
    await Promise.race([current.resume(), new Promise<void>(resolve => setTimeout(resolve, 700))])
    if (current.state !== 'running') { releaseSpeechOutput(); return }
    if (cold) {
      const latency = Number.isFinite(current.outputLatency) ? current.outputLatency : 0
      const base = Number.isFinite(current.baseLatency) ? current.baseLatency : 0
      const lead = Math.min(1200, Math.max(450, (latency + base) * 1000 + 150))
      await new Promise<void>(resolve => setTimeout(resolve, lead))
    }
  } catch { releaseSpeechOutput() }
}

export function releaseSpeechOutput(immediately = false) {
  clearTimeout(releaseTimer)
  const close = () => {
    const closing = context
    context = undefined
    try { source?.stop(); source?.disconnect() } catch { /* The context may already have been closed by the browser. */ }
    source = undefined
    void closing?.close().catch(() => {})
  }
  if (immediately) close()
  else releaseTimer = setTimeout(close, 1500)
}

window.addEventListener('pagehide', () => releaseSpeechOutput(true))
