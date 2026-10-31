import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { getConnectableHost, normalizeLoopbackHost } from './shared/networkHosts.js'
import keepPageOnReconnect from './vite-plugins/keepPageOnReconnect.js'
import compressResponses from './vite-plugins/compressResponses.js'
import precompressedAssets from './vite-plugins/precompressedAssets.js'

// The client shows the installed package version so it can be compared against the
// version the server process is actually running. Importing package.json here and
// injecting it keeps the frontend free of imports that reach outside src/. Imported, not
// read from disk: Vite bundles this config with esbuild, which makes package.json a config
// dependency, so a version bump restarts the dev server on its own and the new number is
// baked in. A one-time read here served the old version until the config itself changed.
import pkg from './package.json'

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
    // The file editor reaches every grammar through a dynamic import() and the file previews reach
    // their renderers the same way, so Vite would discover each one only when Edit is first pressed
    // on a file of that kind or a PDF is first opened — and the discovery reloads the page. Naming
    // them here pre-bundles them at server start instead. The 360° sphere (three.js and the viewer) is first
    // imported when a pano opens, which is the discovery above. Measured on a cold cache (`.verify/sphere-cold-start.mjs`):
    // the start-up scan follows SphereView's literal import() and finds the four anyway, so the first sphere opens in one
    // document load with or without them here; naming them keeps it so should that import ever be computed.
    // Her ears' worker first imports `@huggingface/transformers` when the ears arm (the worker is its own chunk, reached through
    // `new Worker(new URL(...))`), so a dev server that had not bundled it would discover it then and reload the page.
    optimizeDeps: {
      include: [
        '@codemirror/lang-css',
        '@codemirror/lang-html',
        '@codemirror/lang-javascript',
        '@codemirror/lang-json',
        '@codemirror/lang-markdown',
        '@codemirror/lang-python',
        '@codemirror/lang-yaml',
        '@huggingface/transformers',
        '@photo-sphere-viewer/core',
        '@photo-sphere-viewer/cubemap-adapter',
        '@photo-sphere-viewer/markers-plugin',
        'docx-preview',
        'pdfjs-dist',
        'three',
        'xlsx'
      ]
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
      // under those names on the LAN and a VPN — the machine name and its DNS name included — so
      // they are listed in the comma-separated VITE_ALLOWED_HOSTS or such a visit renders a 403 page.
      allowedHosts: (env.VITE_ALLOWED_HOSTS || '').split(',').map((name) => name.trim()).filter(Boolean),
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
