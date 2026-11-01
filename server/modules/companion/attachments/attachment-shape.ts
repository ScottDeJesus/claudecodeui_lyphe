import type { CompanionAttachment } from '@/shared/companion-types.js';
import { isList, isRecord, isText, isWholeFrom } from '@/shared/document-fields.js';

/**
 * The one rule a stored attachment record is read by. His typed line carries its files in `companion_log.attachments_json` and his
 * unanswered words in `companion_state.unanswered_json`; both columns are read through this check, so the log and the ledger cannot
 * come to hold two ideas of what a record is. A column that is not a list of records of this shape is dropped whole by its reader
 * (`companion-store.ts`'s `readJsonColumn`), never half-read: a file she is told about must be a file she can be given.
 *
 * The same rule keeps the columns small on the WRITE side: `toAttachmentRecords` cuts each record down to the contract's five fields,
 * so whatever a caller carries on an object it hands over (a picture's base64, say) never reaches a row that is rewritten many times a
 * turn, nor the `companion_log` frame built from it. Disk keeps records, never bytes.
 *
 * Consumers: `companion-store.ts` (the log's column, `attachedFiles`, and the cut at both of its writes) and `companion-unanswered.ts`
 * (the ledger's entries).
 */

const isWholeNumber = isWholeFrom(0);

const isAttachment = (value: unknown): value is CompanionAttachment =>
  isRecord(value)
  && isText(value.path)
  && isText(value.name)
  && isWholeNumber(value.size)
  && (value.mimeType === undefined || isText(value.mimeType))
  && (value.opens === 'shown' || value.opens === 'text' || value.opens === 'unopened');

/**
 * Each record as the contract's five fields and nothing else (`mimeType` only when there is one), in the contract's order. Applied by the
 * store to every attachment list it writes, to the log's column and to the unanswered words, so no extra field is ever stored or sent.
 */
export function toAttachmentRecords(attachments: readonly CompanionAttachment[]): CompanionAttachment[] {
  return attachments.map(({ path, name, size, mimeType, opens }) =>
    mimeType === undefined ? { path, name, size, opens } : { path, name, size, mimeType, opens });
}

/** A list (possibly empty) of `CompanionAttachment` records. The shape check both attachment columns are read through. */
export function isAttachmentList(value: unknown): value is CompanionAttachment[] {
  return isList(value) && value.every(isAttachment);
}
