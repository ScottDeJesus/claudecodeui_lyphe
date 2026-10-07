// `run`: the daemon `cerberus-warden.service` keeps alive. It owns no behaviour of its own — it plugs
// the outbox, the link and the scheduler together, keeps `run.json` current, and ends on a signal.
//
//   CHAIN        `chain.mjs` keeps each check's `prevAt` across restarts (what center acked, saved on acks and at a
//                clean stop), so a restart does not blank the minutes before it for a quiet check.
//   COMPOSITION  the link asks the scheduler, the catalog, the runner and the updater what to put in `hello` and every
//                heartbeat (`state()`), and they send and receive through the link (`checks.set` and `catalog.set`
//                and `run.start` and `update.offer` in, `result` and `run.*` and `update.progress` out; the session
//                host's `session.*` frames both ways, and none of them through the outbox). Every later plan's
//                frame joins the same way: a `link.on(type, fn)` registered here, before the link starts, and a
//                field in `state()` when center must be told of it in `hello`.
//   RUN.JSON     rewritten on the link's own events — after every heartbeat, whenever a socket closes (the link's
//                `onReport`), and when a `welcome` or a `checks.set` has been applied — so `status` never waits
//                for a timer: an outage shows its queue growing at each failed reconnect. Written at start and
//                at stop too. A write that fails is one log line, never the end of the daemon.
//   UPDATE       an `update.offer` ends this process with 75 through the same clean stop a SIGTERM takes, so the launcher
//                (`launcher.mjs`) starts the release `update.mjs` swapped in; `main.mjs` exits with the code `run` resolves.
//   LOG          the link says its own changes (`linked to …`, `link lost — retrying in 1 s`); this file adds
//                one line at start and one at stop.
import { createCatalog } from './catalog.mjs';
import { createChain } from './chain.mjs';
import { createDiagTools } from './diag-tools.mjs';
import { takeHomeLock } from './home-lock.mjs';
import { createLink } from './link.mjs';
import { log } from './log.mjs';
import { createOutbox } from './outbox.mjs';
import { createProbes } from './probes.mjs';
import { createRunner } from './runner.mjs';
import { createSessions } from './sessions.mjs';
import { createUpdater } from './update.mjs';
import { hasNodeKey, homeDir, homePaths, readIdentity, version, writeRun } from './state.mjs';

const NOT_ENROLLED = 'This node is not enrolled — run enroll.sh with a token from Cerberus';

/** After the link is closed, how long the process waits for the close handshake to carry the last batch out. */
const SHUTDOWN_GRACE_MS = 250;

/**
 * The ids of the runs that are over but whose `run.*` frames still wait on the outbox for center's ack:
 * `hello.active.owed`. Center ends a live run that neither `active.runs` nor this names (its child and its
 * outbox are gone, or its `run.start` never arrived) and leaves one that is named here, because its frames
 * are resent after the `welcome` and end it themselves.
 */
function runsOwed(outbox, running) {
  const owed = new Set();
  for (const frame of outbox.pending(0)) {
    const runId = frame.body?.runId;
    if (frame.type.startsWith('run.') && typeof runId === 'string' && !running.includes(runId)) owed.add(runId);
  }
  return [...owed];
}

/** The sentence saying why this home cannot run, or null when its identity and key are all there. */
function homeProblem(identity, home) {
  const named = ['node', 'center', 'centerKey'].every((field) => typeof identity[field] === 'string' && identity[field] !== '');
  if (!named) return `The identity in ${homePaths(home).identityFile} is incomplete`;
  if (!hasNodeKey(home)) return `The node key ${homePaths(home).keyFile} is missing`;
  return null;
}

/** Runs the daemon until SIGTERM or SIGINT; answers the process's exit code (1 when the home cannot run). */
export async function runDaemon() {
  const home = homeDir();
  const identity = readIdentity(home);
  if (!identity) {
    console.log(NOT_ENROLLED);
    return 1;
  }
  const problem = homeProblem(identity, home);
  if (problem) {
    console.log(problem);
    return 1;
  }

  const lock = await takeHomeLock(home);
  if (lock === 'taken') {
    console.log(`A warden is already running on ${home} — \`node warden/src/main.mjs status\` shows what it reports`);
    return 1;
  }
  if (lock !== 'held') log(`could not take the one-daemon lock on this home (${lock}); going on without it`);

  const outbox = createOutbox({ home });
  let stopDaemon = () => {}; // replaced below, once the promise that holds the daemon open exists
  // `probes`, `catalog`, `runner`, `diagTools` and `updater` exist once the link does; the link reads this only after `start()`, when all are built.
  /** The work that must not be cut off by a restart: the fix runs in flight and the diagnosis open. `hello.active` says it, and the updater waits on it. */
  const activeWork = () => ({ ...runner.activeWork(), ...diagTools.activeWork() });
  const state = () => {
    const work = activeWork();
    return {
      checksVersion: probes.checksVersion,
      catalogVersion: catalog.version,
      active: { runs: work.runs, diags: work.diags, owed: runsOwed(outbox, work.runs) },
      probesRunning: probes.scheduled, // the wire's word for "how many probes it has scheduled" (cerberus-types.ts)
      update: updater.helloUpdate(),
    };
  };
  const report = () => {
    try {
      writeRun({
        at: Date.now(),
        linked: link.linked,
        ackedUpto: outbox.ackedUpto,
        outbox: outbox.size,
        overflowing: outbox.overflowing,
        probes: probes.scheduled,
        checksVersion: probes.checksVersion,
        version,
      }, home);
    } catch (error) {
      // A full disk is the node Cerberus most needs to hear from: the record is lost, the daemon is not.
      log(`could not write run.json: ${error.message}`);
    }
  };
  const link = createLink({ identity, home, outbox, state, onReport: report });
  const chain = createChain({ home, outbox });
  const probes = createProbes({ link, previousAt: chain.previousAt });
  const catalog = createCatalog({ link });
  const runner = createRunner({ link, catalog });
  const sessions = createSessions({ link, home });
  const diagTools = createDiagTools({ link, home });
  const updater = createUpdater({
    link,
    home,
    activeWork,
    onWorkChange: (listener) => {
      const removers = [runner.onWorkChange(listener), diagTools.onWorkChange(listener)];
      return () => removers.forEach((remove) => remove());
    },
    exit: (code) => stopDaemon('the update is swapped in', code),
  });
  link.on('ack', chain.noteAck);
  // After `createProbes`: handlers of one frame run in registration order, so the scheduler has applied
  // the checks a `welcome` or a `checks.set` carries by the time the record is written.
  link.on('welcome', report);
  link.on('checks.set', report);

  log(`warden ${version} running as ${identity.node}, reporting to ${identity.center}`);
  report();
  link.start();

  return new Promise((resolve) => {
    let stopping = false;
    stopDaemon = (reason, code = 0) => {
      if (stopping) return;
      stopping = true;
      log(`${reason}; stopping`);
      probes.stop(); // flushes the batch while the link is still up
      runner.stop(); // kills the commands it started: none outlives its warden
      diagTools.stop(); // kills the reads a diagnosis has going
      sessions.stop(); // detaches every session channel; the hosts, in their own cgroup, keep running
      link.stop();
      chain.save(); // what the outbox still holds is not acked, so the saved chain stops short of it
      report();
      setTimeout(() => resolve(code), SHUTDOWN_GRACE_MS);
    };
    process.on('SIGTERM', () => stopDaemon('SIGTERM received'));
    process.on('SIGINT', () => stopDaemon('SIGINT received'));
  });
}
