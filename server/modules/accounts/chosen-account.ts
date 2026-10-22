import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expandHome } from '@/shared/utils.js';

/**
 * The account the house chose, read from the store's own non-secret record.
 *
 * `chosen.json` is written only by the house — the operator's click or the rule that switches when an
 * account fills (`claude-account use`, `auto.settle`). A chat's next message reads it to learn whether
 * the account it would launch on changed under the running process; the process itself was started on
 * the door's answer, which is `current()`'s answer at that moment.
 *
 * READ ON EVERY CALL, and never cached: a switch is the operator's click or a rule's pass, and a
 * cached record would leave an open conversation on the old account until the API restarted. The
 * file is two short fields; this is not a poll and is never called on a timer.
 *
 * THE HOME IS THE PYTHON STORE'S, BOTH STEPS OF IT (`record.home()`): `$PLAN_RUNNER_CLAUDE_ACCOUNT_HOME`
 * when set (a probe's scratch store), else `<state_root>/claude_account` — and `state_root()` is the
 * PARENT of a set `$DISPATCHER_HOME` (`plan_runner/state.py`) — and only else the live
 * `~/.claude/state/claude_account`. A stack that moved the door's store must never read the operator's
 * own choice beside it.
 *
 * ABSENT, UNREADABLE, HALF-WRITTEN, OR NOT THE TWO FIELDS reads `null` and never raises: the chat then
 * launches on whatever the door said, and no process is ever replaced on a guess. The digest is the
 * store's 8-hex account id; anything else is not an account this house chose.
 */

/** One account as `chosen.json` names it: the digest in data, the slug in every sentence a person reads. */
export type ChosenAccount = { digest: string; slug: string };

/** The store's home: the probe seam made absolute, else the state root the Python store derives. */
function storeHome(): string {
  const explicit = (process.env.PLAN_RUNNER_CLAUDE_ACCOUNT_HOME || '').trim();
  if (explicit) return path.resolve(expandHome(explicit));
  // `state_root()` (`plan_runner/state.py`) is the PARENT of a set `$DISPATCHER_HOME`, and the live
  // state directory otherwise. `path.resolve` mirrors its `abspath`, which does not expand `~`.
  const dispatcher = (process.env.DISPATCHER_HOME || '').trim();
  const root = dispatcher
    ? path.dirname(path.resolve(dispatcher))
    : path.join(os.homedir(), '.claude', 'state');
  return path.join(root, 'claude_account');
}

/** The account the house chose, or `null` when no readable record names one. */
export function chosenAccount(): ChosenAccount | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(storeHome(), 'chosen.json'), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as { digest?: unknown; slug?: unknown };
    if (typeof record.digest !== 'string' || !/^[0-9a-f]{8}$/.test(record.digest)) return null;
    if (typeof record.slug !== 'string' || record.slug === '') return null;
    return { digest: record.digest, slug: record.slug };
  } catch {
    return null;
  }
}
