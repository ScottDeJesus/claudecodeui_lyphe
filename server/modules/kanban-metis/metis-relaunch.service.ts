import fs from 'node:fs';
import path from 'node:path';

import { expandHome } from '@/shared/utils.js';

import { DEFAULT_METIS_STATE_ROOT } from './metis-registry.service.js';

/**
 * The relaunch ledger and the rate-limit hold: the two questions the driver asks before it puts a
 * child on a board, and the bounds that keep it from asking forever.
 *
 * `~/.claude/descent/pm_relaunch_ledger.py:159-191` is the ledger ported here — SAME rule, this
 * repository's constants: launches that keep THROWING are retried ever-less-often and then not at
 * all, so a board whose work cannot start stops consuming a conversation every fifteen seconds. The
 * count is on DISK because an in-memory one is zeroed by a restart, and the restarted server would
 * revive the very poison board the ceiling exists to retire.
 *
 * The rate-limit hold is the other half of the same idea. `~/.claude/hooks/notify_api_error.sh`
 * writes ONE signal when a Claude Code turn dies on an account cap, and the driver reads it before
 * spawning: a child launched into a live cap dies on her first turn, which looks exactly like a
 * breakage and would be counted as one. The signal's KEYS ARE THE SCRIPT'S (`last_rate_limit_at`,
 * `reset_at`, epoch SECONDS, the second nullable) — a hold read from a guessed key is never on.
 *
 * NOTHING HERE THROWS. A ledger fault degrades to an empty one (the board re-earns its attempts,
 * which is harmless), a signal fault reads as NO HOLD (the board spawns, which is the failure the
 * operator can see). Neither may take the driver's interval down: a daemon that stops ticking is
 * silent by definition.
 */

/**
 * How many failed launches of one board the ledger allows before it stops retrying that board:
 * `pm_relaunch_ledger.py:51`'s `MAX_ATTEMPTS` — a count of LAUNCHES THAT THREW, never of launches
 * that ran. Three is deliberate: the first backoff is ten minutes, so three attempts span half an
 * hour of a board genuinely failing to start.
 */
export const RELAUNCH_MAX_ATTEMPTS = 3;

/**
 * The first backoff after attempt #1, in milliseconds: `pm_relaunch_ledger.py:54-55`'s
 * `BACKOFF_BASE` (600 s). Attempt N waits `BASE * 2 ** (N - 1)`, capped at
 * {@link RELAUNCH_BACKOFF_CAP_MS} — the units are MILLISECONDS because every timestamp in this
 * module is, and a ledger mixing seconds with the clock the driver passes would catch no type.
 */
export const RELAUNCH_BACKOFF_BASE_MS = 600_000;

/** The ceiling the doubling stops at: one hour between attempts, however many have been made. */
export const RELAUNCH_BACKOFF_CAP_MS = 3_600_000;

/**
 * How old a ledger row may be before it is FORGIVEN: `pm_relaunch_ledger.py:71`'s `_LEDGER_TTL_SECS`
 * (7 days) — "a long-quiet card is eventually forgiven". Without it a board at the ceiling has no way
 * back but a person launching it by hand. A row recorded a week ago says nothing about the board
 * TODAY; `lastAt` is the freshness stamp, and a dropped row re-earns its attempts from zero.
 */
export const RELAUNCH_LEDGER_TTL_MS = 604_800_000;

/**
 * The hold armed when `reset_at` HAS passed: the short grace on the raw event, so a cap that lifts
 * and is immediately re-fired does not get a child launched into it. `pm_relaunch.py:70`'s
 * `RATE_LIMIT_QUIET` (120 s).
 */
export const RATE_LIMIT_GRACE_MS = 120_000;

/**
 * The hold armed when the signal carries NO `reset_at`: the long window, because a cap advertising no
 * reset cannot be told from a multi-hour one. `pm_relaunch.py:67`'s `RATE_LIMIT_LOG_QUIET` (1800 s) —
 * the producer writes `reset_at` only when the payload named one, and the common fire carries the
 * event and nothing else.
 */
export const RATE_LIMIT_BLIND_HOLD_MS = 1_800_000;

/** The margin added to a future `reset_at`, so the child is not launched into the last second of a cap. */
export const RATE_LIMIT_RESET_BUFFER_MS = 30_000;

/**
 * The furthest future a `reset_at` may name before it is read as CORRUPT rather than as a hold:
 * `pm_relaunch.py:78`'s `RESET_AT_MAX_HORIZON` (8 days). Claude's caps are hourly windows, so a
 * timestamp a week out is a bad parse or a bad clock, and honouring it would silence every board on
 * the install. Past the horizon the signal is demoted to the blind hold — held, but not that long.
 */
