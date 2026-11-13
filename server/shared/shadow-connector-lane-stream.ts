import { Readable, pipeline } from 'node:stream';

import type express from 'express';

import type { LaneAnswer } from './shadow-connector-lane.js';
import { NO_SECRET_MESSAGE, describeFailure, laneHeaders, upstreamUrl } from './shadow-connector-lane-wire.js';

/**
 * The event-stream mode of a lane to shadow-connector: `stream`, beside the forwarder's `forward`. Consumers:
 * `shadow-connector-lane.ts` (which builds it and hands it its one read of the secret),
 * `shadow-connector-lane-router.ts` (which sends a `stream` row to it and writes what it opens) and
 * `server/index.ts` (whose shutdown path ends the open streams, `endOpenEventStreams`).
 *
 * A view that is TOLD of every change — the upload runs' feed, a live run's bubbles — holds an event stream
 * open, and shadow-connector's surface is internal-caller gated, so this server is the one hop that can hold
 * the secret for it. The stream is relayed as it arrives: nothing is buffered here, and nothing is left open
 * when the browser goes or this server retires. Four things differ from `forward`, and each has a reason:
 *
 *  - The bound covers CONNECTING (and reading any answer that is not a stream), never the stream: an open
 *    event stream is meant to outlast any timeout. What keeps a dead upstream from holding a browser for ever
 *    is the upstream's own `: keepalive` comment every 15 s against the HTTP client's 300 s body timeout.
 *  - The browser hanging up aborts the upstream, at any point from the connect to the last byte (`hangUp`).
 *  - A retiring server ends its open streams as its HTTP drain starts: a stream never finishes by itself, so the
 *    drain would otherwise wait out its whole bound for it at every restart while a view is shown.
 *  - Any answer that is not a 200 event stream is relayed with its status and its JSON, never turned into a
 *    stream: a browser's `EventSource` FAILS on a non-200 and never dials again, where a 200 that closes
 *    arms its retry loop (the engine's `routes_stream.py` banner has the reasoning, and a 410 relies on it).
 *
 * Nothing here throws. A lane fault is a RESULT, as in `forward`, so the router can choose the status.
 */

const EVENT_STREAM = 'text/event-stream';
const LAST_EVENT_ID_HEADER = 'Last-Event-ID';

/** The headers of an event stream written to a browser: the house's SSE writer (`provider.routes.ts`), minus the `Connection` header HTTP/1.1 implies. */
const EVENT_STREAM_HEADERS = {
  'Content-Type': EVENT_STREAM,
  'Cache-Control': 'no-cache',
  // The reverse proxy's buffering switch (nginx and the tunnels honour it): a frame must reach the browser when it is sent.
  'X-Accel-Buffering': 'no',
} as const;

/**
 * One stream to open. Consumer: `createLaneRouter`, which builds it from a request it has validated against its
 * lane's allowlist, and hands it to the lane's `stream`.
 */
export type LaneStreamRequest = {
  /** Absolute upstream path, already validated by the route that built it. */
  path: string;
  query?: Record<string, string>;
  /** The signed-in operator's name, or null when the request carried none. */
  actingUser: string | null;
  /** The Gemini budget to carry as `X-Gemini-Budget-Plan`, from `relayBudgetOf`; null carries none. */
  budget: string | null;
  /** The browser's `Last-Event-ID`, already checked to be a whole number; null carries none. */
  lastEventId: string | null;
  /** Bounds the connect, and the reading of any answer that is not an event stream. Never an open stream. */
  connectTimeoutMs: number;
  /** Aborts when the browser goes (`hangUpSignal`); the upstream is closed with it. */
  hangUp: AbortSignal;
};

/**
 * What opening a stream came back as: a live event stream, or any answer `forward` can give but an image.
 * Consumer: `createLaneRouter`, which writes it.
 *
 *  - `kind: 'stream'`  a 200 `text/event-stream`. `body` is its bytes, unchanged, as they arrive; destroying it
 *    closes the upstream.
 *  - `kind: 'json'`    any other answer, with its status and its JSON (a 410 for an ended run, a 503 for a full feed).
 *  - a fault           the lane's own (`unreachable`, `unreadable`, `no_secret`), as for `forward`.
 */
export type LaneStreamAnswer = { ok: true; kind: 'stream'; body: Readable } | Exclude<LaneAnswer, { kind: 'bytes' }>;

/** The lane's second verb, as `createShadowConnectorLane` returns it beside `forward`. */
export type LaneStream = (request: LaneStreamRequest) => Promise<LaneStreamAnswer>;

/** What `createShadowConnectorLane` hands the transport. */
export type LaneStreamDependencies = {
  /** shadow-connector's origin without a trailing slash. */
  origin: string;
  /** The lane's ONE read of the secret, handed in so this file never touches the env file (INV-8633). */
  currentSecret: () => Promise<string | null>;
  /** The lane's log word, for the one line an open stream's failure earns. */
  label: string;
};

/**
 * Builds the lane's `stream`. Consumer: `createShadowConnectorLane`, once per lane.
 */
