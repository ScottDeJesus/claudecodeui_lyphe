// `status`: what this home is — who it enrolled as, with whom, which build runs, and the last thing
// the daemon wrote about itself. It reads files and speaks to no one, so it is safe to run while
// the daemon runs, and it answers the same question whether or not center is reachable.
import { fingerprint, homeDir, readIdentity, readRun, version } from './state.mjs';

/** A linked daemon heartbeats every 15 s; a record this much older than that says it has stopped. */
const SILENT_AFTER_MS = 45_000;

function printLine(label, value) {
  console.log(`${`${label}:`.padEnd(13)}${value}`);
}

function agoWords(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 120) return `${seconds} s ago`;
  return seconds < 7200 ? `${Math.round(seconds / 60)} min ago` : `${Math.round(seconds / 3600)} h ago`;
}

/** A field of a `run.json` another build or a hand wrote may lack: say so, never print `undefined`. */
function recorded(value) {
  return value ?? 'not recorded';
}

/** The fields of `run.json` as the design names them: linked, ackedUpto, the outbox's length, the probes scheduled. */
function printRun({ run, writtenAt }) {
  const at = Number.isSafeInteger(run.at) ? run.at : writtenAt;
  const age = Date.now() - at;
  printLine('run', `written ${new Date(at).toISOString()} (${agoWords(age)})`);
  printLine('  linked', recorded(run.linked));
  // The link is up, so a heartbeat is due every 15 s: a record this old is the daemon's last word, not its state.
  if (run.linked === true && age > SILENT_AFTER_MS) printLine('  note', 'no heartbeat since — the daemon is not running');
  printLine('  ackedUpto', recorded(run.ackedUpto));
  const overflow = run.overflowing ? ' — overflowing, keeping only the latest result per check' : '';
  printLine('  outbox', run.outbox === undefined ? 'not recorded' : `${run.outbox} queued${overflow}`);
  const checks = run.checksVersion === null || run.checksVersion === undefined ? 'no checks yet' : `checks version ${run.checksVersion}`;
  printLine('  probes', run.probes === undefined ? 'not recorded' : `${run.probes} scheduled (${checks})`);
  if (typeof run.version === 'string' && run.version !== version) printLine('  daemon', `${run.version} (this build is ${version})`);
}

/** Prints the identity, the version and the newest `run.json`; answers the process's exit code (1 when the home is not enrolled). */
export function runStatus() {
  const home = homeDir();
  const identity = readIdentity(home);
  printLine('version', version);
  printLine('home', home);
  if (!identity) {
    printLine('node', 'not enrolled — run: node warden/src/main.mjs enroll --center <url> --name <name> --token <token>');
    return 1;
  }
  printLine('node', identity.node);
  printLine('center', identity.center);
  printLine('enrolled', new Date(identity.enrolledAt).toISOString());
  printLine('fingerprint', fingerprint(home));

  const record = readRun(home);
  if (record) printRun(record);
  else printLine('run', 'no run.json yet — the daemon has not reported');
  return 0;
}
