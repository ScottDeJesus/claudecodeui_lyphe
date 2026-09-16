#!/usr/bin/env node
// Proves a real board write reaches a real websocket client, end to end: open the app's `/ws`
// socket as a browser would, wait for the frame, and report what arrived.
//
//   node scripts/kanban-ws-probe.mjs <app-url> <token> <board-id>
//
// It prints exactly one line and exits — `FRAME kind=<event kind> card=<cardId> lanes=<n>` for the
// first `kanban_event` frame whose boardId matches, or `NO-FRAME` — so a caller can grep the
// result instead of reading a log. Nothing is hard-coded: the url, the token and the board id all
// arrive as arguments, and the token rides as the same `?token=` query parameter
// `src/shared/context/WebSocketContext.tsx` builds.
//
// A frame of any other kind is not evidence: the server broadcasts to every connected client with
// no per-user or per-project filtering, so a `session_upserted` from another window — or a
// `kanban_event` for a different board — would otherwise pass for the write under test.
import WebSocket from 'ws';

/** The longest a probe waits for a matching frame before reporting NO-FRAME. */
const DEADLINE_MS = 20_000;

const [appUrl, token, boardId] = process.argv.slice(2);

if (!appUrl || !token || !boardId) {
  console.error('usage: node scripts/kanban-ws-probe.mjs <app-url> <token> <board-id>');
  process.exit(2);
}

/** The app's http(s) url turned into the websocket url the browser client builds. */
function socketUrl(base, authToken) {
  const url = new URL(base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/ws`;
  url.search = new URLSearchParams({ token: authToken }).toString();
  return url.toString();
}

let settled = false;

// Opening the socket can fail before there is a socket to listen on at all — a url the caller
// mistyped, or a scheme `ws` will not speak. That is the same news as an app that never answers,
// so it is reported the same way: one greppable line, never a stack trace where a line was
// promised. Without this guard `new URL('notaurl')` throws out of the module and prints nothing.
let socket;
try {
  socket = new WebSocket(socketUrl(appUrl, token));
} catch (error) {
  console.error(`kanban-ws-probe: ${error.message}`);
  console.log('NO-FRAME');
  process.exit(0);
}

/** Print the one line, hang up, and leave — a probe never waits out its deadline on success. */
function finish(line) {
  if (settled) return;
  settled = true;
  clearTimeout(deadline);
  console.log(line);
  socket.removeAllListeners();
  socket.close();
  process.exit(0);
}

const deadline = setTimeout(() => finish('NO-FRAME'), DEADLINE_MS);

socket.on('message', (data) => {
  let frame;
  try {
    frame = JSON.parse(data.toString());
  } catch {
    return; // a frame that is not JSON cannot be the one under test
  }
  if (frame?.kind !== 'kanban_event' || frame.boardId !== boardId) return;
  const lanes = Array.isArray(frame.lanes) ? frame.lanes.length : 0;
  finish(`FRAME kind=${frame.event?.kind ?? 'unknown'} card=${frame.event?.cardId ?? 'null'} lanes=${lanes}`);
});

// An unreachable app, a refused token or a closed socket is a NO-FRAME with a reason on stderr —
// a fast failure rather than one the caller pays the whole deadline for.
socket.on('error', (error) => {
  console.error(`kanban-ws-probe: ${error.message}`);
  finish('NO-FRAME');
});

socket.on('close', () => finish('NO-FRAME'));
