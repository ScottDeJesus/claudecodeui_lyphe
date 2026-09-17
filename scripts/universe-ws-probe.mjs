#!/usr/bin/env node
// Proves the estate's live lane reaches a real websocket client, end to end: open the app's `/ws`
// socket as a browser would, watch it for a window, and report what arrived.
//
//   node scripts/universe-ws-probe.mjs <app-url> <token>
//
// It prints exactly one line and exits — `frames=<n> rows=<n> edit=<yes|no> exec=<yes|no>` — so a
// caller can grep the result instead of reading a log, and `NO-FRAME` (with the reason on stderr, and
// a non-zero exit — the same "no evidence" answer `universe-ui-probe.mjs` gives as `NO-CANVAS`) when
// nothing arrived to report. Nothing is hard-coded: the url and the token arrive as arguments, and
// the token rides as the same `?token=` query parameter `src/shared/context/WebSocketContext.tsx`
// builds.
//
// WHY THE WHOLE WINDOW IS SPENT, where `kanban-ws-probe.mjs` hangs up the moment its one frame
// lands. The line here is a COUNT of what the estate said while a socket was open, so the window is
// the measurement rather than a deadline being waited out: a probe that left on its first row would
// report one second of traffic and call it the estate's.
//
// WHAT THE TALLIES PROVE, AND WHAT THEY CANNOT. A socket only listens, and a broadcast carries
// nothing that ties a row to a cause. So `frames`, `rows`, `edit` and `exec` say the lane is live and
// delivering — that history, edits and requests really reach a browser over `/ws` — and they can
// never say that any particular request produced any particular row. The estate talks on its own:
// measured over one quiet minute on this box, shadow-connector.service alone was worth 151 exec rows
// with nothing driving it, so `exec=yes` is not evidence that the requests you made arrived. Read it
// as "the exec lane carried traffic while we listened".
//
// A `universe_map` frame is NOT activity. It announces that a crawl landed, and it arrives on a
// completely silent estate; counting it would let this probe pass having observed no edit and no
// request at all.
import WebSocket from 'ws';

/** How long the socket is watched. The window IS the measurement — see the note above. */
const WINDOW_MS = 90_000;

const [appUrl, token] = process.argv.slice(2);

if (!appUrl || !token) {
  console.error('usage: node scripts/universe-ws-probe.mjs <app-url> <token>');
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
  console.error(`universe-ws-probe: ${error.message}`);
  console.log('NO-FRAME');
  process.exit(1);
}

/** What arrived while the socket was open: activity frames, the row entries inside them, and which
 *  kinds were among those entries. `rows` counts entries, never the `count` each one aggregates. */
let frames = 0;
let rows = 0;
let sawEdit = false;
let sawExec = false;

/** The one line, from the tallies as they stand. */
function tally() {
  return `frames=${frames} rows=${rows} edit=${sawEdit ? 'yes' : 'no'} exec=${sawExec ? 'yes' : 'no'}`;
}

/** Print the one line, hang up, and leave — non-zero when the line is `NO-FRAME`, so a caller reading
 *  the exit status learns the same thing as a caller grepping the line. Usage errors exit 2, and a
 *  measurement exits 0; nothing here exits 0 without evidence. */
function finish(line) {
  if (settled) return;
  settled = true;
  clearTimeout(deadline);
  console.log(line);
  socket.removeAllListeners();
  socket.close();
  process.exit(line === 'NO-FRAME' ? 1 : 0);
}

const deadline = setTimeout(() => {
  // An estate with nothing to say inside the window is the one case the tallies cannot report: a
  // line of zeroes would read as a measurement, and there is no measurement to make.
  if (frames === 0) {
    console.error(`universe-ws-probe: no universe_activity frame arrived in ${WINDOW_MS} ms`);
    finish('NO-FRAME');
    return;
  }
  finish(tally());
}, WINDOW_MS);

socket.on('message', (data) => {
  let frame;
  try {
    frame = JSON.parse(data.toString());
  } catch {
    return; // a frame that is not JSON is not the lane's
  }
  // The map lane and every other kind the server broadcasts are dropped here, by name: this probe's
  // subject is the activity lane, and a chat or session frame says nothing about it.
  if (frame?.kind !== 'universe_activity') return;

  frames += 1;
  for (const row of Array.isArray(frame.rows) ? frame.rows : []) {
    rows += 1;
    if (row?.kind === 'edit') sawEdit = true;
    else if (row?.kind === 'exec') sawExec = true;
  }
});

// An unreachable app, a refused token or a closed socket is a NO-FRAME with a reason on stderr —
// a fast failure rather than one the caller pays the whole window for.
socket.on('error', (error) => {
  console.error(`universe-ws-probe: ${error.message}`);
  finish('NO-FRAME');
});

socket.on('close', () => {
  // A socket that closed having delivered nothing is the same news as one that never opened. One
  // that closed AFTER delivering has already produced the measurement this probe exists to take,
  // and answering NO-FRAME then would contradict the tallies in hand.
  if (frames === 0) console.error('universe-ws-probe: the socket closed before any activity frame arrived');
  finish(frames === 0 ? 'NO-FRAME' : tally());
});
