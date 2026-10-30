import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CompanionFaceManifest } from '@/shared/companion-types.js';

import { normalizePhoto } from './face-atlas.js';
import { FaceBakeRefusal, FacePhotoInvalid } from './face-refusal.js';
import { recipeId } from './face-recipe.js';

/**
 * THE FACES ROOT and everything under it, content-addressed:
 *
 *   <root>/seed.json                    the original's photo id, written once
 *   <root>/bake.lock, comfyui.pid       the baker's pid, for the operator (the lock itself is a socket: `face-lock.ts`), and ComfyUI's (`comfyui.ts`)
 *   <root>/comfyui/{input,output,temp}  ComfyUI's folders, the bake's own
 *   <root>/<photoId>/photo.png          the photo, orientation applied, alpha flattened, at most 2048 px
 *   <root>/<photoId>/frames/            the 512 px crop cache
 *   <root>/<photoId>/<recipeId>/        a face: manifest.json, sheet-N.webp, contact.webp
 *
 * A photo id is the first 12 hex of the sha256 of the uploaded bytes; the face id on every wire is `<photoId>-<recipeId>`.
 */

const PHOTO_ID_PATTERN = /^[0-9a-f]{12}$/;
const RECIPE_ID_PATTERN = /^[0-9a-f]{8}$/;
const FACE_ID_PATTERN = /^[0-9a-f]{12}-[0-9a-f]{8}$/;

/** The seed photo when `COMPANION_FACE_SEED` names none. */
const DEFAULT_SEED_PHOTO = path.join(os.homedir(), '.claude', 'state', 'images', 'kaylee', 'kaylee-portrait-base.jpg');

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
 * share (and truncate) a scratch, then renamed into place. A failed write leaves no scratch behind. Consumed by this file
 * and by `face-bake.ts` (the frame cache and the manifest).
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

/** Consumed by `face.routes.ts` and `face.service.ts`: whether a string from the wire is a face id before it names a path. */
export function isFaceId(candidate: string): boolean {
  return FACE_ID_PATTERN.test(candidate);
}

/** The photo a face id was made from: its first half. `faceId` must be a face id (`isFaceId`). Consumed by `face.service.ts`. */
export function photoIdOfFace(faceId: string): string {
  if (!FACE_ID_PATTERN.test(faceId)) throw new Error(`"${faceId}" is not a face id`);
  return faceId.slice(0, 12);
}

/** The recipe a face id was made under: its second half. `faceId` must be a face id (`isFaceId`). Consumed by `face.service.ts`, which brings every face whose recipe is no longer the current one up to date. */
export function recipeIdOfFace(faceId: string): string {
  if (!FACE_ID_PATTERN.test(faceId)) throw new Error(`"${faceId}" is not a face id`);
  return faceId.slice(13);
}

/** The face id the CURRENT recipe makes of a photo. Consumed by `face-bake.ts` and `face.service.ts`. */
export function faceIdOf(photoId: string): string {
  return `${photoId}-${recipeId()}`;
}

/**
 * A path under the root joined from ids that already matched their patterns, resolved and checked to lie strictly inside
 * the root: the one gate every path of this file passes, so no id can name a place outside it.
 */
function insideRoot(...ids: string[]): string {
  const root = path.resolve(facesRoot());
  const target = path.resolve(root, ...ids);
  const relative = path.relative(root, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`the path ${target} is not inside the faces root`);
  }
  return target;
}

/** `<root>/<photoId>`: the photo and its frame cache. Consumed by `face-bake.ts`. */
export function photoDir(photoId: string): string {
  if (!PHOTO_ID_PATTERN.test(photoId)) throw new Error(`"${photoId}" is not a photo id`);
  return insideRoot(photoId);
}

/** `<root>/<photoId>/<recipeId>`: a face's folder. Consumed by `face-bake.ts` and `face.service.ts` (the files it serves). */
export function faceDir(faceId: string): string {
  if (!FACE_ID_PATTERN.test(faceId)) throw new Error(`"${faceId}" is not a face id`);
  return insideRoot(faceId.slice(0, 12), faceId.slice(13));
}

