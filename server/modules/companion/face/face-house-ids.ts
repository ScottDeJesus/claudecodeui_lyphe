import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizePhoto } from './face-atlas.js';
import { DEFAULT_AVATAR_KEY, HOUSE_AVATARS, seedFileOf, type HouseAvatar } from './face-avatars.js';
import { FaceBakeRefusal, FacePhotoInvalid } from './face-refusal.js';
import { facesRoot, isPhotoId, isPresent, photoDir, storePhoto, writeFileAtomically, writePhotoFile } from './face-root.js';

/**
 * THE HOUSE'S IDS: `<root>/avatars.json`, each house avatar's photo id by its key (`{ "original": "<12 hex>", "office": "<12 hex>" }`),
 * and the registering of every house avatar's photo from its seed file (`face-avatars.ts`). A key is written ONCE, when its face is
 * first made (the CLI) or its seed file first stored (the start), so a house look holds even after its seed file moves. Another
 * photo for a recorded key is refused rather than replacing it, so a look's identity never shifts under the accounts that wear it.
 *
 * The one-photo store kept the original's id in `<root>/seed.json`; `registerHouseAvatars` records that id as the default key
 * and removes that file by its name.
 */

const AVATARS_FILE = 'avatars.json';
const LEGACY_SEED_FILE = 'seed.json';

const avatarsPath = (): string => path.join(facesRoot(), AVATARS_FILE);

/** Each house avatar's photo id, by key, as avatars.json records it; {} before any. An entry whose value is no photo id is not an id and is left out. A file that is not JSON, or is JSON but not an object of ids (`[]`, `null`), cannot be read as the house's ids and throws, so the prune removes nothing on it. Consumed by `face-files.ts` (the prune keeps every photo named here) and `face-house-ids.ts`'s own writers. */
export async function readHouseIds(): Promise<Record<string, string>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(avatarsPath(), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`${avatarsPath()} could not be read as the house's ids`, { cause: error });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${avatarsPath()} could not be read as the house's ids: it is not an object of photo ids`);
  }
  const ids: Record<string, string> = {};
  for (const [key, photoId] of Object.entries(parsed)) {
    if (typeof photoId === 'string' && isPhotoId(photoId)) ids[key] = photoId;
  }
  return ids;
}

function refuseIfTaken(ids: Record<string, string>, key: string, photoId: string): void {
  const recorded = ids[key];
  if (recorded !== undefined && recorded !== photoId) {
    throw new FaceBakeRefusal(
      `The house avatar "${key}" is already registered as photo ${recorded}. Remove "${key}" from ${avatarsPath()} first to register ${photoId} instead.`,
    );
  }
}

/** Refuses before a bake, as `recordHouseAvatar` would after it: a key recorded under a different photo, with the sentence for his screen. Consumed by `face-bake-cli.ts`, so a conflict costs no frame. */
export async function refuseIfHouseKeyTaken(key: string, photoId: string): Promise<void> {
  refuseIfTaken(await readHouseIds(), key, photoId);
}

/**
 * Records `photoId` as house avatar `key`, ONCE: the file is written only when the key is absent, so a look stays what it was
 * after its seed file moves. A key recorded under a different photo is refused with the sentence naming avatars.json and the key to
 * remove from it. Consumed by `registerHouseAvatars` and `face-bake-cli.ts` (`--house`).
 */
export async function recordHouseAvatar(key: string, photoId: string): Promise<void> {
  const ids = await readHouseIds();
  refuseIfTaken(ids, key, photoId);
  if (ids[key] === photoId) return;
  await fs.mkdir(facesRoot(), { recursive: true });
  await writeFileAtomically(avatarsPath(), `${JSON.stringify({ ...ids, [key]: photoId }, null, 2)}\n`);
}