export const RATE_LIMIT_MAX_HORIZON_MS = 691_200_000;

/** One board's row, and the file it lives in: launches that THREW, and when the last one did. */
type RelaunchEntry = { attempts: number; lastAt: number };
type RelaunchLedger = Record<string, RelaunchEntry>;

/** The rate-limit signal as `notify_api_error.sh` writes it. Both epochs are SECONDS. */
type RateLimitSignal = { lastRateLimitAt: number; resetAt: number | null };

/** Faults already said aloud: a repeating fault on the 15 s tick is one sentence, never a flood. */
const said = new Set<string>();

/** Says a fault once per distinct sentence — `metis-driver.service.ts`'s journal, applied here. */
function say(message: string): void {
  if (said.has(message)) return;
  said.add(message);
  console.error(`[KanbanMetis] relaunch: ${message}`);
}

/** One error's message, whatever was thrown. A journal line is never `[object Object]`. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Where the ledger lives: `<KANBAN_METIS_STATE_ROOT>/relaunch-ledger.json`, beside the registry's
 * session directories. THE ENVIRONMENT IS READ AT CALL TIME, never captured at module load, so a
 * probe gets the whole ledger in a temporary root. The default is the registry's own, imported
 * rather than re-spelled: two spellings of the state root are two ledgers.
 */
export function relaunchLedgerPath(): string {
  const root = process.env.KANBAN_METIS_STATE_ROOT || DEFAULT_METIS_STATE_ROOT;
  return path.join(expandHome(root), 'relaunch-ledger.json');
}

/** Where the rate-limit signal lives, read at call time for the same reason as the ledger. */
export function rateLimitSignalPath(): string {
  const override = process.env.CLOUDCLI_RATE_LIMIT_PATH;
  return override !== undefined && override !== ''
    ? expandHome(override)
    : expandHome('~/.cloudcli/rate_limit.json');
}

/**
 * The ledger on disk as it stands: a MISSING file is the ordinary first run and says nothing, and a
 * file that cannot be read or parsed is the torn write of a server killed mid-save (the writes below
 * are atomic, so that is the one case left). Both degrade to an EMPTY ledger — the boards re-earn
 * their attempts, costing at most three extra launches, where refusing every spawn would silence
 * autonomy until a human noticed.
 */
function readLedger(): RelaunchLedger {
  const file = relaunchLedgerPath();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      say(`ledger unreadable at ${file}, starting empty (${describe(error)})`);
    }
    return {};
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const ledger: RelaunchLedger = {};
  for (const [boardId, entry] of Object.entries(parsed as Record<string, unknown>)) {
    // ONE ROW AT A TIME: a hand-edited or half-understood file must not cost every OTHER board its
    // count, and the two numbers are the only thing a row is.
    if (entry === null || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const attempts = row.attempts;
    const lastAt = row.lastAt;
    if (!Number.isFinite(attempts) || !Number.isFinite(lastAt)) continue;
    // Long quiet: forgiven, exactly as `pm_relaunch_ledger.py:99-105` drops a stale row on load.
    if (Date.now() - (lastAt as number) > RELAUNCH_LEDGER_TTL_MS) continue;
    ledger[boardId] = {
      attempts: Math.max(0, Math.trunc(attempts as number)),
      lastAt: lastAt as number,
    };
  }
  return ledger;
}

/**
 * The ledger written back atomically: same-directory temp file, then rename, `pm_relaunch_ledger.py:
 * 117-140`'s save. The atomicity is the point — a reader (or the next boot) can never catch a
 * half-written file, the one failure that would turn a killed server into one whose ledger has to be
 * discarded. A write fault is said once and dropped: the count is then correct only for this
 * process's life, which beats taking the tick down.
 */
function writeLedger(ledger: RelaunchLedger): void {
  const file = relaunchLedgerPath();
  const tmp = `${file}.tmp.${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify(ledger)}\n`, 'utf8');
    fs.renameSync(tmp, file);
  } catch (error) {
    say(`ledger not saved at ${file} (${describe(error)})`);
    // The temp is never left behind: a full disk would otherwise accumulate one file per attempt.
    try {
      fs.rmSync(tmp, { force: true });
    } catch (cleanupError) {
      say(`ledger temp ${tmp} could not be removed (${describe(cleanupError)})`);
    }
  }
}

/** How long a board with this many recorded attempts waits before its next one. */
function backoffMs(attempts: number): number {
  if (attempts <= 0) return RELAUNCH_BACKOFF_BASE_MS;
  return Math.min(RELAUNCH_BACKOFF_CAP_MS, RELAUNCH_BACKOFF_BASE_MS * 2 ** (attempts - 1));
}

