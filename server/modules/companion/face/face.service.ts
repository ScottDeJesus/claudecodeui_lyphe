import fs from 'node:fs';
import path from 'node:path';

import { companionDb } from '@/modules/database/index.js';
import type { CompanionStateRow } from '@/modules/database/index.js';
import { sendToUser } from '@/modules/websocket/index.js';
import type { CompanionFace, CompanionFaceBake, CompanionFrame } from '@/shared/companion-types.js';

import { comfyuiDir, isComfyUIInstalled } from './comfyui.js';
import { faceNotFound, faceStopping } from './face-errors.js';
import {
  faceDir, faceIdOf, isFaceId, newestPublishedFaceOf, photoIdOfFace, prune, readManifest, recipeIdOfFace, registerSeed,
} from './face-files.js';
import { createBakeQueue, type BakeJob, type BakeOutcome } from './face-queue.js';
import { recipeFrames, recipeId } from './face-recipe.js';
import { acceptPhoto } from './face-upload.js';

/**
 * EACH ACCOUNT'S FACE, and the making of it. An account's face is three columns of `companion_state`: `face_id` (the face its
 * pages draw, NULL for the original), `face_pending_id` (the face being made from his upload, which a restart resumes) and
 * `face_error` (the last bake's failure sentence). Clear leaves them. The service answers the account's `CompanionFace`
 * (`faceOf`), takes an upload (`upload`) and puts the original back (`restore`), serves a face's files to the account that may
 * read them (`fileFor`), and makes the faces on events: the queue runs the bakes one at a time in the order asked, in this
 * process, under the box-wide lock; each frame rendered and the end of a bake reach every page of the account as a
 * `companion_face` frame.
 *
 * THE ORIGINAL is the seed photo (`seed.json`) under the current recipe. While it is made again under a new recipe, `faceOf`
 * answers the newest original face that is published and the prune keeps it, so her face on every page never goes missing
 * between recipes; its id is null only while no original face exists at all.
 *
 * MODULE START (`start`) is the event the house recovers on: it registers the seed, queues the original's bake when its face
 * under the current recipe is not published and ComfyUI is installed, re-queues every account's pending bake, makes again the
 * face of any account whose recipe is no longer current or whose files are gone, and prunes. A seed step that fails is logged
 * and does not stop the rest, except the prune: it waits for the original to be known. `stop` aborts the running bake, which
 * releases the lock, and leaves every pending id in the database for the next start.
 *
 * THE PRUNE keeps the original and every face an account names, current or pending (`face-files.ts` deletes only a path joined
 * from an id that matched its pattern and resolved to lie strictly inside the faces root). The prune and the store of an upload
 * take turns (`exclusive`), so a prune never lands between a photo being stored and an account claiming it.
 */

/** An uploaded photo as the route hands it over: the bytes of the one file, whose kind is read from the bytes themselves. */
export type FaceUpload = { bytes: Buffer };

/** Which of a face's files a page asks for: its manifest, its contact sheet (every frame named, for Settings' "See every frame"), or sheet number n. */
export type FaceFile = 'manifest' | 'contact' | number;

type FaceColumns = Pick<CompanionStateRow, 'face_id' | 'face_pending_id' | 'face_error'>;

/** A face id from a stored column, or null for none or a value that is no face id (a hand edit): the picture must still load. */
const validFaceId = (stored: string | null | undefined): string | null => (stored && isFaceId(stored) ? stored : null);

