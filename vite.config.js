import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { getConnectableHost, normalizeLoopbackHost } from './shared/networkHosts.js'
import keepPageOnReconnect from './vite-plugins/keepPageOnReconnect.js'
import compressResponses from './vite-plugins/compressResponses.js'
import precompressedAssets from './vite-plugins/precompressedAssets.js'

// The client shows the installed package version so it can be compared against the
// version the server process is actually running. Reading package.json here and
// injecting it keeps the frontend free of imports that reach outside src/.
// Read from disk rather than require()d: the require cache outlives a dev-server config
// restart, which would keep serving the old version after a bump.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')

  const configuredHost = env.HOST || '0.0.0.0'
  // if the host is not a loopback address, it should be used directly. 
  // This allows the vite server to EXPOSE all interfaces when the host 
  // is set to '0.0.0.0' or '::', while still using 'localhost' for browser 
  // URLs and proxy targets.
  const host = normalizeLoopbackHost(configuredHost)
  
  const proxyHost = getConnectableHost(configuredHost)
  // TODO: Remove support for legacy PORT variables in all locations in a future major release, leaving only SERVER_PORT.
  const serverPort = env.SERVER_PORT || env.PORT || 3001

  return {
    // keepPageOnReconnect: a phone waking a sleeping tab keeps its page instead of reloading it.
    // compressResponses: the dev server sends every transformed module uncompressed — 19.5 MB of
    // boot on the wire, ~39s of it pure transfer on a phone's Tailscale link. Same bytes, smaller
    // envelope; a save still lands through HMR exactly as before.
    // precompressedAssets: the production client on :5184 (`vite preview`) — Brotli twins written at
    // build time, served with a year's cache on hashed assets.
    plugins: [react(), keepPageOnReconnect(), compressResponses(), precompressedAssets()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    server: {
      host,
      port: parseInt(env.VITE_PORT) || 5173,
      // Vite 7 refuses any Host header that is not an IP or localhost. This app is opened directly
      // under those names on the LAN and the tailnet — the machine name and its MagicDNS name
      // included — so they must stay allowed or such a visit renders a 403 page.
      allowedHosts: ['eis1', 'eis1.tail8717cd.ts.net'],
      // Pre-transform the entry module when the dev server starts, so the first visit after a restart
      // does not wait on it. Vite warms the listed file; its imports still transform on first request.
      warmup: { clientFiles: ['./src/main.tsx'] },
      // The :5184 build tree lives in the repo; left watched, every production build rewrote three
      // .html files there and full-reloaded every open :5183 tab.
      watch: { ignored: [(file) => /[\\/](?:\.prod-client|dist-server)(?:[\\/]|$)/.test(file)] },
      proxy: {
        '/api': `http://${proxyHost}:${serverPort}`,
        '/ws': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        },
        '/shell': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        },
        '/plugin-ws': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        }
      }
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            // No CodeMirror chunk: a manual chunk collects shared helpers too (the JSX runtime among
            // them), which made the entry preload all 616 kB of it. Left to Rollup, CodeMirror stays
            // in the lazy PRD editor's own chunk.
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-clipboard', '@xterm/addon-webgl']
          }
        }
      }
    }
  }
})
