import { sessionCompactionsDb } from '@/modules/database/index.js';
import { summarizeClaudeTokenUsage } from '@/modules/providers/services/provider-token-usage.service.js';
import type {
  AnyRecord,
  ChatCompactionMarker,
  CompactionRecord,
  NormalizedMessage,
} from '@/shared/types.js';
import { createNormalizedMessage } from '@/shared/utils.js';

/**
 * What a chat leaves behind when a custom compaction moves it onto a new Claude session: the old
 * transcript stays on disk and the chat's history reads the old and the new one as ONE
 * conversation, with a divider where the swap happened.
 *
 * This file is a leaf on purpose. `claude-sessions.provider.ts` (the reader that owns the row
 * parsing) calls in here for the stitch, the divider and the seed rewrite, and hands the one-
 * transcript reader in as a parameter, so nothing here imports the provider back.
 */

const PROVIDER = 'claude';

/**
 * The `type` of the raw row a compaction is read as. Not a type the CLI writes, so it cannot be
 * mistaken for one of its rows; `normalizeMessage` turns it into a `kind: 'compaction'` message.
 */
const COMPACTION_ROW_TYPE = 'cloudcli-compaction';

/**
 * True for a row the user typed, as opposed to a tool result or an injected note.
 *
 * Used by the Claude history reader (`dropSupersededPromptBranches` tells sibling prompts apart
 * with it) and here, to find the prompt a compaction's new session was seeded with.
 */
export function isUserPromptRow(row: AnyRecord): boolean {
  if (row.type !== 'user' || row.isMeta === true || row.isCompactSummary === true) {
    return false;
  }

  const content = row.message?.content;
  if (Array.isArray(content)) {
    return content.some((part: AnyRecord) => part?.type === 'text' || part?.type === 'image');
  }

  return typeof content === 'string' && content.length > 0;
}

/** Reads ONE Claude transcript's rows for one provider session id; the provider's own reader, handed in. */
export type ReadClaudeTranscriptRows = (
  transcriptPath: string | null | undefined,
  providerSessionId: string,
) => Promise<AnyRecord[]>;

/**
 * A chat's raw history rows, stitched across its compactions, with the facts the reader needs
 * to treat the parts differently.
 */
export type StitchedClaudeHistory = {
  /** Every row in reading order: each compacted transcript, then a divider row, then the live transcript. */
  rows: AnyRecord[];
  /** The live transcript's rows alone — the composer's token counter is the context the chat NOW holds. */
  liveRows: AnyRecord[];
  /**
   * The rows read from a compacted transcript. They offer no edit and no fork: the conversation
   * they belong to is not the one the CLI resumes, so an anchor on one would only ever answer
   * "no longer in the transcript".
   */
  supersededRows: WeakSet<AnyRecord>;
  /**
   * What the CLI counted the live session at when the latest compaction ended (the record's
   * `post_tokens`), while the live transcript holds no assistant usage yet; null once it does, in a
   * chat with no compaction, and when the record has no count yet. The seed append has no reply, so
   * until the next one the transcript has nothing for the composer's counter to read.
   */
  openingContextTokens: number | null;
};

/** The first text block of a user row's content, as a string; null when it has none. */
function readFirstTextBlock(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const block = content.find((part: AnyRecord) => part?.type === 'text' && typeof part.text === 'string');
  return block ? block.text : null;
}

/** The only text of the stand-in reply the CLI writes when it resumes a session whose last row is a user row. */
const RESUME_PLACEHOLDER_TEXT = 'No response requested.';

/** True for the CLI's `<synthetic>` assistant row whose only text is "No response requested." */
function isResumePlaceholderRow(row: AnyRecord): boolean {
  if (row.type !== 'assistant' || row.message?.model !== '<synthetic>') {
    return false;
  }
  const content = row.message?.content;
  if (typeof content === 'string') {
    return content.trim() === RESUME_PLACEHOLDER_TEXT;
  }
  return Array.isArray(content)
    && content.length > 0
    && content.every((part: AnyRecord) => part?.type === 'text' && typeof part.text === 'string' && part.text.trim() === RESUME_PLACEHOLDER_TEXT);
}

/**
 * Drops the resume placeholder that lies between the seed row (at `seedIndex`) and the next user
 * prompt. A seed append has no reply of its own, so when the session resumes from disk the CLI
 * answers the append's dangling user row with this stand-in before the operator's message — and
 * drawn, it would read as the model speaking after the summary. The row stays in the transcript
 * (it is the resume point an edit's anchor rule uses); only the reading leaves it out. A placeholder
 * anywhere else in the conversation is the CLI's own business and is drawn as before.
 */
