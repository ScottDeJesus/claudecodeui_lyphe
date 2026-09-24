import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { expandHome } from '@/shared/utils.js';

const execFileAsync = promisify(execFile);

/**
 * The dispatcher's own front door (`~/.claude/scripts/dispatcher`), as the plan-runner lanes resolve
 * theirs. `DISPATCHER_BIN` moves it for a probe; the default is where the house installs it.
 */
const DEFAULT_BIN = '~/.claude/scripts/dispatcher';

/**
 * How long a kick may take before it is given up on. `kick` is a datagram to a live daemon, or a
 * `systemd-run` for one that is not there yet — both answer in well under a second, so this is a
 * bound on a door that is stuck, never a wait anybody is meant to sit through.
 */
const KICK_TIMEOUT_MS = 10_000;

/**
 * The lines already said, so a fault that repeats does not bury the journal it repeats into. The
 * volume a flip can produce is bounded by hand — one kick per press — but a wedged `kick` (no user
 * bus, a missing script) would say the same sentence on every press from now on, and `console.error`
 * is the only door this server has.
 */
const said = new Set<string>();

/** Say one line, once per distinct line, for the life of this process. */
function logOnce(message: string): void {
  if (said.has(message)) return;
  said.add(message);
  console.error(message);
}

/** One line out of a child's stream, or an empty string when it said nothing. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Hand a switch flip to the dispatcher. THE FLIP IS THE EVENT; this is the one line that makes it
 * the dispatcher's business the moment it lands rather than at the next session event.
 *
 * A kick wakes the daemon that is already running, or starts one where the store holds work, and its
 * own answer is the record that the flip got there: `woke daemon`, `started daemon unit=…`,
 * `no work`, or `no daemon` when this host has no user manager to hold one.
 *
 * NOTHING HERE RAISES AND NOTHING HERE AWAITS A VERDICT. The toggles that call it must answer with
 * the position on disk whatever the dispatcher is doing — a switch that failed because a daemon was
 * busy would be a switch that lies about a file it had already written — so every failure, including
 * a script that is not there and a kick that hung past its bound, is swallowed and said once.
 * Callers write `void kickDispatcher()`: the HTTP answer is the flip's, not the kick's.
 *
 * The child inherits this server's environment, which is what puts it in the same home the
 * dispatcher's own readers resolve. Whatever it starts is sealed on the far side: the daemon runs
 * with exactly four names of its own (`wake._env`), so nothing of this process's reaches a walker.
 */
export async function kickDispatcher(): Promise<void> {
  const bin = expandHome(process.env.DISPATCHER_BIN || DEFAULT_BIN);
  try {
    const { stdout } = await execFileAsync(bin, ['kick'], { timeout: KICK_TIMEOUT_MS });
    // The answer is said on every kick rather than deduped with the failures below: it is one line
    // per press, and it is the trace that a flip reached the dispatcher at all.
    console.error(`dispatcher kick: ${text(stdout) || 'no answer'}`);
  } catch (error) {
    const failure = error as { stderr?: unknown; message?: unknown };
    const saidBy = text(failure.stderr);
    logOnce(`dispatcher kick failed: ${saidBy || text(failure.message) || 'the dispatcher did not answer'}`);
  }
}
