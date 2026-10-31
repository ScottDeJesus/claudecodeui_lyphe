import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import { claudeConfigDir, readObjectRecord } from '@/shared/utils.js';

/**
 * Renewing the saved login's pass: the one thing that keeps `~/.claude/.credentials.json` alive on a
 * box where no chat rides it.
 *
 * WHY IT IS NEEDED. The login in that file hands out an access token that lasts hours, and the CLI
 * fetches a new one from the refresh token only when it RUNS on that login. Chats, souls and the
 * companion here all ride saved long-lived tokens (`CLAUDE_CODE_OAUTH_TOKEN`), so nothing else
 * starts the CLI on the file, and the usage meter — which reads with the file's pass — finds it dead.
 *
 * HOW. `claude auth status` is the cheapest start of that CLI: it renews an expired pass from the
 * refresh token and rewrites the file ITSELF. This module never writes the credentials file, never
 * reads a token out of it (only `expiresAt`, a clock) and makes no OAuth call of its own; it starts
 * the binary a chat starts and then looks at the file's clock.
 *
 * THE ENVIRONMENT IS STRIPPED OF EVERY CREDENTIAL. With a token in the CLI's environment it reports
 * THAT token and renews nothing, so the copy handed to the child has no `CLAUDE_CODE_OAUTH_TOKEN`,
 * `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`. `CLAUDE_CONFIG_DIR` goes through as the server's
 * `claudeConfigDir()` reads it — set when the server's own environment sets it, absent otherwise —
 * because merely naming the default directory changes where the CLI keeps `.claude.json`.
 *
 * ONE ATTEMPT AT A TIME, AND NOT AGAIN SOON. Callers share one in-flight promise. An attempt that
 * leaves no live pass, or a live pass that did not move, arms a ten-minute wait, so a login that cannot
 * be renewed does not spawn a CLI on every poll of the meter — and a token endpoint that answered
 * with a limit is not asked again at once. A live pass that did not move (the usage endpoint refused a
 * pass the clock still trusts) holds only until that pass's own expiry, when the CLI has something to
 * renew. A login the CLI cleared (`accessToken: ""`) is the dead refresh token's mark: the meter reads
 * it without asking this verb.
 *
 * `detail` is built here from facts (an exit code, a clock, the first line of stderr with token
 * shapes blanked), never from the CLI's stdout: its JSON status names the account and has nothing
 * a reader needs.
 */

const RENEWAL_TIMEOUT_MS = 30_000;
const RETRY_AFTER_NO_RENEWAL_MS = 10 * 60_000;
/** The CLI's status JSON is ~400 bytes; past this the rest is dropped, not held. */
const MAX_CAPTURED_BYTES = 16 * 1024;
const CREDENTIAL_ENV_NAMES = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

/**
 * What one call to `renewSavedLogin` answers.
 *
 * `renewed` is "the saved pass is live now" — the file's `expiresAt` is ahead of the clock — which is
 * also true when the pass never needed renewing, and is the file's clock on a cooldown answer too.
 * `expiresAt` is that stamp in epoch milliseconds, `null` when the file cannot be read. `attempted` is
 * false when the answer is the cooldown's and no CLI was started, so a caller logs one line per
 * attempt rather than one per poll.
 */
type LoginRenewal = { renewed: boolean; expiresAt: number | null; attempted: boolean; detail: string };

type CliRun =
  | { kind: 'unstarted'; code: string }
  | { kind: 'timeout' }
  | { kind: 'exited'; code: number | null; stdout: string; stderr: string };

let inFlight: Promise<LoginRenewal> | null = null;
/** The instant before which no new attempt is made; 0 before the first failed one. */
let holdUntil = 0;

/**
 * The pass's `expiresAt` (epoch ms) from the saved login file, or `null`, and whether the CLI cleared
 * the login (`accessToken: ""`). Reads the clock and one boolean, never the token.
 */
async function readSavedPass(): Promise<{ expiresAt: number | null; cleared: boolean }> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(claudeConfigDir(), '.credentials.json'), 'utf8'));
    const oauth = readObjectRecord(readObjectRecord(parsed)?.claudeAiOauth);
    const expiresAt = oauth?.expiresAt;
    return {
      expiresAt: typeof expiresAt === 'number' && Number.isFinite(expiresAt) ? Math.trunc(expiresAt) : null,
      cleared: oauth?.accessToken === '',
    };
  } catch {
    return { expiresAt: null, cleared: false }; // absent, unreadable or not JSON — all one fact here
  }
}

/** A copy of the server's environment fit for the CLI to sign in from the file. */
function loginRenewalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of CREDENTIAL_ENV_NAMES) delete env[name];
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (configured) env.CLAUDE_CONFIG_DIR = configured;
  else delete env.CLAUDE_CONFIG_DIR;
  return env;
}

