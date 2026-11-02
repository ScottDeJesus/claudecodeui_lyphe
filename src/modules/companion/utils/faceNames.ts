// The names of the frames of a face, in pure code: the one convention the bake's lines, its contact sheet, the portrait's `data-frame`
// stamp and `.verify`'s replays share (the header of `server/modules/companion/face/face-recipe.ts` lists it). The engine never reads a
// name: it picks indices, and this says what each index is.

import { blinkNames } from '@/modules/companion/utils/faceBlink';
import type { CompanionFaceManifest } from '@/shared/companion-types';

/**
 * Used by the portrait and by `.verify`'s replay (both through `faceEngine.ts`): every frame's name by index, in the bake's convention. A frame two things
 * point at keeps the first name; one nothing points at is `frame.<n>`. A clip's own frames are numbered from 0 without the frames another
 * table already names: the gasp's playlist is `clip.gasp.0`, `state.surprise`, `clip.gasp.1`, as the bake names them.
 */
export function frameNames(manifest: CompanionFaceManifest): string[] {
  const names = manifest.frames.map((_, index) => `frame.${index}`);
  const claimed = new Set<number>();
  const claim = (index: number, name: string) => {
    if (claimed.has(index)) return;
    claimed.add(index);
    names[index] = name;
  };
  for (const [mood, face] of Object.entries(manifest.moods)) {
    for (const [mouth, index] of Object.entries(face.mouths)) claim(index, `mood.${mood}.${mouth}`);
  }
  for (const [index, name] of blinkNames(manifest)) claim(index, name);
  for (const [gaze, index] of Object.entries(manifest.gaze)) claim(index, `gaze.${gaze}`);
  for (const [pose, index] of Object.entries(manifest.poses)) claim(index, `pose.${pose}`);
  for (const [state, index] of Object.entries(manifest.states)) claim(index, `state.${state}`);
  for (const [clip, { frames }] of Object.entries(manifest.clips)) {
    let n = 0;
    for (const index of frames) {
      if (claimed.has(index)) continue;
      claim(index, `clip.${clip}.${n}`);
      n += 1;
    }
  }
  // A `brows` that is a record but not whole names what it holds, as `blinkNames` does.
  for (const [mood, index] of Object.entries(manifest.brows ?? {})) claim(index, `brow.${mood}`);
  return names;
}
