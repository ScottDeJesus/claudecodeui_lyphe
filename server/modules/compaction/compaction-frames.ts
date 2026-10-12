import type { ChatCompactionMarker, CompactionFacts, NormalizedMessage } from '@/shared/types.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

/**
 * The frames a compaction run writes to its own writer. Every one is a plain `NormalizedMessage`, so
 * the registry sequences, buffers and replays them to every tab like any other event of a run. The app
 * session id rides on each (the registry remaps it anyway, and the replay keys on it).
 *
 * The `compaction` row and the summary row carry the ids the chat's history gives the same two rows
 * (`claude-compacted-history.ts`), so the refresh after the run REPLACES the live frames with the
 * history's rather than showing both.
 */

/** The `compaction` row's id; the history row for the same record has the same one. */
export function compactionRowId(oldProviderSessionId: string): string {
  return `compaction-${oldProviderSessionId}`;
}

/** The summary row's id; the history rewrites the seed's first block to a row with the same one. */
export function compactionSummaryRowId(oldProviderSessionId: string): string {
  return `compaction-summary-${oldProviderSessionId}`;
}

/** A status line on the chat's processing line. `canInterrupt` keeps the Stop button on it. */
export function statusFrame(sessionId: string, text: string): NormalizedMessage {
  return createNormalizedMessage({ kind: 'status', text, canInterrupt: true, sessionId, provider: 'claude' });
}

/** An error row in the transcript. */
export function errorFrame(sessionId: string, content: string): NormalizedMessage {
  return createNormalizedMessage({ kind: 'error', content, sessionId, provider: 'claude' });
}

/** The run's terminal `complete`. Exit 0 for a run that finished or was set aside, 1 for one that failed. */
export function completeFrame(sessionId: string, exitCode: number): NormalizedMessage {
  return createCompleteMessage({ provider: 'claude', sessionId, exitCode });
}

/**
 * The marker a compaction draws, from the facts the verb and the trigger gave. `postTokens` is null
 * until the seed append's context count has reported; `at` is when the swap happens (the frame is written
 * moments before it).
 */
export function markerOf(facts: CompactionFacts, postTokens: number | null, at: string): ChatCompactionMarker {
  return {
    trigger: facts.trigger,
    summarizerModel: facts.summarizerModel,
    summarizerServed: facts.summarizerServed,
    summarizerEffort: facts.summarizerEffort,
    preTokens: facts.preTokens,
    postTokens,
    summarizerTokensIn: facts.summarizerTokensIn,
    summarizerTokensOut: facts.summarizerTokensOut,
    chunks: facts.chunks,
    at,
  };
}

/** The `compaction` divider row, live. */
export function compactionRowFrame(sessionId: string, oldProviderSessionId: string, marker: ChatCompactionMarker): NormalizedMessage {
  return createNormalizedMessage({
    kind: 'compaction',
    id: compactionRowId(oldProviderSessionId),
    compaction: marker,
    sessionId,
    provider: 'claude',
  });
}

/**
 * The summary, live: assistant-side text flagged `isCompactSummary`, the shape the CLI's own summary
 * row has, so the chat draws it under the existing preference. `summary` is the seed's block 0.
 */
export function summaryFrame(sessionId: string, oldProviderSessionId: string, summary: string): NormalizedMessage {
  return createNormalizedMessage({
    kind: 'text',
    role: 'assistant',
    content: summary,
    isCompactSummary: true,
    id: compactionSummaryRowId(oldProviderSessionId),
    sessionId,
    provider: 'claude',
  });
}
