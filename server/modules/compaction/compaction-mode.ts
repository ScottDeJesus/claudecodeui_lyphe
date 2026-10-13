import { stat } from 'node:fs/promises';

import { readCustomCompactionSwitch, summarizerStatus } from '@/modules/settings/index.js';
import type { SummarizerStatus } from '@/modules/settings/index.js';

import { taskLedgerUnlisted } from './node-task-ledger.js';

/**
 * Whether the house's compaction has a chat, and why not when it has not.
 *
 * `on` is the ONE fact the rest of the module acts on: the switch reads on AND the summarizer is ready.
 * The other four describe the summarizer for a log line or a status frame; they are `null` whenever the
 * switch is off, because nothing was asked of the verb then.
 */
export type CompactionMode = {
  on: boolean;
  model: string | null;
  effort: string | null;
  ready: boolean | null;
  why: string | null;
};

const SWITCH_OFF: CompactionMode = { on: false, model: null, effort: null, ready: null, why: null };

// The summarizer's status, as the verb last said it, and the ask now in flight for a fresh one.
// Single-flight: every message launch asks `takesOver` twice, and a burst of them must cost ONE verb
// process, not a burst of Python starts.
let cachedStatus: SummarizerStatus | null = null;
let statusAsk: Promise<SummarizerStatus | null> | null = null;

// The switch's position as the last read saw it, and how many times it has been seen to move. A
// session under an automatic refusal stays under it only while this number stands where it did
// (`compaction-registry.ts`), which is how "until a flip of the switch" is kept with no listener.
let lastSwitchPosition: boolean | null = null;
let switchFlips = 0;

// What the most recent `compactionMode()` concluded, for the one reader that cannot wait for an
// answer (`takeoverSnapshot`).
let lastMode: CompactionMode | null = null;

/**
 * Whether the binary the cached status was derived from is still the file on disk: same size and
 * mtime. `mtime_ns` is past 2^53, so BOTH sides pass through `Number(...)` — the status's came out
 * of JSON as the nearest double to the integer, and `Number(bigint)` rounds the same integer the
 * same way. A path that cannot be stat'd (the install moved) is a binary that changed.
 */
async function binaryIsUnchanged(cli: SummarizerStatus['cli']): Promise<boolean> {
  try {
    const found = await stat(cli.path, { bigint: true });
    return Number(found.size) === cli.size && Number(found.mtimeNs) === cli.mtime_ns;
  } catch {
    return false;
  }
}

/** Asks the verb, sharing an ask already in flight. A failed ask (null) is never kept. */
function askStatus(): Promise<SummarizerStatus | null> {
  statusAsk ??= summarizerStatus()
    .then((status) => {
      cachedStatus = status;
      return status;
    })
    .finally(() => {
      statusAsk = null;
    });
  return statusAsk;
}

/**
 * The status to act on: a cached READY status while its binary is unchanged, else a fresh ask. Invalidated
 * by the binary's identity, by the verb's own answers (`noteVerbNotReady`) and by a flip of the switch —
 * events, never a clock: nothing re-asks on a timer.
 *
 * A not-ready status is never served from the cache. The binary is not the only thing readiness hangs on:
 * the operator fixes the summarizer's words in Edit Agent Chains, which moves neither the binary nor the
 * switch, and a cached "not ready" would keep every chat on the CLI's compaction while the Settings row
 * (which asks afresh) already reads ready. While not ready, each launch asks once (single-flighted, ~0.25 s).
 */
async function currentStatus(): Promise<SummarizerStatus | null> {
  if (cachedStatus?.ready && (await binaryIsUnchanged(cachedStatus.cli))) return cachedStatus;
  return askStatus();
}

/** Remembers where the switch stood; a move drops the cached status, so a flip is also a retry. */
function noteSwitchPosition(position: boolean): void {
  if (lastSwitchPosition !== null && lastSwitchPosition !== position) {
    switchFlips += 1;
    cachedStatus = null;
  }
  lastSwitchPosition = position;
}

/**
 * Reads the switch (at EVERY call) and, when it is on, the summarizer's status. A status that could
 * not be asked is `ready: null` and not on: the chat keeps the CLI's own compaction, and the next call
 * asks again.
 *
 * Consumer: `takesOver` below, and the compaction procedure's log lines.
 */
export async function compactionMode(): Promise<CompactionMode> {
  const enabled = await readCustomCompactionSwitch();
  noteSwitchPosition(enabled);
  if (!enabled) {
    lastMode = SWITCH_OFF;
    return SWITCH_OFF;
  }
  const status = await currentStatus();
  lastMode = status
    ? { on: status.ready, model: status.model, effort: status.effort, ready: status.ready, why: status.why || null }
    : { on: false, model: null, effort: null, ready: null, why: 'the summarizer status could not be read' };
  return lastMode;
}

/**
 * The runtime's question, asked at every message launch: is this chat's compaction taken over? Any chat with
 * an app session id can be, wherever its CLI runs. A chat placed on a Cerberus node is taken over exactly as a
 * local one: the verb reads the transcript from this machine's disk, and a node chat's transcript is on it,
 * because placement refuses a node that is not co-located (`node-transport.ts`, `colocationRefusal`) and the
 * warden, its session host and this server all run as the same user. The one node chat that is not taken over is
 * one whose warden lists no live tasks (`taskLedgerUnlisted`): a compaction could not tell it from a quiet chat.
 *
 * Consumer: the Claude runtime, through `ChatCompactionHooks.takesOver`; the idle trigger.
 */
export async function takesOver(input: { appSessionId: string | null }): Promise<boolean> {
  return input.appSessionId !== null && !taskLedgerUnlisted(input.appSessionId) && (await compactionMode()).on;
}

/**
 * The last answer `compactionMode()` gave, or null before there was one — without waiting for a new
 * one. The turn-end trigger needs it: it must start its run in the same synchronous tick as the turn's
 * `complete`, before the queued-message pass (a `setImmediate`) can take the session's reservation, and
 * an awaited switch read would lose that race. The snapshot is as fresh as the message that started the
 * turn, which asked `takesOver` at its launch; the run itself asks again (the decorator ends an
 * automatic run that is no longer taken over with nothing done).
 *
 * Consumer: auto-trigger.ts.
 */
export function takeoverSnapshot(): boolean | null {
  return lastMode === null ? null : lastMode.on;
}

/** How many times the switch has been seen to move; see `lastSwitchPosition`. Consumer: compaction-registry.ts. */
export function switchFlipCount(): number {
  return switchFlips;
}

/**
 * Records a fresh status the procedure asked for (the words may have changed since the cache was
 * filled; the operator edits them in Edit Agent Chains, which is no change of the binary). A failed
 * ask (null) is not recorded.
 *
 * Consumer: compaction-procedure.ts.
 */
export function noteSummarizerStatus(status: SummarizerStatus | null): void {
  if (status) cachedStatus = status;
}

/**
 * A verb that answered exit 3 has said the installed Claude Code cannot serve the summarizer: the
 * cached status becomes not-ready with the verb's own sentence, and the next launch asks afresh (see
 * `currentStatus`), so the sentence stands only until then.
 *
 * Consumer: compaction-procedure.ts.
 */
export function noteVerbNotReady(sentence: string): void {
  if (cachedStatus) cachedStatus = { ...cachedStatus, ready: false, why: sentence };
  lastMode = { on: false, model: cachedStatus?.model ?? null, effort: cachedStatus?.effort ?? null, ready: false, why: sentence };
}
