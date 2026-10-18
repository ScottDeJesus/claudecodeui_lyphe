import { sessionCompactionsDb } from '@/modules/database/index.js';
import type { ChatTurnReport } from '@/shared/types.js';

/**
 * THE IDLE DEADLINE A RESTART MUST NOT COST. The deadline is a timer in the server's memory, so every restart
 * and handover (the dev server hands over on each save under `server/`) drops all of them. A chat with a
 * deadline still to come always has a live host — its process is closed after 120 minutes without a message and
 * the idle wait is 54 — and the boot re-adopts exactly those hosts, so the runtime reads each adopted host's
 * last turn end off its journal and the trigger arms the deadline again from it (`turnRestored`).
 *
 * This file is the decision, apart from the timers `auto-trigger.ts` keeps: when the deadline is owed, when it
 * falls, and how many starts one turn end may have. The chat's own gates (floor, takeover, a run, busy, a flight,
 * a refusal) stay in `fireIdleDeadline`.
 *
 * Consumer: auto-trigger.ts.
 */

/**
 * How long after re-adoption an overdue check waits. The adopted process registers its handle and replays
 * what the previous server never acknowledged in the first seconds; a turn that ends in that replay arms the
 * chat's own deadline (which this restore then gives way to), and only after it does the chat's activity
 * read what the process is really doing.
 */
const RESTORE_SETTLE_MS = 15_000;

/**
 * How far apart the overdue chats of one boot are started. Every chat left past its deadline across a restart is
 * owed its check at the same moment, and each start is a summarizer call that can run to 600,000 tokens followed
 * by a process replacement, in the first seconds after a dev-server save: they are queued behind one another at
 * this spacing instead of beginning together.
 */
const RESTORE_SPACING_MS = 30_000;

/**
 * How many times one turn end's idle check may start a compaction: the first, and one more when a handover cut
 * the first short. A start that fails or is refused is the limit at once (the procedure records it so). The count
 * lives in the chat's host meta (`idleCheck`, the one record of it) and is cleared by the next turn end, so a restart
 * cannot repeat the check without bound.
 *
 * Consumer: auto-trigger.ts (counts each start), compaction-procedure.ts (a failure or a refusal spends the rest).
 */
export const IDLE_CHECK_MAX_TRIES = 2;

/**
 * Spaces the overdue restores of one boot: the first starts after the settle, the next `RESTORE_SPACING_MS` after it,
 * and so on. A restore with time left on its wait is not asked about: it fires at its own moment, as it would have
 * without the restart. Answers the delay to arm, from `now`. One spacer per trigger, so the queue is the boot's.
 *
 * Consumer: auto-trigger.ts.
 */
export function createRestoreSpacer(): (delayMs: number, now: number) => number {
  let nextFreeAt = 0;
  return (delayMs, now) => {
    const startAt = Math.max(now + delayMs, nextFreeAt);
    nextFreeAt = startAt + RESTORE_SPACING_MS;
    return startAt - now;
  };
}

/**
 * What a restore decided: whether to arm, the decision line, and whether the report's context still describes the chat
 * (`current: false` when the chat was compacted after the turn the report was read from).
 */
type IdleRestorePlan =
  | { arm: true; delayMs: number; say: string; current: true }
  | { arm: false; say: string; current: boolean };

/** A span in the words a log line quotes: seconds under a minute and a half, minutes under two hours, else hours. */
function describeSpan(milliseconds: number): string {
  const seconds = Math.round(Math.abs(milliseconds) / 1000);
  if (seconds < 90) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 120 ? `${minutes} min` : `${(minutes / 60).toFixed(1)} h`;
}

/**
 * Whether a re-adopted chat is owed its idle deadline, and when it falls: the last turn's end plus the idle wait,
 * or — when that moment has passed — the settle after re-adoption, queued behind the other overdue chats of the boot.
 *
 * A chat is not owed one when its last turn measured no context (a compaction's seed append runs no request, and a
 * seed append arms nothing), when the chat was compacted at or after the turn's end, when the idle check has already
 * started its limit of compactions for this turn end (`rules.idleTries`, from the host's meta), or when that context is
 * under the idle floor. The compaction case is the trap: the turn's size is stale, the chat stands at the compaction's own
 * `postTokens`, and a restore that went on from the stale size would compact it a second time, on every restart
 * after. A compaction seeds a NEW process, so its host's journal begins after the swap and its last turn is the seed
 * append's (no context); the record's time is the second line, for a chat whose old host outlived its retirement.
 *
 * Consumer: auto-trigger.ts (`turnRestored`).
 */
export function planIdleRestore(
  report: ChatTurnReport,
  endedAt: number,
  rules: {
    now: number;
    idleAfterMs: number;
    minTokens: number;
    idleTries: number;
    spacer: (delayMs: number, now: number) => number;
  },
): IdleRestorePlan {
  const { contextTokens } = report;
  if (contextTokens === null) {
    return { arm: false, current: true, say: 'no deadline restored: the last turn made no request, so it measured no context' };
  }
  // The record's time is whole seconds, so it names the START of the second the swap was written in: the swap may have
  // landed up to a second later, and a turn that ended inside that second is read as before it. Wrongly skipping a restore
  // costs one deadline; wrongly compacting twice costs a summarizer call and a chat's history.
  const latest = sessionCompactionsDb.latestCompaction(report.appSessionId);
  if (latest !== null && latest.compactedAtMs + 1000 > endedAt) {
    return {
      arm: false,
      current: false,
      say: `no deadline restored: the chat was compacted after its last turn (its context is now ${latest.postTokens ?? 'unmeasured'})`,
    };
  }
  if (rules.idleTries >= IDLE_CHECK_MAX_TRIES) {
    return {
      arm: false,
      current: true,
      say: `no deadline restored: the idle check has already started ${rules.idleTries} of its ${IDLE_CHECK_MAX_TRIES} compactions for this turn end`,
    };
  }
  if (contextTokens < rules.minTokens) {
    return { arm: false, current: true, say: `no deadline restored: the context is under ${rules.minTokens} tokens` };
  }
  // Never later than a whole wait: a clock that moved back must not push a deadline past the one a turn end would arm.
  const dueIn = Math.min(endedAt + rules.idleAfterMs - rules.now, rules.idleAfterMs);
  const ago = describeSpan(rules.now - endedAt);
  if (dueIn >= RESTORE_SETTLE_MS) {
    return { arm: true, current: true, delayMs: dueIn, say: `deadline restored after a restart: the last turn ended ${ago} ago, the check is due in ${describeSpan(dueIn)}` };
  }
  const delayMs = rules.spacer(RESTORE_SETTLE_MS, rules.now);
  return {
    arm: true,
    current: true,
    delayMs,
    say: `deadline restored after a restart, already due: the last turn ended ${ago} ago, the check runs in ${describeSpan(delayMs)}`,
  };
}