/** The bytes of the file a house avatar is seeded from, or null when it is not there. */
async function readSeedFile(avatar: HouseAvatar): Promise<Buffer | null> {
  try {
    return await fs.readFile(seedFileOf(avatar));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * The one-photo store's `seed.json`, if one is left: its photo is recorded as the default key and the file removed, as one file by
 * its name. When avatars.json already records the default key under ANOTHER photo, avatars.json is the house's word and the file is
 * left, logged, for the operator.
 */
async function adoptLegacySeed(): Promise<void> {
  const file = path.join(facesRoot(), LEGACY_SEED_FILE);
  let seedId: string | null;
  try {
    const record = JSON.parse(await fs.readFile(file, 'utf8')) as { photoId?: unknown };
    seedId = typeof record.photoId === 'string' && isPhotoId(record.photoId) ? record.photoId : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const recorded = (await readHouseIds())[DEFAULT_AVATAR_KEY];
  if (seedId === null || (recorded !== undefined && recorded !== seedId)) {
    console.error(`[Companion] ${file} could not be adopted as "${DEFAULT_AVATAR_KEY}" in ${avatarsPath()} (it names ${seedId ?? 'no photo'}; avatars.json holds ${recorded ?? 'none'}); remove it by hand`);
    return;
  }
  await recordHouseAvatar(DEFAULT_AVATAR_KEY, seedId);
  await fs.rm(file, { force: true });
}

/** Stores a recorded photo's `photo.png` again from its seed file, IF that file still holds that very photo (same bytes, same id): the next bake of the look needs the photo, and nobody can upload it. */
async function restorePhoto(avatar: HouseAvatar, recorded: string): Promise<void> {
  const bytes = await readSeedFile(avatar);
  if (bytes === null) return;
  try {
    const { png, photoId } = await normalizePhoto(bytes);
    if (photoId === recorded) await writePhotoFile(photoId, png);
  } catch (error) {
    if (!(error instanceof FacePhotoInvalid)) throw error;
    console.error(`[Companion] the seed file of the house avatar "${avatar.key}" is no longer a photo, so its photo was not restored from it`, error);
  }
}

async function registerOne(avatar: HouseAvatar, recorded: string | undefined): Promise<string | null> {
  if (recorded !== undefined) {
    if (!(await isPresent(path.join(photoDir(recorded), 'photo.png')))) await restorePhoto(avatar, recorded);
    return recorded;
  }
  const bytes = await readSeedFile(avatar);
  if (bytes === null) return null;
  try {
    const { photoId } = await storePhoto(bytes);
    await recordHouseAvatar(avatar.key, photoId);
    return photoId;
  } catch (error) {
    // A look with no photo yet has no face to lose: the others still register.
    if (!(error instanceof FacePhotoInvalid)) throw error;
    console.error(`[Companion] the seed file of the house avatar "${avatar.key}" is not a usable photo, so it is not registered`, error);
    return null;
  }
}

/**
 * Registers every house avatar and answers each key's photo id in the house's order, or null for a key whose seed file is not
 * there. A recorded key keeps its photo, and its photo.png is stored again from its seed file when that file still holds the very
 * photo. An unrecorded key stores its seed file and records it. A seed.json left by the one-photo store is recorded as the default
 * key and removed by its one name. One look that cannot be registered (a seed or photo that cannot be read, a seed.json that is
 * not JSON) is logged and does not take the others' ids away: a recorded key still answers its recorded photo, so its face stays
 * named for the prune, and an unrecorded one answers null. An avatars.json that cannot be read still rejects, so nothing is pruned
 * on it. Consumed by `face.service.ts` at start.
 */
export async function registerHouseAvatars(): Promise<Map<string, string | null>> {
  try {
    await adoptLegacySeed();
  } catch (error) {
    console.error(`[Companion] the one-photo store's ${LEGACY_SEED_FILE} could not be adopted; it is left in place`, error);
  }
  const ids = await readHouseIds();
  const registered = new Map<string, string | null>();
  for (const avatar of HOUSE_AVATARS) {
    try {
      registered.set(avatar.key, await registerOne(avatar, ids[avatar.key]));
    } catch (error) {
      console.error(`[Companion] the house avatar "${avatar.key}" could not be registered`, error);
      registered.set(avatar.key, ids[avatar.key] ?? null);
    }
  }
  return registered;
}
