import fs from 'node:fs';
import path from 'node:path';

import { companionDb } from '@/modules/database/index.js';
import type { CompanionStateRow } from '@/modules/database/index.js';
import { sendToUser } from '@/modules/websocket/index.js';
import type { CompanionFace, CompanionFaceBake, CompanionFrame } from '@/shared/companion-types.js';

import { comfyuiDir, isComfyUIInstalled } from './comfyui.js';
import { DEFAULT_AVATAR_KEY, OWN_AVATAR_KEY, OWN_AVATAR_LABEL } from './face-avatars.js';
import { frameCacheIsComplete } from './face-bake.js';
import { faceInvalid, faceNoSuchLook, faceNotFound, faceStopping } from './face-errors.js';
import { faceDir, faceIdOf, isFaceId, photoIdOfFace, prune, readManifest, recipeIdOfFace } from './face-files.js';
import { createHouse } from './face-house.js';
import { bakeOfJob, createBakeQueue, type BakeJob, type BakeOutcome } from './face-queue.js';
import { recipeFrames, recipeId } from './face-recipe.js';
import { acceptPhoto } from './face-upload.js';

/**
 * EACH ACCOUNT'S LOOK, and the making of the faces behind it. She wears one of her AVATARS, each a portrait and the face made from it: the
 * house's looks (`face-avatars.ts`, held at run time by `face-house.ts`: no row, every account's) and his own photo. Three columns of
 * `companion_state` are his photo: `face_id` (the face made from it, NULL while none), `face_pending_id` (the face being made, which a restart
 * resumes) and `face_error` (the last bake's failure sentence); a fourth, `avatar`, is the look he PICKED (NULL until he picks, which reads
 * as the house's first). Clear leaves all four. `faceOf` answers the account's `CompanionFace`: the looks, the picked one's face, and each
 * look's bake. The service stores his pick (`pick`), takes an upload (`upload`) and removes his photo (`removeOwn`), serves a face's files to
 * the account that may read them (`fileFor`), and makes the faces on events: the queue runs the bakes one at a time in the order asked, in this process, under the
 * box-wide lock. A house look's bake and its end reach EVERY account's pages (every picker lists the house's looks); his photo's reach his
 * own, each as a `companion_face` frame.
 *
 * A LOOK'S FACE while it is made again under a new recipe is the newest face of it that is published, which the prune keeps, so a face on a
 * page never goes missing between recipes; a look has no face only until its first is made. An upload whose face is made, or whose bake ends
 * made, sets `face_id` and the pick becomes `own` (a bake that only re-makes the photo he wears under a new recipe leaves the pick). Removing
 * his photo clears the three columns, and a pick of `own` goes back to NULL.
 *
 * MODULE START (`start`) is the event the house recovers on: it registers the house's looks and finds each one's face, queues the bake of
 * each whose current face is not published when ComfyUI is installed or the photo's frame cache holds every frame (a recipe change that only
 * re-cuts renders nothing), re-queues every account's pending bake, makes again the face of any account whose recipe is no longer
 * current or whose files are gone, and prunes. A look that cannot be registered is logged and the rest stand. `stop` aborts the running
 * bake, which releases the lock, and leaves every pending id in the database for the next start.
 *
 * THE PRUNE keeps every look of the house (its current and drawn face), every account's `face_id`, `face_pending_id` and that pending face's
 * photo, and the queue's photos (`face-files.ts` also keeps every photo `avatars.json` names, and deletes only a path joined from an id that
 * matched its pattern and resolved to lie strictly inside the faces root). The prune and the store of an upload take turns (`exclusive`), so a
 * prune never lands between a photo being stored and an account claiming it, and it waits until the house is known.
 */

/** An uploaded photo as the route hands it over: the bytes of the one file, whose kind is read from the bytes themselves. */
export type FaceUpload = { bytes: Buffer };

/**
 * The names a page may ask of a face's folder: its manifest, its contact sheet (every frame named, for Settings' "See every frame")
 * and its sheets, which the manifest names (`sheet-<size>-<n>.webp` of each tier, `sheet-<n>.webp` of a face made before tiers).
 * Nothing else in the folder is the face's to serve, and no name can reach outside it.
 */
const FACE_FILE_NAME = /^(manifest\.json|contact\.webp|sheet-(\d{1,4}-)?\d{1,3}\.webp)$/;

type FaceColumns = Pick<CompanionStateRow, 'face_id' | 'face_pending_id' | 'face_error'>;

