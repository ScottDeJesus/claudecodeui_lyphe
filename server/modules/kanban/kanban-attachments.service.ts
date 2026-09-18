import fs from 'node:fs';
import path from 'node:path';

import { kanbanChecklistDb, kanbanIdsDb } from '@/modules/database/index.js';
import type { KanbanAttachment, KanbanWriteContext } from '@/shared/kanban-types.js';
import { AppError, expandHome, resolveUnderRoot } from '@/shared/utils.js';

import { requireCardRow } from './kanban-cards.guards.js';
import { writeKanban } from './kanban-write.service.js';

/**
 * A card's attachments: the BYTES, and the row that indexes them.
 *
 * An attachment is operator input — a screenshot pasted into a card, a PDF handed to a build —
 * never builder output. The row carries the display metadata (id, filename, mime, size) and the
 * bytes live on disk under `<root>/<cardId>/<attachmentId>.<ext>`.
 *
 * THE DERIVE-PATH-FROM-ID RULE (load-bearing). The on-disk path is derived from the MINTED id plus
 * the extension of the VALIDATED mime — NEVER from the client's filename. A filename like
 * `../../etc/passwd` or `x.php` therefore cannot influence where bytes land or what they are named:
 * the only caller-controlled bit that reaches a path (the mime) is constrained to the closed allowlist
 * below before it touches a path component. The filename is display text and nothing else. This is
 * `~/.claude/descent/store_attachments.py`'s rule, and its `store_schema.py:79-93` derivation.
 *
 * ON-DISK / ROW ORDERING. `addAttachment` writes the bytes BEFORE it inserts the row, so a failed
 * disk write never commits a row pointing at a file that is not there. The reverse — a file with no
 * row — is harmless: it is an orphan blob no reader can reach, because every read starts from a row.
 *
 * EVERY write goes through `writeKanban` — the row insert, the row delete and their audit events
 * land in that seam's one transaction, and the frame it broadcasts is what repaints an open drawer.
 * No verb here opens a transaction of its own.
 *
 * Consumers: `routes/attachment.routes.ts`, `kanban.module.ts`, and the barrel beside it. The MCP
 * program is NOT one of them — it is a leaf that reaches the board over HTTP through
 * `/api/kanban-pm`, never by importing a service.
 */

/**
 * The largest attachment this board accepts, in bytes — Descent's eight megabytes, checked by
 * multer's `fileSize` limit so an oversized body is cut off as it arrives rather than buffered and
 * then refused. The service checks it again on the bytes it was handed, because a caller other than
 * the route (an import, a future MCP verb) must meet the same cap.
 */
export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The CLOSED mime allowlist, and the extension each type is stored under.
 *
 * An allowlist and not a denylist: a mime that is not in this map yields no extension, so the path
 * derivation refuses it rather than inventing a name for a blob it cannot describe. It is the only
 * thing besides the minted id that names a file on disk, which is what makes the stored extension
 * derivable and the client's filename ignorable.
 *
 * SVG is deliberately ABSENT, unlike the chat assets route: an SVG is a document that can carry
 * script, and this route streams bytes back into the app's own origin.
 */
export const ATTACHMENT_MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Whether one mime may be stored as a card attachment. The route's `fileFilter` asks this too. */
export function isAllowedAttachmentMime(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(ATTACHMENT_MIME_TO_EXT, mime);
}

/**
 * The magic header each allowlisted type must START with — the CONTENT gate behind the mime.
 *
 * The mime is a string the caller sends, and it is the one field that decides both the stored
 * extension and the `Content-Type` the download is labelled with. Nothing else verifies it: a
 * multipart part's headers are all a browser has to go on, so without this gate `image/png` is a
 * claim about bytes nobody looked at. `server_api.py:360-399` orders its door mime → decode → size
 * → sniff for exactly that reason, and `_sniff_image` is this table.
 *
 * WebP is a CONTAINER, so a bare `RIFF` prefix proves nothing — a WAV carries it too — and its
 * form-type at offset 8 is what decides.
 */
const ATTACHMENT_MAGIC: Record<string, Buffer> = {
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'image/gif': Buffer.from('GIF8', 'latin1'),
  'image/webp': Buffer.from('RIFF', 'latin1'),
  'application/pdf': Buffer.from('%PDF-', 'latin1'),
};

/** Whether the payload actually begins with the header its claimed mime promises. */
function looksLikeMime(mime: string, bytes: Buffer): boolean {
  const magic = ATTACHMENT_MAGIC[mime];
  if (magic === undefined || !bytes.subarray(0, magic.length).equals(magic)) return false;
  return mime !== 'image/webp' || bytes.subarray(8, 12).toString('latin1') === 'WEBP';
}

/**
 * Where a card's attachment bytes live: `KANBAN_ATTACHMENTS_ROOT`, else `~/.cloudcli/kanban-attachments`.
 *
 * Read at CALL time, never captured at module load, so a probe that redirects the variable touches
 * nothing of the operator's (Interfaces §10). It sits outside the work tree deliberately: a runtime
 * write path never lands inside the repository.
 */
