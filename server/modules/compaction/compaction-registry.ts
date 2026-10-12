import type { ChatProcessActivity, ChatTurnReport, CompactionFacts } from '@/shared/types.js';

import { switchFlipCount } from './compaction-mode.js';

/**
 * One compaction run in progress for a chat, as the rest of the module sees it. The procedure owns the
 * object and moves `phase`; the decorator's `abort` and the triggers only read it.
 *
 * `stop` is replaced at each phase with what stopping means THERE: waking the guard, signalling the
 * verb's child, or aborting the seed append. `stopped` is set by every `stop`, and the procedure checks it
 * at each boundary, so a Stop that lands between two phases is not lost.
 */
export type CompactionFlight = {
  trigger: CompactionFacts['trigger'];
  phase: 'waiting' | 'summarizing' | 'seeding';
  stopped: boolean;
  stop: () => Promise<boolean>;
};

const flights = new Map<string, CompactionFlight>();

/** Registers a compaction as in flight for the chat; the caller ends it with `endFlight`. */
export function beginFlight(sessionId: string, trigger: CompactionFacts['trigger']): CompactionFlight {
  const flight: CompactionFlight = {
    trigger,
    phase: 'waiting',
    stopped: false,
    stop: async () => {
      flight.stopped = true;
      return true;
    },
  };
  flights.set(sessionId, flight);
  return flight;
}

/** Removes the chat's flight, but only if it is still THIS one (a later compaction may have replaced it). */
export function endFlight(sessionId: string, flight: CompactionFlight): void {
  if (flights.get(sessionId) === flight) flights.delete(sessionId);
}

/**
 * The chat's compaction in flight, or undefined. A flight the operator has already stopped is not in
 * flight: it stays registered until its verb has exited (up to the SIGKILL grace for a verb that ignores
 * SIGTERM), and a Stop of the NEXT turn in that window must reach `inner.abort`, not be answered by the
 * flight that was already stopped. Consumers: the decorator's abort, the triggers.
 */
export function flightOf(sessionId: string): CompactionFlight | undefined {
  const flight = flights.get(sessionId);
  return flight && !flight.stopped ? flight : undefined;
}

/**
 * Stops every compaction that has not yet started its seed append: a waiting guard ends, a running verb's
 * child gets its SIGTERM. A seed append is a real run, so it is left to finish with the drain. Called once, at
 * shutdown, so a verb is not orphaned on a process that is leaving.
 */
export function stopFlightsBeforeSeed(): void {
  for (const flight of flights.values()) {
    if (flight.phase !== 'seeding' && !flight.stopped) void flight.stop();
  }
}

// ---------------------------
// ACTIVITY EVENTS: the runtime's `activityChanged` hook, handed to whoever is waiting on a chat.

type ActivityListener = (activity: ChatProcessActivity) => void;
const activityListeners = new Map<string, Set<ActivityListener>>();

/** Subscribes to a chat's activity changes; returns the unsubscribe. Consumers: the guard. */
export function onActivityChanged(sessionId: string, listener: ActivityListener): () => void {
  let listeners = activityListeners.get(sessionId);
  if (!listeners) {
    listeners = new Set();
    activityListeners.set(sessionId, listeners);
  }
  listeners.add(listener);
  return () => {
    const held = activityListeners.get(sessionId);
    held?.delete(listener);
    if (held?.size === 0) activityListeners.delete(sessionId);
  };
}

/**
 * Hands one activity change to everyone waiting on the chat. A listener that throws is logged and the
 * others still hear it: the runtime wraps this call too, but one waiter must not starve another.
 */
export function publishActivity(sessionId: string, activity: ChatProcessActivity): void {
  for (const listener of [...(activityListeners.get(sessionId) ?? [])]) {
    try {
      listener(activity);
    } catch (error) {
      console.error('[compaction] an activity listener failed:', error instanceof Error ? error.message : error);
    }
  }
}

// ---------------------------
// AUTOMATIC REFUSALS: a chat the verb refused (exit 2 or 3) is left alone by the triggers until the
// operator presses Compact himself or flips the switch.

const refusedAt = new Map<string, number>();

/** Puts the chat under an automatic refusal, stamped with the switch's flip count at that moment. */
export function refuseAutomatic(sessionId: string): void {
  refusedAt.set(sessionId, switchFlipCount());
}

/** Whether the chat is under an automatic refusal now: one stamped before the switch last moved is over. */
export function isRefusedAutomatic(sessionId: string): boolean {
  const stamp = refusedAt.get(sessionId);
  if (stamp === undefined) return false;
  if (stamp !== switchFlipCount()) {
    refusedAt.delete(sessionId);
    return false;
  }
  return true;
}

/** A manual Compact lifts the chat's refusal. */
export function liftAutomaticRefusal(sessionId: string): void {
  refusedAt.delete(sessionId);
}

// ---------------------------
// LAST REPORT: the chat's context as its latest turn left it, for a manual compaction's `pre_tokens`.
// Kept in memory only: after a restart it is null until the chat's next turn ends.

const lastContexts = new Map<string, { contextTokens: number; contextWindow: number | null }>();

/** Keeps a report's context for the chat; a report that measured nothing leaves the earlier one. */
export function rememberTurnContext(report: ChatTurnReport): void {
  if (report.contextTokens === null) return;
  lastContexts.set(report.appSessionId, { contextTokens: report.contextTokens, contextWindow: report.contextWindow });
}

/** The chat's last measured context, or null (never reported by this server). */
export function lastContextTokens(sessionId: string): number | null {
  return lastContexts.get(sessionId)?.contextTokens ?? null;
}

/** The chat's last measured context and window, for a decision line written where no report is at hand. */
export function lastTurnContext(sessionId: string): { contextTokens: number | null; contextWindow: number | null } {
  return lastContexts.get(sessionId) ?? { contextTokens: null, contextWindow: null };
}

/** Forgets everything held for a chat that no longer exists. */
export function forgetSession(sessionId: string): void {
  flights.delete(sessionId);
  activityListeners.delete(sessionId);
  refusedAt.delete(sessionId);
  lastContexts.delete(sessionId);
}
