import fs from 'node:fs';

import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import multer from 'multer';

import { AppError } from '@/shared/utils.js';

import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MIME_TO_EXT,
  attachmentNotFound,
  isAllowedAttachmentMime,
} from '../kanban-attachments.service.js';
import type { KanbanAttachmentsService } from '../kanban-attachments.service.js';

/**
 * A card's attachments: the upload, the download and the removal.
 *
 * The three routes are the only ones in the package that touch bytes — every other route parses
 * JSON and calls one service verb. So this file is where the door's own vocabulary lives (the mime
 * allowlist, the size cap, the streaming headers) while the SERVICE owns where a byte lands: the
 * route hands over a buffer and never composes a path.
 *
 * The upload is multipart (field `file`) and REPLACES the metadata-only JSON route the board used
 * to carry at this path (`detail.routes.ts`, body `{ filename, mime, size }`) — a card whose drawer
 * lists an attachment must be able to download it, and nothing was ever able to produce those
 * bytes. Healed means deleted: that route and its body parsing are gone.
 *
 * Auth is the mount's (`authenticateToken` for `/api/kanban`, `kanbanMetisSecretGuard` for
 * `/api/kanban-pm`): no handler here reads an actor off the request. The DELETE is refused at the
 * child's door, ahead of this router (`kanban-metis.routes.ts`'s `OPERATOR_BYTES`) — an unattended
 * session does not destroy an operator's uploaded file. Reading and uploading are not refused: they
 * are how a build sees the screenshot it was handed.
 */

/** The dependencies this route package needs. `kanban.routes.ts` hands them over. */
export type AttachmentRouteDependencies = { attachments: KanbanAttachmentsService };

/** One handler, with its failure path attached once — `AppError`s render from the transport. */
function handle<P extends Record<string, string>>(
  run: (request: Request<P>, response: Response) => void
): RequestHandler<P> {
  return (request: Request<P>, response: Response, next: NextFunction) => {
    try {
      run(request, response);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Multer, in MEMORY — the service owns where a byte lands, so the transport never opens a file.
 *
 * The two limits are the door's, and they are ordered the way `server_api.py:360-399` orders its
 * gate: the type is refused before the body is read at all (`fileFilter` runs on the part's
 * headers), and the size is cut off BY multer as the bytes arrive, so an eight-hundred-megabyte
 * upload is closed at eight megabytes rather than buffered in full and then refused.
 *
 * `files: 1` is the single-file counterpart of the cap: this route takes one attachment, and a
 * second part is a caller's mistake rather than something to store.
 *
 * The refusal is an `AppError` carrying its own status, not a bare `Error`, so the handler below
 * can tell THIS refusal from the ones multer and busboy raise for themselves — a bare `Error` is
 * what a malformed multipart body arrives as, and answering that as an unacceptable TYPE would
 * describe a bad request as a bad file. The gate's own body-level steps (empty bytes, and the
 * header sniff a part's headers cannot make) live in the service, which is what the bytes reach.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_request, file, callback) => {
    if (isAllowedAttachmentMime(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(
      new AppError(`An attachment must be one of ${Object.keys(ATTACHMENT_MIME_TO_EXT).join(', ')}.`, {
        code: 'KANBAN_ATTACHMENT_MIME_REFUSED',
        statusCode: 422,
      })
    );
  },
  limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1 },
});

/**
 * The upload. `201` with the stored row, exactly as `server_api.py:h_add_attachment` answers.
 *
 * Every refusal arrives here as a CALLBACK error rather than a thrown one, so each is translated
 * back into the status it means: an over-cap body is the 413 the route table declares, the
 * `fileFilter`'s own refusal is the 422, and anything else — multer's own limits, and busboy's
 * malformed-multipart complaints, which reach this branch as plain `Error`s — is a bad REQUEST
 * (400). A missing part is a 400 too: the request named no attachment at all.
 */
function uploadAttachment(
  dependencies: AttachmentRouteDependencies
): RequestHandler<{ cardId: string }> {
  return (request, response, next) => {
    upload.single('file')(request, response, (error: unknown) => {
      if (error) {
        const message = error instanceof Error ? error.message : 'Upload failed';
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
          response
            .status(413)
            .json({ error: `An attachment may be at most ${ATTACHMENT_MAX_BYTES} bytes.` });
          return;
        }
        if (error instanceof multer.MulterError) {
          response.status(400).json({ error: message });
          return;
        }
        if (error instanceof AppError) {
          // The `fileFilter`'s refusal, carrying its own 422 — and the service's gate answers
          // through `next(error)` below, on the same status.
          response.status(error.statusCode).json({ error: error.message });
          return;
        }
        // Busboy's own complaint about the body itself ("Multipart: Boundary not found") — a
        // malformed request, and no business of the mime allowlist.
        response.status(400).json({ error: message });
        return;
      }

      const file = request.file;
      if (!file) {
        response.status(400).json({ error: 'An attachment needs a file.' });
        return;
      }

      try {
        const attachment = dependencies.attachments.addAttachment(request.params.cardId, {
          filename: file.originalname,
          mime: file.mimetype,
          bytes: file.buffer,
        });
        response.status(201).json({ attachment });
      } catch (thrown) {
        next(thrown);
      }
    });
  };
}

