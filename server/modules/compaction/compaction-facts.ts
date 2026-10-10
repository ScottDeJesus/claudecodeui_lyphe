import type { CompactionFacts } from '@/shared/types.js';

import type { VerbAnswer } from './compaction-children.js';

/**
 * Reading what `summarize` said. The verb's JSON is a contract across a process boundary, so it is
 * checked field by field here, once: a success that does not have the shape is a failure with a
 * sentence, never a half-trusted object carried into a swap.
 */

/** The verb's exit-0 answer, narrowed to what the compaction uses. */
export type VerbSuccess = {
  seed: string[];
  model: string;
  served: string[];
  effort: string;
  chunks: number;
  tokensIn: number;
  tokensOut: number;
};

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value !== '';
const asCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;

/** The verb's success, or null when its JSON lacks any field the compaction needs. */
export function readVerbSuccess(json: Record<string, unknown> | null): VerbSuccess | null {
  if (!json) return null;
  const { seed, model, served, effort } = json;
  const chunks = asCount(json.chunks);
  const tokensIn = asCount(json.tokens_in);
  const tokensOut = asCount(json.tokens_out);
  if (
    !Array.isArray(seed) || seed.length === 0 || !seed.every(isNonEmptyString)
    || !isNonEmptyString(model) || !isNonEmptyString(effort)
    || !Array.isArray(served) || !served.every((word) => typeof word === 'string')
    || chunks === null || tokensIn === null || tokensOut === null
  ) {
    return null;
  }
  return { seed: [...seed], model, served: served as string[], effort, chunks, tokensIn, tokensOut };
}

/**
 * The one sentence that says why the verb gave no summary: its own `error`, else the last of what it
 * wrote to stderr, else what the exit code alone can say. Trailing full stops are dropped so a caller can
 * put the sentence inside its own.
 */
export function verbFailureSentence(answer: VerbAnswer): string {
  const own = typeof answer.json?.error === 'string' ? answer.json.error : '';
  const fallback = answer.stderr.split('\n').filter(Boolean).pop() ?? '';
  const text = own || fallback || (answer.exitCode === null ? 'the summarizer was stopped or could not be started' : `the summarizer exited ${answer.exitCode}`);
  return text.replace(/[.\s]+$/, '');
}

/**
 * The facts the record stores: the verb's words and tokens plus the trigger. `summarizerServed` is the
 * first model that answered, `null` when none named itself. `preTokens` is the chat's context before
 * (null when this server never saw a turn of the chat end).
 */
export function factsOf(success: VerbSuccess, trigger: CompactionFacts['trigger'], preTokens: number | null): CompactionFacts {
  return {
    trigger,
    summarizerModel: success.model,
    summarizerServed: success.served[0] ?? null,
    summarizerEffort: success.effort,
    preTokens,
    summarizerTokensIn: success.tokensIn,
    summarizerTokensOut: success.tokensOut,
    chunks: success.chunks,
  };
}
