import http from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer } from 'ws';

import { hintChanged } from './cerberus-broadcast.js';
import { authenticateUpgrade } from './warden-auth.js';
import { runWardenLink } from './warden-link.js';
import { wardenLinks } from './warden-links.js';

/**
 * The warden gateway: a listener of its own, apart from the API's, where wardens dial in.
 *
 * WHY A SECOND LISTENER. The API binds loopback (`HOST=127.0.0.1`) and never has to face the LAN;
 * the wardens live on other machines. This server binds `CERBERUS_LISTEN` (a tailnet address) and
 * carries NO user route: a login, a cookie or a `token` query string opens nothing here. Its only
 * doors are the GETs in `wardenHttpRoutes` (exact paths) and `wardenHttpPrefixRoutes` (a path
 * prefix, for a file whose name is not known until it is built) — both registered by
 * `warden-files.ts`, which serves the enroll script and the warden release — and
 * one websocket upgrade, `GET /cerberus/ws`, which is authenticated BEFORE the socket is upgraded —
 * a peer that fails gets a plain 401 and a destroyed socket, and no websocket to send frames on.
 *
 * BINDING mirrors `server/index.ts`: `server.listen({ host, port, reusePort: supervised })`. Under the
 * dev supervisor a successor may find the retiring process still holding the port, and `reusePort`
 * is what lets it bind anyway. In practice it does not: the entrypoint starts the gateway after it
 * has signalled ready, the supervisor retires the old process on that signal, and the old process
 * stops its listener on SIGTERM — so a handover leaves the address with NO listener for about a
 * second (0.74–1.21 s over six handovers, 2026-10-06). A warden's first redial in it is refused and
 * backs off; it must not read "listening" at the `handover complete` journal line.
 * A bind error is logged once and answered in `error`; it is never thrown — a gateway that cannot
 * listen must not stop the API from booting. With `listen` null nothing starts at all.
 *
 * HAZARD, for the module that calls this: `reusePort` lets the gateway bind an address another
 * listener of the supervised API already holds, WITHOUT an error, and the kernel then splits that
 * address's traffic between the two (measured: of 60 requests, 26 reached the API and 34 got this
 * gateway's 404). The gateway cannot know the API's port, so the caller refuses a `CERBERUS_LISTEN` on it
 * before calling: the cerberus module's `start()` does, by port alone (`isApiOwnPort`).
 *
 * `stop()` closes the LISTENER only. Open links are left to the process's exit, as `http-drain.ts`
 * leaves the browser's websockets: a warden reconnects on its own, and closing a link early would
 * only make it reconnect to the process that is about to leave.
 *
 * Consumers: the cerberus module's `start()` (`startWardenGateway`) and `stop()` (the returned
 * `stop`); `warden-files.ts` (`wardenHttpRoutes`, `wardenHttpPrefixRoutes`).
 */

/** The only path a websocket upgrade is taken on. */
const WARDEN_WS_PATH = '/cerberus/ws';

/**
 * The largest frame a warden may send: a result batch is kilobytes, so for results this is a ceiling,
 * not a target; a `session.frame` carries one CLI line verbatim and can be megabytes. A frame past it
 * closes the whole link (1009), so the warden keeps what it relays under it (NODE SESSIONS in
 * `cerberus-types.ts`).
 */
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** How long a refused socket may take to read its answer before it is destroyed regardless. */
const REFUSAL_DRAIN_MS = 2000;

/** A GET handler of the gateway's plain HTTP side; one that throws or rejects answers a 500 and costs the process nothing. */
type WardenHttpHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;

/**
 * Exact-path GET routes of the gateway's plain HTTP side, `pathname → handler`. Every request that
 * matches neither this table nor `wardenHttpPrefixRoutes` answers a plain 404.
 * Consumers: `warden-files.ts`, which registers the enroll script and `latest.json` at start.
 */
export const wardenHttpRoutes = new Map<string, WardenHttpHandler>();

/**
 * GET routes taken by path prefix, `prefix → handler`, tried after the exact table. The handler is
 * handed the raw request and is the one that judges the rest of the path: nothing here decodes it,
 * and a name the handler does not recognise must be answered 404 by the handler itself.
 * Consumers: `warden-files.ts`, for `/cerberus/warden/<release file>` — the file's name carries a
 * version, so no exact path could be registered ahead of a build.
 */
export const wardenHttpPrefixRoutes = new Map<string, WardenHttpHandler>();

/** The handler for `pathname`: an exact route, else the first prefix route that starts it. */
function findHttpRoute(pathname: string): WardenHttpHandler | undefined {
  const exact = wardenHttpRoutes.get(pathname);
  if (exact) return exact;
  for (const [prefix, handler] of wardenHttpPrefixRoutes) {
    if (pathname.startsWith(prefix)) return handler;
  }
  return undefined;
}

