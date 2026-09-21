import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { kanbanLearningDb } from '@/modules/database/index.js';
import { kanbanCardsService } from '@/modules/kanban/index.js';
import {
  KANBAN_LANE_LIMIT_MAX,
  KANBAN_STATUSES,
  type KanbanSessionUsage,
} from '@/shared/kanban-types.js';
import type { KanbanMetisSession } from '@/shared/types.js';

import { getLiveMetisRegistry } from './metis-registry.service.js';

/**
 * The token watcher: every thirty seconds, what each live Metis session has burned, read off the
 * transcript files the CLI writes — never guessed at, and never smeared onto the wrong card.
 *
 * It records two ways: the durable
 * per-session ledger (`kanban_session_usage`) and the per-card `build_tokens_*` counters the
 * board's cost chip renders, attributed to the card the session holds a FRESH build lease on. A
 * session between cards — orienting, or holding a lease that went stale — records at the session
 * level only, because that spend is real but belongs to no card.
 *
 * WHERE THE TOKENS ARE. A session's transcript is `<projects root>/<cwd slug>/<sessionId>.jsonl`,
 * and SUBAGENTS LOG SEPARATELY under `<that directory>/<sessionId>/subagents/agent-*.jsonl`. A
 * main-transcript-only tally undercounts badly, because that is where most of the work happens, so
 * a session's reading is the sum over its main file and every subagent file.
 *
 * THE MULTI-LINE MESSAGE TRAP. One logical assistant message spans SEVERAL JSONL lines — one per
 * content block — and EVERY one of those lines repeats the message's whole `usage`. Summing lines
 * therefore double- or triple-counts. {@link accumulateUsage} dedups on `message.id`: a message's
 * usage is counted once, on the first line it appears on, and the per-file `seen` set carries
 * across ticks so a message split over a tick boundary is still counted once.
 *
 * CHEAP TICKS, VIA BYTE OFFSETS. Transcripts are append-only, so each file keeps a byte cursor and
 * each tick reads only what was appended since. The cursor advances ONLY past complete
 * (newline-terminated) lines, so a half-flushed trailing line is re-read intact next tick rather
 * than dropped or parsed as JSON. A file that shrank (truncation, a rename) restarts from zero.
 *
 * THE DURABLE TRUTH IS THE DATABASE ROW, NEVER MEMORY. The in-memory tallies reset on a restart,
 * and the following full re-read would re-derive a cumulative that the stored row already holds —
 * which is why the step is `delta = max(0, fresh − stored)`: after a restart `fresh` re-equals
 * `stored` and the delta is zero. Only genuinely new spend is ever written.
 *
 * NEVER RAISES. A malformed line, a vanished file, a locked database — each degrades to "skip and
 * continue". The tick's guard is per session and per fault, because one bad transcript must not end
 * the interval or stop every session behind it from being counted.
 */

/**
 * How often the watcher tallies.
 *
 * Token spend changes gradually and the display is a coarse chip, so thirty seconds surfaces a
 * build's cost promptly without re-reading transcripts every second. The delta math is idempotent,
 * so a longer interval would delay a number but never miscount one.
 */
export const TELEMETRY_TICK_MS = 30_000;

/**
 * Where the Claude CLI writes transcripts, and where the providers module's own root points.
 *
 * Derived here rather than imported because `CLAUDE_PROJECTS_ROOT`
 * (`providers/list/claude/claude-session-synchronizer.provider.ts`) is not on the providers barrel
 * and a cross-module deep import is refused by both the module standards and the lint boundary
 * rules — the barrel for this module is the only door. `metis-spawn.service.ts` and
 * `metis-env.service.ts` derive their own `~/.claude` roots the same way.
 */
const CLAUDE_PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');

/** The read window. One transcript line can be huge; nothing here materializes a whole file. */
const READ_CHUNK_BYTES = 64 * 1024;

