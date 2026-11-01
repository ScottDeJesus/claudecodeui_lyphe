import { useEffect, useRef, useState } from 'react';

import { useDevicePixelRatio } from '@/modules/companion/hooks/useDevicePixelRatio';
import { api } from '@/shared/api';
import type { CompanionFaceManifest, CompanionFaceTier } from '@/shared/companion-types';

/**
 * A face ready to play at one tier: where every frame sits (`manifest`), the side of that tier's cells (`frameSize`) and the decoded
 * sheets those cells are cut from (`sheets[n]` is the tier's sheet n). The manifest is the same object for every tier of a face.
 */
export type FaceAtlas = { manifest: CompanionFaceManifest; frameSize: number; sheets: ImageBitmap[] };

/**
 * How many faces stay decoded at once: the one on the page and the one that replaced it a moment ago (a switch decodes the new
 * face while the old one still draws). A sheet of the 256 px tier is 2048 px square, about 16 MB decoded, and one of the 448 px
 * tier is 3584 px, about 51 MB, so a page that lives for days and has its face changed a few times must not keep every one of them.
 */
const KEPT_FACES = 2;

/** The manifests that are in, by face id, so a render can tell which tier a size wants without waiting on a request. */
const manifests = new Map<string, CompanionFaceManifest>();

/** The manifests being fetched, by face id. */
const fetchingManifests = new Map<string, Promise<CompanionFaceManifest>>();

/** The atlases decoded: by face id, oldest face first, and under it by tier size. Module-level, so the button and Settings' preview share one copy per page. */
const decoded = new Map<string, Map<number, FaceAtlas>>();

/** The atlases being fetched and decoded, by `<face id>@<tier size>`, so two components asking for the same tier at once make one request. */
const decoding = new Map<string, Promise<FaceAtlas>>();

/**
 * The smallest tier size that failed to load for a face on this page, by face id. The page asks for no tier of that size or larger
 * again and draws the largest that remains: a tier that could not be fetched or decoded (the large one is the likelier, with twice the
 * requests and two 3584 px bitmaps) must not leave her blank while a smaller one works. Kept for the page's life, so a component that
 * mounts later does not walk the same road; a reload tries again. Never set for a face's smallest tier: nothing is smaller.
 */
const failedFrom = new Map<string, number>();

/** Whether `value` is a non-null object: the shape of every table of the manifest. */
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';

const isTier = (value: unknown): value is CompanionFaceTier => isRecord(value) && typeof value.frameSize === 'number' && Array.isArray(value.sheets);

/**
 * Only what the portrait and its engine read is checked, field by field: a manifest missing one (made by an older recipe, or cut short) would throw
 * inside the portrait's render and take the whole screen with it, so it is refused here and the disc keeps her ground. The neutral mood is the one
 * the engine starts from and falls back to. `blinks` is absent on a face made before it, which the engine plays as it always did, so it
 * is checked only when present, and then whole: its listening blink and its gaze and pose tables. `brows` is absent on a face made before
 * it and plays as it always did too, and is checked only when present, as a record. The numbers inside the tables are the server's own and
 * are not checked one by one.
 */
function isManifest(value: unknown): value is CompanionFaceManifest {
  if (!isRecord(value)) return false;
  const { version, frameSize, frames, sheets, largerTiers, moods, gaze, poses, states, clips, blinks, brows } = value;
  return version === 1 && typeof frameSize === 'number' && Array.isArray(frames) && Array.isArray(sheets)
    && (largerTiers === undefined || (Array.isArray(largerTiers) && largerTiers.every(isTier)))
    && (blinks === undefined || (isRecord(blinks) && isRecord(blinks.listening) && isRecord(blinks.gaze) && isRecord(blinks.poses)))
    && (brows === undefined || isRecord(brows))
    && isRecord(moods) && isRecord(moods.neutral) && isRecord(gaze) && isRecord(poses) && isRecord(states) && isRecord(clips);
}

/** The manifest's tiers, smallest first: its own cells, then its `largerTiers` (a face made before tiers has only its own). */
function tiersOf(manifest: CompanionFaceManifest): CompanionFaceTier[] {
  return [{ frameSize: manifest.frameSize, sheets: manifest.sheets }, ...(manifest.largerTiers ?? [])].sort((a, b) => a.frameSize - b.frameSize);
}

/**
 * The tier to draw, as a srcset picks its image: the smallest whose cells cover `neededPx` device pixels, else the largest, which no
 * size can better, from the tiers of `faceId` that have not failed on this page (`failedFrom`). A small head on a phone stays on the
 * small tier and never fetches the large sheets.
 */
function pickTier(manifest: CompanionFaceManifest, neededPx: number, faceId: string): CompanionFaceTier {
  const failed = failedFrom.get(faceId) ?? Infinity;
  const tiers = tiersOf(manifest).filter((tier) => tier.frameSize < failed);
  return tiers.find((tier) => tier.frameSize >= neededPx) ?? tiers[tiers.length - 1];
}

/** Runs `start` for `key` once at a time: callers who ask while it runs share its promise, and a failure is forgotten, so the next caller tries again and nothing retries by itself. */
function shared<T>(running: Map<string, Promise<T>>, key: string, start: () => Promise<T>): Promise<T> {
  const standing = running.get(key);
  if (standing) return standing;
  const promise = start().finally(() => running.delete(key));
  running.set(key, promise);
  return promise;
}

