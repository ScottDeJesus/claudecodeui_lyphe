import { sessionCompactionsDb } from '@/modules/database/index.js';

/**
 * Search's view of the transcripts a custom compaction left behind.
 *
 * A compacted transcript stays on disk and stays searchable, but it is not a chat of its own: it
 * has no session row (the indexer refuses a superseded provider id). Search finds files through
 * session rows, so each compacted transcript is searched as the chat's OWN row carrying the old
 * provider session id and the old transcript path. A hit in it then names its chat, and it goes
 * through every filter a row goes through (a hidden root, an archived project) because the
 * caller feeds these rows to the same normalizer as the live ones.
 */

/** The columns of a chat's row that a compacted entry rewrites. */
type SearchChatRow = {
  session_id: string;
  provider_session_id: string | null;
  jsonl_path: string | null;
};

/**
 * One entry per compaction record whose chat is among `chatRows`: that chat's row with the old
 * provider session id and the old transcript path. A record whose chat is not in `chatRows`
 * (deleted, or archived — an archived chat's live transcript is not searched either) adds nothing.
 *
 * Appended AFTER the live rows by the caller, so the stable sort that orders a project's chats by
 * activity keeps each compacted entry behind its chat's live row.
 */
export function listCompactedTranscriptRows<TRow extends SearchChatRow>(chatRows: readonly TRow[]): TRow[] {
  const chatsBySessionId = new Map(chatRows.map((row) => [row.session_id, row] as const));

  const compactedRows: TRow[] = [];
  for (const record of sessionCompactionsDb.listAllCompactions()) {
    const chat = chatsBySessionId.get(record.sessionId);
    if (!chat) {
      continue;
    }
    compactedRows.push({
      ...chat,
      provider_session_id: record.oldProviderSessionId,
      jsonl_path: record.oldJsonlPath,
    });
  }
  return compactedRows;
}

/** What `addSessionResult` reads of a result: enough to tell two hits in one chat apart. */
type MergeableSessionResult = {
  sessionId: string;
  provider: string;
  matches: Array<{ snippet: string; timestamp: string | null; messageUuid?: string | null }>;
};

function matchIdentity(match: MergeableSessionResult['matches'][number]): string {
  return `${match.messageUuid ?? ''}|${match.timestamp ?? ''}|${match.snippet}`;
}

/**
 * Adds one chat's result to a project's list, merging into the entry the chat already has there.
 *
 * A chat that was compacted is searched as several entries (its live transcript and each compacted
 * one), and each may hit. The sidebar keys a project's results by chat id, so two entries for one
 * chat would collide: this keeps ONE entry per chat and appends the hits it did not already hold.
 * The same hit arriving twice — which happens for the moment a swap's live row still shares the old
 * transcript's path — is dropped, so merging is idempotent.
 */
export function addSessionResult<TResult extends MergeableSessionResult>(
  sessionResults: TResult[],
  result: TResult,
): void {
  const existingIndex = sessionResults.findIndex(
    (existing) => existing.sessionId === result.sessionId && existing.provider === result.provider,
  );
  if (existingIndex === -1) {
    sessionResults.push(result);
    return;
  }

  const existing = sessionResults[existingIndex];
  const held = new Set(existing.matches.map(matchIdentity));
  const added = result.matches.filter((match) => !held.has(matchIdentity(match)));
  if (added.length > 0) {
    sessionResults[existingIndex] = { ...existing, matches: [...existing.matches, ...added] };
  }
}