export function createLaneStream({ origin, currentSecret, label }: LaneStreamDependencies): LaneStream {
  return async function stream(request) {
    const secret = await currentSecret();
    if (secret === null) return { ok: false, reason: 'no_secret', message: NO_SECRET_MESSAGE };

    const headers = laneHeaders(secret, EVENT_STREAM, request);
    if (request.lastEventId !== null) headers[LAST_EVENT_ID_HEADER] = request.lastEventId;

    // The bound is a signal of its own and not `AbortSignal.timeout`, which would also cut the stream at that mark.
    const connectBound = new AbortController();
    const connectTimer = setTimeout(
      () => connectBound.abort(new DOMException('shadow-connector did not answer in time', 'TimeoutError')),
      request.connectTimeoutMs,
    );
    try {
      // `redirect: 'manual'` keeps the secret header from following a Location anywhere (INV-8633).
      const response = await fetch(upstreamUrl(origin, request.path, request.query), {
        method: 'GET',
        headers,
        signal: AbortSignal.any([request.hangUp, connectBound.signal]),
        redirect: 'manual',
      });
      return await answerOf(response, request.hangUp, label);
    } catch (error) {
      return { ok: false, reason: 'unreachable', message: describeFailure(error, request.connectTimeoutMs) };
    } finally {
      // Reached when the answer is decided: a live stream is then unbounded, anything else has been read.
      clearTimeout(connectTimer);
    }
  };
}

/** A 200 that says it is an event stream, and has a body to read. */
function isEventStream(response: Response): response is Response & { body: NonNullable<Response['body']> } {
  const contentType = response.headers.get('content-type') ?? '';
  return response.status === 200 && response.body !== null && contentType.toLowerCase().startsWith(EVENT_STREAM);
}

async function answerOf(response: Response, hangUp: AbortSignal, label: string): Promise<LaneStreamAnswer> {
  if (isEventStream(response)) {
    const body = Readable.fromWeb(response.body);
    // The body also errors when the browser goes (it is the same abort) and when `pipeline` closes it because the
    // response ended first (the browser left, or the shutdown ended the stream). Neither is the upstream failing,
    // so only a failure with the browser still there is news.
    body.once('error', (error: NodeJS.ErrnoException) => {
      if (hangUp.aborted || error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
      console.warn(`[${label}] an open event stream broke: ${describeFailure(error, 0)}`);
    });
    return { ok: true, kind: 'stream', body };
  }
  const text = await response.text();
  try {
    return { ok: true, status: response.status, kind: 'json', body: JSON.parse(text) as unknown, headers: {} };
  } catch {
    return { ok: false, reason: 'unreadable', message: 'shadow-connector did not answer with JSON' };
  }
}

/**
 * A signal that aborts when the browser's connection ends before the response is finished. A finished
 * response closes too, and that is no hang-up. Consumer: `createLaneRouter`, once per `stream` row it serves.
 */
export function hangUpSignal(response: express.Response): AbortSignal {
  const hangUp = new AbortController();
  if (response.destroyed) {
    // The browser went while the mount was still checking its token: no `close` is left to wait for.
    hangUp.abort();
  } else {
    response.once('close', () => {
      if (!response.writableFinished) hangUp.abort();
    });
  }
  return hangUp.signal;
}

/** One event stream being relayed to a browser: what the shutdown needs to end it. */
type OpenStream = { response: express.Response; body: Readable };

/** Every event stream this process is relaying right now: `relayEventStream` adds one, its response closing removes it. */
const openStreams = new Set<OpenStream>();

/** Set when the shutdown asks the streams to end: a stream relayed after that is ended as soon as it is opened. */
let shuttingDown = false;

/**
 * Writes a live stream to the browser: the SSE headers, flushed at once (a reader that waits for the first
 * byte would otherwise show the stream as connecting), then the upstream's bytes unchanged. `pipeline` ends the
 * response when the upstream ends, and when either side fails or goes it destroys the other: the browser
 * leaving closes the upstream, and the upstream failing closes the browser's stream, which makes its
 * `EventSource` dial again. Consumer: `createLaneRouter`.
 */
export function relayEventStream(response: express.Response, body: Readable): void {
  if (response.destroyed) {
    // The browser went between the answer and this write: nobody to tell, and the upstream must not stay open for it.
    body.destroy();
    return;
  }
  response.writeHead(200, EVENT_STREAM_HEADERS);
  response.flushHeaders();
  if (shuttingDown) {
    // Asked for over a keep-alive socket that was still open when the shutdown began: an empty stream that ends at once
    // is a 200 that closes, which is what makes an `EventSource` dial the successor (a non-200 would end it for good).
    body.destroy();
    response.end();
    return;
  }
  const open: OpenStream = { response, body };
  openStreams.add(open);
  response.once('close', () => openStreams.delete(open));
  // A failed pipe has been cleaned up on both sides by the time the callback runs, and the cause that is news is logged where it is seen.
  pipeline(body, response, () => undefined);
}

/**
 * Ends every event stream this process is relaying, cleanly, and any asked for after this. An event stream never
 * finishes by itself, so the HTTP drain of a retiring server (`http-drain.ts`) would otherwise wait out its whole
 * bound for it, journal it as a cut request, and hold the successor's takeover back by that much, at every restart
 * while a view is shown. Ended here, the browser's `EventSource` dials the successor and the drain returns as soon
 * as the last response has closed. The pipe is let go before the response ends, so no byte follows the end; the
 * response closing then makes `pipeline` destroy the body, which closes the upstream.
 * Consumer: `server/index.ts`'s shutdown path, right after it starts the drain.
 */
export function endOpenEventStreams(): void {
  shuttingDown = true;
  for (const { response, body } of openStreams) {
    try {
      body.unpipe(response);
      response.end();
    } catch (error) {
      // One stream that cannot be ended must not keep the shutdown from reaching the rest of it: the exit cuts that one.
      console.error(`[shutdown] could not end an open event stream: ${error instanceof Error ? error.name : 'unknown error'}`);
    }
  }
}
