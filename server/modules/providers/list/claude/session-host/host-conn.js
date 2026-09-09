/**
 * One client connection: NDJSON framing, the CLI's stdin line buffer, the initialize cache,
 * `note` handling, and the replay hand-off that precedes going live.
 *
 * Two rules this file exists to keep:
 * - A socket close is a DETACH, never EOF (D-10). Nothing here ends the CLI's stdin except an
 *   explicit `end_input` frame, so the SDK's exit reaper dropping a socket during an API
 *   restart cannot end the turn that restart was supposed to survive.
 * - The cached initialize reply carries seq 0 and is never journaled: it answers ONE client's
 *   request, and giving it a real seq would make the next re-attach replay a control response
 *   nobody asked for (D-3's cursor covers CLI output only).
 */

import { StringDecoder } from 'node:string_decoder';

const NEWLINE_BYTE = 0x0a;
const NEWLINE_BUF = Buffer.from('\n');
// Far above any real frame (attachments are <=10 MB each and arrive base64-of-base64), and
// safely under V8's ~512 MB max string length, where a runaway peer would otherwise crash the
// host outright instead of erroring one connection.
const MAX_UNTERMINATED_BYTES = 256 * 1024 * 1024;
const tooLong = (what, length) =>
  `${what} reached ${length} bytes with no newline (limit ${MAX_UNTERMINATED_BYTES})`;

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Holds the CLI's one and only initialize answer, and answers every later request from it.
 * consumer: host.js (observe) and this file (claim/queue/frameFor)
 */
export function createInitCache() {
  let forwardedRequestId = null;
  let cachedResponse = null;
  let waiters = [];

  // The SDK matches on response.request_id; a CLI that ever carried it at the top level still
  // has to be recognised, so both places are read (and both are rewritten on the way out).
  function requestIdOf(parsed) {
    return parsed?.response?.request_id ?? parsed?.request_id ?? null;
  }

  function frameFor(requestId) {
    const copy = JSON.parse(JSON.stringify(cachedResponse));
    if (copy.response && typeof copy.response === 'object') copy.response.request_id = requestId;
    if (Object.prototype.hasOwnProperty.call(copy, 'request_id')) copy.request_id = requestId;
    return { t: 'out', seq: 0, at: Date.now(), line: JSON.stringify(copy) };
  }

  return {
    /** 'forward' for the first initialize the CLI ever sees, and for no other. */
    claim(requestId) {
      if (forwardedRequestId === null) {
        forwardedRequestId = requestId;
        return 'forward';
      }
      return cachedResponse === null ? 'queue' : 'answer';
    },

    /** A re-attach that beats the CLI's first answer waits here rather than reaching stdin. */
    queue(requestId, conn) {
      waiters.push({ requestId, conn });
    },

    frameFor,

    observe(line) {
      if (cachedResponse !== null || forwardedRequestId === null) return;
      const parsed = parseJson(line);
      if (parsed?.type !== 'control_response') return;
      if (requestIdOf(parsed) !== forwardedRequestId) return;
      cachedResponse = parsed;
      const pending = waiters;
      waiters = [];
      for (const waiter of pending) {
        if (!waiter.conn.closed) waiter.conn.send(frameFor(waiter.requestId));
      }
    },

    forget(conn) {
      waiters = waiters.filter((waiter) => waiter.conn !== conn);
    }
  };
}

/**
 * Drives one accepted socket to its close.
 * consumer: host.js
 */
