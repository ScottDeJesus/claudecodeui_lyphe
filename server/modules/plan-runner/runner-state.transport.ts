import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The disk side of the plan-runner lane: how one run directory is read, and nothing about
 * what its contents MEAN.
 *
 * The runner owns `<state dir>/<run_id>/`. This server only ever reads it — the runner is a
 * separate process that may be mid-phase right now, and a second writer would race its own
 * atomic rewrite. Four of the files in there are this lane's:
 *
 * - `progress.json` — the whole picture (position, phases, spend, the composed status line).
 *   The runner REPLACES it whole through `atomic_write` (`hooks/plan_runner/state_lock.py:72-90`,
 *   a per-write `mkstemp` scratch plus `os.replace`), called at `progress.py:151`, so a read
 *   caught mid-rewrite is a decode error on the old bytes or a clean read of the new ones —
 *   never a half-record with plausible fields.
 * - `run.json` — the run's own state. This lane reads two fields from it: `stopped_at`, and
 *   `launched_by_session` — the Claude transcript uuid whose turn launched the run, kept RAW here
 *   and resolved to an app session id by `plan-runner.module.ts` (`sessionsDb.resolveAppSessionId`).
 *   This lane names no database, so the id it carries out is the disk's own spelling.
 * - `receipt.json` — its PRESENCE means the run is over; its `status` and `ended_at` say how and when,
 *   which the lane carries for a while so the operator sees the ending before it leaves the tab.
 * - `runner.log` — one appended line per stage change (`progress.py:155`).
 *
 * A fifth file is read from OUTSIDE the run directory: the run's lock under `locks/`, which is
 * the only thing on disk that says a daemon is still breathing. See {@link readRunLockBeat}.
 *
 * The directory holds more than those four, and the rest are ignored on purpose rather than
 * missed. `progress.txt` is the same line plus one row per phase, rendered for a human reading it
 * in a terminal (`progress.py:152`); this lane already has those facts structured, so parsing the
 * prose back would be a second and worse decoder of the file it sits beside. `runner.out` is the
 * daemon's raw stderr (`cmd/daemon.py:47,196`) and `phase_<n>/` holds each soul's transcript —
 * both unbounded, unstructured, and carrying whatever a soul happened to print, which is not
 * something to fan out to every open tab on a two-second poll.
 *
 * Every read here is best-effort by contract. A missing file, an unreadable one, a directory
 * that vanished between the listing and the read: all of them are "absent for this tick"
 * (`null` / `false` / `[]`) and never a thrown error, because the watcher polls this on an
 * interval and one bad directory must never cost the others their reading.
 */

/**
 * The name the runner's lock store goes by inside the default state root. Used ONLY to skip it
 * when listing run directories — it is a sibling of the runs, never one of them. Finding a lock
 * goes through {@link LOCK_DIR} — the same store under the default root, a different one once
 * `PLAN_RUNNER_STATE_DIR` is set, which is what that constant's own note is about.
 */
const LOCKS_DIR_NAME = 'locks';

/**
 * Where the runner's locks are read from — absolute, and (unlike the run directories) NOT derived
 * from the state root this lane was pointed at.
 *
 * It was written when that was right: the runner expanded a fixed `~/.claude/state/runner` at
 * import and no module under `hooks/plan_runner/` read `PLAN_RUNNER_STATE_DIR`. That stopped being
 * true on 2026-09-22 — `state_lock.py:38-43` now resolves that env at import for `RUNNER_DIR` and
 * joins `LOCK_DIR` onto it, `costs` imports the same resolution, and `scripts/runner_watchdog.py`
 * and the quiet checkpoint's `scripts/quiet_checkpoint_runs.py` mirror it. The runner therefore
 * moves the runs and their lock store TOGETHER (a root that moved one alone would read the other
 * tree's locks), and this constant is now the one reader that disagrees.
 *
 * In the default configuration both name the same directory, so nothing is wrong today. Under a
 * moved env every lookup here misses, every run falls back to its progress file, and every healthy
 * long phase reads `stale` — silently, and only under the configuration meant to be the safe one.
 *
 * The cure is to thread the root this lane already resolves for the runs
 * (`plan-runner.module.ts:157`) through {@link readRunLockBeat} and {@link pruneVanishedReads} and
 * delete this constant. That is a signature change plus a server rebuild, so it is the operator's
 * call and not this module's — and once it lands, deriving the store from `stateDir` is CORRECT
 * rather than the bug the earlier version of this comment warned against: the symmetry was wrong
 * because the RUNNER kept the two apart, never because the two belong apart.
 *
 * One lock per PLAN rather than per run (`state_lock.py:116`), which is why a lock is found by
 * hashing a plan path and not by naming a run.
 */
