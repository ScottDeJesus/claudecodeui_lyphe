// The production client's compression and caching, for `vite preview` on :5184.
//
// Build: when `CLOUDCLI_PRECOMPRESS=1` (set by scripts/prod-client-build.sh, and only there, so a
// plain `npm run build` into dist/ is unchanged), every compressible file the bundle writes gets a
// `.br` (quality 11) beside it — the preview server streams files off disk and compresses nothing.
//
// Preview: a request whose file has a `.br` twin, from a client that takes br, is answered with the
// twin, with an ETag from its size and mtime so a revalidation is a 304. A page navigation (a route
// with no file extension) is answered with `index.html`'s twin. Everything under `/assets/` carries
// a content hash in its name, so it is cached for a year and never revalidated — whichever server
// answers it; everything else (the document, the manifest, the service worker) keeps `no-cache`, so
// a rebuild is seen on the next load. A request this does not match falls through to Vite's own
// static server and proxy.

import fs from 'node:fs'
import path from 'node:path'
import { brotliCompressSync, constants } from 'node:zlib'

const MIN_BYTES = 1024
const IMMUTABLE = 'public, max-age=31536000, immutable'

const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
}

// The API and socket paths the preview proxies. This middleware runs before the proxy, so it must
// never answer one of them as a page.
const PROXIED = /^\/(?:api|ws|shell|plugin-ws)(?:\/|$)/

function acceptsBrotli(header) {
  return String(header || '')
    .split(',')
    .some((part) => {
      const [name, ...params] = part.split(';').map((s) => s.trim().toLowerCase())
      const q = params.find((p) => p.startsWith('q='))
      return (name === 'br' || name === '*') && !(q && !(Number(q.slice(2)) > 0))
    })
}

export default function precompressedAssets() {
  let outDir = 'dist'

  return {
    name: 'precompressed-assets',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    writeBundle() {
      if (process.env.CLOUDCLI_PRECOMPRESS !== '1') return
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const file = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            walk(file)
            continue
          }
          if (!TYPES[path.extname(file)]) continue
          const body = fs.readFileSync(file)
          if (body.length < MIN_BYTES) continue
          fs.writeFileSync(`${file}.br`, brotliCompressSync(body, {
            params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: body.length },
          }))
        }
      }
      walk(outDir)
    },
    configurePreviewServer(server) {
      const root = path.resolve(server.config.root, server.config.build.outDir)
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next()
        let pathname
        try {
          pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname)
        } catch {
          return next()
        }
        if (PROXIED.test(pathname)) return next()

        // Hashed names never change content: a year's cache, whichever server ends up answering.
        if (pathname.startsWith('/assets/')) {
          const writeHead = res.writeHead
          res.writeHead = function (status, ...rest) {
            if (status === 200 || status === 304) {
              res.removeHeader('Cache-Control')
              const headers = rest.find((arg) => arg && typeof arg === 'object')
              if (headers) {
                for (const key of Object.keys(headers)) if (key.toLowerCase() === 'cache-control') delete headers[key]
              }
              res.setHeader('Cache-Control', IMMUTABLE)
            }
            return writeHead.call(res, status, ...rest)
          }
        }

        // A navigation to a client route is the entry document.
        const isPage = !path.extname(pathname) && String(req.headers.accept || '').includes('text/html')
        const target = isPage ? '/index.html' : pathname
        const type = TYPES[path.extname(target)]
        if (!type || !acceptsBrotli(req.headers['accept-encoding'])) return next()
        const file = path.join(root, target)
        if (!file.startsWith(root + path.sep)) return next()
        let stat
        try {
          stat = fs.statSync(`${file}.br`)
        } catch {
          return next()
        }
        const etag = `W/"br-${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
        res.setHeader('Vary', 'Accept-Encoding')
        res.setHeader('ETag', etag)
        res.setHeader('Cache-Control', target.startsWith('/assets/') ? IMMUTABLE : 'no-cache')
        if (req.headers['if-none-match'] === etag) {
          res.statusCode = 304
          return res.end()
        }
        res.statusCode = 200
        res.setHeader('Content-Type', type)
        res.setHeader('Content-Encoding', 'br')
        res.setHeader('Content-Length', stat.size)
        if (req.method === 'HEAD') return res.end()
        const stream = fs.createReadStream(`${file}.br`)
        // The twin can vanish between the stat and the open (a retention pass removing an old build).
        stream.on('error', () => {
          if (res.headersSent) return res.destroy()
          for (const name of ['Content-Encoding', 'Content-Length', 'Content-Type', 'ETag']) res.removeHeader(name)
          next()
        })
        stream.pipe(res)
      })
    },
  }
}
