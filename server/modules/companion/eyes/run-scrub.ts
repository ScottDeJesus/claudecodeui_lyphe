/**
 * What a run's own text must not carry to her (operator ruling 1: "Never usage or spend"), cut after the launcher's reader has
 * cut the report's `  cost:` line. PURE text work, no I/O.
 *
 * A chain's report and `walker.out` hold more than the cost line: the `built:` line says which PROVIDER the builder ran on
 * (`hephaestus on claude`), a `flags:` line says when a stage hit a usage limit and when it resets (the pacer's window), and a
 * failed chain's `cause` can be that same sentence. A stage's timeout flag and a timed-out soul's cause carry the stage's RUNTIME
 * (`wall 3604s past cap 3600s`) and the wait before its relaunch (`after 60s`), which are runtime figures. None of those is hers to
 * say; each is cut here, in every text the run reads hand over. The `also:` line, which lists every file the walk dirtied, is cut
 * to a length a person can hold.
 *
 * Consumers: `run-scopes.ts` (every `read_run` scope).
 */

/** A line that opens with `cost:` (any indent): the launcher's reader cuts these already; this is the second fence. */
const COST_LINE = /^\s*cost:/i;

/** A line that speaks of a usage or rate limit and its reset: the pacer's window, not a fact about the run. */
const LIMIT_LINE = /usage limit|rate limit|resets \d/i;

/** The `built:` line's provider: `built:  hephaestus on claude · 5 files` → `built:  hephaestus · 5 files`. */
const BUILT_PROVIDER = /^(\s*built:\s+\S+) on \S+/;

/** The longest `also:` line she is handed: the count and the first files say it; the rest is a list of paths. */
const ALSO_LINE_MAX = 240;

/** The walker's clock in a stage's flag, with its lead: `— wall 3604s past cap 3600s`. The fact that the stage timed out stays; the seconds go. */
const WALL_CLOCK_FLAG = /\s*—\s*wall \d+(?:\.\d+)?s past cap \d+(?:\.\d+)?s/g;

/** The wait before a relaunch, `after 60s` (a count of retries, `after 3 retries`, has no `s` on its number and stays). */
const RELAUNCH_WAIT = /\s+after \d+(?:\.\d+)?s\b/g;

/** The same wall-clock figures standing alone, as a soul's cause words them (`wall 3601s past cap 3600s`). */
const WALL_CLOCK_CAUSE = /wall \d+(?:\.\d+)?s past cap \d+(?:\.\d+)?s/g;

/** What a timed-out soul's cause becomes: that it ran out of time, not for how long. */
const TIMEOUT_CAUSE = 'it ran past its time cap';

/** The sentence a failed run's cause becomes when it was a usage limit: the fact that it stopped, not the window it stopped at. */
const LIMIT_CAUSE = 'it hit a limit and was not relaunched';

/**
 * A chain report or a stretch of `walker.out` without cost, provider or usage-limit lines, its `also:` line shortened.
 * Consumed by `run-scopes.ts` for the `result`, `findings` and `log` scopes.
 */
export function scrubReport(report: string): string {
  return report
    .split('\n')
    .filter((line) => !COST_LINE.test(line) && !LIMIT_LINE.test(line))
    .map((line) => line.replace(BUILT_PROVIDER, '$1').replace(WALL_CLOCK_FLAG, '').replace(RELAUNCH_WAIT, ''))
    .map((line) => (/^\s*also:/.test(line) && Array.from(line).length > ALSO_LINE_MAX ? `${Array.from(line).slice(0, ALSO_LINE_MAX - 1).join('')}…` : line))
    .join('\n');
}

/**
 * A soul's report or a reviewer's file without any line that opens with `cost:` — the one cut a document of the agent's own
 * words takes, since it has no `built:` or `flags:` line. Consumed by `run-scopes.ts`.
 */
export function scrubDocument(text: string): string {
  return text
    .split('\n')
    .filter((line) => !COST_LINE.test(line))
    .join('\n');
}

/**
 * A failed run's cause as she may say it: a usage limit becomes the plain fact that the run hit a limit, and the wall-clock seconds of a
 * timeout become "it ran past its time cap"; any other cause stands as written. Consumed by `run-scopes.ts`.
 */
export function scrubCause(cause: string): string {
  return LIMIT_LINE.test(cause) ? LIMIT_CAUSE : cause.replace(WALL_CLOCK_CAUSE, TIMEOUT_CAUSE);
}

/**
 * `text` folded to one line and cut to at most `max` characters, as a person counts them, ending "…" when it was cut. A task's title is a
 * sentence of the design's own; a line or a head names it by its first words. Consumed by `run-list.ts` and `run-scopes.ts`.
 */
export function clipText(text: string, max: number): string {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim());
  return characters.length <= max ? characters.join('') : `${characters.slice(0, max - 1).join('')}…`;
}