const LOCK_DIR = path.join(os.homedir(), '.claude', 'state', 'runner', 'locks');

/** One file's last reading, kept so an unchanged file is not decoded again on every 2 s tick. */
type CachedRead = {
  mtimeMs: number;
  size: number;
  /** The inode. `os.replace` over a fresh scratch file always lands a NEW one, so this catches a
   *  rewrite that happened to keep the same size inside the same millisecond — which mtime and
   *  size together cannot. It costs nothing: the same `statSync` already answered it. */
  ino: number;
  value: unknown;
};

const readCache = new Map<string, CachedRead>();

/** A non-empty string, or `null`. */
export function readStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Reads a file through the cache, decoding it with `parse` only when its stat changed.
 *
 * The cache is keyed by absolute path and never evicted by age. A failed `stat` drops that one
 * file, which covers everything this lane keeps asking about; what it cannot cover is a file this
 * lane stops asking about, since a path never read again is never stat'd again. That is what
 * {@link pruneVanishedReads} is for, on both populations that go quiet — see it for which.
 */
function readCached(filePath: string, parse: (raw: string) => unknown): unknown {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    // Absent, or a directory that went away underneath us. Either way there is nothing to
    // remember about it, so the entry goes too — a file recreated later re-reads from scratch.
    readCache.delete(filePath);
    return null;
  }

  const cached = readCache.get(filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size && cached.ino === stats.ino) {
    return cached.value;
  }

  let value: unknown = null;
  try {
    value = parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    // A decode error mid-rewrite is NORMAL here, not a fault: the runner replaces
    // `progress.json` whole while we poll. `null` is cached against this exact stat so the same
    // bad bytes are not decoded again every tick, and the next rewrite changes the stat.
    value = null;
  }

  readCache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, ino: stats.ino, value });
  return value;
}

/**
 * The PLAN's spend OUTSIDE its runs — planner, reviewer, scout waves — booked by the hooks tree at
 * `~/.claude/state/plan_costs/<slug>.json` (`plan_runner/costs.py`; `plan-runner cost <plan>` prints
 * the same book). Summed by kind; a `build` row there is ignored because the receipts are that
 * kind's source and `tally` already folds them. Operator, 2026-09-12: "add the planning and
 * architecture into the plan cost as well … I'd like to see totals" — a "$93 run" had cost a third
 * of the weekly budget once the planner, his scouts and the review were counted.
 *
 * `planning`/`review`/`scouts` are PAID dollars (Claude rows price at 0 — `costs.PRICES` holds
 * vendor models only), and `tokens`/`tokensIn`/`tokensOut` are THE CLAUDE ROWS' ALONE — a
 * planner or a review that rode the operator's subscription is counted here and nowhere in the
 * dollars, and a row a vendor billed is the other way round (operator rule, 2026-09-24: a spend
 * figure is dollars OR tokens, by who was used). ONE predicate decides both halves of a row
 * (`rowRidesClaude`), so the two can never be taken from different records.
 */
export type PlanLedger = {
  planning: number; review: number; scouts: number;
  tokens: number; tokensIn: number; tokensOut: number;
};

const PLAN_COST_DIR = path.join(os.homedir(), '.claude', 'state', 'plan_costs');

