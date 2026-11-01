import express from 'express';
import type { Request, Response, Router } from 'express';
import multer from 'multer';

import { asyncHandler, readAuthenticatedUserId, readPathParam } from '@/shared/utils.js';

import { faceInvalid } from './face-errors.js';
import { PHOTO_MAX_BYTES, photoTooLargeSentence } from './face-upload.js';
import { faceService } from './face.service.js';

/**
 * Her face's five routes, mounted by `createCompanionRoutes` at `/api/companion/face` behind `authenticateToken`. ONLY
 * TRANSPORT: each route reads who is asking, parses what came, calls one verb of the face service and answers.
 *
 *   POST   /                     multipart, one `photo` of at most 15 MB: 200 `{ face }` when that photo's face was already made and is now
 *                                hers, 202 `{ face }` while it is made (its progress comes as `companion_face` frames)
 *   DELETE /                     200 `{ face }`, the original
 *   GET    /:faceId/manifest     the face's `CompanionFaceManifest`
 *   GET    /:faceId/sheet/:file  one sheet, `image/webp`, by the file name the manifest gives it (every tier's sheets are named there)
 *   GET    /:faceId/contact      the contact sheet (every frame named), `image/webp`
 *
 * A file is served only for the original and the face the asking account names (404 `COMPANION_FACE_NOT_FOUND` for any other),
 * with `Cache-Control: private, max-age=31536000, immutable`: a face id names its bytes for ever. The refusals are the app's own
 * `AppError` envelope: 400 `COMPANION_FACE_INVALID` (its message is the sentence the card shows), 404, and 503 `COMPANION_STOPPING`.
 * Like her memory, the face is no page's, so these name no `x-companion-client`. Consumed by `companion.routes.ts`.
 */

/** A face id names its bytes for ever (the bake writes a face once, under an id made of its photo and its recipe), so a page never asks twice. */
const FACE_FILE_CACHE_CONTROL = 'private, max-age=31536000, immutable';

/**
 * One file and no text field, so a body of nothing but fields is refused at the first one instead of held in memory. The file
 * limit is ONE BYTE past the largest photo: the parser cuts a part that REACHES its limit, so a photo of exactly the largest
 * size would otherwise be refused, and `acceptPhoto` (inclusive) is what says whether a photo is too large.
 */
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PHOTO_MAX_BYTES + 1, files: 1, fields: 0 } }).single('photo');

/** The photo of the multipart body, or the 400 that says what to send. Multer's own refusals are the photo's: too large, or not one file in the field `photo`. */
async function readPhoto(request: Request, response: Response): Promise<Buffer> {
  await new Promise<void>((resolve, reject) => {
    photoUpload(request, response, (failure?: unknown) => {
      if (failure === undefined || failure === null) return resolve();
      const tooLarge = failure instanceof multer.MulterError && failure.code === 'LIMIT_FILE_SIZE';
      reject(faceInvalid(tooLarge ? photoTooLargeSentence : 'Send one photo, as one multipart file in the field named photo.'));
    });
  });
  if (!request.file) throw faceInvalid('Choose a photo to upload: one JPEG, PNG or WebP file, in the field named photo.');
  return request.file.buffer;
}

/** Serves one face file, by its name in the face's folder (the service refuses a name that is not one of a face's files), with its cache header. `dotfiles: 'allow'` because the faces root lives under `~/.cloudcli`, which `sendFile` would otherwise refuse as a hidden path. */
function sendFaceFile(request: Request, response: Response, fileName: string): void {
  const location = faceService.fileFor(readAuthenticatedUserId(request), readPathParam(request.params.faceId, 'faceId'), fileName);
  response.sendFile(location, { dotfiles: 'allow', cacheControl: false, headers: { 'Cache-Control': FACE_FILE_CACHE_CONTROL } });
}

/** Consumed by `companion.routes.ts`. */
export function createFaceRoutes(): Router {
  const router = express.Router();

  router.post(
    '/',
    asyncHandler(async (request: Request, response: Response) => {
      const userId = readAuthenticatedUserId(request);
      const { face, switched } = await faceService.upload(userId, { bytes: await readPhoto(request, response) });
      response.status(switched ? 200 : 202).json({ face });
    }),
  );

  router.delete(
    '/',
    asyncHandler(async (request: Request, response: Response) => {
      response.json({ face: faceService.restore(readAuthenticatedUserId(request)) });
    }),
  );

  router.get(
    '/:faceId/manifest',
    asyncHandler(async (request: Request, response: Response) => sendFaceFile(request, response, 'manifest.json')),
  );

  router.get(
    '/:faceId/sheet/:file',
    asyncHandler(async (request: Request, response: Response) => sendFaceFile(request, response, readPathParam(request.params.file, 'file'))),
  );

  router.get(
    '/:faceId/contact',
    asyncHandler(async (request: Request, response: Response) => sendFaceFile(request, response, 'contact.webp')),
  );

  return router;
}
