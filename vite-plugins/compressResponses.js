// Serves the dev client compressed. Nothing else about it changes.
//
// The dev server sends every transformed module raw. Measured on the client's own boot: 1,177
// requests moving 19.5 MB across the wire, where `/src/main.tsx` is 1,963 bytes on disk, 6,721
// transformed, and goes out as `Content-Length: 6721` with NO `Content-Encoding` — even when the
// browser asks for gzip, deflate and br, and with no `Vary` to say the response is unframed. On a
// phone's 120ms Tailscale link that is ~39s of pure transfer inside a 48.6s load, which is most of
// why a cold load costs 3.5x a warm one (48.6s vs 13.8s measured). Measured after this plugin, the
// same cold load: 5.9 MB and 29.2s. The warm load is unchanged (176 KB, 13.8s) — it is 588
// conditional revalidations carrying no body at all, so there is nothing here to compress.
//
// This is not the deliberate "hosted as a development build" choice — that choice is about edits
// landing instantly, and it is untouched here: the very same transformed bytes are sent, in a
// smaller envelope, and a save still lands through HMR exactly as before. Compressing a response
// cannot make an edit arrive later.
//
// The body is compressed only when it is handed to `res.end` before the headers are written, so any
// handler that streams or sets its own status passes through untouched — it is simply not
// compressed. Two whole classes stream: every file served off disk from `public/`, and every
// response proxied to the API (`/api`, `/ws`). Both go out raw, and nothing proxied or streamed is
// ever buffered or framed twice. That keeps this to one wrapped method and no changes to Vite's
// middleware order.
//
// Dev server only: a build already emits compressed-by-the-network sizes and is served by whatever
// hosts dist/.

import { gzipSync, brotliCompressSync, constants } from 'node:zlib'

const MIN_BYTES = 1024

// Compressible types, by shape rather than an allow-list: the dev server serves JavaScript, CSS,
// JSON, HTML and SVG, and a module's type is set from its extension.
const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json|xml|x-javascript|manifest\+json)|image\/svg)/i

// The codings a client will take. One listed with q=0 is one it has ruled out (RFC 9110 §12.5.3).
function acceptedCodings(header) {
  const codings = new Set()
  for (const part of String(header || '').split(',')) {
    const [name, ...params] = part.split(';').map((s) => s.trim().toLowerCase())
    const q = params.find((p) => p.startsWith('q='))
    if (name && !(q && Number(q.slice(2)) === 0)) codings.add(name)
  }
  return codings
}

// A cache that stores a framed body must not hand it to a client that cannot read it. Vite's own
// `Vary: Origin` is kept.
function varyOnEncoding(res) {
  const vary = String(res.getHeader('Vary') || '')
  if (!/accept-encoding/i.test(vary)) {
    res.setHeader('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding')
  }
}

export default function compressResponses() {
  const brotli = { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }

  return {
    name: 'compress-responses',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        const end = res.end

        res.end = function (chunk, encoding, callback) {
          // A 304 revalidates a body this plugin may have framed, and a cache replaces its stored
          // Vary with the 304's (RFC 9111 §4.3.4), so the 304 has to name Accept-Encoding too.
          if (!res.headersSent && res.statusCode === 304) varyOnEncoding(res)
          // Nothing to do when the body was streamed, was already framed, or is not there.
          if (
            res.headersSent ||
            chunk === null ||
            chunk === undefined ||
            res.getHeader('Content-Encoding')
          ) {
            return end.call(res, chunk, encoding, callback)
          }
          if (typeof encoding === 'function') {
            callback = encoding
            encoding = undefined
          }

          const status = res.statusCode
          const type = String(res.getHeader('Content-Type') || '')
          // 204/304 carry no body; 206 is a slice of another representation.
          if (status !== 200 || !COMPRESSIBLE.test(type)) {
            return end.call(res, chunk, encoding, callback)
          }

          const body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8')
          if (body.length < MIN_BYTES) return end.call(res, body, callback)

          const accepts = acceptedCodings(res.req?.headers?.['accept-encoding'])
          let framed = null
          let name = ''
          if (accepts.has('br')) {
            framed = brotliCompressSync(body, brotli)
            name = 'br'
          } else if (accepts.has('gzip')) {
            framed = gzipSync(body, { level: 6 })
            name = 'gzip'
          }
          if (!framed) return end.call(res, body, callback)

          res.setHeader('Content-Encoding', name)
          res.setHeader('Content-Length', framed.length)
          varyOnEncoding(res)
          return end.call(res, framed, callback)
        }

        next()
      })
    },
  }
}