export function readPlanLedger(planPath: string): PlanLedger {
  const out: PlanLedger = { planning: 0, review: 0, scouts: 0, tokens: 0, tokensIn: 0, tokensOut: 0 };
  const base = path.basename(planPath);
  // `costs.slug` + `costs._path`: the `.md` off, then only [A-Za-z0-9._-], at most 120 chars.
  const slug = (base.toLowerCase().endsWith('.md') ? base.slice(0, -3) : base).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 120);
  if (slug.length === 0) return out;
  const rows = readCached(path.join(PLAN_COST_DIR, `${slug}.json`), parseJsonArray);
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const kind = (row as Record<string, unknown>).kind;
    if (kind !== 'planning' && kind !== 'review' && kind !== 'scouts') continue;
    const cost = rowPaidUsd(row as Record<string, unknown>);
    if (cost > 0) out[kind] += cost;
    // The tokens are THE CLAUDE HALF and nothing else: a row whose every model is a vendor's is a
    // bill, and its tokens are that vendor's own business (operator rule, 2026-09-24). Same test as
    // `rowPaidUsd`, one predicate — a row can never show a vendor's dollars beside Claude's tokens.
    if (!rowRidesClaude(row as Record<string, unknown>)) continue;
    // Every token billed on the outing (in + out + cache read + cache write) — the "⛁ tok" unit.
    const tokens = Number((row as Record<string, unknown>).tokens);
    if (Number.isFinite(tokens) && tokens > 0) out.tokens += tokens;
    // The same tally split, when the row carries it (`costs.record_subagent`): `in` is what the
    // outing READ (input + cache read + cache write), `out` what it wrote. A row written before
    // the split shipped contributes its total alone — the sum is never wrong, only less detailed.
    for (const [key, into] of [['tokens_in', 'tokensIn'], ['tokens_out', 'tokensOut']] as const) {
      const part = Number((row as Record<string, unknown>)[key]);
      if (Number.isFinite(part) && part > 0) out[into] += part;
    }
  }
  return out;
}

/** The vendor prefix a card is billed for — `costs.PAID_PREFIX`, the word test `costs.paid_word`
 *  asks, which is what the Python side reads a row's models through (`costs.row_rides_claude`); the
 *  two must answer alike about one row, tier and all. */
const PAID_MODEL_PREFIX = 'deepseek';

/** The keys of a record field that may be a name→count map, `[]` for anything else. */
function mapKeys(value: unknown): string[] {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>)
    : [];
}

/**
 * One ledger ROW's paid dollars — `costs.row_paid_usd`, ported, and the same answer it gives.
 *
 * A row's models NAME what billed it, so where they do the answer is derived rather than trusted:
 * a row whose every model is Claude reads 0 whatever dollar figure it stored. That is what makes an
 * OLD row honest without a backfill — the `planning`/`review` rows written before the operator's
 * 2026-09-24 ruling carry a Claude outing's dollars in `cost_usd`, and the row's own `by_model` keys
 * (or a scout wave's `models` counts) are what say so. A row that names no model at all is the one
 * shape with nothing to go on, and it keeps its stored figure: this is a reader, not a re-pricer.
 */
export function rowPaidUsd(row: Record<string, unknown>): number {
  return rowRidesClaude(row) ? 0 : storedCost(row);
}

/**
 * Whether a ledger ROW rode the operator's Claude subscription — the one predicate behind both of a
 * row's halves, `costs.row_rides_claude` ported: its models NAME what billed it, so a row whose
 * every model is Claude is a subscription row whatever dollar figure it stored, and a row that
 * names no model at all is the one shape with nothing to go on (it keeps its stored figure, and its
 * tokens are read as a vendor's — the direction that never shows a vendor's tokens as Claude's).
 */
function rowRidesClaude(row: Record<string, unknown>): boolean {
  const named = [...mapKeys(row.by_model), ...mapKeys(row.models)].map((word) => word.toLowerCase());
  return named.length > 0 && !named.some((word) => word.startsWith(PAID_MODEL_PREFIX));
}

