// The link: the warden's one socket to center, kept up for as long as the warden runs. The protocol's one home is
// `server/shared/cerberus-types.ts`; center's half is `warden-auth.ts` (who may connect) and `warden-link.ts` (what it says back).
// This file restates only what it must act on; the behaviour by stage is MAN-7824.
//
//   CONNECT   a fresh `at` and signature on EVERY attempt (center remembers the pairs it has seen); `hello` first.
//   TRUST     every frame from center is checked against the key pinned at enrollment BEFORE its text is parsed.
//   LINKED    from `welcome` to the socket's close: the outbox trimmed to `ackedUpto`, the rest resent, a heartbeat every 15 s;
//             a reliable frame center leaves unanswered for 90 s, with no other word from it, drops the link (`ack-watch.mjs`).
//   RETRY     after any close, 1, 2, 4, 8, then 15 s (±20 %), restarted by a `welcome`; a connect that never opened is
//             asked about (`readRefusal`) so the log says WHY — a websocket client cannot see the 401's body.
//
// `link.on(type, fn)` and `link.send(type, body)` add frames; `link.on('link.down', fn)` runs when a LINKED socket is lost.
import { createAckWatch } from './ack-watch.mjs';
import { log } from './log.mjs';
import { createOutbox } from './outbox.mjs';
import { version } from './state.mjs';
import { buildHello, centerSocketUrl, connectHeaders, makeEnvelope, readRefusal, verifyFrame } from './wire.mjs';

export { readRefusal, verifyFrame };

/** Seconds to wait after the nth consecutive close; the last value repeats. */
const BACKOFF_SECONDS = [1, 2, 4, 8, 15];
const BACKOFF_JITTER = 0.2;
const HEARTBEAT_MS = 15_000;
const ATTEMPT_DEADLINE_MS = 10_000; // center closes a socket silent for 10 s; each stage of an attempt (the upgrade, then the `welcome`) gets the same
const ACK_DEADLINE_MS = 90_000; // six heartbeats: a center that acks a batch in milliseconds and a backlog in seconds is silent after this
const SOCKET_OPEN = 1;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function noState() {
  return { checksVersion: null, catalogVersion: null, active: { runs: [], diags: [] }, probesRunning: 0 };
}

/**
 * @param {{
 *   identity: { node: string, center: string, centerKey: string },
 *   state?: () => { checksVersion: number|null, catalogVersion: number|null, active: object, probesRunning: number },
 *   outbox?: ReturnType<typeof createOutbox>,
 *   home?: string,
 *   onReport?: () => void,
 * }} options `state` is read afresh for every `hello` and heartbeat; `home` is where the node key lives;
 * `onReport` runs after every heartbeat and whenever a connection attempt or link ends and a retry is scheduled.
 */