/**
 * How many lane pages the attribution scan will walk before it gives up on a board.
 *
 * The same bound and the same reason as `metis-driver.service.ts`'s lease scan: a claim sends no
 * anchors, so a card taken this minute lands at the BOTTOM of the ladder, far past a single page.
 * A board longer than this is one this tick cannot read completely, and the honest answer for it
 * is to attribute nothing — an unattributed delta is a session-level number, while a misattributed
 * one is a lie on someone else's card.
 */
const LEASE_SCAN_PAGES = 25;

/** One transcript file's cursor: how far it has been read, what it has seen, what it has counted. */
type FileTally = {
  /** The byte position past the last COMPLETE line consumed. */
  offset: number;
  /** `message.id`s already counted, so a multi-line message counts once across ticks too. */
  seen: Set<string>;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreate: number;
};

/** Every transcript file this process has read: main files and subagent files alike. */
const fileTallies = new Map<string, FileTally>();

/** Where each session's transcript directory was found, so the projects root is scanned once. */
const transcriptDirs = new Map<string, string>();

/** Faults already said aloud: the tick repeats every thirty seconds, so a fault is one sentence. */
const said = new Set<string>();

function newTally(offset = 0): FileTally {
  return { offset, seen: new Set<string>(), tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheCreate: 0 };
}

/** A usage field as a non-negative counter, degrading a missing or malformed one to zero. */
function asInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * Folds one JSONL line's assistant usage into `tally`, deduped on `message.id`.
 *
 * Total by construction: a line that is not JSON, not an assistant turn, or carries no usage
 * object is skipped in silence. A usage-bearing line with no id is counted — every real assistant
 * message carries one, and under-counting a corrupt rarity is worse than the negligible risk of
 * counting it twice.
 */
function tallyLine(line: string, tally: FileTally): void {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return;
  }
  if (record === null || typeof record !== 'object') return;

  const entry = record as { type?: unknown; message?: unknown };
  if (entry.type !== 'assistant') return;
  if (entry.message === null || typeof entry.message !== 'object') return;

  const { id, usage } = entry.message as { id?: unknown; usage?: unknown };
  if (usage === null || typeof usage !== 'object') return;

  if (typeof id === 'string' && id !== '') {
    if (tally.seen.has(id)) return;
    tally.seen.add(id);
  }

  const counts = usage as Record<string, unknown>;
  tally.tokensIn += asInt(counts.input_tokens);
  tally.tokensOut += asInt(counts.output_tokens);
  tally.cacheRead += asInt(counts.cache_read_input_tokens);
  tally.cacheCreate += asInt(counts.cache_creation_input_tokens);
}

/** Every complete line of one consumed run of bytes, each folded into the tally. */
function tallyLines(complete: Buffer, tally: FileTally): void {
  for (const line of complete.toString('utf8').split('\n')) {
    if (line !== '') tallyLine(line, tally);
  }
}

/**
 * Advances `tally` by the transcript's newly-appended complete lines. Never throws.
 *
 * Streamed in fixed-size windows so a tens-of-megabytes transcript is never materialized whole.
 * The cursor moves only past complete lines: whatever follows the last newline is carried into the
 * next window and re-read intact next tick, which is what makes a half-flushed line a non-event
 * rather than a parse error.
 */