/** What `startWardenGateway` resolves: where it listens (null when it does not), why not, and how to stop. */
export type WardenGateway = { address: string | null; error: string | null; stop(): void };

let linkChangeHintArmed = false;

/**
 * Splits `host:port`; IPv6 hosts may be bracketed (`[::1]:3012`). Null when it is not one.
 * Consumers: this file's start, and `cerberus.module.ts`, which compares the port with the API's
 * own before starting the gateway.
 */
export function parseListen(listen: string): { host: string; port: number } | null {
  const colon = listen.lastIndexOf(':');
  if (colon <= 0) return null;
  const host = listen.slice(0, colon).replace(/^\[(.*)\]$/, '$1');
  const portText = listen.slice(colon + 1);
  const port = Number(portText);
  if (!host || !/^\d{1,5}$/.test(portText) || port > 65535) return null;
  return { host, port };
}

/** Writes a short plain-text HTTP answer on a raw upgrade socket and ends it. */
function endSocketWith(socket: Duplex, status: string, bodyLine: string): void {
  const body = `${bodyLine}\n`;
  // The peer may be gone already; an `error` with no listener would be thrown at the process.
  socket.on('error', () => socket.destroy());
  socket.end(
    `HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    () => socket.destroy()
  );
  // A peer that never reads would keep the socket until its own timeout.
  setTimeout(() => socket.destroy(), REFUSAL_DRAIN_MS).unref();
}

function answerPlainRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const pathname = (req.url ?? '/').split('?')[0];
  const route = req.method === 'GET' ? findHttpRoute(pathname) : undefined;
  if (!route) {
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Content-Length': 10 });
    res.end('Not found\n');
    return;
  }
  // A handler is awaited as well as caught: an `async` one that rejects would otherwise be an
  // unhandled rejection, which ends the API process (nothing in `server/` handles that event).
  const answerFailure = (error: unknown): void => {
    console.error(`[Cerberus] the gateway route ${pathname} failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error\n');
  };
  try {
    Promise.resolve(route(req, res)).catch(answerFailure);
  } catch (error) {
    answerFailure(error);
  }
}

/**
 * Starts the gateway. Resolves once the listener is up or has failed — never rejects: a bind error
 * lands in `error`, and with `listen` null (or not `host:port`) `address` is null and nothing runs.
 */
export function startWardenGateway(options: { listen: string | null; supervised: boolean }): Promise<WardenGateway> {
  const nothingListening = (error: string | null): WardenGateway => ({ address: null, error, stop: () => undefined });
  const listen = options.listen;
  if (listen === null) return Promise.resolve(nothingListening(null));

  const target = parseListen(listen);
  if (!target) {
    const error = `CERBERUS_LISTEN "${listen}" is not host:port`;
    console.error(`[Cerberus] the warden gateway did not start: ${error}`);
    return Promise.resolve(nothingListening(error));
  }

  // A link change (a socket attaching or detaching, a node entering or leaving silence) is a change
  // on screen. One subscription for the process, however many times a gateway is started.
  if (!linkChangeHintArmed) {
    linkChangeHintArmed = true;
    wardenLinks.onChange((node) => hintChanged({ nodes: [node] }));
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const server = http.createServer(answerPlainRequest);

  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url ?? '/').split('?')[0];
    if (req.method !== 'GET' || pathname !== WARDEN_WS_PATH) {
      endSocketWith(socket, '404 Not Found', 'Not found');
      return;
    }
    try {
      const verdict = authenticateUpgrade(req, Date.now());
      if ('refused' in verdict) {
        endSocketWith(socket, '401 Unauthorized', verdict.refused);
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => runWardenLink(ws, verdict));
    } catch (error) {
      console.error(`[Cerberus] an upgrade could not be judged: ${error instanceof Error ? error.message : String(error)}`);
      endSocketWith(socket, '500 Internal Server Error', 'Server error');
    }
  });

  return new Promise((resolve) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      const message = `could not listen on ${listen}: ${error.code ?? error.message}`;
      console.error(`[Cerberus] the warden gateway ${message}`);
      resolve(nothingListening(message));
    });

    server.listen({ host: target.host, port: target.port, reusePort: options.supervised }, () => {
      // From here an error is no longer a failed start; keep it from being thrown at the process.
      server.removeAllListeners('error');
      server.on('error', (error) => console.error(`[Cerberus] the warden gateway server errored: ${error.message}`));

      const bound = server.address();
      // `parseListen` took the brackets off an IPv6 host; an address someone builds a URL from needs them back.
      const hostText = target.host.includes(':') ? `[${target.host}]` : target.host;
      const address = bound && typeof bound === 'object' ? `${hostText}:${bound.port}` : listen;
      console.log(`[Cerberus] the warden gateway is listening on ${address}`);
      resolve({
        address,
        error: null,
        stop: () => {
          if (server.listening) server.close();
        },
      });
    });
  });
}
