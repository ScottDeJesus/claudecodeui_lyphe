/**
 * The one timer a delegated run gets, and the two deadlines it serves.
 *
 * Kept apart from the store because it is the piece with no opinion about runs: it counts, and
 * calls back. The store decides what silence means.
 */

/**
 * How long the run may say NOTHING before the store asks whether it is still going.
 *
 * It is not a verdict on its own: a single Bash call is silent for its whole duration (measured on
 * this host — a 20-second command produced exactly zero frames), so silence alone cannot tell a
 * dead socket from a slow `git push`. What follows the silence is a question, not a conclusion.
 *
 * ⚠ A floor, not a bound. Browsers clamp timers in a hidden tab, so a backgrounded page reaches
 * this later than 120s. Live frames are unaffected — only the verdict is late, which is the safe
 * direction for a verdict that ends a run's narration.
 */
const SILENCE_LIMIT_MS = 120_000;

/** How long the gateway gets to answer that question before the socket is treated as gone. */
const PROBE_ACK_LIMIT_MS = 10_000;

let timer: number | null = null;

export function clearWatchdog(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

/** Waits out the silence the run is allowed, then hands over to `onSilence`. */
export function armSilence(onSilence: () => void): void {
  clearWatchdog();
  timer = window.setTimeout(onSilence, SILENCE_LIMIT_MS);
}

/** Waits for an answer to the question the silence raised. No answer is the only real verdict. */
export function armProbeDeadline(onNoAnswer: () => void): void {
  clearWatchdog();
  timer = window.setTimeout(onNoAnswer, PROBE_ACK_LIMIT_MS);
}
