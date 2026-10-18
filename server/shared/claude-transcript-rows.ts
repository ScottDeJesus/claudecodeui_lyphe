/**
 * Which records of a Claude transcript are the conversation, and which are the CLI's own bookkeeping.
 * Shared by every reader that walks a transcript's lines — the history reader and the subagent reader
 * (`claude-sessions.provider.ts`), transcript search, and the universe's transcript tap — so a record
 * that is not a turn is never read as one by one reader and refused by another.
 */

import type { AnyRecord } from '@/shared/types.js';

/** The only text of the stand-in reply the CLI writes when it resumes a session whose last row is a user row. */
const RESUME_PLACEHOLDER_TEXT = 'No response requested.';

/**
 * True for a record that carries a turn's `message` — a `role` of `user` or `assistant` — without
 * being a turn. The CLI types the records that ARE turns `user` and `assistant`; the others that
 * carry such a message are its bookkeeping. The one measured: `api-request-blob`, which stores the
 * request body the CLI is about to send (the operator's prompt among the context blocks, a whole
 * earlier assistant message with its tool calls) under a content hash, with NO `uuid` and NO
 * `timestamp` (4,351 user and 33,556 assistant such records over 585 transcripts on this box).
 *
 * Read as turns, such a record becomes a second copy of a message the transcript already holds,
 * stamped with the time the reader ran and an id minted on the spot — the old message that
 * reappeared at the foot of a chat, and a doubled tool call in a subagent's card.
 *
 * Takes `unknown` because the universe's tap parses lines it has not typed. A live SDK frame is
 * typed `user` or `assistant` as the transcript rows are, so it is never one of these.
 */
export function isClaudeTurnLookalike(record: unknown): boolean {
  if (typeof record !== 'object' || record === null) {
    return false;
  }
  const { type, message } = record as { type?: unknown; message?: { role?: unknown } | null };
  const role = message?.role;
  return (role === 'user' || role === 'assistant') && type !== 'user' && type !== 'assistant';
}

/**
 * True for the CLI's `<synthetic>` assistant row whose only text is "No response requested." — the
 * stand-in it writes ahead of the operator's next message when a session resumes with a dangling
 * user row (after an interrupt, or an idle resume). It keeps the transcript's turns alternating; it
 * is not the assistant speaking, and read as a reply it answers a message nothing answered.
 *
 * The other `<synthetic>` rows are NOT this: a rate-limit refusal, an expired login or an API error
 * says something the reader needs, and carries `isApiErrorMessage: true`.
 */
export function isResumePlaceholderRow(row: AnyRecord): boolean {
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