/** A ledger row's stored dollar figure, `0` for anything that is not a positive number. */
function storedCost(row: Record<string, unknown>): number {
  const cost = Number(row.cost_usd);
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

/**
 * Whether a RECEIPT says every phase of its run rode the operator's Claude subscription —
 * `costs._scan_runs`' own test, ported: a `providers` map that is present and names no vendor.
 *
 * A run's stored `cost_usd` was booked by the runner as it walked, so an OLD receipt's figure is
 * the CLI's own self-report and counts the subscription as money. Where the map is there, the
 * record says so itself and the figure reads 0; a receipt with no map, or one naming a vendor, keeps
 * what it stored — this lane never re-prices.
 */
export function receiptRidesClaude(receipt: unknown): boolean {
  const providers = (receipt as Record<string, unknown> | null)?.providers;
  const words = providers !== null && typeof providers === 'object' && !Array.isArray(providers)
    ? Object.values(providers as Record<string, unknown>).map((word) => String(word ?? ''))
    : [];
  return words.length > 0 && words.every((word) => word === '' || word === 'claude');
}

/** The word a phase carries when it rode the operator's Claude subscription (`receiptRidesClaude`). */
const CLAUDE_PROVIDER = 'claude';

/** Every phase word a run record names, in either shape the runner writes them. */
function phaseWords(record: Record<string, unknown>): string[] {
  const providers = record.providers;
  if (providers !== null && typeof providers === 'object' && !Array.isArray(providers)) {
    const words = Object.values(providers as Record<string, unknown>).map((word) => String(word ?? ''));
    if (words.length > 0) return words;
  }
  const phases = record.phases;
  if (Array.isArray(phases)) {
    return phases
      .filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object')
      .map((row) => String(row.provider ?? ''));
  }
  return [];
}

/**
 * A record's token count, `0` for anything that is not a finite number — so a mistyped field reads
 * as "not recorded" and never as `NaN` walking all the way to the DOM.
 */
function tokenCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

/**
 * ONE RUN RECORD's tokens AS THE CLAUDE HALF — `plan_runner/costs.py:run_claude_tokens`, ported,
 * and the same answer it gives: what the subscription spent of a run, which is the only token
 * figure any card states.
 *
 * A SPEND FIGURE IS DOLLARS **OR** TOKENS, BY WHO WAS USED (operator rule, 2026-09-24). A run is an
 * AGGREGATE of children on both providers, so its token figure is not the record's own word but its
 * children's: `$0.32 DeepSeek · 12.4M in · 80k out` counts the CLAUDE phases and never a vendor's.
 * Three answers, in the order the record can support them.
 *
 * 1. A run walked since the rule carries the half itself — `tokens_claude_in`/`tokens_claude_out`,
 *    folded at the one place a child's ending meets the run (`stages._spawn`). Read as stored.
 * 2. An older run carries ONE all-child tally and a phase→provider map naming what each phase rode.
 *    Where that map names no vendor, the tally IS the subscription's — read as its own split, or as
 *    the total alone on a record written before the split shipped.
 * 3. Where the map names BOTH, the tally cannot be split from the record, and this reader does NOT
 *    open the children's logs to split it (INV-4299: "a display does not open a child log to correct
 *    it"). Such a run reads all zeroes — the dollars alone, never a figure that counts a vendor's
 *    tokens as the subscription's.
 *
 * A record naming no phase word at all is read as PAID, which is `receiptRidesClaude`'s own reading
 * of the empty word and the same direction the dollars take.
 */
export function runClaudeTokens(
  record: unknown,
): { tokens: number; tokensIn: number; tokensOut: number } {
  const zero = { tokens: 0, tokensIn: 0, tokensOut: 0 };
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return zero;
  const rec = record as Record<string, unknown>;
  if (typeof rec.tokens_claude_in === 'number' || typeof rec.tokens_claude_out === 'number') {
    const read = tokenCount(rec.tokens_claude_in);
    const written = tokenCount(rec.tokens_claude_out);
    return { tokens: read + written, tokensIn: read, tokensOut: written };
  }
  const words = phaseWords(rec);
  if (words.length === 0 || words.some((word) => word !== '' && word !== CLAUDE_PROVIDER)) return zero;
  const read = tokenCount(rec.tokens_in);
  const written = tokenCount(rec.tokens_out);
  const total = tokenCount(rec.tokens);
  return read > 0 || written > 0
    ? { tokens: total, tokensIn: read, tokensOut: written }
    : { tokens: total, tokensIn: 0, tokensOut: 0 };
}

/** A JSON array, or `null` for anything else. */
function parseJsonArray(raw: string): unknown {
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : null;
}

/** A JSON object, or `null` for anything else — an array or a bare number is not a record. */
function parseJsonRecord(raw: string): unknown {
  const parsed: unknown = JSON.parse(raw);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

/**
 * Drops cached reads for files this lane will not ask about again.
 *
 * Two populations go quiet, for different reasons, and each needs its own retirement:
 *
 * - A RUN's files, retired by their directory no longer being listed. Scoped by grandparent so a
 *   cache shared with any other root — there is only one today — could never lose an entry this
 *   listing has no business judging.
 * - A LOCK, retired against a listing of {@link LOCK_DIR}. It cannot ride the run test: a lock is
 *   never one of the listed run directories, so that test would drop it on EVERY tick — the one
 *   file rewritten every 30 s, and precisely the read the cache exists to spare. Nor can it be
 *   left to its own failed `stat` in {@link readCached}, which only fires on a path still being
 *   read: `classifyRun` never asks for the lock of a receipted run (the ending is read first, and
 *   an ended run keeps its last written beat), so the moment a run finishes its lock entry stops
 *   being stat'd and would sit in the map for the life of the
 *   process — one object per plan ever run, small and unbounded, which is a leak however small.
 *
 * One `readdir` of a directory holding one file per active plan replaces the per-entry stats it
 * would otherwise take. A lock directory that cannot be listed is read as EMPTY rather than
 * skipped: being wrong that way costs a re-read on the next tick, while skipping would restore
 * the leak this exists to close.
 */
function pruneVanishedReads(root: string, liveRunDirs: Set<string>): void {
  let lockFiles: Set<string>;
  try {
    lockFiles = new Set(fs.readdirSync(LOCK_DIR));
  } catch {
    lockFiles = new Set();
  }

  for (const key of [...readCache.keys()]) {
    const dir = path.dirname(key);
    if (dir === LOCK_DIR) {
      if (!lockFiles.has(path.basename(key))) readCache.delete(key);
      continue;
    }
    if (path.dirname(dir) === root && !liveRunDirs.has(dir)) readCache.delete(key);
  }
}

/**
 * Every run directory under `stateDir`, sorted by name.
 *
 * `locks/` is the runner's own lock store, not a run, and is skipped by name; anything that is
 * not a directory is skipped by its dirent (the state dir carries loose files too). The sort
 * matches `runner_statusline.py:collect`, so two runs that started in the same second are
 * ordered the same way in the bar and in this lane.
 */
export function listRunDirs(stateDir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(stateDir, { withFileTypes: true });
  } catch {
    return []; // no state dir yet ⇒ no runs, which is a fact and not a failure
  }

  const root = path.resolve(stateDir);
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name !== LOCKS_DIR_NAME)
    .map((entry) => entry.name)
    .sort()
    .map((name) => path.join(root, name));

  pruneVanishedReads(root, new Set(dirs));
  return dirs;
}