/** Consumed by this file, once, as `faceService`. */
function createFaceService() {
  let stopped = false;
  /** The seed photo's id once `start` registered it; null before, and on a box with no seed photo. */
  let seedPhotoId: string | null = null;
  /** The face the original's pages draw: the seed's face under the current recipe, else its newest published one, else null. Held in memory so `faceOf` stays a plain read; set by `start` and after each bake of the seed. */
  let originalFaceId: string | null = null;
  /** Whether `start` has found out what the original is (a face, or no seed photo at all). A prune before that, or after the seed step failed, would take the original's face for garbage. */
  let originalKnown = false;
  /** The end of the last exclusive section, which never rejects. */
  let exclusiveTail: Promise<unknown> = Promise.resolve();

  /** Runs `work` after every earlier exclusive section has ended. */
  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = exclusiveTail.then(work);
    exclusiveTail = run.catch(() => undefined);
    return run;
  }

  function bakeOf(columns: FaceColumns | null): CompanionFaceBake | null {
    const pending = validFaceId(columns?.face_pending_id);
    if (pending !== null) {
      const job = queue.jobOf(photoIdOfFace(pending));
      if (job?.state === 'baking') return { state: 'baking', done: job.done, total: job.total };
      return { state: 'queued', done: 0, total: job?.total ?? recipeFrames().length };
    }
    return columns?.face_error ? { state: 'failed', error: columns.face_error } : null;
  }

  function faceOf(userId: number): CompanionFace {
    const columns = companionDb.readState(userId);
    const own = validFaceId(columns?.face_id);
    return {
      id: own ?? originalFaceId,
      original: own === null || photoIdOfFace(own) === seedPhotoId,
      bake: bakeOf(columns),
    };
  }

  function announce(userId: number): void {
    const frame: CompanionFrame = { kind: 'companion_face', face: faceOf(userId) };
    sendToUser(userId, frame);
  }

  /** Tells every account on the original that its face may have changed (the original was just made, or first found). */
  function announceAccountsOnOriginal(): void {
    for (const row of companionDb.listFaces()) if (validFaceId(row.face_id) === null) announce(row.user_id);
  }

  async function findOriginalFace(): Promise<string | null> {
    if (seedPhotoId === null) return null;
    const current = faceIdOf(seedPhotoId);
    return (await readManifest(current)) ? current : newestPublishedFaceOf(seedPhotoId);
  }

  /** Removes every face nobody names. Callers hold the exclusive section. Waits until the original is known: without it the original's face would be a face nobody names. */
  async function pruneNamed(): Promise<void> {
    if (!originalKnown) return;
    const named = new Set<string>();
    if (seedPhotoId !== null) named.add(faceIdOf(seedPhotoId));
    if (originalFaceId !== null) named.add(originalFaceId);
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

  /** The accounts that were waiting on `job`'s photo and still are (an upload since, or a restore, moved the others on). */
  function stillWaiting(job: BakeJob): number[] {
    return [...job.accounts].filter((userId) => {
      const pending = validFaceId(companionDb.readState(userId)?.face_pending_id);
      return pending !== null && photoIdOfFace(pending) === job.photoId;
    });
  }

  async function settle(job: BakeJob, outcome: BakeOutcome): Promise<void> {
    if (outcome.kind === 'ended') {
      // Nobody wants the face any more (replaced, or restored): its photo and frames are garbage now. A stop leaves everything as it is.
      if (!stopped) pruneLater();
      return;
    }
    if (outcome.kind === 'refused') {
      console.error('[Companion] a face could not be made', { photoId: job.photoId, sentence: outcome.sentence });
      // The old face stays; the sentence is stored and shown. The photo's frames stay too, so the same photo uploaded again finishes where this stopped.
      for (const userId of stillWaiting(job)) {
        companionDb.writeState(userId, { face_pending_id: null, face_error: outcome.sentence });
        announce(userId);
      }
      return;
    }
    for (const userId of stillWaiting(job)) {
      companionDb.writeState(userId, { face_id: outcome.faceId, face_pending_id: null, face_error: null });
      announce(userId);
    }
    if (job.photoId === seedPhotoId) {
      originalFaceId = await findOriginalFace();
      announceAccountsOnOriginal();
    }
    pruneLater();
  }

  const queue = createBakeQueue({
    onProgress: (job) => job.accounts.forEach(announce),
    onSettled: settle,
  });

  /** Resumes what the last process left and brings every face up to the current recipe. */
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

  /** Registers the seed, finds the original's face and queues its bake when it is not made. A failure is logged and leaves the original unknown: the accounts' own faces are still resumed, and nothing is pruned. */
  async function setUpOriginal(): Promise<void> {
    try {
      seedPhotoId = await registerSeed();
      originalFaceId = await findOriginalFace();
      originalKnown = true;
      // A page may have read the picture before the seed was found; it hears the original now.
      announceAccountsOnOriginal();

      if (seedPhotoId !== null && !(await readManifest(faceIdOf(seedPhotoId)))) {
        if (isComfyUIInstalled(comfyuiDir())) queue.wantOriginal(seedPhotoId);
        else console.warn(`[Companion] the original face is not made under the current recipe, and ComfyUI is not installed at ${comfyuiDir()}; run scripts/install-comfyui.sh`);
      }
    } catch (error) {
      console.error('[Companion] the original face could not be set up; the accounts\' own faces are still resumed', error);
    }
  }

  async function begin(): Promise<void> {
    await setUpOriginal();
    await resumeAccounts();
    await exclusive(pruneNamed);
  }

  /** The path of one of a face's files, for the account that may read it. Checked on the disk: a face whose manifest is there is whole. */
  function fileFor(userId: number, faceId: string, file: FaceFile): string {
    if (!isFaceId(faceId)) throw faceNotFound();
    const named = validFaceId(companionDb.readState(userId)?.face_id);
    if (faceId !== originalFaceId && faceId !== named) throw faceNotFound();

    const wanted = typeof file === 'number' ? `sheet-${file}.webp` : file === 'manifest' ? 'manifest.json' : 'contact.webp';
    if (typeof file === 'number' && !(Number.isInteger(file) && file >= 0)) throw faceNotFound();
    const folder = faceDir(faceId);
    if (!fs.existsSync(path.join(folder, 'manifest.json')) || !fs.existsSync(path.join(folder, wanted))) throw faceNotFound();
    return path.join(folder, wanted);
  }

  return {
    /** The account's face as its pages draw it, with the making of its next one. Consumed by `companion-picture.ts` and `face.routes.ts`. */
    faceOf,

    /**
     * Takes the account's photo. `switched` is true when that photo's face under the current recipe was already made, and the
     * account has it at once; else its bake is queued, replacing any bake still pending for the account, and the face is the
     * current one with `bake` queued. Refusals: 400 `COMPANION_FACE_INVALID`, 503 `COMPANION_STOPPING`.
     */
    async upload(userId: number, file: FaceUpload): Promise<{ face: CompanionFace; switched: boolean }> {
      if (stopped) throw faceStopping();
      return exclusive(async () => {
        const { photoId } = await acceptPhoto(file.bytes);
        const faceId = faceIdOf(photoId);
        if (await readManifest(faceId)) {
          queue.release(userId);
          companionDb.writeState(userId, { face_id: faceId, face_pending_id: null, face_error: null });
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

    /** Puts the original back and drops the account's pending bake. Consumed by `face.routes.ts`. */
    restore(userId: number): CompanionFace {
      if (stopped) throw faceStopping();
      queue.release(userId);
      companionDb.writeState(userId, { face_id: null, face_pending_id: null, face_error: null });
      announce(userId);
      pruneLater();
      return faceOf(userId);
    },

    /** The path of a face's manifest, contact sheet or sheet n; 404 `COMPANION_FACE_NOT_FOUND` for any face but the original and the one the account names. Consumed by `face.routes.ts`. */
    fileFor,

    /** Registers the seed, resumes the bakes and prunes, on the module's start. Failures are logged; the module still serves. */
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