/** A face id from a stored column, or null for none or a value that is no face id (a hand edit): the picture must still load. */
const validFaceId = (stored: string | null | undefined): string | null => (stored && isFaceId(stored) ? stored : null);

/** Consumed by this file, once, as `faceService`. */
function createFaceService() {
  let stopped = false;
  /** The faces the accounts made from their own photos (made under the house framing), for the house to keep out of a look it frames otherwise. */
  const ownFaceIds = (): Set<string> => new Set(companionDb.listFaces().flatMap((row) => validFaceId(row.face_id) ?? []));
  /** The house's looks at run time: each one's photo, drawn face and failed bake. Its `register` is the start's. */
  const house = createHouse((faceId) => queue.jobOf(faceId), ownFaceIds);
  /** The end of the last exclusive section, which never rejects. */
  let exclusiveTail: Promise<unknown> = Promise.resolve();

  /** Runs `work` after every earlier exclusive section has ended. */
  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = exclusiveTail.then(work);
    exclusiveTail = run.catch(() => undefined);
    return run;
  }

  /** The making of his photo's face: its job's count while it is queued or baking (a pending face with no job is about to be queued), else the last failure's sentence, else none. */
  function ownBakeOf(columns: FaceColumns | null): CompanionFaceBake | null {
    const pending = validFaceId(columns?.face_pending_id);
    if (pending !== null) {
      const job = queue.jobOf(pending);
      return job ? bakeOfJob(job) : { state: 'queued', done: 0, total: recipeFrames().length };
    }
    return columns?.face_error ? { state: 'failed', error: columns.face_error } : null;
  }

  function faceOf(userId: number): CompanionFace {
    const columns = companionDb.readState(userId);
    const avatars = house.avatars();
    const ownBake = ownBakeOf(columns);
    const ownFaceId = validFaceId(columns?.face_id);
    // His photo is a look while the account holds a face made from it, one being made, or the sentence of a bake that failed.
    if (ownFaceId !== null || ownBake !== null) avatars.push({ key: OWN_AVATAR_KEY, label: OWN_AVATAR_LABEL, faceId: ownFaceId, bake: ownBake });
    // A pick that names no look with a face reads as the first look that has one, which is the default whenever the default has a face (the house's first leads): nothing is drawn from a face that is not there, and her initial only while no look has any.
    const wearing = avatars.find((look) => look.key === columns?.avatar && look.faceId !== null) ?? avatars.find((look) => look.faceId !== null);
    return { id: wearing?.faceId ?? null, avatar: wearing?.key ?? DEFAULT_AVATAR_KEY, avatars };
  }

  function announce(userId: number): void {
    const frame: CompanionFrame = { kind: 'companion_face', face: faceOf(userId) };
    sendToUser(userId, frame);
  }

  /** The pages that hear a bake: every account when it makes a house look's face (every picker lists the house's looks; his upload of Dark hair's own photo is made under the same framing, so it makes that same face), else the accounts `waiting` on it. */
  const hearersOf = (job: BakeJob, waiting: number[]): number[] => (job.forHouse || house.makes(job.faceId) ? companionDb.listFaces().map((row) => row.user_id) : waiting);

  /** Removes every face nobody names. Callers hold the exclusive section. Waits until the house is known: without it a look's face would be a face nobody names. */
  async function pruneNamed(): Promise<void> {
    if (!house.isKnown()) return;
    const named = house.faces();
    for (const row of companionDb.listFaces()) {
      const own = validFaceId(row.face_id);
      if (own !== null) named.add(own);
      const pending = validFaceId(row.face_pending_id);
      // A pending face is not made yet: its photo and the frames cached so far are what its bake, or its resumption, runs on.
      if (pending !== null) named.add(pending).add(photoIdOfFace(pending));
    }
    for (const photoId of queue.photoIds()) named.add(photoId);
    const removed = await prune(named);
    if (removed.length > 0) console.log(`[Companion] pruned ${removed.length} unused face(s): ${removed.join(', ')}`);
  }

  function pruneLater(): void {
    void exclusive(pruneNamed).catch((error) => console.error('[Companion] the unused faces could not be pruned', error));
  }

  /** The accounts that were waiting on `job`'s face and still are (an upload since, or a removal, moved the others on). */
  function stillWaiting(job: BakeJob): number[] {
    return [...job.accounts].filter((userId) => {
      const pending = validFaceId(companionDb.readState(userId)?.face_pending_id);
      return pending !== null && faceIdOf(photoIdOfFace(pending)) === job.faceId;
    });
  }

  async function settle(job: BakeJob, outcome: BakeOutcome): Promise<void> {
    if (outcome.kind === 'ended') {
      // Nobody wants the face any more (replaced, or removed): its photo and frames are garbage now. A stop leaves everything as it is.
      if (!stopped) pruneLater();
      return;
    }
    const waiting = stillWaiting(job);
    if (outcome.kind === 'refused') {
      console.error('[Companion] a face could not be made', { faceId: job.faceId, sentence: outcome.sentence });
      house.failed(job.faceId, outcome.sentence);
      // The face he wears stays; the sentence is stored and shown. The photo's frames stay too, so the same photo uploaded again finishes where this stopped.
      for (const userId of waiting) companionDb.writeState(userId, { face_pending_id: null, face_error: outcome.sentence });
    } else {
      for (const userId of waiting) {
        // Making again the photo he already wears, under a new recipe, is the same look: only a different photo's face becomes his pick.
        const ownFaceId = validFaceId(companionDb.readState(userId)?.face_id);
        const remade = ownFaceId !== null && photoIdOfFace(ownFaceId) === job.photoId;
        companionDb.writeState(userId, { face_id: outcome.faceId, face_pending_id: null, face_error: null, ...(remade ? {} : { avatar: OWN_AVATAR_KEY }) });
      }
      // Whoever asked for it: his upload of Dark hair's own photo is made under the house framing, so it is the very face Dark hair is drawn with, and a failed house bake of it is mended so (Brown hair's framing differs: an upload of its photo is another face).
      await house.made(outcome.faceId);
    }
    hearersOf(job, waiting).forEach(announce);
    if (outcome.kind === 'made') pruneLater();
  }

  const queue = createBakeQueue({
    onProgress: (job) => hearersOf(job, [...job.accounts]).forEach(announce),
    onSettled: settle,
  });

  /** Resumes what the last process left and brings every account's own face up to the current recipe. */
  async function resumeAccounts(): Promise<void> {
    for (const row of companionDb.listFaces()) {
      const pending = validFaceId(row.face_pending_id);
      const own = validFaceId(row.face_id);
      // A pending face is baked under the CURRENT recipe, whichever recipe its id was written under; a face made under an older recipe, or whose files are gone, is made again from its photo.
      const source = pending ?? (own !== null && (recipeIdOfFace(own) !== recipeId() || !(await readManifest(own))) ? own : null);
      if (source === null) {
        if (row.face_pending_id !== null) companionDb.writeState(row.user_id, { face_pending_id: null });
        continue;
      }
      const photoId = photoIdOfFace(source);
      if (row.face_pending_id !== faceIdOf(photoId)) companionDb.writeState(row.user_id, { face_pending_id: faceIdOf(photoId), face_error: null });
      queue.assign(row.user_id, photoId);
    }
  }

  /** Registers the house's looks, finds each one's face and queues the bake of each that is not made. A failure is logged and leaves the house unknown: the accounts' own faces are still resumed, and nothing is pruned. */
  async function setUpHouse(): Promise<void> {
    try {
      await house.register();
      // A page may have read the picture before the looks were found; every account hears them now.
      companionDb.listFaces().forEach((row) => announce(row.user_id));
      for (const { look, photoId } of house.unpublished()) {
        // ComfyUI is needed only for a frame the cache lacks: a recipe change that only re-cuts is made from the cache on a box with none.
        if (isComfyUIInstalled(comfyuiDir()) || (await frameCacheIsComplete(photoId, look.framing))) queue.wantHouse(photoId, look.framing);
        else console.warn(`[Companion] the face of the house avatar "${look.key}" is not made under the current recipe, its frame cache lacks frames, and ComfyUI is not installed at ${comfyuiDir()}; run scripts/install-comfyui.sh`);
      }
    } catch (error) {
      console.error('[Companion] the house\'s avatars could not be set up; the accounts\' own faces are still resumed', error);
    }
  }

  async function begin(): Promise<void> {
    await setUpHouse();
    await resumeAccounts();
    await exclusive(pruneNamed);
  }

  /** The path of one of a face's files (`FACE_FILE_NAME`), for the account that may read it. Checked on the disk: a face whose manifest is there is whole. */
  function fileFor(userId: number, faceId: string, fileName: string): string {
    if (!isFaceId(faceId) || !FACE_FILE_NAME.test(fileName)) throw faceNotFound();
    if (!house.faces().has(faceId) && faceId !== validFaceId(companionDb.readState(userId)?.face_id)) throw faceNotFound();

    const folder = faceDir(faceId);
    if (!fs.existsSync(path.join(folder, 'manifest.json')) || !fs.existsSync(path.join(folder, fileName))) throw faceNotFound();
    return path.join(folder, fileName);
  }

  return {
    /** The account's look as its pages draw it: the face of the look it wears, the looks it may wear and each one's making. Consumed by `companion-picture.ts` and `face.routes.ts`. */
    faceOf,

    /**
     * Takes the account's photo. `switched` is true when that photo's face under the current recipe was already made: the account has it
     * at once and wears it. Else its bake is queued, replacing any bake still pending for the account, the look he wears stays, and the
     * `own` avatar's `bake` is queued; when the bake ends made, he wears it. Refusals: 400 `COMPANION_FACE_INVALID`, 503 `COMPANION_STOPPING`.
     */
    async upload(userId: number, file: FaceUpload): Promise<{ face: CompanionFace; switched: boolean }> {
      if (stopped) throw faceStopping();
      return exclusive(async () => {
        const { photoId } = await acceptPhoto(file.bytes);
        const faceId = faceIdOf(photoId);
        if (await readManifest(faceId)) {
          queue.release(userId);
          companionDb.writeState(userId, { face_id: faceId, face_pending_id: null, face_error: null, avatar: OWN_AVATAR_KEY });
          announce(userId);
          pruneLater();
          return { face: faceOf(userId), switched: true };
        }
        companionDb.writeState(userId, { face_pending_id: faceId, face_error: null });
        queue.assign(userId, photoId);
        announce(userId);
        return { face: faceOf(userId), switched: false };
      });
    },

    /**
     * Stores the look he picked and tells every page of his account: a house look whose face is made, or `own` while his photo's face is
     * made. Refusals: 400 `COMPANION_FACE_INVALID`, "There is no look called <key>." for a key that names none of his looks (his photo
     * included, while he has none) or "That look isn't ready yet; it can be picked once it is made." for a look still being made;
     * 503 `COMPANION_STOPPING`. Synchronous, so the check and the write cannot be parted by an upload or a removal. Consumed by `face.routes.ts`.
     */
    pick(userId: number, key: string): CompanionFace {
      if (stopped) throw faceStopping();
      const look = faceOf(userId).avatars.find((candidate) => candidate.key === key);
      if (look === undefined) throw faceNoSuchLook(key);
      if (look.faceId === null) throw faceInvalid("That look isn't ready yet; it can be picked once it is made.");
      companionDb.writeState(userId, { avatar: key });
      announce(userId);
      return faceOf(userId);
    },

    /** Removes his photo and the face made from it, and drops a bake still being made; a pick of his photo goes back to NULL, a pick of a house look stays. Consumed by `face.routes.ts`. */
    removeOwn(userId: number): CompanionFace {
      if (stopped) throw faceStopping();
      queue.release(userId);
      const wearsOwn = companionDb.readState(userId)?.avatar === OWN_AVATAR_KEY;
      companionDb.writeState(userId, { face_id: null, face_pending_id: null, face_error: null, ...(wearsOwn ? { avatar: null } : {}) });
      announce(userId);
      pruneLater();
      return faceOf(userId);
    },

    /** The path of a face's manifest, contact sheet or sheet, by the name it has in the folder; 404 `COMPANION_FACE_NOT_FOUND` for any other name and for any face but the house's looks' and the one the account made from its photo. Consumed by `face.routes.ts`. */
    fileFor,

    /** Registers the house's looks, resumes the bakes and prunes, on the module's start. Failures are logged; the module still serves. */
    start(): void {
      begin().catch((error) => console.error('[Companion] the face service could not start', error));
    },

    /** Aborts the running bake (ComfyUI is stopped and the lock released) and waits for it; every pending id stays for the next start. Consumed by `companion.module.ts`'s stop. */
    async stop(): Promise<void> {
      stopped = true;
      await queue.stop();
      await exclusiveTail;
    },
  };
}

/** The one face service of the process, made once as `companionService` is. Consumed by `companion-picture.ts`, `companion.module.ts` and `face.routes.ts`. */
export const faceService = createFaceService();

/** The service's surface, for the routes. Consumed by `face.routes.ts`. */
export type FaceService = typeof faceService;
