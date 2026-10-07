// The runner: the warden runs what center asks for ONLY when it is what the warden itself acked.
//
// `run.start` (`CerberusRunStartBody`, `server/shared/cerberus-types.ts`) is signed by center (the link
// has already verified that) and carries the catalog version, the entry's or proposal's id and the exact
// command. Three things must hold, checked in this order against the catalog `catalog.mjs` holds, and the
// first to fail is the run's whole outcome — `run.refused { runId, reason }`, drawn red, nothing started:
//
//   VERSION  it is the version this warden acked: a catalog center has since replaced, or one the warden
//            never received (nothing acked yet, whatever the frame names), is not a catalog it can vouch for.
//   ID       the id is in that version, and — for a one-off — has not expired.
//   COMMAND  the command is that id's command, byte for byte. The warden never runs a string it was not
//            given in a catalog; a `run.start` carrying a different one is refused, whoever signed it.
//
// Then `run.accepted { runId, startedAt }`, `/bin/sh -c <cmd>` as this account from its home directory
// (as an `exec` probe is run), `run.output` batches (`run-lines.mjs`) and `run.end { runId, result, exit,
// endedAt }`. Every run frame goes through the outbox, so a link that drops mid-run loses none of them:
// they are resent after the reconnect, in order.
//
//   ONCE     a run id starts one child, ever: a `run.start` for an id that is running, or that ended in this
//            process (the last `SETTLED_KEPT` are remembered), is logged and ignored. A signed frame carries
//            no freshness, and a fix that restarts a service or runs a backup must not run twice for one ask.
//   TIMEOUT  past the catalog's `timeout` (or `run.start`'s, when that is shorter) the child's whole process
//            group gets SIGTERM, and SIGKILL 5 s later; the run ends `timed_out` however the command went.
//            The group is signalled so a pipeline's every stage goes, and once more with SIGKILL as a
//            timed-out run is settled, so nothing that ignored the SIGTERM is left behind. The deadline
//            is for the shell: once it has exited, only the 1 s the pipes get to drain remains, and a
//            command that finished in time is never called `timed_out` for a child still holding its pipes.
//   END      `ok` is exit 0, `failed` anything else, `exit` null for a command a signal ended. The run ends
//            when the shell has exited and its pipes have drained, or one second after the shell exits —
//            a command that left a daemon holding its stdout must not keep the run open for ever.
//   STOP     `stop()` kills every child and sends nothing more: the daemon is ending, and center reconciles
//            the runs it still counts active with the `hello.active.runs` of the next link.
import { spawn } from 'node:child_process';
import os from 'node:os';

import { log } from './log.mjs';
import { MAX_TIMER_MS } from './probe-support.mjs';
import { createRunLines } from './run-lines.mjs';

const KILL_AFTER_TERM_MS = 5000;
const PIPE_DRAIN_MS = 1000;
/** How many ended run ids are remembered so a repeated `run.start` cannot start a second child. */
const SETTLED_KEPT = 500;

/** `18:54` — the local time of day a sentence for a person names. */
function clockTime(milliseconds) {
  const date = new Date(milliseconds);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Signals the process group `child` leads. The pid is checked before it is negated: a group signal to a bad number reaches processes this warden never started. */
function signalGroup(child, signal) {
  const pid = child?.pid;
  if (!Number.isInteger(pid) || pid <= 1) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') log(`could not send ${signal} to run process ${pid}: ${error.code ?? error.message}`);
  }
}

/**
 * @param {{
 *   link: { on(type: string, handler: (body: object) => void): unknown, send(type: string, body: object, options?: { reliable?: boolean }): unknown },
 *   catalog: ReturnType<import('./catalog.mjs').createCatalog>,
 *   home?: string,
 * }} options `home` is the directory a command starts in: the account's own home directory unless told otherwise.
 */
