import path from 'node:path';

import { sessionCompactionsDb, sessionsDb } from '@/modules/database/index.js';
import type { CompactionFacts, ProviderRuntimeWriter } from '@/shared/types.js';

/**
 * THE SEED APPEND's writer: the run's own writer, wrapped so that the swap of the chat onto its new
 * session happens at exactly the moment the new session announces itself, and so that the run's
 * `complete` is held until the compaction knows whether it took.
 *
 * - At the FIRST `setSessionId(id)` or `session_created` naming an id other than the old one, it calls
 *   `sessionCompactionsDb.swapToCompactedSession(...)` BEFORE forwarding. Forwarded afterwards, the
 *   gateway's own bookkeeping finds the chat already on the new id and leaves the old transcript to
 *   the swap's record (it would otherwise file it as an edit's rewind).
 * - It keeps the last `token_budget` it forwards: the new session's first context, the marker's "after".
 * - It holds the turn's `complete`. The procedure forwards it on success, or answers with its own after
 *   taking the swap back.
 *
 * Once `release()` has been called it forwards everything untouched. The runtime keeps the writer it
 * was spawned with until the next message joins that process, so a background task's follow-up turn can
 * still write through this object long after the compaction run ended; it must be transparent then.
 *
 * Consumer: compaction-procedure.ts.
 */

type SeedTarget = ProviderRuntimeWriter & {
  setCliVersion?(version: string): void;
  getSessionId?(): string | null;
};

/** What the procedure reads off the wrapper once the seed append's run has settled. */
export type SeedWriter = ProviderRuntimeWriter & {
  setCliVersion(version: string): void;
  getSessionId(): string | null;
  /** The id the new session announced, or null when it never did (or announced the old id). */
  readonly announcedProviderSessionId: string | null;
  /** Whether the swap was written. */
  readonly swapped: boolean;
  /** Why the swap could not be written, when it could not. */
  readonly swapFailure: string | null;
  /** The turn's `complete`, held back; null when the turn ended without one. */
  readonly heldComplete: Record<string, unknown> | null;
  /** The `used` of the last `token_budget` forwarded: the new session's first context. */
  readonly lastBudgetUsed: number | null;
  /** Ends the holding: from here every frame, `complete` included, goes straight to the run's writer. */
  release(): void;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;

/**
 * A seed that announced a session the swap could not claim must not leave that session's transcript to
 * be listed as a second chat in the sidebar, so it is filed as a transcript this chat left behind (the
 * indexer refuses those and the chat's delete removes them). Only while the chat exists: a record for a
 * deleted chat would have nothing to be deleted with.
 */
function parkUnclaimedSeed(sessionId: string, oldTranscriptPath: string, seedProviderSessionId: string): void {
  try {
    if (!sessionsDb.getSessionById(sessionId)) return;
    sessionsDb.markProviderSessionSuperseded({
      providerSessionId: seedProviderSessionId,
      provider: 'claude',
      sessionId,
      jsonlPath: path.join(path.dirname(oldTranscriptPath), `${seedProviderSessionId}.jsonl`),
    });
  } catch (error) {
    console.error('[compaction] could not park the seed session that could not be claimed:', error instanceof Error ? error.message : error);
  }
}

export function createSeedWriter(input: {
  target: SeedTarget;
  sessionId: string;
  oldProviderSessionId: string;
  oldTranscriptPath: string;
  facts: CompactionFacts;
  /** The seed's blocks as the verb returned them: the swap stores them, so a start-over can append them again. */
  seed: string[];
}): SeedWriter {
  const { target } = input;
  let announced: string | null = null;
  let swapped = false;
  let swapFailure: string | null = null;
  let heldComplete: Record<string, unknown> | null = null;
  let lastBudgetUsed: number | null = null;
  let released = false;

  /** Returns false when the announcement must NOT be forwarded (the swap could not be written). */
  const claimAnnouncedSession = (id: unknown): boolean => {
    if (typeof id !== 'string' || id === '' || id === input.oldProviderSessionId) return true;
    // The runtime announces twice (`setSessionId`, then `session_created`): a swap that failed on the
    // first keeps swallowing the second, and one that held lets it through.
    if (announced !== null) return swapFailure === null;
    announced = id;
    try {
      sessionCompactionsDb.swapToCompactedSession({
        sessionId: input.sessionId,
        oldProviderSessionId: input.oldProviderSessionId,
        oldJsonlPath: input.oldTranscriptPath,
        newProviderSessionId: id,
        facts: input.facts,
        seed: input.seed,
      });
      swapped = true;
      return true;
    } catch (error) {
      swapFailure = error instanceof Error ? error.message : String(error);
      console.error(`[compaction] session=${input.sessionId} could not swap onto ${id}:`, swapFailure);
      parkUnclaimedSeed(input.sessionId, input.oldTranscriptPath, id);
      return false;
    }
  };

  return {
    get isWebSocketWriter() {
      return target.isWebSocketWriter;
    },
    get userId() {
      return target.userId;
    },
    send(data: unknown): void {
      const record = released ? null : asRecord(data);
      if (record?.kind === 'session_created') {
        if (!claimAnnouncedSession(record.newSessionId || record.sessionId)) return;
      } else if (record?.kind === 'complete' && heldComplete === null) {
        heldComplete = record;
        return;
      } else if (record?.kind === 'status' && record.text === 'token_budget') {
        const used = asRecord(record.tokenBudget)?.used;
        if (typeof used === 'number' && Number.isFinite(used)) lastBudgetUsed = used;
      }
      target.send(data);
    },
    setSessionId(id: string): void {
      if (!released && !claimAnnouncedSession(id)) return;
      target.setSessionId?.(id);
    },
    setCliVersion(version: string): void {
      target.setCliVersion?.(version);
    },
    getSessionId(): string | null {
      return target.getSessionId?.() ?? null;
    },
    get announcedProviderSessionId() {
      return announced;
    },
    get swapped() {
      return swapped;
    },
    get swapFailure() {
      return swapFailure;
    },
    get heldComplete() {
      return heldComplete;
    },
    get lastBudgetUsed() {
      return lastBudgetUsed;
    },
    release(): void {
      released = true;
    },
  };
}
