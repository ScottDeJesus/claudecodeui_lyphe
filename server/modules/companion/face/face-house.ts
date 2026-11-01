import type { CompanionFaceAvatar } from '@/shared/companion-types.js';

import { HOUSE_AVATARS, seedFileOf, type HouseAvatar } from './face-avatars.js';
import { faceIdOf, newestPublishedFaceOf, readManifest } from './face-files.js';
import { registerHouseAvatars } from './face-house-ids.js';
import { bakeOfJob, type BakeJob } from './face-queue.js';
import { FACE_FRAMING } from './face-recipe.js';

/**
 * THE HOUSE'S LOOKS AT RUN TIME, the part of the face service that belongs to no account: for each house avatar (`face-avatars.ts`)
 * its photo id, the face it is DRAWN with (its current face when that is published, else its newest published one, else none), its
 * CURRENT face (the photo under the look's framing and the current recipe, made or not) and, while its bake has failed, the sentence.
 * A house look has no database row, so all of it is held in memory and found again at each start.
 *
 * `register` is the start's half of it and `made` / `failed` the bake's end; between them every read is a plain read of memory, so the
 * face service answers `faceOf` without waiting on the disk. Until `register` has found out what every look is (its face, or no seed
 * photo at all) the house is not `known`: a prune before that would take a look's face for garbage.
 */

/** A house look's photo with the look it belongs to, as `start` needs it to queue the look's bake. */
type HouseBake = { look: HouseAvatar; photoId: string };

/**
 * Consumed by `face.service.ts`, once per service. `jobOf` is the queue's: the job making a face, so each look's `bake` is read where the queue holds it.
 * `ownFaces` names the faces the accounts made from their own photos, which are made under the HOUSE framing: a look framed otherwise (Brown hair's)
 * never falls back to one of them while its own face is not published, though it is a published face of the same photo.
 */
export function createHouse(jobOf: (faceId: string) => BakeJob | undefined, ownFaces: () => Set<string>) {
  /** Each key's photo id as `register` recorded it; a key whose seed file is not there is null. Empty before `register`. */
  let photoIds = new Map<string, string | null>();
  /** Each key's drawn face. Read by `faceOf` on every picture, so it is held and not looked up on the disk; set by `register` and again by `made`. */
  let drawn = new Map<string, string | null>();
  /** Each key's failed bake's sentence, until the look is made. A house look has no row to hold it, and a restart is a new try. */
  const failures = new Map<string, string>();
  /** Whether `register` has found every look's face (or that it has no photo). A prune before that, or after a look could not be read, would take a face for garbage. */
  let known = false;

  /** The current face of a look: its photo under its framing and the current recipe; null while the look has no photo. */
  function currentOf(look: HouseAvatar): string | null {
    const photoId = photoIds.get(look.key);
    return photoId ? faceIdOf(photoId, look.framing) : null;
  }

  /** The face a look is drawn with, read from the disk: its current face if published, else its newest published face, else null. */
  async function findDrawn(look: HouseAvatar): Promise<string | null> {
    const photoId = photoIds.get(look.key);
    if (!photoId) return null;
    const current = faceIdOf(photoId, look.framing);
    return (await readManifest(current)) ? current : newestPublishedFaceOf(photoId, look.framing === FACE_FRAMING ? undefined : ownFaces());
  }

  /** The looks whose current face is `faceId`. */
  const looksMaking = (faceId: string): HouseAvatar[] => HOUSE_AVATARS.filter((look) => currentOf(look) === faceId);

  return {
    /** Whether `register` found every look. Consumed by `face.service.ts`'s prune. */
    isKnown: (): boolean => known,

    /**
     * Registers the house's avatars (their photos stored and recorded, `face-house-ids.ts`) and finds each look's drawn face. A look
     * whose seed file is missing is logged and has no photo: the others stand. A look whose face cannot be read is logged and leaves
     * the house unknown, so nothing is pruned on it. An `avatars.json` that cannot be read rejects.
     */
    async register(): Promise<void> {
      photoIds = await registerHouseAvatars();
      const found = new Map<string, string | null>();
      let everyLookFound = true;
      for (const look of HOUSE_AVATARS) {
        if (!photoIds.get(look.key)) console.warn(`[Companion] the house avatar "${look.key}" has no photo: its seed file ${seedFileOf(look)} is not there, so it is not offered`);
        try {
          found.set(look.key, await findDrawn(look));
        } catch (error) {
          everyLookFound = false;
          console.error(`[Companion] the face of the house avatar "${look.key}" could not be read`, error);
        }
      }
      drawn = found;
      known = everyLookFound;
    },

    /** The looks that have a photo and whose current face is not published, which `start` queues the bake of. */
    unpublished(): HouseBake[] {
      const looks: HouseBake[] = [];
      for (const look of HOUSE_AVATARS) {
        const photoId = photoIds.get(look.key);
        if (photoId && drawn.get(look.key) !== currentOf(look)) looks.push({ look, photoId });
      }
      return looks;
    },

    /** Whether `faceId` is a house look's current face: a bake of it moves every account's picker, whoever asked for the bake. Consumed by `face.service.ts`'s `hearersOf`. */
    makes: (faceId: string): boolean => looksMaking(faceId).length > 0,

    /** A bake of `faceId` ended made: every look it is the current face of is drawn with it from now, and no longer failed. */
    async made(faceId: string): Promise<void> {
      for (const look of looksMaking(faceId)) {
        drawn.set(look.key, await findDrawn(look));
        failures.delete(look.key);
      }
    },

    /** A bake of `faceId` was refused: every look it is the current face of shows `sentence` until it is made. */
    failed(faceId: string, sentence: string): void {
      for (const look of looksMaking(faceId)) failures.set(look.key, sentence);
    },

    /** The house's part of `CompanionFace.avatars`: every look in the house's order, with its drawn face and its bake (queued, baking or failed). */
    avatars(): CompanionFaceAvatar[] {
      return HOUSE_AVATARS.map((look) => {
        const current = currentOf(look);
        const job = current === null ? undefined : jobOf(current);
        const failure = failures.get(look.key);
        const bake = job ? bakeOfJob(job) : failure === undefined ? null : ({ state: 'failed', error: failure } as const);
        return { key: look.key, label: look.label, faceId: drawn.get(look.key) ?? null, bake };
      });
    },

    /** Every face a page of any account may read and the prune keeps: each look's current and drawn face. */
    faces(): Set<string> {
      const faces = new Set<string>();
      for (const look of HOUSE_AVATARS) {
        for (const faceId of [currentOf(look), drawn.get(look.key)]) if (faceId) faces.add(faceId);
      }
      return faces;
    },
  };
}