/** The four files of one run directory, each absent-tolerant. */
export type RunnerRunFiles = {
  progress: unknown | null;
  run: unknown | null;
  /** True when a readable receipt is on disk — derived from `receipt`, never a second syscall (see `readRunFiles`). */
  hasReceipt: boolean;
  /** The receipt's record, or `null` when there is none. */
  receipt: unknown | null;
  logLines: string[];
};

/**
 * Reads one run directory's four files.
 *
 * `hasReceipt` is derived from the receipt READ, not from a second `existsSync`: the runner writes
 * a receipt atomically, so a record that reads is the whole signal and a file that does not is none.
 */
export function readRunFiles(dir: string): RunnerRunFiles {
  const logLines = readCached(path.join(dir, 'runner.log'), (raw) =>
    raw.split('\n').filter((line) => line.length > 0),
  );

  const receipt = readCached(path.join(dir, 'receipt.json'), parseJsonRecord);
  return {
    progress: readCached(path.join(dir, 'progress.json'), parseJsonRecord),
    run: readCached(path.join(dir, 'run.json'), parseJsonRecord),
    // ONE read decides both: the runner writes a receipt atomically (`state_lock.atomic_write`),
    // so it is either whole or absent — and a resume's rename landing between a separate
    // `existsSync` and this read would have painted one tick of a phantom `unknown` ending on a
    // run that is in fact restarting. A record that reads is a receipt; nothing else is.
    receipt,
    hasReceipt: receipt !== null,
    logLines: Array.isArray(logLines) ? (logLines as string[]) : [],
  };
}

