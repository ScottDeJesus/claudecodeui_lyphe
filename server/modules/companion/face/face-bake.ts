import fs from 'node:fs/promises';
import path from 'node:path';

import { ComfyUIExit, comfyuiDir, comfyWorkPaths, startComfyUI, type ComfyUI } from './comfyui.js';
import { reapOrphanComfyUI } from './comfyui-orphan.js';
import { contactSheet, cutFrame, layoutSheets, packSheets, padPhoto } from './face-atlas.js';
import { faceDir, faceIdOf, facesRoot, photoDir, readManifest, writeFileAtomically } from './face-files.js';
import { takeBakeLock } from './face-lock.js';
import { FaceBakeRefusal, sentences } from './face-refusal.js';
import { buildManifest, frameCacheKey, recipeFrames, type RecipeFrame } from './face-recipe.js';

// FaceBakeRefusal: its message is the sentence for his screen. Re-exported from its own file so `face-atlas.ts` can throw it without a cycle.
export { FaceBakeRefusal };

/** What the node prints, on its stdout, when it finds no face and carries on with the whole image (nodes.py:243). */
const NO_FACE_LINE = 'Failed to detect face!!';

type BakeInput = {
  photoId: string;
  /** Called once for each frame, in bake order, as it is rendered or found cached (`seconds` is 0 for a cached one). */
  onProgress(done: number, total: number, frame: string, seconds: number): void;
  /** Aborting stops ComfyUI and releases the lock, and the bake rejects with the signal's reason. */
  signal: AbortSignal;
  /** When another face is being made: `wait` (default) parks until its holder is done, `refuse` throws at once naming its pid. */
  whenBusy?: 'wait' | 'refuse';
};

function secondsSince(startedAt: number): number {
  return Math.round((performance.now() - startedAt) / 100) / 10;
}

async function readIfPresent(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}


type StartedComfyUI = { comfy: ComfyUI; sourceName: string; sourcePath: string };

/** ComfyUI started for this photo, with the padded source in its input folder, and the name `renderFrame` loads it by. */
async function startForPhoto(photoId: string, signal: AbortSignal, onLine: (line: string) => void): Promise<StartedComfyUI> {
  const root = facesRoot();
  const photo = await readIfPresent(path.join(photoDir(photoId), 'photo.png'));
  if (photo === null) throw new FaceBakeRefusal(sentences.photoMissing());
  const comfy = await startComfyUI({ dir: comfyuiDir(), workDir: root, signal, onLine });
  try {
    const sourceName = `face-${photoId}.png`;
    const sourcePath = path.join(comfyWorkPaths(root).input, sourceName);
    await fs.writeFile(sourcePath, await padPhoto(photo));
    return { comfy, sourceName, sourcePath };
  } catch (error) {
    await comfy.stop();
    throw error;
  }
}

/**
 * Every frame's cut square, in bake order: its 512 px crop from the `frames/` cache, or rendered by ComfyUI (started when
 * the first frame is not cached, so a tune that changes only the cut renders nothing and never starts it). The first
 * render is when the node looks for the face; "Failed to detect face!!" on its stdout ends the bake before that crop is cached.
 */
async function cutEveryFrame(
  photoId: string, frames: RecipeFrame[], onProgress: BakeInput['onProgress'], signal: AbortSignal,
): Promise<Buffer[]> {
  const cacheDir = path.join(photoDir(photoId), 'frames');
  await fs.mkdir(cacheDir, { recursive: true });
  const cuts: Buffer[] = [];
  let started: StartedComfyUI | null = null;
  let noFaceSeen = false;
  let lastLines: string[] = [];

  try {
    for (const [index, frame] of frames.entries()) {
      signal.throwIfAborted();
      const cached = path.join(cacheDir, `${frameCacheKey(frame.sliders)}.png`);
      let preview = await readIfPresent(cached);
      let seconds = 0;

      if (preview === null) {
        started ??= await startForPhoto(photoId, signal, (line) => {
          if (line.includes(NO_FACE_LINE)) noFaceSeen = true;
          lastLines = [...lastLines.slice(-29), line];
        });
        const renderStarted = performance.now();
        preview = await started.comfy.renderFrame(started.sourceName, frame.sliders);
        if (noFaceSeen) throw new FaceBakeRefusal(sentences.noFace());
        // Whole or not at all, so an interrupted bake never leaves a half-written crop that the next one trusts.
        await writeFileAtomically(cached, preview);
        seconds = Math.max((performance.now() - renderStarted) / 1000, 0.001);
      }

      cuts.push(await cutFrame(preview));
      onProgress(index + 1, frames.length, frame.name, seconds);
    }
    return cuts;
  } catch (error) {
    if (signal.aborted || error instanceof FaceBakeRefusal) throw error;
    if (noFaceSeen) throw new FaceBakeRefusal(sentences.noFace());
    console.error('[Companion] the face maker stopped', {
      photoId, done: cuts.length, total: frames.length, error,
      lastLines: error instanceof ComfyUIExit ? error.lastLines : lastLines,
    });
    throw new FaceBakeRefusal(sentences.stopped(cuts.length, frames.length));
  } finally {
    await started?.comfy.stop();
    // The padded source is the bake's own file, about 15 MB per photo: left behind, every upload would add one for good.
    if (started) await fs.rm(started.sourcePath, { force: true });
  }
}

/** The face's files, `manifest.json` LAST and by rename: a face whose manifest exists is whole. */
async function publishFace(faceId: string, frames: RecipeFrame[], cuts: Buffer[]): Promise<void> {
  const folder = faceDir(faceId);
  await fs.mkdir(folder, { recursive: true });
  const layout = layoutSheets(cuts.length);
  const [sheets, contact] = await Promise.all([packSheets(cuts), contactSheet(cuts, frames.map((frame) => frame.name))]);
  await Promise.all(sheets.map((bytes, n) => fs.writeFile(path.join(folder, layout.sheets[n].file), bytes)));
  await fs.writeFile(path.join(folder, 'contact.webp'), contact);
  await writeFileAtomically(path.join(folder, 'manifest.json'), `${JSON.stringify(buildManifest(faceId, layout))}\n`);
}

/**
 * Makes (or resumes) the face of photo `photoId` under the current recipe; published when it resolves. Consumed by the CLI and `face.service.ts`.
 *
 * The order: take the lock, kill a checked orphan, look again for a published face, then render what the frame cache lacks
 * (ComfyUI started for the first miss, stopped when the last frame is in), cut and pack, write the sheets and the contact
 * sheet, write `manifest.json` by rename, release the lock. A face already published reports every frame as cached and
 * returns at once. Refusals are `FaceBakeRefusal`; an abort rejects with the signal's reason.
 */
export async function bakeFace(input: BakeInput): Promise<{ faceId: string; seconds: number }> {
  const startedAt = performance.now();
  const faceId = faceIdOf(input.photoId);
  const frames = recipeFrames();

  const lock = await takeBakeLock(facesRoot(), input.whenBusy ?? 'wait', input.signal);
  try {
    reapOrphanComfyUI(facesRoot());

    // Looked at AFTER the lock: the baker that held it may have just made this very face.
    if (await readManifest(faceId)) {
      frames.forEach((frame, index) => input.onProgress(index + 1, frames.length, frame.name, 0));
      return { faceId, seconds: secondsSince(startedAt) };
    }

    const cuts = await cutEveryFrame(input.photoId, frames, input.onProgress, input.signal);
    await publishFace(faceId, frames, cuts);
    return { faceId, seconds: secondsSince(startedAt) };
  } finally {
    lock.release();
  }
}
