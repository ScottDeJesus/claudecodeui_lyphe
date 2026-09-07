import type { Tone } from '@/shared/types';

/**
 * What a tool row can truthfully say about itself once the facts are in.
 *
 * `waiting` and `approved` outrank `automatic` on purpose. A row that is blocked
 * on a person has not been "done automatically", and neither has one the person
 * personally allowed — saying so about either is the one wrong thing this badge
 * could say (design handoff §5: say what ran on its OWN).
 */
export type ToolOutcome = 'waiting' | 'approved' | 'finished' | 'automatic';

/** What the permission layer knows about one tool call right now. */
export type ToolPermissionState = 'idle' | 'waiting' | 'prompted';

/** The mark that carries the outcome when the colour does not (doctrine §6). */
export const TOOL_OUTCOME_GLYPH: Record<ToolOutcome, string> = {
  automatic: '≔',
  waiting: '▲',
  approved: '✓',
  finished: '✓',
};

/** The tone each outcome is painted in — a token swap, never a colour of its own. */
export const TOOL_OUTCOME_TONE: Record<ToolOutcome, Tone> = {
  automatic: 'neutral',
  waiting: 'warn',
  // Neutral, not positive: a person answering a prompt is not an achievement to
  // celebrate, it is a fact about who decided. Positive stays with a command
  // that ran and came back.
  approved: 'neutral',
  finished: 'positive',
};

/**
 * A stable identity for one tool call, used to line a transcript row up with the
 * permission prompt raised for it.
 *
 * It has to be BUILT rather than read: the `permission_request` event carries
 * `requestId`, `toolName` and `input` and no tool-use id
 * (claude-runtime.provider.js:835), so the input is the identity. Keys are
 * sorted at every depth because the two sides arrive by different routes — one
 * off the socket, one re-serialized through the transcript — and JSON key order
 * is not a promise either of them makes.
 */
export function permissionKey(toolName: string | undefined, input: unknown): string {
  const parsed = typeof input === 'string' ? safeParse(input) : input;
  return `${toolName ?? ''}::${stableStringify(parsed)}`;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

type DeriveToolOutcomeArgs = {
  /** What the permission layer knows about this call. */
  permissionState: ToolPermissionState;
  /** The provider has sent a result for this call. */
  hasResult: boolean;
  /** That result reports a failure — an outcome none of these words describe. */
  isError: boolean;
  /** Shell tools get the louder "finished": they RAN something, they did not just read. */
  isShellCommand: boolean;
};

/**
 * The outcome to show, or null when there is nothing positive to say yet.
 *
 * Null is a real answer and not a gap to fill: a call still running with nobody
 * waiting on it, and a call that failed, are both states the existing
 * ToolStatusBadge already names. Inventing another word for them here would put
 * two vocabularies on one row.
 *
 * ⚠ `prompted` is known only while the session that answered the prompt is still
 * open. A transcript records that a tool ran, never that a person was asked, so a
 * reloaded conversation shows that same call as "Done automatically". That is the
 * limit of the evidence on disk, not a claim this function is making.
 */
export function deriveToolOutcome({
  permissionState,
  hasResult,
  isError,
  isShellCommand,
}: DeriveToolOutcomeArgs): ToolOutcome | null {
  if (permissionState === 'waiting') return 'waiting';
  if (!hasResult || isError) return null;
  if (permissionState === 'prompted') return 'approved';
  return isShellCommand ? 'finished' : 'automatic';
}