/**
 * The heartbeat of the LOCK held for `planPath`, when that lock names `runId` — otherwise `null`.
 *
 * This is the lane's liveness signal, and it is not the one the terminal bar uses.
 * `progress.json.heartbeat_at` is set to "now" at `progress.py:185`, inside `_assemble`, which is
 * reached ONLY through `write` (`:139`, whose contract at `:141` is "Called after every stage
 * change") and written at `:151`. So the field advances on a stage change and at no other moment:
 * a perfectly healthy phase that spends twenty minutes in one fix-pass has a progress heartbeat
 * twenty minutes old. Aged against a fifteen-minute cut, that run reads stale while it is working
 * — measured on this host at 96 s of progress age against 6 s of lock age, on a phase whose own
 * budget is 5400 s.
 *
 * The lock is the honest beat: a daemon thread rewrites `heartbeat_at` every 30 s for as long as
 * it lives (`state_lock.py:239-250`, `HEARTBEAT_S = 30`), independently of what any phase is
 * doing. `plan-runner status` reads liveness the same way (`cmd/observe.py`, `_liveness`).
 *
 * RESIDUE, named: that independence cuts both ways. The beat thread survives a run that is alive
 * but WEDGED — a phase blocked forever on a subprocess that never returns keeps its lock beaten
 * every 30 s, so this lane reads it `live` indefinitely, where aging the progress file would have
 * raised `stale` after 900 s. The trade is deliberate: a false `stale` on every long healthy
 * phase is constant and misleading, a wedge is rare, and `position.stage_since` is what still
 * shows it — a stage that has not moved in an hour is the cue this lane leaves the reader.
 *
 * The `run_id` match is the whole point of the check and not a formality. A lock is keyed by
 * PLAN, so the lock sitting at this path may belong to a LATER run of the same plan that took
 * over from this one; borrowing its beat would show a dead run as live forever. When no lock
 * names this run — every fixture, a crashed daemon, a run whose lock was released — the caller
 * falls back to the progress file, and that run is judged by its own last write, which is then a
 * real lapse rather than an artefact.
 *
 * `realpath` mirrors `lock_path` exactly (`state_lock.py:116`): the runner hashes the RESOLVED
 * plan path so two symlinks to one plan share one lock, and a hash of the unresolved spelling
 * would simply miss the file and silently degrade every symlinked plan to the fallback.
 *
 * Takes no state root yet: the lock it reads is located by {@link LOCK_DIR}, which is where this
 * lane and the runner still disagree once `PLAN_RUNNER_STATE_DIR` moves — see that constant.
 */
export function readRunLockBeat(planPath: string, runId: string): number | null {
  let resolvedPlanPath: string;
  try {
    resolvedPlanPath = fs.realpathSync(planPath);
  } catch {
    return null; // the plan went away between the existence check and here ⇒ no lock to find
  }

  const key = crypto.createHash('sha256').update(resolvedPlanPath, 'utf8').digest('hex').slice(0, 16);
  const lock = readCached(path.join(LOCK_DIR, `${key}.json`), parseJsonRecord);
  if (lock === null) return null;

  const record = lock as Record<string, unknown>;
  if (record.run_id !== runId) return null;

  const beat = record.heartbeat_at;
  return typeof beat === 'number' && Number.isFinite(beat) ? beat : null;
}
