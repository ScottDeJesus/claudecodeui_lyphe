// The Gemini budget relay, read at RUN time so that saving it does not restart the dev server.
//
// `server/shared/gemini-budget-relay.ts` is edited by the people building the relay, and this config used to import it. That made it a
// CONFIG DEPENDENCY, and Vite restarts the whole dev server on every save of one: every open page reloaded onto a cold module graph
// (measured 2026-11-13: two restarts inside one second at 08:19:40, and the HTTPS front's dial to :5183 refused at 08:19:44).
// Imported from here with a computed specifier, which esbuild does not follow when it bundles the config, it is not a dependency.
// Node loads the `.ts` itself (type stripping: the file is erasable syntax and imports node built-ins only, so no build step stands
// between a save and the running rule), and the dev server swaps a saved version in without a restart.
//
// Never fail open. A relay that will not load answers "carry nothing" for every request, which is the rule's own answer for a caller
// it cannot place: the connector then refuses a call that reaches Gemini, and the sender can always fix that. A save that does not
// parse keeps the previous rule running and says so.
//
// `vite preview` (:5184) reads the file once, at start, like any other process; the hot swap is the dev server's.

import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RELAY_FILE = fileURLToPath(new URL('../server/shared/gemini-budget-relay.ts', import.meta.url))

// The header's home is the relay itself (`BUDGET_HEADER`). This copy exists for the one moment the relay cannot be loaded and a header
// the browser sent must still be stripped; it is never used while the relay is there.
const HEADER_WHEN_RELAY_IS_DOWN = 'X-Gemini-Budget-Plan'

// A fresh specifier per version of the file: Node keeps a module by URL for the life of the process, and a saved edit must not be
// answered from that cache.
function importRelay() {
  const version = fs.statSync(RELAY_FILE).mtimeMs
  return import(`${pathToFileURL(RELAY_FILE).href}?v=${version}`)
}

/**
 * Used by `vite.config.js`: loads the relay and hands back what the config needs of it. `relayTo(proxyReq, req)` is the `/api`
 * proxy's `proxyReq` handler (what the API, and through it shadow-connector, is told about who this request is: the rule's answer
 * set as the budget header, or the header removed when the rule has none), and `plugin` keeps the dev server's copy of the rule
 * current when the file is saved.
 */
export async function createBudgetRelay() {
  let relay = null
  try {
    relay = await importRelay()
  } catch (error) {
    console.error(`[budget-relay] ${RELAY_FILE} did not load; every API request carries no budget until it does: ${error.message}`)
  }
  let reloads = 0

  return {
    relayTo(proxyReq, req) {
      const budget = relay === null ? null : relay.relayBudgetOf(req)
      const header = relay === null ? HEADER_WHEN_RELAY_IS_DOWN : relay.BUDGET_HEADER
      if (budget === null) proxyReq.removeHeader(header)
      else proxyReq.setHeader(header, budget)
    },
    plugin: {
      name: 'budget-relay-reload',
      apply: 'serve',
      configureServer(server) {
        server.watcher.on('change', async (file) => {
          if (file !== RELAY_FILE) return
          // Two saves close together import twice; only the newest answer may become the rule.
          const mine = ++reloads
          try {
            const loaded = await importRelay()
            if (mine !== reloads) return
            relay = loaded
            server.config.logger.info('budget relay reloaded, no restart', { timestamp: true })
          } catch (error) {
            if (mine !== reloads) return
            server.config.logger.warn(`budget relay not reloaded, the previous rule stays: ${error.message}`, { timestamp: true })
          }
        })
      },
    },
  }
}
