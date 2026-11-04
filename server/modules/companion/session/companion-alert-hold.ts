import type { SessionAlert } from './companion-session-types.js';
import { guarded } from './guarded-callback.js';

/**
 * Alerts are said at the LAST MOMENT, and an alert that was answered before that moment is never said.
 *
 * An alert about a prompt (an Accept, a chat's tool permission) says "this is waiting on him". Between the house raising it and her
 * speaking it, he can answer it: inside the alert feed's three-second gather window, or while she is mid-sentence and the alert waits
 * for her. The CLI cannot take a message back once it has been given one, so the question "is this still open?" has to be asked at the
 * last moment the house controls, which is the moment the message is assembled for the CLI (`companion-session.ts`'s `deliver`), and
 * a message that waits (behind her closing, a handover, a stop) is built only when its wait is over.
 *
 * TWO PARTS, BOTH HERE:
 *   - `lastMomentBody` turns a batch of alerts into the body of ONE message that is read when it is given: the alerts that are no longer
 *     owed are dropped silently, the rest are told (`told`, which writes the panel's row) and joined. Nothing left to say is `null`, and
 *     the session then gives nothing and wakes nothing. A check that throws leaves its alert in: an alert is never lost for a question
 *     that could not be answered.
 *   - `createAlertHold` keeps the alerts that CAN be answered while a turn of hers is in flight, and gives them when the turn has ended (and
 *     none has begun in its place). A message given to the CLI mid-turn is queued there, folded into the turn at its next step or run
 *     after it, and nothing can retract it, so an alert pushed then would be said without a last look. An alert that cannot be answered
 *     (a failure, a landing: nothing in it to retract) goes at once, as before, even when it shares its window with one that can, so a
 *     failure is never held behind a sentence; the two then reach her as two messages.
 *
 * The hold never stands in front of her closing, which parks every push itself and says it after her fresh start. What is held outlives
 * the launch it was held under: a launch that ends before its turn does (a failure, a refused resume, an interrupt it never answered)
 * leaves the alerts for the next one, given at once and judged at that moment like any other, so a prompt that is still open is not lost
 * to her for the length of a turn. Two ends are deliberate and drop what is held (`abandon`, one journal line): Clear, which makes her
 * forget, and the session's own `close`, which is the server stopping and must not wake a new process. It ends on an event, the turn's
 * end, and nothing polls.
 *
 * Consumer: `companion-session.ts`, which builds one hold per account and routes `pushAlerts` through it.
 */

/**
 * A message body read when the message is finally given to the CLI, not when it was pushed: `null` when there is nothing left to say, in
 * which case the push is dropped whole. Consumed by `companion-session.ts` (`push` and `deliver` take it beside a plain string).
 */
export type LateBody = () => string | null;

/** Whether `alert` still needs saying: one with no check always does, and a check that throws is read as "yes". */
function stillOwed(userId: number, alert: SessionAlert): boolean {
  if (alert.owed === undefined) return true;
  try {
    return alert.owed();
  } catch (error) {
    console.error(`[Companion] account ${userId}: could not tell whether an alert is still open, so it is said`, error);
    return true;
  }
}

/** The body of one message for `alerts`, read when it is given (see the head of this file). */
function lastMomentBody(userId: number, alerts: readonly SessionAlert[]): LateBody {
  return () => {
    const owed = alerts.filter((alert) => stillOwed(userId, alert));
    const answered = alerts.length - owed.length;
    if (answered > 0) console.log(`[Companion] account ${userId}: ${answered} of ${alerts.length} alert(s) were answered before she could say them and were dropped`);
    if (owed.length === 0) return null;
    // The panel's row is a record of what she was told: it is written as the alert goes into her message, never for one that was dropped.
    for (const alert of owed) guarded('alert told', userId, alert.told)();
    return owed.map(({ envelope }) => envelope).join('\n');
  };
}

/** What `createAlertHold` answers; the session holds one per account. */
type AlertHold = {
  /** A batch of alerts arrived: given at once, or, when she is mid-turn, its answerable alerts are kept until her turn ends. */
  say(alerts: readonly SessionAlert[]): void;
  /** A turn of hers ended: what was kept is given if none is in flight now. Called OUTSIDE the turn tracker's own call (it is a microtask away), because giving starts a turn. */
  turnEnded(): void;
  /** Her conversation is being cleared or the session closed on purpose: what was kept is dropped, never given to a process that wakes after. */
  abandon(): void;
};

/**
 * What the hold reads of the session, each at the moment it is asked: whether a turn is in flight (`busy`, never true with no process),
 * whether her closing is holding pushes itself (`parks`) and how a body is given to the conversation (`give`, the session's own push).
 * Consumed by `companion-session.ts`.
 */
type AlertHoldHooks = {
  userId: number;
  busy(): boolean;
  parks(): boolean;
  give(body: LateBody): void;
};

/** Consumed by `companion-session.ts`: one hold per account's conversation. */
export function createAlertHold(hooks: AlertHoldHooks): AlertHold {
  const { userId } = hooks;
  let held: SessionAlert[] = [];

  return {
    say(alerts) {
      const answerable = alerts.filter((alert) => alert.owed !== undefined);
      if (answerable.length === 0 || !hooks.busy() || hooks.parks()) {
        hooks.give(lastMomentBody(userId, alerts));
        return;
      }
      // Mid-turn: what cannot be answered has nothing to retract and goes now, what can waits for the turn to end.
      const unanswerable = alerts.filter((alert) => alert.owed === undefined);
      if (unanswerable.length > 0) hooks.give(lastMomentBody(userId, unanswerable));
      held.push(...answerable);
    },
    turnEnded() {
      if (held.length === 0 || hooks.busy()) return;
      const waiting = held;
      held = [];
      hooks.give(lastMomentBody(userId, waiting));
    },
    abandon() {
      if (held.length === 0) return;
      console.log(`[Companion] account ${userId}: ${held.length} alert(s) held for her turn were dropped: her conversation was cleared or closed`);
      held = [];
    },
  };
}