function dropResumePlaceholder(rows: AnyRecord[], seedIndex: number): AnyRecord[] {
  let nextPromptIndex = rows.findIndex((row, index) => index > seedIndex && isUserPromptRow(row));
  if (nextPromptIndex === -1) {
    nextPromptIndex = rows.length;
  }
  const kept = rows.filter((row, index) => index <= seedIndex || index >= nextPromptIndex || !isResumePlaceholderRow(row));
  return kept.length === rows.length ? rows : kept;
}

/**
 * Rewrites the seed — the first prompt of a transcript a compaction began — into the shape the
 * CLI's own summary row has, so the existing `isCompactSummary` branch draws it as assistant-side
 * summary text under the `showCompactSummary` preference.
 *
 * The seed is the summary, then — when it has them — the operator's own messages, the verbatim tail
 * of the old conversation and the handover line. Only the first is kept: the others are for the model,
 * and the messages and the tail repeat rows the reader has already drawn above the divider. Its id is
 * the one the live frames use (`compaction-summary-<old provider id>`), so the refresh after a
 * compaction replaces the live row with this one and never draws both.
 */
function rewriteSeedAsSummary(rows: AnyRecord[], beganBy: CompactionRecord | null): AnyRecord[] {
  if (!beganBy) {
    return rows;
  }
  const seedIndex = rows.findIndex(isUserPromptRow);
  if (seedIndex === -1) {
    return rows;
  }
  const seed = rows[seedIndex];
  // Rows leave only AFTER the seed, so `seedIndex` still names it in what is kept.
  const kept = dropResumePlaceholder(rows, seedIndex);
  const summaryText = readFirstTextBlock(seed.message?.content);
  if (summaryText === null) {
    return kept;
  }

  const rewritten = kept.slice();
  rewritten[seedIndex] = {
    ...seed,
    isCompactSummary: true,
    uuid: `compaction-summary-${beganBy.oldProviderSessionId}`,
    message: { ...seed.message, content: summaryText },
  };
  return rewritten;
}

/**
 * When the divider sorts: the swap's time, unless the seed that follows it is stamped no later.
 *
 * The record keeps the swap to the second (`createdAt`) while the CLI stamps the seed to the
 * millisecond, a few ms BEFORE the swap lands, so the seed can fall in the second before the
 * floored stamp. The chat's store sorts its rows by timestamp whenever one live row is not on disk
 * yet, and that sort would put the summary above its own divider. The divider therefore never
 * sorts after the seed: it takes the millisecond before it. The marker's own `at` stays the swap's.
 */
function readDividerTimestamp(swappedAt: string, followingRows: AnyRecord[]): string {
  const seedTimestamp = followingRows.find(isUserPromptRow)?.timestamp;
  const swapped = Date.parse(swappedAt);
  const seeded = typeof seedTimestamp === 'string' ? Date.parse(seedTimestamp) : Number.NaN;
  if (!Number.isFinite(swapped) || !Number.isFinite(seeded) || swapped < seeded) {
    return swappedAt;
  }
  return new Date(seeded - 1).toISOString();
}

/**
 * The raw row one compaction is read as: the record itself, timestamped when the swap happened
 * (`readDividerTimestamp` says when that is not quite so). `followingRows` are the transcript the
 * swap began, BEFORE its seed is rewritten.
 */
function buildCompactionRow(record: CompactionRecord, followingRows: AnyRecord[]): AnyRecord {
  return {
    type: COMPACTION_ROW_TYPE,
    uuid: `compaction-${record.oldProviderSessionId}`,
    timestamp: readDividerTimestamp(record.createdAt, followingRows),
    compaction: record,
  };
}

/**
 * The latest compaction's `post_tokens` while the live transcript has no assistant usage to count,
 * else null. "No usage" is `summarizeClaudeTokenUsage`'s own reading (a sidechain row, and a
 * `<synthetic>` row such as the resume placeholder, carry none), so the two can never disagree about
 * which of them answers the composer's counter.
 */
function readOpeningContextTokens(compactions: CompactionRecord[], liveRows: AnyRecord[]): number | null {
  const postTokens = compactions[compactions.length - 1]?.postTokens ?? null;
  if (postTokens === null) {
    return null;
  }
  const liveUsage = summarizeClaudeTokenUsage(liveRows, undefined, { transcriptIsComplete: false });
  return liveUsage.used === 0 ? postTokens : null;
}

/**
 * Reads a chat's history across its compactions, oldest first: for each compaction record, that
 * transcript's rows (read with ITS OWN provider session id, so its subagents are found under its
 * own folder) and one compaction row; then the live transcript's rows.
 *
 * A chat with no compaction row reads exactly the live transcript, as it always did.
 *
 * Every transcript after the first was begun by a compaction, and its first prompt is the seed:
 * see `rewriteSeedAsSummary`. A transcript that is not on disk (the live one, in the moment between
 * a swap and the seed's first row) reads as no rows: that is the handed-in reader's answer, not
 * an error to catch here.
 */