export function attachmentsRoot(): string {
  return expandHome(process.env.KANBAN_ATTACHMENTS_ROOT || '~/.cloudcli/kanban-attachments');
}

/**
 * An attachment that is not there is a 404, and this is the one place that sentence is written.
 *
 * Exported because `resolveAttachmentFile` and `removeAttachment` answer `null`/`false` by contract
 * and the ROUTE is what turns that into a response: one refusal, one code and one sentence for
 * every caller, rather than each route's own paraphrase of the store's words.
 */
export function attachmentNotFound(attachmentId: string): AppError {
  return new AppError(`No kanban attachment with id "${attachmentId}".`, {
    code: 'KANBAN_ATTACHMENT_NOT_FOUND',
    statusCode: 404,
  });
}

/**
 * The on-disk path for an attachment, DERIVED from its id and the extension of its VALIDATED mime.
 *
 * `null` when the mime is not on the allowlist, or when a path segment would step outside the root
 * — `resolveUnderRoot` is the repository's one containment predicate, shared with the chat-assets
 * resolver, so this is not a second copy of a security check that could drift from that one.
 */
function attachmentPath(cardId: string, attachmentId: string, mime: string): string | null {
  const ext = ATTACHMENT_MIME_TO_EXT[mime];
  if (ext === undefined) return null;

  return resolveUnderRoot(attachmentsRoot(), cardId, `${attachmentId}.${ext}`);
}

/**
 * One attachment row, card-scoped.
 *
 * The card id is part of the lookup rather than merely context: an id that belongs to another card
 * is not found here, so a URL naming a card and an attachment that do not go together answers 404
 * rather than handing back one card's bytes through another card's path.
 */
function findAttachment(cardId: string, attachmentId: string): KanbanAttachment | null {
  return kanbanChecklistDb.listAttachments(cardId).find((row) => row.id === attachmentId) ?? null;
}

/**
 * Stores one attachment: the bytes to disk first, the row second, one `attachment.added` event.
 *
 * The whole gate is applied HERE as well as at the door, because the door is not the only caller
 * that can exist: a blob whose type is not on the allowlist has no derivable extension, so it is
 * refused rather than written to a name the next reader could not reconstruct — and the bytes are
 * SNIFFED against the claimed mime, because the multipart part's headers cannot be, which is what
 * makes the row's `mime` (and so the download's `Content-Type`) a fact rather than the caller's
 * claim. `server_api.py:360-399`'s order: mime, then the bytes decode to something, then the size,
 * then the header.
 *
 * The bytes are written inside the seam's transaction (the minted id is what names the file, so the
 * id cannot precede it) and the row is inserted after them, in the same transaction: a disk failure
 * rolls the row back and leaves at most an orphan blob, never a card pointing at a file that is not
 * there. `store_attachments.py`'s `add_attachment` order exactly.
 *
 * A blank filename is defaulted rather than refused: it is a display label, the client's browser
 * always sends one, and the store never uses it as a path component (`server_api.py:392`).
 */
export function addAttachment(
  cardId: string,
  file: { filename: string; mime: string; bytes: Buffer },
  context?: KanbanWriteContext
): KanbanAttachment {
  const mime = file.mime;
  if (!isAllowedAttachmentMime(mime)) {
    throw new AppError(`An attachment must be one of ${Object.keys(ATTACHMENT_MIME_TO_EXT).join(', ')}.`, {
      code: 'KANBAN_ATTACHMENT_MIME_REFUSED',
      statusCode: 422,
    });
  }

  const bytes = file.bytes;
  // Empty bytes are refused before the sniff for the same reason the reference distinguishes them:
  // a zero-length file has no header to check, and a row claiming `image/png` over nothing serves a
  // 0-byte image the browser cannot render.
  if (bytes.length === 0) {
    throw new AppError('An attachment cannot be empty.', {
      code: 'KANBAN_ATTACHMENT_EMPTY',
      statusCode: 422,
    });
  }

  if (bytes.length > ATTACHMENT_MAX_BYTES) {
    throw new AppError(`An attachment may be at most ${ATTACHMENT_MAX_BYTES} bytes.`, {
      code: 'KANBAN_ATTACHMENT_TOO_LARGE',
      statusCode: 413,
    });
  }

  // LAST of the gate, and the only step that reads the bytes themselves: everything above trusts
  // the caller's word for the type, and this is what makes the row's mime a fact rather than a
  // claim. Without it a text file named `image/png` is stored as `<id>.png` and served back as one.
  if (!looksLikeMime(mime, bytes)) {
    throw new AppError(`The uploaded bytes are not a valid ${mime} file.`, {
      code: 'KANBAN_ATTACHMENT_CONTENT_REFUSED',
      statusCode: 422,
    });
  }

  const filename = file.filename.trim() === '' ? 'attachment' : file.filename.trim();
  const card = requireCardRow(cardId);

  return writeKanban(
    {
      kind: 'attachment.added',
      cardId,
      boardId: card.board_id,
      actor: context?.actor,
      // The id is minted inside the transaction, so the event names its subject from the mutation.
      payload: (attachment) => ({ attachment_id: attachment.id, filename }),
    },
    () => {
      const id = kanbanIdsDb.mintId('a');
      const stored = attachmentPath(cardId, id, mime);
      // Unreachable: the mime was checked above and both the card and the freshly minted id are
      // filesystem-safe. If it ever fires, nothing was written — refuse loudly rather than fall
      // through to a `writeFileSync(null)`, which would be a TypeError from four frames down.
      if (stored === null) {
        throw new AppError(`Could not derive a path for attachment "${id}".`, {
          code: 'KANBAN_ATTACHMENT_PATH_REFUSED',
          statusCode: 500,
        });
      }

      fs.mkdirSync(path.dirname(stored), { recursive: true });
      fs.writeFileSync(stored, bytes);

      return kanbanChecklistDb.insertAttachment({
        id,
        cardId,
        filename,
        mime,
        // The bytes' own length, never a client's claim about it.
        size: bytes.length,
      });
    }
  );
}

