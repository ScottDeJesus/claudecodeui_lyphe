import fs from 'node:fs/promises';
import path from 'node:path';

import type { CompanionFaceManifest } from '@/shared/companion-types.js';

import { readHouseIds } from './face-house-ids.js';
import { FACE_FRAMING, recipeId, type FaceFraming } from './face-recipe.js';
import { facesRoot, insideRoot, isPhotoId, photoDir } from './face-root.js';

// The root and the photo store live in `face-root.ts` (a leaf, so the prune can read `face-house-ids.ts` without a cycle); the rest of the seam reads them from here.
export { facesRoot, isPresent, photoDir, storePhoto, writeFileAtomically } from './face-root.js';

/**
 * THE FACES ROOT and everything under it, content-addressed:
 *
 *   <root>/avatars.json                 each house avatar's photo id by key, written once per key (`face-house-ids.ts`)
 *   <root>/bake.lock, comfyui.pid       the baker's pid, for the operator (the lock itself is a socket: `face-lock.ts`), and ComfyUI's (`comfyui.ts`)
 *   <root>/comfyui/{input,output,temp}  ComfyUI's folders, the bake's own
 *   <root>/<photoId>/photo.png          the photo, orientation applied, alpha flattened, at most 2048 px
 *   <root>/<photoId>/frames/            the 512 px crop cache
 *   <root>/<photoId>/<recipeId>/        a face: manifest.json, sheet-<size>-<n>.webp (every tier), contact.webp
 *
 * A photo id is the first 12 hex of the sha256 of the uploaded bytes; the face id on every wire is `<photoId>-<recipeId>`, the recipe
 * id being the one `recipeId(framing)` makes for the look's framing.
 */

const RECIPE_ID_PATTERN = /^[0-9a-f]{8}$/;
const FACE_ID_PATTERN = /^[0-9a-f]{12}-[0-9a-f]{8}$/;

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

/** The face id the CURRENT recipe makes of a photo for a look framed `framing` (the house's by default, an account's own photo's). Consumed by `face-bake.ts` and `face.service.ts`. */
export function faceIdOf(photoId: string, framing: FaceFraming = FACE_FRAMING): string {
  return `${photoId}-${recipeId(framing)}`;
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
 * published when its `manifest.json` is renamed into place, so that file's age is the face's. It is what a house look
 * keeps drawing (`face-house.ts`) while it is made again under a new recipe. A face in `excluded` is never answered: it is another
 * look's, made from the same photo under another framing. Consumed by `face-house.ts`.
 */
export async function newestPublishedFaceOf(photoId: string, excluded: ReadonlySet<string> = new Set()): Promise<string | null> {
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
    if (!entry.isDirectory() || !RECIPE_ID_PATTERN.test(entry.name) || excluded.has(`${photoId}-${entry.name}`)) continue;
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
 * Removes every face the caller does not name, and every photo with no face left. `named` holds the face ids that must
 * survive (each house look's current and drawn face, each account's current and pending face) and may hold a bare photo id to keep that photo's
 * folder with its `photo.png` and `frames/` though none of its faces survive (a photo whose bake is running). Every photo
 * `avatars.json` names is always kept so: after a recipe change a house look's face does not exist yet, and its photo and its
 * frame cache are what make it cheap to make.
 *
 * The only recursive deletion of the seam (the others are single files it wrote itself: ComfyUI's pid file, the lock's note,
 * the padded source, an atomic write's scratch), and it removes only a path joined from ids the root's own listing produced
 * and that matched their exact patterns, resolved by `insideRoot` to lie strictly inside the root. A symlink is not a directory to
 * `readdir`'s types, so none is followed. A folder it cannot remove is logged and left, and the rest is still pruned. Answers
 * the face ids it removed. An `avatars.json` that cannot be read throws before anything is removed. Consumed by `face.service.ts`.
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

  const housePhotoIds = new Set(Object.values(await readHouseIds()));
  for (const photo of photos) {
    if (!photo.isDirectory() || !isPhotoId(photo.name)) continue;
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
    if (survivors === 0 && !named.has(photo.name) && !housePhotoIds.has(photo.name)) {
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
