import { relayedSendsDb } from '@/modules/database/index.js';
import type { RelayedSendRow } from '@/modules/database/index.js';
import type { NormalizedMessage } from '@/shared/types.js';

/**
 * How far BEFORE a send's own time a persisted row may be stamped and still be that send's row.
 *
 * `relayed_sends.sent_at` is written by this server when it hands the brief to the chat, while the
 * transcript row's `timestamp` is written by the Claude CLI when the message reaches it — a few
 * milliseconds later in the normal case, but a different clock reading from a different process,
 * so the row can carry a stamp slightly earlier than the send. Five seconds absorbs that without
 * letting a same-worded message from long before the send (the brief typed by hand last week)
 * wear the mark.
 */
const SEND_CLOCK_SKEW_MS = 5000;

/**
 * Marks the persisted user messages of one chat that came through Kaylee, so a reload keeps the
 * "Through Kaylee" mark the live echo wore.
 *
 * The match is by TEXT, not by transcript uuid, on purpose: the Claude runtime that writes the row
 * (`claude-runtime.provider.js`) stays untouched by this feature, and a brief is long and specific
 * enough that equality inside one chat is exact in practice. A user `text` row is marked when both hold:
 * - its trimmed content is not empty and equals the trimmed text of one of the chat's relayed sends;
 * - its timestamp is at or after that send's time minus {@link SEND_CLOCK_SKEW_MS}.
 * A brief sent twice therefore marks both of its rows, which is true — both came through her.
 * Blank never matches blank: a picture-only user row carries `content: ''`, and a send that trims
 * to nothing would otherwise mark every such row after it.
 *
 * Reads `relayed_sends` once per call and returns `messages` itself, untouched, when the chat has
 * none — or when the read fails, which is logged and never thrown. A row it marks is a copy; a row it does not is the very object it was given. The input is
 * never mutated, because `sessionsService.fetchHistory` hands it rows that the full-history cache
 * also holds.
 *
 * Consumed by `sessionsService.fetchHistory` (providers module), which applies it to every page it
 * returns — cached or read directly — so the mark rides the same REST payload as the row.
 */
export function markRelayedSends(sessionId: string, messages: NormalizedMessage[]): NormalizedMessage[] {
  let sends: RelayedSendRow[];
  try {
    sends = relayedSendsDb.listForSession(sessionId);
  } catch (error) {
    // The mark is a label on a row; a lookup that fails must cost the label, not the history page
    // every reader of this chat loads.
    console.warn(`[relayed-sends] could not read the relayed sends of session ${sessionId}; the page goes out unmarked:`, error);
    return messages;
  }
  if (sends.length === 0) return messages;

  // Per text, the EARLIEST moment a row may carry and still match any send of that text: a row
  // matches when it is at or after the threshold of at least one send, which is the minimum.
  const earliestMatchByText = new Map<string, number>();
  for (const send of sends) {
    const sentAt = Date.parse(send.sent_at);
    // A send whose stamp cannot be read can never be matched on time, so it marks nothing; nor
    // does a send with no words, which no real brief is.
    if (Number.isNaN(sentAt) || send.text === '') continue;
    const threshold = sentAt - SEND_CLOCK_SKEW_MS;
    const known = earliestMatchByText.get(send.text);
    if (known === undefined || threshold < known) earliestMatchByText.set(send.text, threshold);
  }
  if (earliestMatchByText.size === 0) return messages;

  return messages.map((message) => {
    if (message.kind !== 'text' || message.role !== 'user' || typeof message.content !== 'string') return message;
    const trimmedContent = message.content.trim();
    if (trimmedContent === '') return message;
    const threshold = earliestMatchByText.get(trimmedContent);
    if (threshold === undefined) return message;
    const stampedAt = Date.parse(message.timestamp);
    // A row with no readable time cannot show it is at or after the send, so it is not marked.
    if (Number.isNaN(stampedAt) || stampedAt < threshold) return message;
    return { ...message, spokenVia: 'kaylee' };
  });
}
