/**
 * What a Claude `result` message that ENDED A TURN IN ERROR says, in words for a person.
 *
 * The CLI answers a turn it could not finish with a `result` whose subtype is not `success`
 * (`error_during_execution`, `error_max_turns`, `error_max_budget_usd`,
 * `error_max_structured_output_retries`). Such a result carries the cause in `errors`, and nothing
 * else on the stream says it: the normalizer turns a `result` into no row at all. The runtime reads
 * it here to put the cause on the page, and `claude-runtime-signals.ts` reads its `errors` for the
 * push and asks `endedByInterrupt` before raising one, so the page and the push say the same thing
 * about the same failure, and say nothing about the same interrupt.
 *
 * Two results that are not this module's business, on purpose:
 * - `subtype: 'success'` with `is_error: true` is a turn that ended on an API error. The CLI has
 *   already put the error on the stream as an assistant message ("API Error: …", measured in a
 *   host journal), so a row here would say it twice.
 * - A turn that ended because it was INTERRUPTED answers with `error_during_execution` too, and
 *   `terminal_reason: 'aborted_streaming'` (measured: the result that follows "[Request interrupted
 *   by user]"). It is the person's own Stop, not a failure to tell them about.
 */

/** The CLI's own instrumentation line inside a failed result's `errors`: not a cause. */
const INTERNAL_DIAGNOSTIC_PREFIX = '[ede_diagnostic]';

/** The `terminal_reason`s of a turn that ended because something interrupted it. */
const INTERRUPT_TERMINAL_REASONS = new Set(['aborted_streaming', 'aborted_tools']);

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The causes a failed result names, without the CLI's own instrumentation line. Empty when the
 * result names none.
 *
 * Consumers: this file's `describeErrorResult`, and `claude-runtime-signals.ts` (the text of the
 * `run.failed` push), so the push and the page's row never word one failure two ways.
 */
export function resultErrorLines(message: Record<string, unknown>): string[] {
  if (!Array.isArray(message.errors)) return [];
  return message.errors
    .map((entry) => String(entry))
    .filter((entry) => !entry.startsWith(INTERNAL_DIAGNOSTIC_PREFIX));
}

/**
 * Whether a `result` is the CLI's answer to an interrupt (the person's Stop, a denied tool, an
 * Escape in the terminal): a turn that was ended on purpose, never one that failed. Read off the
 * result itself, so it holds for a process the runtime holds no abort mark for.
 *
 * Consumers: this file's `describeErrorResult` (no page row for it) and `claude-runtime-signals.ts`
 * (no `run.failed` push for it).
 */
export function endedByInterrupt(message: Record<string, unknown>): boolean {
  return INTERRUPT_TERMINAL_REASONS.has(String(message.terminal_reason));
}

/**
 * What to tell the page about a turn the CLI ended in error, or `null` when the result is not one:
 * a success (including the API-error shape the stream already reported), or a turn that was
 * interrupted. The text is the cause the CLI gave, or, when it gave none, what the subtype says.
 *
 * Consumer: `claude-runtime.provider.js` (the result handler that closes a turn), which sends it as
 * an `error` row ahead of the run's one `complete`.
 */
export function describeErrorResult(message: Record<string, unknown>): string | null {
  const subtype = readText(message.subtype);
  if (message.type !== 'result' || subtype === null || subtype === 'success') return null;
  if (endedByInterrupt(message)) return null;

  const causes = resultErrorLines(message);
  if (causes.length > 0) return causes.join('; ');

  switch (subtype) {
    case 'error_max_turns': {
      const turns = readNumber(message.num_turns);
      return turns === null ? 'The turn stopped at its limit on turns.' : `The turn stopped at its limit of ${turns} turns.`;
    }
    case 'error_max_budget_usd': {
      const spent = readNumber(message.total_cost_usd);
      return spent === null ? 'The turn stopped at its spending limit.' : `The turn stopped at its spending limit ($${spent.toFixed(2)} spent).`;
    }
    case 'error_max_structured_output_retries':
      return 'The turn stopped: the structured output kept failing its checks.';
    default:
      return `The turn failed (${subtype}), and Claude Code gave no reason.`;
  }
}