/**
 * Where one attachment's bytes are, and what to serve them as — or null when nothing answers.
 *
 * Null covers all four misses the serving route must not distinguish: no such row, a mime with no
 * derivable extension, a path that would leave the root, and a row whose file is not on disk. That
 * last one is the board's standing discipline (`kanban-types.ts:276`): the file is the truth about
 * the bytes, so a row whose file went away is a 404 and not a zero-length download.
 */
export function resolveAttachmentFile(
  cardId: string,
  attachmentId: string
): { path: string; mime: string; filename: string } | null {
  const attachment = findAttachment(cardId, attachmentId);
  if (attachment === null) return null;

  const stored = attachmentPath(cardId, attachment.id, attachment.mime);
  if (stored === null || !fs.existsSync(stored)) return null;

  return { path: stored, mime: attachment.mime, filename: attachment.filename };
}

/**
 * Removes one attachment: the row and its event in the seam, then the file.
 *
 * Answers `false` for an attachment that is not there, and appends no event for one — a stale id
 * must not tick the stream. The unlink is BEST-EFFORT and happens after the row is committed,
 * `store_attachments.py:delete_attachment`'s order: the row is the source of truth for every reader,
 * so an un-removable file is never a reason to roll back a delete the operator asked for.
 *
 * THAT ORPHAN IS NOT RECLAIMED BY ANYTHING HERE. Descent's `purge_feature_attachments` was not
 * ported — this repository has no sweep over `<root>/<cardId>/` — so a failed unlink, a rolled-back
 * write, or a card deleted straight from the database leaves bytes under the root that only the
 * operator's own `rm` will take back. The delete's own success path is unaffected (the row and the
 * file both go), and the honest statement of the gap belongs beside the choice that leaves it.
 *
 * The row's own delete is the one statement here with no repository verb: `kanban-checklist.db.ts`
 * carries the attachment INSERT and LIST but no delete, and this phase's manifest does not include
 * that file. So it runs on the handle the write seam hands its mutation — which is the same
 * connection, inside the same transaction, as the event written beside it.
 */
export function removeAttachment(
  cardId: string,
  attachmentId: string,
  context?: KanbanWriteContext
): boolean {
  const attachment = findAttachment(cardId, attachmentId);
  if (attachment === null) return false;

  const card = requireCardRow(cardId);
  const stored = attachmentPath(cardId, attachment.id, attachment.mime);

  writeKanban(
    {
      kind: 'attachment.removed',
      cardId,
      boardId: card.board_id,
      actor: context?.actor,
      payload: { attachment_id: attachmentId },
    },
    (db) => {
      const deleted = db
        .prepare('DELETE FROM kanban_attachments WHERE id = ? AND card_id = ?')
        .run(attachmentId, cardId);
      // Gone between the read above and this statement: refuse rather than emit an event for a
      // removal that removed nothing.
      if (deleted.changes === 0) throw attachmentNotFound(attachmentId);
    }
  );

  if (stored !== null) {
    try {
      fs.unlinkSync(stored);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // A file that was already gone is the state we wanted. Anything else is worth a line: the row
      // is gone either way, and the leftover blob is what the operator has to be told about.
      if (code !== 'ENOENT') {
        console.error(
          `[Kanban] removed attachment ${attachmentId} but could not unlink ${stored}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  return true;
}

/** The verbs in the one-object shape `kanban.module.ts` hands the route package. */
export type KanbanAttachmentsService = {
  addAttachment: typeof addAttachment;
  resolveAttachmentFile: typeof resolveAttachmentFile;
  removeAttachment: typeof removeAttachment;
};

export const kanbanAttachmentsService: KanbanAttachmentsService = {
  addAttachment,
  resolveAttachmentFile,
  removeAttachment,
};