/**
 * May the driver launch for this board right now?
 *
 * False for a board that has SPENT its attempts — three launches that threw is a board that cannot
 * start, not one having a bad minute — and false while a recorded attempt's backoff is still running.
 *
 * TWO WAYS BACK, and a board at the ceiling needs one that does not need a person: a row older than
 * {@link RELAUNCH_LEDGER_TTL_MS} is dropped on read, and {@link clearAttempts} fires when one of its
 * sessions reaches a completed ending. Without the first it would wait for a human hand forever.
 */
export function shouldRelaunch(boardId: string, now: number): boolean {
  const entry = readLedger()[boardId];
  if (entry === undefined) return true;
  if (entry.attempts >= RELAUNCH_MAX_ATTEMPTS) return false;
  return now >= entry.lastAt + backoffMs(entry.attempts);
}

/**
 * Records that a launch for this board THREW: bump the count, stamp the moment, arm the next
 * backoff.
 *
 * Only a launch that failed reaches here. A launch that succeeded is a board that is working, and
 * counting it would back a healthy board off after three good launches — the exact inversion the
 * `metis-driver.service.ts` catch block names when it says a failed launch is not recorded as a
 * spawn.
 */
export function recordAttempt(boardId: string, now: number): void {
  const ledger = readLedger();
  const entry = ledger[boardId];
  ledger[boardId] = { attempts: (entry?.attempts ?? 0) + 1, lastAt: now };
  writeLedger(ledger);
}

/**
 * Forgets a board's record, so its next failure starts from the first backoff again.
 *
 * Called when a session for the board reaches a COMPLETED ending: a board that can run a child to
 * the end of its work has proven the thing the ledger was in doubt about, and holding its old
 * failures against it would be the ledger outliving its own reason. A board with no row is left
 * alone without a write — this is asked once per ending the driver observes, not once per tick.
 */
export function clearAttempts(boardId: string): void {
  const ledger = readLedger();
  if (ledger[boardId] === undefined) return;
  delete ledger[boardId];
  writeLedger(ledger);
}

/**
 * The signal `notify_api_error.sh` last wrote, or `null` for no signal. The keys are the script's
 * own (`last_rate_limit_at`, `reset_at`), read straight out of its `write_rate_limit_state`, and a
 * signal that cannot be read answers `null` — which every caller reads as CLEAR.
 */
function readSignal(): RateLimitSignal | null {
  const file = rateLimitSignalPath();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    // Absent is the ordinary case on an install that has not been capped. Anything ELSE is a file
    // this reader cannot make sense of — said once, because it is a silent hole in the hold.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      say(`rate-limit signal unreadable at ${file}, reading it as clear (${describe(error)})`);
    }
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const row = parsed as Record<string, unknown>;
  const last = row.last_rate_limit_at;
  const reset = row.reset_at;
  if (!Number.isFinite(last)) return null;
  return { lastRateLimitAt: last as number, resetAt: Number.isFinite(reset) ? (reset as number) : null };
}

/**
 * When the API rate-limit hold lifts, in epoch MILLISECONDS, or `null` when there is no hold.
 *
 * `pm_relaunch.py:194-228`'s `rate_limit_signal`, in the one form its callers need: the driver does
 * not care WHY spawning is held, only until when. A future `reset_at` (plus a small buffer) is
 * exact; a `reset_at` that has already passed falls back to the short grace on the event; a signal
 * with no `reset_at` at all — the common fire — holds for the long blind window, because a cap that
 * advertises no reset cannot be distinguished from a long one. A `reset_at` beyond the horizon is
 * demoted to that same blind window rather than honoured.
 *
 * A `null` answer is a green light: no signal, an unreadable one and one whose windows have all
 * elapsed are the same answer, deliberately.
 */
export function rateLimitHold(now: number): number | null {
  const signal = readSignal();
  if (signal === null) return null;

  let resetAtMs = signal.resetAt === null ? null : signal.resetAt * 1000;
  if (resetAtMs !== null && resetAtMs > now + RATE_LIMIT_MAX_HORIZON_MS) resetAtMs = null;

  if (resetAtMs !== null) {
    const clearAt = resetAtMs + RATE_LIMIT_RESET_BUFFER_MS;
    if (clearAt > now) return clearAt;
  }

  const grace = resetAtMs !== null ? RATE_LIMIT_GRACE_MS : RATE_LIMIT_BLIND_HOLD_MS;
  const lastAtMs = signal.lastRateLimitAt * 1000;
  if (now - lastAtMs < grace) return lastAtMs + grace;
  return null;
}