/** Starts `claude auth status` and waits for it. Total: every failure is a `CliRun`. */
function runAuthStatus(): Promise<CliRun> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      const executable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH) ?? 'claude';
      // A fixed cwd, so a project's own `.claude/settings.json` cannot add an environment of its own.
      child = spawn(executable, ['auth', 'status'], {
        env: loginRenewalEnv(),
        cwd: os.homedir(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ kind: 'unstarted', code: errorCode(error) });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (run: CliRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(run);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle({ kind: 'timeout' });
    }, RENEWAL_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_CAPTURED_BYTES) stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_CAPTURED_BYTES) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => settle({ kind: 'unstarted', code: errorCode(error) }));
    child.on('close', (code) => settle({ kind: 'exited', code, stdout, stderr }));
  });
}

/** An error's `code` (`ENOENT`, `EACCES`) and never its message, which may carry a path or an argument. */
function errorCode(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && code ? code : 'UNKNOWN';
}

/** The first non-empty line of stderr with anything shaped like a token blanked, capped at 160 chars. */
function firstLineOf(stderr: string): string {
  const line = stderr.split('\n').map((row) => row.trim()).find((row) => row !== '') ?? '';
  return line.replace(/sk-ant-[\w-]+|[A-Za-z0-9_.-]{40,}/g, '<redacted>').slice(0, 160);
}

/** Whether the CLI's stdout status JSON says it holds no login at all. */
function reportsNoLogin(stdout: string): boolean {
  try {
    return readObjectRecord(JSON.parse(stdout))?.loggedIn === false;
  } catch {
    return false;
  }
}

/** The one line that says what the attempt did, for a caller's log. */
function describeAttempt(
  run: CliRun,
  before: number | null,
  after: { expiresAt: number | null; cleared: boolean },
  now: number,
): string {
  if (run.kind === 'unstarted') return `claude could not be started (${run.code})`;
  if (run.kind === 'timeout') return `claude auth status gave no answer within ${RENEWAL_TIMEOUT_MS / 1000} s`;
  if (after.expiresAt !== null && after.expiresAt > now) {
    return after.expiresAt === before ? 'the pass was still valid; nothing was rewritten' : 'the pass was renewed';
  }
  if (after.cleared) return 'the refresh token was refused and claude cleared the saved login';
  const stderrLine = firstLineOf(run.stderr);
  const outcome = `claude auth status exited ${run.code ?? 'by signal'}`;
  const state = after.expiresAt === null ? 'the saved login file has no readable expiry' : 'the pass is still expired';
  if (reportsNoLogin(run.stdout)) return `${outcome}; claude reports no login`;
  return stderrLine ? `${outcome}: ${stderrLine}; ${state}` : `${outcome}; ${state}`;
}

async function attemptRenewal(): Promise<LoginRenewal> {
  const { expiresAt: before } = await readSavedPass();
  const run = await runAuthStatus();
  const after = await readSavedPass();
  const now = Date.now();
  const passEndsAt = after.expiresAt;
  const renewed = passEndsAt !== null && passEndsAt > now;
  // ⚠ ANY attempt that did not leave a NEWER live pass is a spent attempt: asking the CLI again in
  // thirty seconds would find the same file. A live pass that did not move — the usage endpoint
  // refused a pass the clock still trusts — is spent only until that pass expires, because from then
  // on the CLI has something to renew.
  if (!renewed) holdUntil = now + RETRY_AFTER_NO_RENEWAL_MS;
  else if (passEndsAt === before) holdUntil = Math.min(now + RETRY_AFTER_NO_RENEWAL_MS, passEndsAt);
  return { renewed, expiresAt: passEndsAt, attempted: true, detail: describeAttempt(run, before, after, now) };
}

/**
 * Renews the saved login's pass by running `claude auth status` on it, and answers whether the pass
 * is live afterwards. Never rejects and never writes the credentials file; see the module comment.
 *
 * Consumer: the accounts module's usage meter (`usage.service.ts`), which calls it when the pass in
 * the file has expired, and once more when the usage endpoint refuses a pass the clock still trusts.
 */
export function renewSavedLogin(): Promise<LoginRenewal> {
  if (inFlight) return inFlight;
  const heldMs = holdUntil - Date.now();
  if (heldMs > 0) {
    // No CLI is started, so `renewed` is only the file's own clock, as it is on any answer.
    return readSavedPass().then(({ expiresAt }) => ({
      renewed: expiresAt !== null && expiresAt > Date.now(),
      expiresAt,
      attempted: false,
      detail: `the last renewal left no new pass; the next try is in ${Math.ceil(heldMs / 60_000)} min`,
    }));
  }
  const attempt = attemptRenewal()
    .catch((): LoginRenewal => ({
      // A belt: every leg above is total, and the meter is forbidden to fail on a renewal.
      renewed: false, expiresAt: null, attempted: true, detail: 'the renewal failed unexpectedly',
    }))
    .finally(() => {
      inFlight = null;
    });
  inFlight = attempt;
  return attempt;
}