export function createLink({ identity, state = noState, outbox = createOutbox(), home, onReport }) {
  const handlers = new Map(); // frame type → handlers, in registration order
  const loggedOnce = new Set();
  let socket = null;
  let linked = false;
  let running = false;
  let attempt = 0;
  let lastLoggedRefusal = null;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let deadlineTimer = null;
  let sentUpto = 0; // the highest seq put on the current socket
  const ackWatch = createAckWatch(ACK_DEADLINE_MS, () => {
    log(`center has answered nothing for ${ACK_DEADLINE_MS / 1000} s with ${sentUpto - outbox.ackedUpto} reliable frame(s) outstanding; dropping the link`);
    abandon(socket); scheduleReconnect();
  });

  function logOnce(key, message) {
    if (loggedOnce.has(key)) return;
    loggedOnce.add(key);
    log(message);
  }

  function transmit(type, seq, body) {
    if (socket?.readyState !== SOCKET_OPEN) return false;
    try {
      socket.send(JSON.stringify(makeEnvelope(identity.node, type, seq, body)));
      return true;
    } catch (error) {
      log(`could not send a "${type}" frame: ${error.message}`);
      return false;
    }
  }

  /** Puts every queued frame above `sentUpto` on the socket, in order — including the one the outbox queues by itself when it drains below its cap. */
  function flushUnsent() {
    for (const frame of linked ? outbox.pending(sentUpto) : []) {
      if (!transmit(frame.type, frame.seq, frame.body)) return;
      sentUpto = frame.seq;
    }
    if (linked && sentUpto > outbox.ackedUpto) ackWatch.expect();
  }

  /** A report that throws is logged and dropped: it must never end the daemon from inside a socket event or a timer. */
  function report() {
    try { onReport?.(); } catch (error) { log(`the status report failed: ${error.message}`); }
  }

  function sendHeartbeat() {
    transmit('heartbeat', null, { version, uptimeS: Math.round(process.uptime()), probesRunning: state().probesRunning });
    report();
  }

  // --- what center says ---------------------------------------------------------------------------

  /** `welcome`: the link is made. Settle accounts with what center holds, then speak freely. */
  function onWelcome(body) {
    const ackedUpto = Number.isSafeInteger(body.ackedUpto) ? body.ackedUpto : 0;
    // The one call here that can throw (a floor write): before the deadline is cancelled, so a failed welcome is dropped and retried by the backoff.
    outbox.ack(ackedUpto);
    clearTimeout(deadlineTimer);
    attempt = 0;
    lastLoggedRefusal = null;
    sentUpto = ackedUpto;
    ackWatch.stop(); // a welcome re-settles the account: `flushUnsent` below starts the watch again only for what is still unanswered
    linked = true;
    const resend = outbox.pending(ackedUpto);
    log(`linked to ${identity.center} as ${identity.node}${resend.length ? `; resending ${resend.length} unacked frame(s)` : ''}`);
    flushUnsent();
    sendHeartbeat();
    clearInterval(heartbeatTimer); // a second welcome on one link must not stack a second beat
    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
  }

  function onError(body) {
    log(`center says: ${typeof body.message === 'string' ? body.message.slice(0, 200) : 'an error without a message'}`);
  }

  // The frames the link itself acts on. Every type, these included, then reaches `on(type)` handlers.
  const OWN_HANDLING = {
    welcome: onWelcome,
    ack: (body) => {
      outbox.ack(body.upto);
      ackWatch.settle(sentUpto > outbox.ackedUpto);
      flushUnsent(); // an ack can drain the outbox below its cap, which queues a frame
    },
    error: onError,
  };

  function dispatch(env) {
    const body = isRecord(env.body) ? env.body : {};
    const own = Object.hasOwn(OWN_HANDLING, env.type) ? OWN_HANDLING[env.type] : null;
    const registered = handlers.get(env.type) ?? [];
    if (!own && registered.length === 0) {
      logOnce(`type:${env.type}`, `ignoring a "${env.type}" frame; this warden has no handler for it`);
      return;
    }
    const failed = (error) => log(`the handler of a "${env.type}" frame failed: ${error?.message ?? error}`);
    for (const handle of [...(own ? [own] : []), ...registered]) {
      try {
        // An `async` handler fails as a rejected promise, which Node would turn into the end of the process.
        Promise.resolve(handle(body, env)).catch(failed);
      } catch (error) {
        failed(error);
      }
    }
  }

  function onMessage(data) {
    let frame;
    try {
      frame = typeof data === 'string' ? JSON.parse(data) : null;
    } catch {
      frame = null;
    }
    // The type of a frame that fails its signature cannot be trusted, so it is not even read: one line per kind of failure.
    if (frame === null || !verifyFrame(frame, identity.centerKey)) {
      logOnce('unsigned', 'dropped a frame that is not signed by the center this warden enrolled with');
      return;
    }
    let env;
    try {
      env = JSON.parse(frame.env);
    } catch {
      logOnce('unreadable', 'dropped a signed frame whose envelope is not JSON');
      return;
    }
    if (!isRecord(env) || typeof env.type !== 'string') {
      logOnce('malformed', 'dropped a signed frame that is not an envelope');
      return;
    }
    if (env.node !== identity.node) {
      logOnce(`other-node:${env.type}`, `dropped a "${env.type}" frame addressed to node ${JSON.stringify(env.node)}, not ${identity.node}`);
      return;
    }
    ackWatch.heard();
    dispatch(env);
  }

  // --- connecting ----------------------------------------------------------------------------------

  const nextBackoffSeconds = () => BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)];

  function goDown() {
    if (linked) {
      log(`link lost — retrying in ${nextBackoffSeconds()} s`);
      // The one event that is no frame from center: whatever lives only as long as the link (a session channel) is told.
      if (handlers.has('link.down')) dispatch({ type: 'link.down', body: {} });
    }
    linked = false;
    clearInterval(heartbeatTimer);
    clearTimeout(deadlineTimer);
    ackWatch.stop();
  }

  function scheduleReconnect() {
    const seconds = nextBackoffSeconds();
    attempt += 1;
    const jitter = 1 + (Math.random() * 2 - 1) * BACKOFF_JITTER;
    reconnectTimer = setTimeout(connect, Math.round(seconds * 1000 * jitter));
    report(); // a down link has no heartbeat: each end of an attempt is the moment its record moves
  }

  /** A connect that never opened: ask center why, and say it once per distinct answer. Never rejects. */
  async function explainFailedConnect(url) {
    try {
      const { status, reason } = await readRefusal(url, connectHeaders(identity.node, home));
      if (!running) return;
      let line = `center answered HTTP ${status}: ${reason}`;
      if (status === 401) line = `center refused: ${reason}`;
      else if (status === null) line = `center is unreachable: ${reason}`;
      else if (status === 101) return; // it would have let us in: the failure was in the socket, not the door
      if (line === lastLoggedRefusal) return;
      lastLoggedRefusal = line;
      log(line);
    } catch (error) {
      log(`could not read why center refused: ${error.message}`);
    }
  }

  /** Lets go of a socket without waiting for it: its later events are ignored. */
  function abandon(ws) {
    if (socket === ws) socket = null;
    goDown();
    try { ws.close(); } catch { /* already closing: nothing is left to do for it */ }
  }

  function connect() {
    if (!running) return;
    const url = centerSocketUrl(identity.center);
    let opened = false;
    const ws = new WebSocket(url, { headers: connectHeaders(identity.node, home) });
    socket = ws;
    // A center that takes the TCP connection and never answers the upgrade is as silent as one that never answers `hello`: each stage has a deadline.
    const armDeadline = (stage) => {
      clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(() => {
        log(`center did not ${stage === 'upgrade' ? 'accept the connection' : 'make the link'} within ${ATTEMPT_DEADLINE_MS / 1000} s; dropping this attempt`);
        abandon(ws);
        if (stage === 'upgrade') explainFailedConnect(url);
        scheduleReconnect();
      }, ATTEMPT_DEADLINE_MS);
    };
    armDeadline('upgrade');
    ws.addEventListener('open', () => {
      opened = true;
      if (socket !== ws) return;
      transmit('hello', null, buildHello(state()));
      armDeadline('welcome');
    });
    ws.addEventListener('message', (event) => { if (socket === ws) onMessage(event.data); });
    // `close` always follows and carries the decision; this only keeps an error from being unhandled.
    ws.addEventListener('error', () => {});
    ws.addEventListener('close', () => {
      if (socket !== ws) return; // abandoned, or stopped
      socket = null;
      goDown();
      if (!running) return;
      if (!opened) explainFailedConnect(url);
      scheduleReconnect();
    });
  }

  return {
    outbox,
    get linked() { return linked; },
    start() {
      if (running) return;
      running = true;
      connect();
    },
    stop() {
      running = false;
      clearTimeout(reconnectTimer);
      linked = false; // a stop is not a loss: goDown has nothing to report
      if (socket) abandon(socket);
      goDown();
    },
    /** Registers a handler for a frame type, run as `(body, envelope)` after the link's own handling; answers its remover. */
    on(type, handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
      return () => handlers.set(type, (handlers.get(type) ?? []).filter((existing) => existing !== handler));
    },
    /** Sends a frame: `reliable` via the outbox (numbered, kept until acked, resent after a reconnect), else only while linked and gone if not; answers `{ seq, sent }`, `sent` = it left now. */
    send(type, body, { reliable = false } = {}) {
      if (reliable) {
        const seq = outbox.push(type, body);
        flushUnsent();
        return { seq, sent: linked && seq <= sentUpto };
      }
      return { seq: null, sent: linked && transmit(type, null, body) };
    },
  };
}
