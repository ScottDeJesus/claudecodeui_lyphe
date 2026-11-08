import type { AnyRecord } from '@/shared/types.js';

/**
 * A message the CLI received WHILE A TURN WAS RUNNING is filed in the transcript as an `attachment` row, not as a
 * `user` row: `{ type: 'attachment', attachment: { type: 'queued_command', commandMode: 'prompt', prompt, ... } }`,
 * written where the CLI folded it into the turn (measured on CLI 2.1.x: a steer pushed five seconds into a Bash loop
 * is one such row between the loop's tool result and the reply, beside `queue-operation` bookkeeping rows and an
 * `api-request-blob` that quotes it). No `message` field, so the history reader saw no user turn there: a brief folded
 * into a running turn was missing from the chat after a reload, and nothing could mark it "Through Kaylee".
 *
 * `queuedPromptAsUserRow` gives such a row the shape of the user row the reader already understands, so the same
 * rules apply to it (wrapper prefixes stripped, internal content hidden). Only `commandMode: 'prompt'` is a message a
 * person wrote; the others (a background task's notification, a slash command) keep the meaning they have today.
 * The row carries no edit anchor (`normalizeMessage` skips it): rewinding a conversation to an attachment row is not
 * a resume point the CLI accepts.
 *
 * The user row's id is the one the message was SENT with (`source_uuid`, the uuid stamped on the pushed message), not
 * the attachment row's own: the composer's Steer sends under an id of its own, and the live echo of the CLI reading the
 * message carries that same id, so the live bubble and the history row are one message to the page and not two.
 *
 * Consumer: `claude-sessions.provider.ts` (`normalizeMessage`, the history reader's one door).
 */

/** The user-shaped row for a queued-prompt attachment, or `null` when `raw` is any other row. */
export function queuedPromptAsUserRow(raw: AnyRecord): AnyRecord | null {
  const queued: unknown = raw.attachment;
  if (raw.type !== 'attachment' || typeof queued !== 'object' || queued === null) return null;
  const { type, commandMode, prompt, timestamp, source_uuid: sourceUuid } = queued as AnyRecord;
  if (type !== 'queued_command' || commandMode !== 'prompt' || typeof prompt !== 'string' || prompt.trim() === '') return null;
  const sentAs = typeof sourceUuid === 'string' && sourceUuid !== '' ? sourceUuid : raw.uuid;
  return { type: 'user', uuid: sentAs, timestamp: raw.timestamp ?? timestamp, message: { role: 'user', content: prompt } };
}