function loadManifest(faceId: string): Promise<CompanionFaceManifest> {
  const known = manifests.get(faceId);
  if (known) return Promise.resolve(known);
  return shared(fetchingManifests, faceId, async () => {
    const response = await api.companion.face.manifest(faceId);
    if (!response.ok) throw new Error(`the manifest answered ${response.status}`);
    const manifest: unknown = await response.json();
    if (!isManifest(manifest)) throw new Error('the manifest is not one this page can play');
    manifests.set(faceId, manifest);
    return manifest;
  });
}

/** The decoded sheets of one tier, each asked by the file name the manifest gives it. */
function loadSheets(faceId: string, tier: CompanionFaceTier): Promise<ImageBitmap[]> {
  return Promise.all(
    tier.sheets.map(async ({ file }) => {
      const response = await api.companion.face.sheet(faceId, file);
      if (!response.ok) throw new Error(`sheet ${file} answered ${response.status}`);
      return createImageBitmap(await response.blob());
    }),
  );
}

/** Keeps `atlas` and forgets the faces beyond the newest `KEPT_FACES`. Forgotten, not closed: a component that still draws an old face holds its bitmaps, and a closed bitmap cannot be drawn. */
function remember(faceId: string, atlas: FaceAtlas): void {
  const tiers = decoded.get(faceId) ?? new Map<number, FaceAtlas>();
  tiers.set(atlas.frameSize, atlas);
  decoded.delete(faceId);
  decoded.set(faceId, tiers);
  for (const oldest of [...decoded.keys()].slice(0, Math.max(0, decoded.size - KEPT_FACES))) {
    decoded.delete(oldest);
    manifests.delete(oldest);
    failedFrom.delete(oldest);
  }
}

/**
 * The atlas of `faceId` at the tier `neededPx()` calls for. The tier is chosen only once the manifest is in, from the size read THEN:
 * the manifest arrives a moment after the first render, and by then the layout has told the page the size that render only guessed.
 * A tier that fails to load is dropped for the page (`failedFrom`) and the next smaller one is loaded in its place; only the smallest
 * tier's failure is the caller's.
 */
async function loadAtlas(faceId: string, neededPx: () => number): Promise<FaceAtlas> {
  const manifest = await loadManifest(faceId);
  const tier = pickTier(manifest, neededPx(), faceId);
  const held = decoded.get(faceId)?.get(tier.frameSize);
  if (held) return held;
  try {
    return await shared(decoding, `${faceId}@${tier.frameSize}`, async () => {
      const atlas: FaceAtlas = { manifest, frameSize: tier.frameSize, sheets: await loadSheets(faceId, tier) };
      remember(faceId, atlas);
      return atlas;
    });
  } catch (failure) {
    if (tier.frameSize <= tiersOf(manifest)[0].frameSize) throw failure;
    // Components that shared the failed load all land here: the first drops the tier and says so, the rest find it dropped.
    if ((failedFrom.get(faceId) ?? Infinity) > tier.frameSize) {
      console.warn(`[Companion] Her face ${faceId} could not be loaded at ${tier.frameSize} px; drawing the next smaller tier:`, failure);
      failedFrom.set(faceId, tier.frameSize);
    }
    return loadAtlas(faceId, neededPx);
  }
}

/**
 * Used by this module's CompanionAvatar (the button's disc, her panel's header, the station's head and portrait) and by Settings' face
 * card through it: the atlas of face `faceId`, or null until its first one is decoded (and always null for no face at all, a fresh box).
 * `drawnPx` is the square she is drawn in, in CSS px.
 *
 * THE TIER IS PICKED LIKE A SRCSET. The face comes at more than one resolution; the page fetches the smallest tier whose cells cover
 * `drawnPx` at the window's pixel ratio, else the largest. It is picked again when the size or the ratio changes, and a new tier is
 * fetched while the old one keeps drawing. A small disc on a phone never asks for the large sheets. A tier that fails to load is dropped
 * for the page and the next smaller one is drawn instead.
 *
 * EACH TIER LOADS ONCE PER FACE PER PAGE. It goes through `api.companion.face` because an `<img src>` to an authenticated route
 * carries no token, and it is kept decoded in a module-level cache, so every component showing this face at this tier shares one copy.
 * While a new face id's sheets decode, the hook keeps answering the atlas it had: a switch never blanks her.
 */
export function useFaceAtlas(faceId: string | null, drawnPx: number): FaceAtlas | null {
  const neededPx = Math.ceil(drawnPx * useDevicePixelRatio());
  const manifest = faceId === null ? null : manifests.get(faceId) ?? null;
  const frameSize = manifest === null || faceId === null ? null : pickTier(manifest, neededPx, faceId).frameSize;
  const cached = faceId === null || frameSize === null ? null : decoded.get(faceId)?.get(frameSize) ?? null;
  // The atlas last answered. State because it is what a switch keeps showing while the new face (or tier) decodes, and nothing else remembers it.
  const [answered, setAnswered] = useState<FaceAtlas | null>(cached);
  if (cached !== null && answered !== cached) setAnswered(cached);

  // The size the page wants now, for a load that outlasts the render that began it (see `loadAtlas`). Written in an effect, never during render.
  const neededNow = useRef(neededPx);
  useEffect(() => {
    neededNow.current = neededPx;
  });

  useEffect(() => {
    if (faceId === null || cached !== null) return undefined;
    let current = true;
    loadAtlas(faceId, () => neededNow.current).then(
      (atlas) => {
        if (current) setAnswered(atlas);
      },
      (failure: unknown) => console.warn(`[Companion] Her face ${faceId} could not be loaded; the disc keeps her ground:`, failure),
    );
    return () => {
      current = false;
    };
  }, [faceId, frameSize, cached]);

  return faceId === null ? null : cached ?? answered;
}
