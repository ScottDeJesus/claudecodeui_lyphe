// The little scenes her face plays besides its resting looks: the clips her sounds start, the nod as his press begins, and
// the tsk's shake. A clip is a short run of frames at a rate, and a MOTION that the page's CSS plays on the whole portrait
// while the frames run; the motion outlasts its frames when the stylesheet's movement does (a gasp settles after it lifts).

import type { CompanionFaceManifest } from '@/shared/companion-types';

/** The movements the portrait's stylesheet knows, keyed on `data-motion`. */
export type FaceMotion = 'laugh' | 'giggle' | 'gasp' | 'sigh' | 'nod' | 'shake' | 'breath';

/** One clip ready to play: its `frames` (indices into the manifest's frames), `stepMs` each, and how long its `motion` lasts (ms, never less than the frames take). */
export type ClipPlan = { motion: FaceMotion; frames: number[]; stepMs: number; motionMs: number };

/** The clip each sound plays. The pauses play nothing, and neither does a tag added to the allow-list later, until this names it. A Map, so a tag that spells an Object property is not found on the prototype. */
const CLIP_OF_SOUND = new Map<string, FaceMotion>([
  ['giggle', 'giggle'], ['chuckle', 'giggle'], ['laugh', 'laugh'], ['gasp', 'gasp'], ['sigh', 'sigh'], ['phew', 'sigh'],
  ['tsk', 'shake'], ['breath', 'breath'],
]);

/** How long a motion runs at least, where the stylesheet's movement is longer than the frames: the gasp's lift and settle (120 + 300 ms), the sigh's drop and settle (400 + 600), the nod's dip, and the one deeper breath. */
const MOTION_FLOOR_MS: Partial<Record<FaceMotion, number>> = { gasp: 420, sigh: 1000, nod: 600, breath: 1600 };

/** The nod's rate (frames a second), and the tsk's shake. */
const NOD_FPS = 8;
const SHAKE_FPS = 12;

function plan(motion: FaceMotion, frames: number[], fps: number): ClipPlan {
  const stepMs = 1000 / fps;
  return { motion, frames, stepMs, motionMs: Math.max(frames.length * stepMs, MOTION_FLOOR_MS[motion] ?? 0) };
}

/**
 * Used by `faceEngine.ts`: the clip a sound starts, or null for a tag that plays nothing. The bake's recipe fixes the frames:
 * the laugh, giggle and sigh play their `clips`; the gasp plays its first frame, the surprised face, then its second; the tsk
 * shakes between the two 10-degree turns; the breath has no frames, only its motion.
 */
export function clipForSound(tag: string, manifest: CompanionFaceManifest): ClipPlan | null {
  const motion = CLIP_OF_SOUND.get(tag);
  switch (motion) {
    case 'laugh':
    case 'giggle':
    case 'sigh':
      return plan(motion, manifest.clips[motion].frames, manifest.clips[motion].fps);
    case 'gasp': {
      const [first, second] = manifest.clips.gasp.frames;
      return plan('gasp', [first, manifest.states.surprise, second], manifest.clips.gasp.fps);
    }
    case 'shake':
      return plan('shake', [manifest.poses.left_10, manifest.poses.right_10, manifest.poses.left_10, manifest.poses.right_10], SHAKE_FPS);
    case 'breath':
      return plan('breath', [], 1);
    default:
      return null;
  }
}

/** Used by `faceEngine.ts`: the nod as his press begins — her head dips down 5, down 10, down 5 degrees, and comes up to her listening face. */
export function nodClip(manifest: CompanionFaceManifest): ClipPlan {
  const { poses, states } = manifest;
  return plan('nod', [poses.down_5, poses.down_10, poses.down_5, states.listening], NOD_FPS);
}