export function createRunner({ link, catalog, home = os.homedir() }) {
  const active = new Map(); // run id → { child, lines, timers, ended }
  const settled = new Set(); // the last SETTLED_KEPT ids that ended, oldest first
  let stopped = false;

  /** A run frame, reliable. A frame the outbox could not number (a full disk) is one log line: the run goes on. */
  function say(type, body) {
    try {
      link.send(type, body, { reliable: true });
    } catch (error) {
      log(`could not queue a "${type}" frame: ${error?.code ?? error?.name ?? 'unknown'}`);
    }
  }

  /** `{ held }` — the catalog's entry — when all three things hold, else `{ reason }`, the sentence for the first that does not. */
  function verify(body) {
    const acked = catalog.version;
    if (acked === null || body.catalogVersion !== acked) {
      return { reason: `Catalog version ${body.catalogVersion} is not the one this warden acked (${acked ?? 'none'})` };
    }
    const id = body.entryId ?? body.proposalId;
    if (body.entryId != null && body.proposalId != null) return { reason: 'The run names both an entry and a proposal' };
    if (typeof id !== 'string') return { reason: 'The run names no entry or proposal' };
    const held = catalog.find(id);
    if (!held) return { reason: `No entry '${id}' in catalog v${acked}` };
    if (held.expiredAt !== undefined) return { reason: `The one-off '${id}' expired at ${clockTime(held.expiredAt)}` };
    if (body.cmd !== held.cmd) return { reason: `The command is not catalog v${acked}'s command for '${id}'` };
    return { held };
  }

  function launch(runId, held, requestedTimeout) {
    say('run.accepted', { runId, startedAt: Date.now() });
    const lines = createRunLines({ emit: (batch) => say('run.output', { runId, lines: batch }) });
    const run = { child: null, lines, timers: [], ended: false };
    active.set(runId, run);

    const seconds = Number.isInteger(requestedTimeout) && requestedTimeout >= 1 ? Math.min(held.timeout, requestedTimeout) : held.timeout;
    let timedOut = false;

    function settle(code, signal) {
      if (run.ended) return;
      run.ended = true;
      for (const timer of run.timers) clearTimeout(timer);
      if (timedOut) signalGroup(run.child, 'SIGKILL');
      lines.finish();
      active.delete(runId);
      settled.add(runId);
      if (settled.size > SETTLED_KEPT) settled.delete(settled.values().next().value);
      const result = timedOut ? 'timed_out' : code === 0 ? 'ok' : 'failed';
      say('run.end', { runId, result, exit: signal ? null : (code ?? null), endedAt: Date.now() });
    }

    let child;
    try {
      // The child leads its own process group (`detached`), so one signal reaches a pipeline's every stage.
      child = spawn('/bin/sh', ['-c', held.cmd], { cwd: home, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      // spawn throws, rather than emitting 'error', for an argument it refuses (a NUL byte in the command).
      lines.take('err', `Could not start the command (${error.code ?? error.name})\n`);
      settle(null, null);
      return;
    }
    run.child = child;

    const deadline = setTimeout(() => {
      timedOut = true;
      signalGroup(child, 'SIGTERM');
      run.timers.push(setTimeout(() => signalGroup(child, 'SIGKILL'), KILL_AFTER_TERM_MS));
    }, Math.min(seconds * 1000, MAX_TIMER_MS));
    run.timers.push(deadline);

    for (const [stream, pipe] of [['out', child.stdout], ['err', child.stderr]]) {
      pipe.setEncoding('utf8');
      pipe.on('data', (chunk) => lines.take(stream, chunk));
      pipe.on('error', () => {}); // a pipe that fails is the run's end below, through 'close'
    }
    child.on('error', (error) => {
      lines.take('err', `Could not start the command (${error.code ?? error.name})\n`);
      settle(null, null);
    });
    // 'close' is the shell gone AND its pipes drained; 'exit' alone is the shell gone, with a grace for the pipes.
    child.on('exit', (code, signal) => {
      clearTimeout(deadline); // the shell finished: a deadline landing in the pipes' grace second would blame it for a child it left behind
      run.timers.push(setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        settle(code, signal);
      }, PIPE_DRAIN_MS));
    });
    child.on('close', (code, signal) => settle(code, signal));
  }

  function start(body) {
    if (stopped) return;
    const runId = body.runId;
    if (typeof runId !== 'string' || runId === '') {
      log('ignoring a run.start without a runId');
      return;
    }
    if (active.has(runId) || settled.has(runId)) {
      log(`ignoring a second run.start for run ${runId}, which ${active.has(runId) ? 'is still going' : 'already ran'}`);
      return;
    }
    const { held, reason } = verify(body);
    if (reason) {
      log(`refused run ${runId}: ${reason}`);
      say('run.refused', { runId, reason });
      return;
    }
    launch(runId, held, body.timeout);
  }

  link.on('run.start', start);

  return {
    /** The ids of the runs in flight: `hello.active.runs`, and what the updates plan waits on before it restarts the warden. */
    activeWork() {
      return { runs: [...active.keys()] };
    },
    /** The warden is stopping: every child is killed, and nothing more is said about them. */
    stop() {
      stopped = true;
      for (const run of active.values()) {
        run.ended = true;
        for (const timer of run.timers) clearTimeout(timer);
        run.lines.abandon();
        signalGroup(run.child, 'SIGKILL');
      }
      active.clear();
    },
  };
}
