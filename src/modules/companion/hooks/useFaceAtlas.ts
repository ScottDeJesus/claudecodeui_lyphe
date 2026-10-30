import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { CompanionFaceManifest } from '@/shared/companion-types';

/** A face ready to play: where every frame sits (`manifest`) and the decoded sheets those frames are cut from (`sheets[n]` is `manifest.sheets[n]`). */
export type FaceAtlas = { manifest: CompanionFaceManifest; sheets: ImageBitmap[] };

/**
 * How many faces stay decoded at once: the one on the page and the one that replaced it a moment ago (a switch decodes the new
 * face while the old one still draws). A sheet is 2048 px square, about 16 MB decoded, so a page that lives for days and has
 * its face changed a few times must not keep every one of them.
 */
const KEPT_FACES = 2;

/** The faces whose sheets are decoded, by face id, oldest first. Module-level, so the button and Settings' preview share one copy per page. */
const decoded = new Map<string, FaceAtlas>();

/** The faces being fetched and decoded, by face id, so two components asking for the same face at once make one request. */
const decoding = new Map<string, Promise<FaceAtlas>>();

/** Whether `value` is a non-null object: the shape of every table of the manifest. */
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';

/**
 * Only what the portrait and its engine read is checked, field by field: a manifest missing one (made by an older recipe, or cut short) would throw
 * inside the portrait's render and take the whole screen with it, so it is refused here and the disc keeps her ground. The neutral mood is the one
 * the engine starts from and falls back to. The numbers inside the tables are the server's own and are not checked one by one.
 */
function isManifest(value: unknown): value is CompanionFaceManifest {
  if (!isRecord(value)) return false;
  const { version, frameSize, frames, sheets, moods, gaze, poses, states, clips } = value;
  return version === 1 && typeof frameSize === 'number' && Array.isArray(frames) && Array.isArray(sheets)
    && isRecord(moods) && isRecord(moods.neutral) && isRecord(gaze) && isRecord(poses) && isRecord(states) && isRecord(clips);
}

async function fetchAtlas(faceId: string): Promise<FaceAtlas> {
  const manifestResponse = await api.companion.face.manifest(faceId);
  if (!manifestResponse.ok) throw new Error(`the manifest answered ${manifestResponse.status}`);
  const manifest: unknown = await manifestResponse.json();
  if (!isManifest(manifest)) throw new Error('the manifest is not one this page can play');

  const sheets = await Promise.all(
    manifest.sheets.map(async (_, n) => {
      const sheetResponse = await api.companion.face.sheet(faceId, n);
      if (!sheetResponse.ok) throw new Error(`sheet ${n} answered ${sheetResponse.status}`);
      return createImageBitmap(await sheetResponse.blob());
    }),
  );
  return { manifest, sheets };
}

function loadAtlas(faceId: string): Promise<FaceAtlas> {
  const standing = decoding.get(faceId);
  if (standing) return standing;
  const loading = fetchAtlas(faceId).then(
    (atlas) => {
      decoding.delete(faceId);
      decoded.set(faceId, atlas);
      // Forgotten, not closed: a component that still draws the old face holds its bitmaps, and a closed bitmap cannot be drawn.
      for (const oldest of [...decoded.keys()].slice(0, Math.max(0, decoded.size - KEPT_FACES))) decoded.delete(oldest);
      return atlas;
    },
    (failure: unknown) => {
      // Not remembered: the next component to ask tries again, and nothing retries by itself.
      decoding.delete(faceId);
      throw failure;
    },
  );
  decoding.set(faceId, loading);
  return loading;
}

/**
 * Used by this module's CompanionAvatar (the button's disc, her panel's header) and by Settings' face card through it: the atlas of
 * face `faceId`, or null until its first one is decoded (and always null for no face at all, a fresh box).
 *
 * THE ATLAS LOADS ONCE PER FACE PER PAGE. It goes through `api.companion.face` because an `<img src>` to an authenticated route
 * carries no token, and it is kept decoded in a module-level cache, so every component showing this face shares one copy. While
 * a new face id's sheets decode, the hook keeps answering the atlas it had: a switch never blanks her.
 */
export function useFaceAtlas(faceId: string | null): FaceAtlas | null {
  const cached = faceId === null ? null : decoded.get(faceId) ?? null;
  // The atlas last answered. State because it is what a switch keeps showing while the new face decodes, and nothing else remembers it.
  const [answered, setAnswered] = useState<FaceAtlas | null>(cached);
  if (cached !== null && answered !== cached) setAnswered(cached);

  useEffect(() => {
    if (faceId === null || decoded.has(faceId)) return undefined;
    let current = true;
    loadAtlas(faceId).then(
      (atlas) => {
        if (current) setAnswered(atlas);
      },
      (failure: unknown) => console.warn(`[Companion] Her face ${faceId} could not be loaded; the disc keeps her ground:`, failure),
    );
    return () => {
      current = false;
    };
  }, [faceId]);

  return faceId === null ? null : cached ?? answered;
}
