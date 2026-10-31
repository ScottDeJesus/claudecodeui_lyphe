import { isList, isRecord, isText } from '@/shared/document-fields.js';
import { isStoreStamp } from '@/shared/utils.js';

/**
 * His words that no turn of hers has answered yet, as the account's row keeps them (`companion_state.unanswered_json`).
 *
 * Her conversation lives in a process, and a process ends at every server handover and every crash. What the CLI had been
 * given and not yet answered would end with it, so the words he said stay on disk until a turn answers them (or he cuts
 * the answer on purpose, or it fails, or Clear): the next process finds them there and says them to her again. It is the
 * RAW text and how it came, never the assembled message — the roster and the view inside an assembled message are a
 * snapshot that goes stale, so a message is assembled again when it is delivered.
 *
 * Consumers: `companion-store.ts` (reads and writes the column through `isUnansweredList`) and the session
 * (`session/companion-session-types.ts` names the type in its deps; `session/companion-ledger.ts` builds the list).
 */

/**
 * One message of his she has not answered: the `uuid` it was last pushed under (a re-delivery pushes it under a new one and
 * replaces this entry), his raw `body` (`''` with `via: 'spoken'` is a press that carried no words, or, with `heard: 'name'`,
 * a press that was only her name), how it came and the stamp `at` he said it. `cut` is the cut the message opened with (`<cut heard interrupted/>`, the sentences he heard and
 * the one he interrupted; absent when it opened with none): it is the one thing in the assembled message that is not a
 * snapshot, so a message said again after a handover opens with it too.
 */
export type UnansweredMessage = { uuid: string; body: string; via: 'typed' | 'spoken'; at: string; heard?: 'name'; cut?: { heard: string; interrupted: string } };

const isCut = (value: unknown): boolean => value === undefined || (isRecord(value) && isText(value.heard) && isText(value.interrupted));

const isUnansweredMessage = (value: unknown): value is UnansweredMessage =>
  isRecord(value) && isText(value.uuid) && isText(value.body) && (value.via === 'typed' || value.via === 'spoken') && isStoreStamp(value.at)
  && (value.heard === undefined || value.heard === 'name') && isCut(value.cut);

/** The shape check `unanswered_json` is read through: a list of `UnansweredMessage`, oldest first. */
export function isUnansweredList(value: unknown): value is UnansweredMessage[] {
  return isList(value) && value.every(isUnansweredMessage);
}
