// Keeps a page when its dev-server connection comes back, instead of reloading it.
//
// Vite's client reloads the whole page whenever its HMR socket drops and the server answers
// again. A phone drops that socket every time it puts a background tab to sleep, so every return
// to the tab was a full reload — even though the server never went away and no code changed.
//
// This plugin gives the dev server a run id and a count of source changes (`/__dev-state`), and
// rewrites that one reload in the served client: after the reconnect it compares the server's
// state with the state the page last applied, and reloads only if the server restarted or code
// changed. Otherwise the page stays and the app's own socket reconnect catches the data up.
//
// A kept page has no HMR socket any more, so it cannot take edits live. It checks again each time
// the reader comes back to the tab and reloads then if code changed — never on a timer while the
// page is in use, where another session's edit would reload it under the reader.
//
// Dev server only. If a Vite upgrade changes the client text rewritten here, the rewrite is
// skipped with a warning and Vite's own reload stands.

import { randomUUID } from 'node:crypto'

const RELOAD_AFTER_PING = /(await waitForSuccessfulPing\(url\.href\);\s*)location\.reload\(\);/
const AFTER_UPDATE = 'await hmrClient.notifyListeners("vite:afterUpdate", payload);'

// Prepended to the served Vite client.
const CLIENT_HELPER = `
async function __readDevState() {
  try { return await (await fetch('/__dev-state', { cache: 'no-store' })).json(); } catch { return null; }
}
// The server state this page's code matches: taken at load, refreshed after every HMR update.
let __appliedDevState = __readDevState();
function __markDevStateApplied() { __appliedDevState = __readDevState(); }
async function __keepPageOrReload() {
  const applied = await __appliedDevState;
  const outOfDate = (state) => !applied || !state || state.runId !== applied.runId || state.changes !== applied.changes;
  if (outOfDate(await __readDevState())) { location.reload(); return; }
  console.log('[vite] reconnected to the same server with no code changes; kept the page');
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (outOfDate(await __readDevState())) location.reload();
  });
}
`

export default function keepPageOnReconnect() {
  const runId = randomUUID()
  let changes = 0

  return {
    name: 'keep-page-on-reconnect',
    apply: 'serve',
    configureServer(server) {
      const count = (file) => {
        if (file.includes('/src/') || file.endsWith('/index.html')) changes += 1
      }
      server.watcher.on('change', count)
      server.watcher.on('add', count)
      server.watcher.on('unlink', count)
      server.middlewares.use('/__dev-state', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify({ runId, changes }))
      })
    },
    transform(code, id) {
      if (!id.includes('vite/dist/client/client.mjs')) return null
      if (!RELOAD_AFTER_PING.test(code)) {
        this.warn('keep-page-on-reconnect: the Vite client reload was not found; Vite reloads as before')
        return null
      }
      let next = code.replace(RELOAD_AFTER_PING, '$1await __keepPageOrReload();')
      if (next.includes(AFTER_UPDATE)) {
        next = next.replace(AFTER_UPDATE, `${AFTER_UPDATE} __markDevStateApplied();`)
      }
      return CLIENT_HELPER + next
    },
  }
}
