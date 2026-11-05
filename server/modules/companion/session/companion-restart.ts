import { answeredWithin } from './companion-process.js';

/**
 * What a server restart does to her conversation, from both servers of a handover (`deploy/dev-supervisor/README.md`). The two halves
 * change together: one decides what the retiring server does with the turn she is in, the other what the successor does with the words
 * that arrive while that turn finishes.
 *
 * THE RETIRING SERVER LETS HER TURN FINISH (`createTurnDrain`). A stop used to interrupt the turn at once, so a restart cut her off
 * mid-sentence and the successor answered his words again from the top. Now `finishTurn` waits for the turn in flight to end by
 * itself, at most `boundMs`; the caller then closes her process as it always did. A turn that does not end in the bound is interrupted
 * and its words are said again by the next process (the ledger, unchanged), and her last turn (her own compaction) is not waited for:
 * it falls back to the house summarizer, as designed. The wait is an event, the turn's end; the bound is one timer that ends it.
 *
 * THE SUCCESSOR HOLDS HER UNTIL IT IS THE SOLE SERVER (`createTakeoverHold`). The retiring server keeps her CLI until her turn is
 * over, and a second CLI resuming the same conversation beside it would fork the transcript and talk over the first. So a session born
 * on a handover boot holds every push until the takeover's resend (`resendUnanswered`) lifts it: his words are kept on disk at once
 * (the ledger) and said by the resend, in order; whatever is not his (an alert, the news of a chat) waits and goes after them.
 *
 * Consumers: `companion-session.ts` (both), one of each per account.
 */

/** What the drain reads of the session: whether a turn is in the CLI, whether it is her last one, and the alerts to drop. */
type TurnDrainHooks = {
  /** A turn is in the CLI: the tracker's turn in flight, or a stop whose result is not in yet. */
  turnInFlight(): boolean;
  /** Her last turn is running: it is not a turn of his, and a stop falls back to the house summarizer as before. */
  inLastTurn(): boolean;
  /** Alerts kept for her turn are dropped: none may start a new turn while the old one ends. */
  dropAlerts(): void;
};

/** Consumed by `companion-session.ts`, once per account: `finishTurn` is the session's, `draining` keeps her last turn from starting, `settled` is told whenever a turn or a stop's wait has ended. */
export function createTurnDrain(userId: number, hooks: TurnDrainHooks) {
  let draining = false;
  let settle: () => void = () => undefined;
  // The one wait, shared by every call: a second stop signal in the window (the supervisor's and systemd's) joins it, so each caller wakes when the turn ends and one journal line tells how it ended.
  let waiting: Promise<void> | null = null;

  async function waitForEnd(boundMs: number): Promise<void> {
    console.log(`[Companion] account ${userId}: the server is stopping; her turn in flight is let to finish (at most ${boundMs / 1000} s)`);
    const ended = await answeredWithin(new Promise<true>((resolve) => { settle = () => resolve(true); }), boundMs);
    settle = () => undefined;
    console.log(
      ended
        ? `[Companion] account ${userId}: her turn finished before her process closed`
        : `[Companion] account ${userId}: her turn did not finish within ${boundMs / 1000} s; it is stopped, and the next process says his words again`
    );
  }

  return {
    /** True from the first `finishTurn` on: the server is stopping, so a turn's end begins nothing (no last turn). */
    get draining(): boolean {
      return draining;
    },
    /** A turn ended or a stop was answered: if that leaves no turn in the CLI, the wait is over. */
    settled(): void {
      if (!hooks.turnInFlight()) settle();
    },
    /** Resolves when her turn in flight has ended, at `boundMs`, or at once when there is none to wait for or it is her last turn. Closes nothing. A second call joins the wait the first began. */
    async finishTurn(boundMs: number): Promise<void> {
      draining = true;
      hooks.dropAlerts();
      if (hooks.inLastTurn() || !hooks.turnInFlight()) return;
      waiting ??= waitForEnd(boundMs);
      await waiting;
    },
  };
}

/**
 * Consumed by `companion-session.ts`, once per account. `awaiting` is true for a session born on a handover boot (its predecessor still
 * answers). `standing` says the hold is up; `park` keeps `run` for the lift; `lift` ends the hold and runs what was parked, in order
 * (a second call does nothing); `abandon` drops what was parked and leaves the hold standing (Clear, a close: a push after it still waits for the takeover, and his words are kept on disk). A `run` must not
 * throw: the caller guards it, so one that fails cannot lose those behind it.
 */
export function createTakeoverHold(awaiting: boolean) {
  let parked: Array<() => void> | null = awaiting ? [] : null;
  return {
    standing: (): boolean => parked !== null,
    park(run: () => void): void {
      parked?.push(run);
    },
    lift(): void {
      const waiting = parked ?? [];
      parked = null;
      for (const run of waiting) run();
    },
    abandon(): void {
      if (parked !== null) parked = [];
    },
  };
}