/** A face's manifest, or null while it is not made: a face whose manifest exists is whole, because the bake writes it last. Consumed by `face-bake.ts` and `face.service.ts`. */
export async function readManifest(faceId: string): Promise<CompanionFaceManifest | null> {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(faceDir(faceId), 'manifest.json'), 'utf8')) as CompanionFaceManifest;
    return manifest.version === 1 ? manifest : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * The face of `photoId` that was published last, under whatever recipe made it, or null when the photo has none. A face is
 * published when its `manifest.json` is renamed into place, so that file's age is the face's. It is what the original's
 * pages keep drawing while the original is being made again under a new recipe. Consumed by `face.service.ts`.
 */
export async function newestPublishedFaceOf(photoId: string): Promise<string | null> {
  const folder = photoDir(photoId);
  let entries;
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let newest: { faceId: string; publishedAt: number } | null = null;
  for (const entry of entries) {
    if (!entry.isDirectory() || !RECIPE_ID_PATTERN.test(entry.name)) continue;
    try {
      const { mtimeMs } = await fs.stat(path.join(folder, entry.name, 'manifest.json'));
      if (newest === null || mtimeMs > newest.publishedAt) newest = { faceId: `${photoId}-${entry.name}`, publishedAt: mtimeMs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return newest?.faceId ?? null;
}

/**
 * Stores a photo as `<photoId>/photo.png`, normalized, and answers its id. The same bytes are the same folder, so an upload
 * of a photo already made finds its frames and its faces where they were. Consumed by the CLI and `face.service.ts`.
 */
export async function storePhoto(bytes: Buffer): Promise<{ photoId: string; width: number; height: number }> {
  const { png, photoId, width, height } = await normalizePhoto(bytes);
  await writePhotoFile(photoId, png);
  return { photoId, width, height };
}

async function writePhotoFile(photoId: string, png: Buffer): Promise<void> {
  const folder = photoDir(photoId);
  await fs.mkdir(folder, { recursive: true });
  await writeFileAtomically(path.join(folder, 'photo.png'), png);
}

/** The original's photo id as `seed.json` records it, or null before any is registered. */
async function readSeedId(): Promise<string | null> {
  try {
    const record = JSON.parse(await fs.readFile(path.join(facesRoot(), 'seed.json'), 'utf8')) as { photoId?: unknown };
    return typeof record.photoId === 'string' && PHOTO_ID_PATTERN.test(record.photoId) ? record.photoId : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Refuses when a DIFFERENT photo is already registered as the original, with the sentence for his screen. The CLI asks it
 * BEFORE the bake, so a conflict costs no frame; `recordSeed` asks it again before writing.
 */
export async function refuseIfSeedTaken(photoId: string): Promise<void> {
  const recorded = await readSeedId();
  if (recorded !== null && recorded !== photoId) {
    throw new FaceBakeRefusal(
      `The original face is already registered as photo ${recorded}. Remove ${path.join(facesRoot(), 'seed.json')} first to register ${photoId} instead.`,
    );
  }
}

/**
 * Records `photoId` as the original, ONCE: `seed.json` is written only when absent, so the original is the original even
 * after the seed file moves. A second, different id is refused rather than replacing it. Consumed by the CLI's `--seed`
 * and by `registerSeed`.
 */
export async function recordSeed(photoId: string): Promise<void> {
  await refuseIfSeedTaken(photoId);
  if ((await readSeedId()) === photoId) return;
  await fs.mkdir(facesRoot(), { recursive: true });
  await writeFileAtomically(path.join(facesRoot(), 'seed.json'), `${JSON.stringify({ photoId })}\n`);
}

/** The bytes of the file `COMPANION_FACE_SEED` names (default Kaylee's portrait), or null when it is not there. */
async function readSeedFile(): Promise<Buffer | null> {
  try {
    return await fs.readFile(process.env.COMPANION_FACE_SEED || DEFAULT_SEED_PHOTO);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function isPresent(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * The original's photo id: `seed.json`'s when it exists, else the photo `COMPANION_FACE_SEED` names, which is stored,
 * hashed and recorded. Null when nothing is recorded and that photo is not there. When `seed.json` names a photo whose
 * `photo.png` is gone, the seed file is stored again IF it still holds that very photo (same bytes, same id): the next bake
 * of the original needs the photo, and nobody can upload it. Consumed by `face.service.ts` at start, to bake the original
 * on a box that has none.
 */
export async function registerSeed(): Promise<string | null> {
  const recorded = await readSeedId();
  if (recorded !== null) {
    if (!(await isPresent(path.join(photoDir(recorded), 'photo.png')))) await restoreSeedPhoto(recorded);
    return recorded;
  }

  const bytes = await readSeedFile();
  if (bytes === null) return null;
  const { photoId } = await storePhoto(bytes);
  await recordSeed(photoId);
  return photoId;
}

async function restoreSeedPhoto(recorded: string): Promise<void> {
  const bytes = await readSeedFile();
  if (bytes === null) return;
  try {
    const { png, photoId } = await normalizePhoto(bytes);
    if (photoId === recorded) await writePhotoFile(photoId, png);
  } catch (error) {
    if (!(error instanceof FacePhotoInvalid)) throw error;
    console.error('[Companion] the seed file is no longer a photo, so the original\'s photo was not restored from it', error);
  }
}

/**
 * Removes every face the caller does not name, and every photo with no face left. `named` holds the face ids that must
 * survive (the original's, each account's current and pending face) and may hold a bare photo id to keep that photo's
 * folder with its `photo.png` and `frames/` though none of its faces survive (a photo whose bake is running). The photo
 * `seed.json` names is always kept so: after a recipe change the original's face does not exist yet, and its photo and its
 * frame cache are what make it cheap to make.
 *
 * The only recursive deletion of the seam (the others are single files it wrote itself: ComfyUI's pid file, the lock's note,
 * the padded source, an atomic write's scratch), and it removes only a path joined from ids the root's own listing produced
 * and that matched their exact patterns, resolved by `insideRoot` to lie strictly inside the root. A symlink is not a directory to
 * `readdir`'s types, so none is followed. A folder it cannot remove is logged and left, and the rest is still pruned. Answers
 * the face ids it removed. Consumed by `face.service.ts`.
 */
export async function prune(named: Set<string>): Promise<string[]> {
  const removed: string[] = [];
  const root = facesRoot();
  let photos;
  try {
    photos = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return removed;
    throw error;
  }

  const seedPhotoId = await readSeedId();
  for (const photo of photos) {
    if (!photo.isDirectory() || !PHOTO_ID_PATTERN.test(photo.name)) continue;
    let faces;
    try {
      faces = (await fs.readdir(path.join(root, photo.name), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && RECIPE_ID_PATTERN.test(entry.name));
    } catch (error) {
      console.error(`[Companion] the faces of photo ${photo.name} could not be listed for the prune`, error);
      continue;
    }
    let survivors = 0;
    for (const face of faces) {
      const faceId = `${photo.name}-${face.name}`;
      if (named.has(faceId) || !(await removeFolder(insideRoot(photo.name, face.name), faceId))) {
        survivors += 1;
        continue;
      }
      removed.push(faceId);
    }
    if (survivors === 0 && !named.has(photo.name) && photo.name !== seedPhotoId) {
      await removeFolder(insideRoot(photo.name), photo.name);
    }
  }
  return removed;
}

/** Removes one folder the prune chose; false, failure logged, when it cannot be, so one stubborn entry never stops the others. */
async function removeFolder(target: string, label: string): Promise<boolean> {
  try {
    await fs.rm(target, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error(`[Companion] the unused face ${label} could not be removed`, error);
    return false;
  }
}
