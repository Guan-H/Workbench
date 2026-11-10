// Served on the document server's origin. Office code never executes in the Workbench/vault window.
(() => {
  const params = new URLSearchParams(location.search)
  const origin = params.get('parentOrigin'), nonce = params.get('nonce')
  if (!origin || !nonce || !/^https?:\/\//.test(origin)) return
  let editor
  function send(kind, data) { parent.postMessage({ kind, data, nonce }, origin) }
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== origin || event.data?.nonce !== nonce) return
    if (event.data.kind === 'init' && !editor && event.data.config && window.DocsAPI) {
      editor = new window.DocsAPI.DocEditor('editor', { ...event.data.config, width: '100%', height: '100%', events: {
        onDocumentReady: () => {
          send('ready')
          // The embedded editor shares this isolated origin; relay shortcuts while retaining its native flush.
          const frame = document.querySelector('iframe')
          frame?.contentDocument?.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !event.repeat) {
              setTimeout(() => send('save-requested'), 250)
            }
          }, true)
        },
        onDocumentStateChange: event => send('changed', event.data === true),
        onError: event => send('error', typeof event.data?.errorCode === 'number' ? event.data.errorCode : null),
      } })
    }
  })
  window.addEventListener('pagehide', () => editor?.destroyEditor())
  send('host-ready')
})()
