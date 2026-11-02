import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { normalizePhoto } from './face-atlas.js';

/**
 * THE FACES ROOT AND THE PHOTO STORE, the layer under `face-files.ts` and `face-house-ids.ts`: where the root is, the one gate
 * every path passes, an atomic write, and a photo stored as `<root>/<photoId>/photo.png`. It is a leaf of its own because the
 * prune (`face-files.ts`) reads the house's ids (`face-house-ids.ts`), which store photos: the two would import each other.
 * `face-files.ts` re-exports what the rest of the seam reads from here, so those two files are the only ones that name this one.
 */

const PHOTO_ID_PATTERN = /^[0-9a-f]{12}$/;

/** Whether a string is a photo id (12 hex) before it names a path. Consumed by `face-files.ts` (the prune's listing) and `face-house-ids.ts` (the ids `avatars.json` holds). */
export function isPhotoId(candidate: string): boolean {
  return PHOTO_ID_PATTERN.test(candidate);
}

/**
 * Where every face lives: `COMPANION_FACES_DIR`, else `~/.cloudcli/companion-faces`, always ABSOLUTE: ComfyUI runs in its own
 * folder, so a relative path would name one place to the bake and another to ComfyUI. Read on each call, so a probe may point
 * it elsewhere. Consumed by the whole seam and `face.service.ts`.
 */
export function facesRoot(): string {
  return path.resolve(process.env.COMPANION_FACES_DIR || path.join(os.homedir(), '.cloudcli', 'companion-faces'));
}

/**
 * Writes `file` whole or not at all: to a scratch beside it, named for this one call so that two writers of one file never
 * share (and truncate) a scratch, then renamed into place. A failed write leaves no scratch behind. Consumed by this file,
 * `face-house-ids.ts` (`avatars.json`) and `face-bake.ts` (the frame cache and the manifest).
 */
export async function writeFileAtomically(file: string, bytes: Buffer | string): Promise<void> {
  const scratch = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(scratch, bytes);
    await fs.rename(scratch, file);
  } catch (error) {
    await fs.rm(scratch, { force: true });
    throw error;
  }
}

/**
 * A path under the root joined from ids that already matched their patterns, resolved and checked to lie strictly inside
 * the root: the one gate every path of this seam's folders passes, so no id can name a place outside it. Consumed by this
 * file (`photoDir`) and `face-files.ts` (a face's folder, and the prune's two removals).
 */
export function insideRoot(...ids: string[]): string {
  const root = path.resolve(facesRoot());
  const target = path.resolve(root, ...ids);
  const relative = path.relative(root, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`the path ${target} is not inside the faces root`);
  }
  return target;
}

/** `<root>/<photoId>`: the photo and its frame cache. Consumed by `face-bake.ts`, `face-files.ts` and `face-house-ids.ts`. */
export function photoDir(photoId: string): string {
  if (!PHOTO_ID_PATTERN.test(photoId)) throw new Error(`"${photoId}" is not a photo id`);
  return insideRoot(photoId);
}

/** Whether `file` exists. Consumed by `face-bake.ts` (the frame cache) and `face-house-ids.ts` (a recorded photo's `photo.png`). */
export async function isPresent(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Writes a normalized photo as `<photoId>/photo.png`. Consumed by this file (`storePhoto`) and `face-house-ids.ts`, which stores a recorded photo again from its seed file. */
export async function writePhotoFile(photoId: string, png: Buffer): Promise<void> {
  const folder = photoDir(photoId);
  await fs.mkdir(folder, { recursive: true });
  await writeFileAtomically(path.join(folder, 'photo.png'), png);
}

/**
 * Stores a photo as `<photoId>/photo.png`, normalized, and answers its id. The same bytes are the same folder, so an upload
 * of a photo already made finds its frames and its faces where they were. Consumed by the CLI, `face-upload.ts` and `face-house-ids.ts`.
 */
export async function storePhoto(bytes: Buffer): Promise<{ photoId: string; width: number; height: number }> {
  const { png, photoId, width, height } = await normalizePhoto(bytes);
  await writePhotoFile(photoId, png);
  return { photoId, width, height };
}