export async function stitchCompactedHistory(input: {
  sessionId: string;
  liveTranscriptPath: string | null | undefined;
  liveProviderSessionId: string;
  readTranscriptRows: ReadClaudeTranscriptRows;
}): Promise<StitchedClaudeHistory> {
  const compactions = sessionCompactionsDb.listCompactions(input.sessionId);
  const supersededRows = new WeakSet<AnyRecord>();

  // A caller that took its provider session id from the chat's row BEFORE a swap landed hands the
  // OLD id here, while the path below is read fresh. In the gap before the seed's file exists that
  // path is still the old transcript, so the "live" read would return every compacted row a second
  // time (and the history cache would keep the doubled read until the path moves). An id a record
  // names as compacted can never be the live transcript: the chat has no live rows yet.
  const liveIdIsCompacted = compactions.some((record) => record.oldProviderSessionId === input.liveProviderSessionId);

  const [liveRows, ...compactedTranscripts] = await Promise.all([
    liveIdIsCompacted ? Promise.resolve([]) : input.readTranscriptRows(input.liveTranscriptPath, input.liveProviderSessionId),
    ...compactions.map((record) => input.readTranscriptRows(record.oldJsonlPath, record.oldProviderSessionId)),
  ]);
  if (compactions.length === 0) {
    return { rows: liveRows, liveRows, supersededRows, openingContextTokens: null };
  }

  const rows: AnyRecord[] = [];
  for (let index = 0; index < compactions.length; index += 1) {
    // The first transcript was not begun by a compaction; every later one was begun by the one before it.
    const beganBy = index === 0 ? null : compactions[index - 1];
    for (const row of rewriteSeedAsSummary(compactedTranscripts[index], beganBy)) {
      supersededRows.add(row);
      rows.push(row);
    }
    // The transcript this swap began: the next compacted one, or the live one after the last swap.
    rows.push(buildCompactionRow(compactions[index], compactedTranscripts[index + 1] ?? liveRows));
  }
  for (const row of rewriteSeedAsSummary(liveRows, compactions[compactions.length - 1])) {
    rows.push(row);
  }

  return { rows, liveRows, supersededRows, openingContextTokens: readOpeningContextTokens(compactions, liveRows) };
}

/** True for the raw row `stitchCompactedHistory` synthesizes; the Claude `normalizeMessage` branches on it. */
export function isCompactionRow(raw: AnyRecord): boolean {
  return raw.type === COMPACTION_ROW_TYPE;
}

/** Builds the marker a compaction row carries from the record the database holds. */
function toCompactionMarker(record: CompactionRecord): ChatCompactionMarker {
  return {
    trigger: record.trigger,
    summarizerModel: record.summarizerModel,
    summarizerServed: record.summarizerServed,
    summarizerEffort: record.summarizerEffort,
    preTokens: record.preTokens,
    postTokens: record.postTokens,
    summarizerTokensIn: record.summarizerTokensIn,
    summarizerTokensOut: record.summarizerTokensOut,
    chunks: record.chunks,
    at: record.createdAt,
  };
}

/**
 * Turns the synthesized compaction row into its one `kind: 'compaction'` message. Called by the
 * Claude `normalizeMessage`, which is why it returns an array like every other branch there.
 */
export function normalizeCompactionRow(raw: AnyRecord, sessionId: string | null): NormalizedMessage[] {
  return [createNormalizedMessage({
    id: raw.uuid,
    sessionId,
    timestamp: raw.timestamp,
    provider: PROVIDER,
    kind: 'compaction',
    compaction: toCompactionMarker(raw.compaction as CompactionRecord),
  })];
}

/**
 * Strips the edit/fork anchor off messages read from a compacted transcript. The Claude
 * `normalizeMessage` stamps one on every user row; here it is taken back off, because the CLI does
 * not resume that conversation and `resolveEditAnchor` would answer "no longer in the transcript".
 */
export function withoutAnchors(messages: NormalizedMessage[]): NormalizedMessage[] {
  for (const message of messages) {
    delete message.transcriptAnchorId;
  }
  return messages;
}

/**
 * A value that moves when anything the stitch reads from the database moves, for the full-history
 * cache (`readCompanionStamp`, via `readHistoryCompanionStamp`).
 *
 * The cache validates an entry by the live transcript's path, mtime and size, and a swap changes
 * the path. That is not the whole of it: the swap writes its record before the new transcript
 * exists (the path is unchanged for that moment), and `postTokens` is filled in AFTER the seed
 * turn's last row — a read between the two would cache a marker without its "after" and the file
 * would never move again to correct it. Empty for a chat with no compaction.
 */
export function readCompactionStamp(sessionId: string): string {
  const records = sessionCompactionsDb.listCompactions(sessionId);
  if (records.length === 0) {
    return '';
  }
  return `|compactions:${records.map((record) => `${record.oldProviderSessionId}@${record.postTokens ?? ''}`).join(',')}`;
}