/**
 * The download: the stored bytes, labelled with the mime their row was stored under.
 *
 * `Content-Type` and `X-Content-Type-Options: nosniff` are the pair the assets route already sets
 * for the same reason — the browser renders what the ROW says the file is, never what a filename
 * claims and never a guess from the bytes. The path itself is the service's: a row's derived
 * location, or a 404. Nothing in the URL reaches the filesystem.
 */
function downloadAttachment(
  dependencies: AttachmentRouteDependencies
): RequestHandler<{ cardId: string; attachmentId: string }> {
  return handle<{ cardId: string; attachmentId: string }>((request, response) => {
    const { cardId, attachmentId } = request.params;
    const found = dependencies.attachments.resolveAttachmentFile(cardId, attachmentId);
    if (found === null) throw attachmentNotFound(attachmentId);

    // The file went away between the resolver's look and this one — the same 404 the resolver
    // would have answered a moment earlier, rather than a `statSync` throw rendered as a 500.
    let size: number;
    try {
      size = fs.statSync(found.path).size;
    } catch {
      throw attachmentNotFound(attachmentId);
    }

    response.setHeader('Content-Type', found.mime);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Length', String(size));

    const stream = fs.createReadStream(found.path);
    stream.on('error', (error) => {
      console.error('Error streaming kanban attachment:', error);
      if (!response.headersSent) {
        response.status(500).json({ error: 'Error reading attachment' });
      }
    });
    stream.pipe(response);
  });
}

/**
 * The removal: the row and its file, or a 404 for an attachment that is not there.
 *
 * It is the only one of the three with no bytes in the request or the answer — it names what it
 * destroyed and says so. On the `kanban-pm` mount it never runs: the guard refuses the method
 * before the router is reached.
 */
function removeAttachment(
  dependencies: AttachmentRouteDependencies
): RequestHandler<{ cardId: string; attachmentId: string }> {
  return handle<{ cardId: string; attachmentId: string }>((request, response) => {
    const removed = dependencies.attachments.removeAttachment(
      request.params.cardId,
      request.params.attachmentId
    );
    if (!removed) throw attachmentNotFound(request.params.attachmentId);

    response.json({ ok: true });
  });
}

export function createAttachmentRoutes(dependencies: AttachmentRouteDependencies): Router {
  const router = express.Router();

  router.post('/cards/:cardId/attachments', uploadAttachment(dependencies));
  router.get('/cards/:cardId/attachments/:attachmentId', downloadAttachment(dependencies));
  router.delete('/cards/:cardId/attachments/:attachmentId', removeAttachment(dependencies));

  return router;
}
