import { broadcastToAll } from '@/modules/websocket/index.js';
import { createPacedHint } from '@/shared/index.js';

/**
 * At most one `drafts_changed` per quarter second: a burst of follow-ups queued behind a turn is one
 * re-read of the drafts per tab, and a card still follows the server within a blink.
 */
const DRAFTS_HINT_GAP_MS = 250;

/**
 * The one `drafts_changed` hint, shared by every writer of a queued message: the user service's
 * append and clear, and the scheduled-messages dispatcher's claim, restore and delete. A typing save
 * writes only the draft's text and does not speak: no card shows it.
 */
const draftsHint = createPacedHint({
  kind: 'drafts_changed',
  minGapMs: DRAFTS_HINT_GAP_MS,
  send: (frame) => broadcastToAll(frame),
});

/** Tells every open tab that a queued message was written; called after the write returns. */
export function tellDraftsChanged(): void {
  draftsHint.tell();
}