export function handleConnection(socket, host) {
  const frameDecoder = new StringDecoder('utf8');
  let frameBuf = '';
  // Raw CLI stdin bytes, split on \n only: a base64 frame boundary must never re-encode or
  // re-chunk what the API wrote, and a partial line waits for its continuation.
  let stdinBuf = Buffer.alloc(0);
  let started = false;

  const conn = {
    closed: false,
    send(frame) {
      if (conn.closed) return;
      socket.write(`${JSON.stringify(frame)}\n`);
    },
    sendRaw(rawLine) {
      if (conn.closed) return;
      socket.write(`${rawLine}\n`);
    },
    /** Last write of this host's life: the callback fires once the frame has been flushed. */
    endWith(frame, onFlushed) {
      if (conn.closed) {
        onFlushed();
        return;
      }
      socket.end(`${JSON.stringify(frame)}\n`, onFlushed);
    },
    end() {
      if (!conn.closed) socket.end();
    }
  };

  function fail(message) {
    conn.send({ t: 'err', message });
    conn.end();
    // 'close' is asynchronous, so mark the connection dead now: the frames already parsed out
    // of this same chunk must not keep reaching the CLI after a protocol error.
    conn.closed = true;
  }

  function forwardStdinLine(line) {
    const parsed = parseJson(line.toString('utf8'));
    const isInitialize =
      parsed?.type === 'control_request' && parsed?.request?.subtype === 'initialize';
    if (!isInitialize) {
      // A false here means the CLI's stdin has already gone; host.js logs the dropped line,
      // and the `exit` frame still tells this client what actually became of the CLI.
      host.writeStdin(Buffer.concat([line, NEWLINE_BUF]));
      return;
    }
    const requestId = parsed.request_id;
    const decision = host.initCache.claim(requestId);
    if (decision === 'forward') host.writeStdin(Buffer.concat([line, NEWLINE_BUF]));
    else if (decision === 'answer') conn.send(host.initCache.frameFor(requestId));
    else host.initCache.queue(requestId, conn);
  }

  function onStdinFrame(frame) {
    if (typeof frame.b64 !== 'string') return fail('stdin frame needs b64');
    const chunk = Buffer.from(frame.b64, 'base64');
    stdinBuf = stdinBuf.length === 0 ? chunk : Buffer.concat([stdinBuf, chunk]);
    let cut = stdinBuf.indexOf(NEWLINE_BYTE);
    while (cut !== -1) {
      const line = stdinBuf.subarray(0, cut);
      stdinBuf = Buffer.from(stdinBuf.subarray(cut + 1));
      forwardStdinLine(line);
      if (conn.closed) return undefined;
      cut = stdinBuf.indexOf(NEWLINE_BYTE);
    }
    if (stdinBuf.length > MAX_UNTERMINATED_BYTES) {
      return fail(tooLong('stdin line', stdinBuf.length));
    }
    return undefined;
  }

  function startFresh(frame) {
    const error = host.spawnCli(frame);
    if (error) return fail(error);
    started = true;
    host.attach(conn);
    return undefined;
  }

  function startReattach(frame) {
    if (!host.hasChild()) return fail('no live CLI to re-attach to');
    started = true;
    // Replay runs to completion inside this handler, so no live line can slip in front of it.
    const fromSeq = host.journal.cursorFor(frame.fromSeq);
    host.journal.replayFrom(fromSeq, (rawLine, replayed) => {
      conn.sendRaw(rawLine);
      host.journal.markDelivered(replayed);
    });
    conn.send({ t: 'live' });
    host.attach(conn);
    return undefined;
  }

  function onFrame(frame) {
    if (!started) {
      if (frame.t === 'spawn') return startFresh(frame);
      if (frame.t === 'hello') return startReattach(frame);
      return fail(`first frame must be spawn or hello, got ${String(frame.t)}`);
    }
    switch (frame.t) {
      case 'stdin':
        return onStdinFrame(frame);
      case 'end_input':
        return host.endInput();
      case 'kill':
        return host.kill(frame.signal);
      case 'note':
        return host.note(frame);
      default:
        return fail(`unexpected frame ${String(frame.t)}`);
    }
  }

  socket.setNoDelay(true);

  socket.on('data', (chunk) => {
    frameBuf += frameDecoder.write(chunk);
    let cut = frameBuf.indexOf('\n');
    while (cut !== -1) {
      const raw = frameBuf.slice(0, cut);
      frameBuf = frameBuf.slice(cut + 1);
      if (raw.trim() !== '') {
        const frame = parseJson(raw);
        if (!frame || typeof frame.t !== 'string') {
          fail('malformed frame');
          return;
        }
        onFrame(frame);
        if (conn.closed) return;
      }
      cut = frameBuf.indexOf('\n');
    }
    if (frameBuf.length > MAX_UNTERMINATED_BYTES) fail(tooLong('frame', frameBuf.length));
  });

  // A peer that vanishes mid-turn is the normal case this whole package exists for.
  socket.on('error', () => {});

  socket.on('close', () => {
    conn.closed = true;
    host.initCache.forget(conn);
    host.detach(conn);
  });

  return conn;
}