function tallyFile(filePath: string, tally: FileTally): void {
  let size: number;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return; // gone or unreadable this tick — the prior cumulative stands, and the next tick retries
  }

  // Truncated or rotated: re-read the file whole. The re-derived total is then SMALLER than the
  // stored row, so the delta pins at zero until the regrown file passes it again — an undercount
  // for that stretch, never a double count. Near-zero probability on an append-only transcript,
  // and self-healing.
  if (size < tally.offset) {
    tally.offset = 0;
    tally.seen.clear();
    tally.tokensIn = 0;
    tally.tokensOut = 0;
    tally.cacheRead = 0;
    tally.cacheCreate = 0;
  }
  if (size <= tally.offset) return; // nothing appended

  let handle: number;
  try {
    handle = fs.openSync(filePath, 'r');
  } catch {
    return;
  }

  try {
    const window = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    let carry = Buffer.alloc(0);
    let position = tally.offset;

    while (position < size) {
      let read: number;
      try {
        read = fs.readSync(handle, window, 0, Math.min(READ_CHUNK_BYTES, size - position), position);
      } catch {
        return;
      }
      if (read <= 0) break;
      position += read;

      const data =
        carry.length === 0 ? window.subarray(0, read) : Buffer.concat([carry, window.subarray(0, read)]);
      const lastBreak = data.lastIndexOf(0x0a);
      if (lastBreak === -1) {
        carry = Buffer.from(data); // no complete line yet — wait for the newline before consuming
        continue;
      }

      carry = Buffer.from(data.subarray(lastBreak + 1));
      tally.offset = position - carry.length;
      tallyLines(data.subarray(0, lastBreak), tally);
    }
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * What one transcript holds from `fromOffset` on, deduped on `message.id`.
 *
 * The one-shot reading: `tokensIn|Out|cacheRead|cacheCreate`
 * are what the consumed lines hold, `seen` names the messages they carried, and `offset` is where
 * to resume — always past a complete line, never into a partial one. A file that is not there
 * reads as all zeros at the offset asked for.
 *
 * THIS FUNCTION HOLDS NO STATE, and that is the whole of its calling contract: the dedup set is
 * built inside the call and dropped at the end of it, so a range read TWICE is counted twice — a
 * message the CLI repeats on a later line (the multi-line-message trap above) counts again when
 * the caller comes back for more of the file and hands the same message over in the new range. A
 * caller that walks a file in steps therefore carries the set itself: {@link tickSession} keeps one
 * per-file tally — cursor, `seen`, running counters — and reads through that, which is what makes
 * a message split across a tick boundary count exactly once. The returned `seen` is how such a
 * caller extends its own set; it is never read back in here.
 */
export function accumulateUsage(
  jsonlPath: string,
  fromOffset: number
): {
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreate: number;
  seen: string[];
  offset: number;
} {
  const tally = newTally(fromOffset);
  tallyFile(jsonlPath, tally);

  return {
    tokensIn: tally.tokensIn,
    tokensOut: tally.tokensOut,
    cacheRead: tally.cacheRead,
    cacheCreate: tally.cacheCreate,
    seen: [...tally.seen],
    offset: tally.offset,
  };
}

/** The tally a file keeps between ticks — the same cursor and dedup set, reused. */
function tallyFor(filePath: string): FileTally {
  let tally = fileTallies.get(filePath);
  if (tally === undefined) {
    tally = newTally();
    fileTallies.set(filePath, tally);
  }
  return tally;
}

/** A file that is really there: an existence check alone would pass an unreadable one. */
function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * The projects directory holding this session's transcript, or `null`.
 *
 * The scan the routes already take (`claude-transcript-activity.ts`'s `scanProjectsRoot` fallback),
 * for the reason its comment gives: a board Metis's cwd is under `~/.claude/kanban-metis`, and the
 * synchronizer refuses to register such a transcript as a project session — so she has no row, and
 * the directory scan is not the edge case here, it is the only case. Resolved once per session and
 * remembered: a transcript's directory does not move.
 */
function projectDirFor(sessionId: string): string | null {
  const found = transcriptDirs.get(sessionId);
  if (found !== undefined) return found;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(CLAUDE_PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return null; // no projects root, or it is unreadable: nothing to scan
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(CLAUDE_PROJECTS_ROOT, entry.name);
    if (isFile(path.join(directory, `${sessionId}.jsonl`))) {
      transcriptDirs.set(sessionId, directory);
      return directory;
    }
  }

  return null;
}

/** A session's main transcript and every subagent transcript under it. */
function sessionTranscriptFiles(sessionId: string): string[] {
  const directory = projectDirFor(sessionId);
  if (directory === null) return [];

  const files = [path.join(directory, `${sessionId}.jsonl`)];
  const subagents = path.join(directory, sessionId, 'subagents');
  try {
    for (const name of fs.readdirSync(subagents)) {
      if (name.startsWith('agent-') && name.endsWith('.jsonl')) {
        files.push(path.join(subagents, name));
      }
    }
  } catch {
    // A session that spawned no subagent has no such directory. Its main file still counts.
  }

  return files;
}

/**
 * Every card's live build-lease holder on one board, by owner — or `null` for a board the scan
 * could not read completely.
 *
 * The board is read through its own barrel, one page at a time to exhaustion, exactly as the
 * driver's reap proof reads it. `null` is the honest answer for a ladder longer than the scan, and
 * the caller treats it as "attribute nothing this tick": a delta that stays at the session level
 * is a smaller loss than a delta written onto a card nobody is building.
 */
function liveLeaseHolders(
  boardId: string,
  cache: Map<string, Map<string, string> | null>
): Map<string, string> | null {
  const cached = cache.get(boardId);
  if (cached !== undefined) return cached;

  const holders = new Map<string, string>();
  let cursor: string | null = null;

  for (let page = 0; page < LEASE_SCAN_PAGES; page += 1) {
    const result = kanbanCardsService.listLaneCards(boardId, [...KANBAN_STATUSES], {
      limit: KANBAN_LANE_LIMIT_MAX,
      cursor,
    });
    for (const card of result.cards) {
      // Both halves of the predicate: the lane the claim path moves the card into, and the
      // lease freshness the server already computed for the summary. They are stamped together, so
      // a card holding a live lease is an `active` card, and a card failing either test is simply
      // not one this tick may attribute to.
      if (card.status === 'active' && card.leaseState === 'held' && card.buildOwner !== null) {
        holders.set(card.buildOwner, card.id);
      }
    }

    cursor = result.nextCursor;
    if (cursor === null) {
      cache.set(boardId, holders);
      return holders;
    }
  }

  cache.set(boardId, null);
  return null;
}

/** One line per distinct fault, carrying the caller's clock so a reader knows when it started. */
function say(fault: string, message: string, now: number): void {
  if (said.has(fault)) return;
  said.add(fault);
  console.error(`[KanbanMetis] telemetry: ${message} (${new Date(now).toISOString()})`);
}

/** One error's message, whatever was thrown. A journal line is never `[object Object]`. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One session's tick: tally its transcripts, take the delta against the stored row, persist, and
 * attribute.
 *
 * The order is the design. The session row is written FIRST and is the durable truth the next
 * tick's delta subtracts against; the card is written second and is best-effort. A card that
 * cannot be resolved leaves the delta at the session level, which is where between-card spend
 * belongs.
 */
function tickSession(
  session: KanbanMetisSession,
  now: number,
  holders: Map<string, Map<string, string> | null>
): void {
  const files = sessionTranscriptFiles(session.sessionId);
  if (files.length === 0) return; // no transcript yet — a session the CLI has not written for

  let freshIn = 0;
  let freshOut = 0;
  let freshRead = 0;
  let freshCreate = 0;
  let mainOffset = 0;

  files.forEach((file, index) => {
    const tally = tallyFor(file);
    tallyFile(file, tally);
    if (index === 0) mainOffset = tally.offset;
    freshIn += tally.tokensIn;
    freshOut += tally.tokensOut;
    freshRead += tally.cacheRead;
    freshCreate += tally.cacheCreate;
  });

  const stored = kanbanLearningDb.getSessionUsage(session.sessionId);
  // max(fresh, stored) IS the guard: the counters only ever climb, so a fresh total that fell
  // behind the stored one (a restart's partial re-read, a truncated file) adds nothing rather than
  // writing a smaller number over a real one.
  const totals = {
    tokensIn: Math.max(freshIn, stored?.tokensIn ?? 0),
    tokensOut: Math.max(freshOut, stored?.tokensOut ?? 0),
    cacheRead: Math.max(freshRead, stored?.cacheRead ?? 0),
    cacheCreate: Math.max(freshCreate, stored?.cacheCreate ?? 0),
  };
  const delta = {
    tokensIn: totals.tokensIn - (stored?.tokensIn ?? 0),
    tokensOut: totals.tokensOut - (stored?.tokensOut ?? 0),
    cacheRead: totals.cacheRead - (stored?.cacheRead ?? 0),
    cacheCreate: totals.cacheCreate - (stored?.cacheCreate ?? 0),
  };
  if (
    delta.tokensIn === 0 &&
    delta.tokensOut === 0 &&
    delta.cacheRead === 0 &&
    delta.cacheCreate === 0
  ) {
    return; // nothing new since the last tick
  }

  const boardId = session.boardId === '' ? null : session.boardId;
  const attributed =
    boardId === null ? null : (liveLeaseHolders(boardId, holders)?.get(session.owner) ?? null);

  kanbanLearningDb.upsertSessionUsage({
    sessionId: session.sessionId,
    boardId,
    // Provenance, and it survives a tick that found no card: the row remembers the card this
    // session's spend has been attributed to rather than blanking it between two builds.
    cardId: attributed ?? stored?.cardId ?? null,
    ...totals,
    byteOffset: mainOffset,
  });

  if (attributed !== null) {
    kanbanCardsService.addCardTokens(attributed, delta, { actor: 'telemetry' });
  }
}

/**
 * One telemetry pass over every running session. Never throws.
 *
 * Each session is tallied under its own guard so a fault on one — a corrupt transcript, a locked
 * database mid-write — still lets the others record. The registry read carries its own guard for
 * the same reason: an unguarded throw here would end the interval silently, and the cost chip
 * would simply stop moving with nothing in the journal to say why.
 *
 * `now` is the caller's clock rather than a second read of it, so the interval and a probe name
 * the same moment — and it is only ever used to stamp a line a reader will later want to date. No
 * staleness decision here consults it: the lease freshness this tick attributes on is computed
 * server-side, in the summary it reads.
 */
export function tickTelemetry(now: number): void {
  const registry = getLiveMetisRegistry();
  if (registry === null) return; // no Metis module in this process — nothing to count

  let running: KanbanMetisSession[];
  try {
    running = registry.list().filter((session) => session.state === 'running');
  } catch (error) {
    say('registry', `could not read the session registry, skipping this tick: ${describe(error)}`, now);
    return;
  }

  // Per tick, so one board's ladder is walked once however many sessions it holds.
  const holders = new Map<string, Map<string, string> | null>();

  for (const session of running) {
    try {
      tickSession(session, now, holders);
    } catch (error) {
      say(
        `tally:${session.sessionId}`,
        `tally for ${session.sessionId} failed, continuing: ${describe(error)}`,
        now
      );
    }
  }
}

/** One session's stored ledger row, or `null` when that session has never been counted. */
export function usageForSession(sessionId: string): KanbanSessionUsage | null {
  return kanbanLearningDb.getSessionUsage(sessionId);
}

/** The interval, so a second call is a no-op rather than a second watcher on the same tallies. */
let timer: NodeJS.Timeout | null = null;

/**
 * Starts the watcher. Called once from the Metis module's composition root, beside the driver.
 *
 * It ticks IMMEDIATELY, so a build already in flight at boot starts accruing on the first pass,
 * and the interval is unreferenced: a watcher is never a reason for the process to stay alive, and
 * a server that will not exit is a server the operator has to kill.
 */
export function startTelemetryWatcher(): void {
  if (timer !== null) return;
  const tick = (): void => tickTelemetry(Date.now());
  tick();
  timer = setInterval(tick, TELEMETRY_TICK_MS);
  timer.unref();
}
