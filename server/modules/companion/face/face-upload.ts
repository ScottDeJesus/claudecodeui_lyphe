import sharp from 'sharp';

import { faceInvalid } from './face-errors.js';
import { storePhoto } from './face-files.js';
import { FacePhotoInvalid, sentences } from './face-refusal.js';

/**
 * What an upload must be before it is stored: one JPEG, PNG or WebP of at most 15 MB, readable, at least 512 px on its short
 * side. The size and the formats are checked here; the short side and the decoding are `normalizePhoto`'s (phase `bake`),
 * reached through `storePhoto`. Every refusal is a 400 `COMPANION_FACE_INVALID` whose message names what is wrong, and is the
 * sentence the Settings card shows under its button.
 */

/** The largest photo a page may upload, in bytes. Consumed by `face.routes.ts` (the multipart limit) and `acceptPhoto` (the sentence). */
export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;

/** sharp's names for the three formats an upload may be; the format is read from the bytes, never from the file's name or the part's type, which a page chooses. */
const ACCEPTED_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp']);

/** The sentence for a photo past the size limit. Consumed by `face.routes.ts`, where multer refuses it before the service sees it. */
export const photoTooLargeSentence = `That photo is larger than ${PHOTO_MAX_BYTES / (1024 * 1024)} MB. Choose a smaller one.`;

/**
 * Validates the uploaded bytes and stores them as a photo (`<photoId>/photo.png`), answering the photo id. Consumed by
 * `face.service.ts`, which calls it inside its exclusive section so a prune never runs between the store and the account's claim.
 */
export async function acceptPhoto(bytes: Buffer): Promise<{ photoId: string }> {
  if (bytes.length === 0) throw faceInvalid('That file is empty. Choose a JPEG, PNG or WebP photo.');
  if (bytes.length > PHOTO_MAX_BYTES) throw faceInvalid(photoTooLargeSentence);

  let format: string | undefined;
  try {
    format = (await sharp(bytes).metadata()).format;
  } catch {
    throw faceInvalid(sentences.unreadable());
  }
  if (format === undefined) throw faceInvalid(sentences.unreadable());
  if (!ACCEPTED_FORMATS.has(format)) {
    throw faceInvalid(`That file is a ${format.toUpperCase()} picture, and her face is made from a JPEG, PNG or WebP photo. Choose one of those.`);
  }

  try {
    const { photoId } = await storePhoto(bytes);
    return { photoId };
  } catch (error) {
    if (error instanceof FacePhotoInvalid) throw faceInvalid(error.message);
    throw error;
  }
}
