import http from 'node:http'

/** Fault injection only: delay genuine authenticated backend bytes, never generate a response. */
export function realResponseGate(backend) {
  let match
  let first
  const pending = new Set()
  const gate = {
    cancelled: 0,
    arm(predicate) {
      gate.release()
      match = predicate
      gate.cancelled = 0
      return new Promise(resolve => { first = resolve })
    },
    release() { match = undefined; for (const entry of pending) entry.release() },
    plugin: {
      name: 'real-response-delay-verification',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (!match?.(request.url)) { next(); return }
          const entry = { released: false, release: () => { entry.released = true; entry.finish?.() } }
          pending.add(entry)
          response.on('close', () => {
            if (!entry.released) gate.cancelled++
            pending.delete(entry)
          })
          const upstream = http.request(new URL(request.url, backend), { headers: { ...request.headers, host: new URL(backend).host } }, actual => {
            const chunks = []
            actual.on('data', chunk => chunks.push(chunk))
            actual.on('end', () => {
              const body = Buffer.concat(chunks)
              response.writeHead(actual.statusCode, actual.headers)
              // Keep a real image response in progress; JSON stays whole until released.
              const split = actual.headers['content-type']?.startsWith('image/') ? Math.min(32, body.length) : 0
              if (split) response.write(body.subarray(0, split))
              entry.finish = () => { if (!response.destroyed) response.end(body.subarray(split)) }
              first?.({ status: actual.statusCode }); first = undefined
              if (entry.released) entry.finish()
            })
          })
          upstream.on('error', error => response.destroy(error))
          upstream.end()
        })
      },
    },
  }
  return gate
}
