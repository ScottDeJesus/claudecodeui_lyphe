// The warden's half of a diagnosis: the read-only hands center's diagnosis agent reaches this node with.
//
//   diag.open { diagId, check }                       center → warden   a diagnosis begins on this node
//   diag.opened { diagId }                            warden → center   heard, always
//   diag.call { diagId, callId, tool, args }          center → warden   one read: log.read, file.read or status.read
//   diag.result { diagId, callId, ok, text, truncated } warden → center the read's answer, masked
//   diag.close { diagId }                             center → warden   the diagnosis is over, however it ended
//
// READ-ONLY BY CONSTRUCTION. The tools are the three in `diag-reads.mjs` — a fixed menu of argv spawns and of reads
// of paths `diag-guard.mjs` allowed. Nothing here, or reachable from here, runs a string, writes a file or takes an
// argument it has not validated; there is no exec tool to misuse. The frames are center's and signed (the link has
// verified them), and a call still opens nothing unless its diagnosis is the one open on this node.
//
// ONE AT A TIME. A node has one open diagnosis. A second `diag.open` is answered `diag.opened` like any other, and every
// call under it is answered `ok: false`, "Another diagnosis is open on this node", so center's loop learns it on its
// first read. A call under no open diagnosis at all is refused as well.
//
// A DIAGNOSIS LIVES AS LONG AS ITS LINK. None of these frames rides the outbox: a link that drops mid-diagnosis fails
// it at center, which will never send `diag.close`, so the warden ends it on `link.down` — and kills the reads it was
// running. Otherwise one lost link would keep every later diagnosis, and the updater, waiting on a ghost.
//
// MASKING. Every text that leaves in a `diag.result` has passed `maskSecrets`, the refusals included, and is cut to 64 KB
// AFTER it, so what is sent never exceeds the cap.
import { capText, startArgv } from './diag-argv.mjs';
import { maskSecrets } from './diag-guard.mjs';
import { READ_TOOLS } from './diag-reads.mjs';
import { log } from './log.mjs';
import { homeDir } from './state.mjs';

/** How many diagnoses refused as "another is open" are remembered; a center that never closes them cannot grow this. */
const REFUSED_KEPT = 50;

const NOTHING_OPEN = 'No diagnosis is open on this node';
const ANOTHER_OPEN = 'Another diagnosis is open on this node';

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isName = (value) => typeof value === 'string' && value !== '';

/**
 * @param {{
 *   link: { on(type: string, handler: (body: object) => void): unknown, send(type: string, body: object, options?: { reliable?: boolean }): unknown },
 *   home?: string,
 * }} options `link` is the warden's link, or anything with `on` and `send` that also announces `link.down`;
 * `home` is the warden's own home, whose `keys/` no read may open (default: the home this process runs on).
 */
export function createDiagTools({ link, home = homeDir() }) {
  let open = null; // { diagId, check } — the one diagnosis this node has open
  const refused = new Set(); // diag ids opened while another was: their calls are refused
  const reading = new Set(); // { kill() } of every read in flight; they all belong to the open diagnosis
  const listeners = new Set(); // `onWorkChange` — told whenever the open diagnosis begins or ends
  let stopped = false;

  /** A frame to center. Never reliable, never throws: it is called from socket events and child exits. */
  function say(type, body) {
    try {
      link.send(type, body);
    } catch (error) {
      log(`could not send a "${type}" frame: ${error?.message ?? error}`);
    }
  }

  /** Masking can make a text longer (`token=1` → `token=<masked>`): the 64 KB cap is judged on what is sent, not on what was read. */
  function answer(diagId, callId, { ok, text, truncated = false }) {
    const sent = capText([Buffer.from(maskSecrets(text), 'utf8')]);
    say('diag.result', { diagId, callId, ok, text: sent.text, truncated: truncated || sent.truncated });
  }

  /** Ends the open diagnosis and every read it still has going. */
  function endOpen() {
    const wasOpen = open !== null;
    open = null;
    for (const read of reading) read.kill();
    reading.clear();
    if (wasOpen) announceChange();
  }

  /** A listener that throws is logged and the rest still hear: the end of a diagnosis is not undone by one listener's fault. */
  function announceChange() {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        log(`a diagnosis work listener failed: ${error?.message ?? error}`);
      }
    }
  }

  function onOpen(body) {
    if (stopped) return;
    if (!isName(body.diagId)) {
      log('ignoring a diag.open without a diagId');
      return;
    }
    if (open === null) {
      open = { diagId: body.diagId, check: typeof body.check === 'string' ? body.check : null };
      log(`diagnosis ${body.diagId} opened${open.check ? ` for ${open.check}` : ''}`);
      announceChange();
    } else if (open.diagId !== body.diagId) {
      refused.add(body.diagId);
      if (refused.size > REFUSED_KEPT) refused.delete(refused.values().next().value);
      log(`diagnosis ${body.diagId} refused: ${open.diagId} is open`);
    }
    say('diag.opened', { diagId: body.diagId });
  }

  function onClose(body) {
    if (open?.diagId === body.diagId) {
      log(`diagnosis ${open.diagId} closed`);
      endOpen();
    } else if (isName(body.diagId)) {
      refused.delete(body.diagId);
    }
  }

  /** A read as `run(binary, argv)`: the argv spawn, tracked so that ending the diagnosis kills it. */
  function run(binary, argv) {
    const started = startArgv(binary, argv);
    reading.add(started);
    return started.done.finally(() => reading.delete(started));
  }

  async function onCall(body) {
    if (stopped) return;
    const { diagId, callId, tool, args } = body;
    if (!isName(diagId) || !isName(callId)) {
      log('ignoring a diag.call without a diagId and a callId');
      return;
    }
    const refuse = (text) => answer(diagId, callId, { ok: false, text });
    if (open?.diagId !== diagId) {
      return refuse(refused.has(diagId) ? ANOTHER_OPEN : open === null ? NOTHING_OPEN : `Diagnosis ${diagId} is not open on this node`);
    }
    if (typeof tool !== 'string' || !Object.hasOwn(READ_TOOLS, tool)) return refuse(`Unknown tool ${JSON.stringify(tool)}`);
    if (!isRecord(args)) return refuse('A call carries its arguments as an object');
    const diagnosis = open; // this object, not its id: a diagnosis reopened under the same id is another one
    let result;
    try {
      result = await READ_TOOLS[tool](args, { run, wardenHome: home });
    } catch (error) {
      log(`diagnosis ${diagId}: ${tool} failed (${error?.code ?? error?.name ?? 'unknown'})`);
      result = { ok: false, text: `The read failed (${error?.code ?? error?.name ?? 'unknown'})`, truncated: false };
    }
    // The diagnosis ended while the read ran (center closed it, or the link went): nobody is waiting for the answer.
    if (open !== diagnosis) return;
    answer(diagId, callId, result);
  }

  link.on('diag.open', onOpen);
  link.on('diag.call', onCall);
  link.on('diag.close', onClose);
  link.on('link.down', () => {
    if (open !== null) log(`link lost; diagnosis ${open.diagId} ended with it`);
    endOpen();
    refused.clear();
  });

  return {
    /** The ids of the diagnoses open on this node: `hello.active.diags`, and what the updater waits on before it restarts the warden. */
    activeWork() {
      return { diags: open === null ? [] : [open.diagId] };
    },
    /** Registers a listener run whenever the open diagnosis begins or ends; answers its remover. The updater wakes on it instead of polling. */
    onWorkChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** The warden is stopping: the reads in flight are killed, and nothing more is said. */
    stop() {
      stopped = true;
      endOpen();
      refused.clear();
    },
  };
}
