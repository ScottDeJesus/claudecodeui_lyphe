// `run`: the daemon `cerberus-warden.service` keeps alive. It owns no behaviour of its own — it plugs
// the outbox, the link and the scheduler together, keeps `run.json` current, and ends on a signal.
//
//   COMPOSITION  the link asks the scheduler what to put in `hello` and every heartbeat (`state()`), and the
//                scheduler sends and receives through the link (`checks.set` in, `result` out). Every later plan's
//                frame joins the same way: a `link.on(type, fn)` registered here, before the link starts, and a
//                field in `state()` when center must be told of it in `hello`.
//   RUN.JSON     rewritten on the link's own events — after every heartbeat, whenever a socket closes (the link's
//                `onReport`), and when a `welcome` or a `checks.set` has been applied — so `status` never waits
//                for a timer: an outage shows its queue growing at each failed reconnect. Written at start and
//                at stop too. A write that fails is one log line, never the end of the daemon.
//   LOG          the link says its own changes (`linked to …`, `link lost — retrying in 1 s`); this file adds
//                one line at start and one at stop.
import { takeHomeLock } from './home-lock.mjs';
import { createLink } from './link.mjs';
import { log } from './log.mjs';
import { createOutbox } from './outbox.mjs';
import { createProbes } from './probes.mjs';
import { hasNodeKey, homeDir, homePaths, readIdentity, version, writeRun } from './state.mjs';

const NOT_ENROLLED = 'This node is not enrolled — run enroll.sh with a token from Cerberus';

/** After the link is closed, how long the process waits for the close handshake to carry the last batch out. */
const SHUTDOWN_GRACE_MS = 250;

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
  // `probes` exists once the link does; the link reads this only after `start()`, when both are built.
  const state = () => ({
    checksVersion: probes.checksVersion,
    catalogVersion: null,
    active: { runs: [], diags: [] },
    probesRunning: probes.scheduled, // the wire's word for "how many probes it has scheduled" (cerberus-types.ts)
  });
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
  const probes = createProbes({ link });
  // After `createProbes`: handlers of one frame run in registration order, so the scheduler has applied
  // the checks a `welcome` or a `checks.set` carries by the time the record is written.
  link.on('welcome', report);
  link.on('checks.set', report);

  log(`warden ${version} running as ${identity.node}, reporting to ${identity.center}`);
  report();
  link.start();

  return new Promise((resolve) => {
    let stopping = false;
    const stop = (signal) => {
      if (stopping) return;
      stopping = true;
      log(`${signal} received; stopping`);
      probes.stop(); // flushes the batch while the link is still up
      link.stop();
      report();
      setTimeout(() => resolve(0), SHUTDOWN_GRACE_MS);
    };
    process.on('SIGTERM', () => stop('SIGTERM'));
    process.on('SIGINT', () => stop('SIGINT'));
  });
}
