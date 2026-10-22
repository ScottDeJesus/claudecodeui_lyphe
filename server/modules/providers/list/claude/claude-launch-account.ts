import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { launchCredential } from '@/modules/accounts/index.js';
import { expandHome } from '@/shared/utils.js';

/**
 * Which account a Claude CLI start rides, the environment that carries its token, and the launch
 * record that says what each chat process was started on.
 *
 * THE TOKEN RIDES AN ENVIRONMENT VALUE, and only for the one process it was read for: the SDK is
 * handed `{ CLAUDE_CODE_OAUTH_TOKEN: <token> }` merged over `userFacingEnv()` at the CLI's spawn. A
 * chat host holds that environment in memory only (`session-host/host-frames.ts`: it never reaches
 * the meta or the journal), and the CLI withholds an environment token from every child it starts.
 * The value is never logged, never returned to a route and never written anywhere by this module.
 *
 * A JOIN NEVER ASKS THE DOOR. Only a spawn reads a credential: a message that joins a running process
 * keeps the environment that process was started with. Whether the account CHANGED is a comparison of
 * two records — the process's launch profile and the house's chosen account (`chosen-account.ts`) —
 * and lives in `accountRespawn` below.
 *
 * THE LAUNCH RECORD is `~/.cloudcli/claude-launches.jsonl`, one line per chat CLI start:
 * `{at, session, account, slug, why}` with `at` epoch SECONDS (the house's JSONL convention) and
 * `why` `"new"` or `"respawn: <reason>"`. The file is evidence, never authority: every failure to
 * write it is swallowed, because a launch that works must never fail on its record. Lines older than
 * 30 days are pruned on the first append of each day (the day read from the newest line's `at`), the
 * same rule `store.log_switch` keeps for `switches.jsonl`. `$CLAUDE_LAUNCHES_PATH` moves the file for
 * a probe.
 */

/** The launch environment and the account it came from. `env` is `{}` when the door answered no token. */
export type LaunchAccountEnv = {
  env: Record<string, string>;
  account: string | null;
  slug: string | null;
};

/** What a profile carries about its account; the two fields `accountRespawn` compares. */
export type LaunchAccountStamp = {
  account: string | null;
  accountSlug: string | null;
};

/** One chat CLI start, as the launch record keeps it. */
export type LaunchRecord = {
  session: string | null;
  account: string | null;
  slug: string | null;
  why: string;
};

const LAUNCHES_ENV = 'CLAUDE_LAUNCHES_PATH';
const DEFAULT_LAUNCHES = '~/.cloudcli/claude-launches.jsonl';
const RETAIN_SECONDS = 30 * 24 * 60 * 60;

/** The environment variable the CLI reads a setup-token from (`claude_account.route.CREDENTIAL_ENV`). */
const TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN';

/** The launch record's absolute path, this call: the probe seam when set, else the installed path. */
function launchesPath(): string {
  const explicit = (process.env[LAUNCHES_ENV] || '').trim();
  return explicit ? path.resolve(expandHome(explicit)) : expandHome(DEFAULT_LAUNCHES);
}

/**
 * The account in use and the environment a CLI start rides.
 *
 * The door answers the chosen account and, when it holds one, its sign-in token. With no token the
 * environment is `{}`, so the process rides the live login exactly as it did before the store
 * existed. Every failure answers the same shape in `{}`: a door that is missing, stuck or refused
 * never blocks a chat.
 */
export async function launchAccountEnv(): Promise<LaunchAccountEnv> {
  try {
    const credential = await launchCredential();
    return {
      env: credential.token ? { [TOKEN_ENV]: credential.token } : {},
      account: credential.account,
      slug: credential.slug,
    };
  } catch {
    return { env: {}, account: null, slug: null };
  }
}

/**
 * The reason a running process must be replaced for its account, or `null` when it may keep it.
 *
 * `undefined` on either side is "not heard" — a process the door gave no answer, a re-adopted host
 * whose meta holds no account — and never a replacement. A known pair that differs names both
 * accounts by SLUG, because the words reach a server log and an operator reads them (INV-76).
 */
export function accountRespawn(live: LaunchAccountStamp, next: LaunchAccountStamp): string | null {
  if (typeof live.account !== 'string' || typeof next.account !== 'string') return null;
  if (live.account === next.account) return null;
  const from = live.accountSlug || live.account;
  const to = next.accountSlug || next.account;
  return `account ${from} → ${to}`;
}

/** A line's `at` in epoch seconds, or null when the line is not one this module wrote. */
function atOf(line: string): number | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const at = (parsed as { at?: unknown }).at;
    return typeof at === 'number' && Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/** The UTC day a stamp falls on, the unit "the first append of each day" is measured in. */
function dayOf(at: number): string {
  return new Date(at * 1000).toISOString().slice(0, 10);
}

/** Write the whole record file (0600) through a temp file and a rename, so a reader never sees half. */
function rewrite(file: string, lines: string[]): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const scratch = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(scratch, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(scratch, file);
  } catch (error) {
    try {
      fs.rmSync(scratch, { force: true });
    } catch {
      // The temp file is already gone; the original error is the one to report.
    }
    throw error;
  }
}

/**
 * Append one chat CLI start to the launch record.
 *
 * Never throws and never delays a launch beyond one small write: a record that cannot be written is
 * a fact nobody's turn waits on. The prune reads the file only to decide whether this is the first
 * append of a new day; on every other day the line is a plain append.
 */
export function recordLaunch(entry: LaunchRecord): void {
  const at = Math.floor(Date.now() / 1000);
  const line = JSON.stringify({
    at,
    session: entry.session,
    account: entry.account,
    slug: entry.slug,
    why: entry.why,
  });
  const file = launchesPath();
  try {
    let lines: string[] = [];
    let readable = true;
    try {
      lines = fs.readFileSync(file, 'utf8').split('\n').filter((row) => row.trim() !== '');
    } catch (error) {
      // Absent is not unreadable: a fresh file gets its first line. Anything else is left as it is.
      readable = (error as NodeJS.ErrnoException).code === 'ENOENT';
    }
    if (!readable) {
      fs.appendFileSync(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
      return;
    }
    const newest = lines.length > 0 ? atOf(lines[lines.length - 1]) : null;
    if (newest === null || dayOf(newest) !== dayOf(at)) {
      const cutoff = at - RETAIN_SECONDS;
      lines = lines.filter((row) => {
        const stamp = atOf(row);
        return stamp !== null && stamp >= cutoff;
      });
      rewrite(file, [...lines, line]);
      return;
    }
    fs.appendFileSync(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // The launch record is evidence, never a gate: a failed write changes nothing about the turn.
  }
}
