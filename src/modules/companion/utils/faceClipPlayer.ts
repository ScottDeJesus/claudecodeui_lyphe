// The clip in play, and the one sound waiting behind it. A clip is started by his press (the nod) or by a sound of hers
// whose place the audio has reached; it shows its frames at its rate, and its motion runs on for the stylesheet's movement.

import { clipForSound } from '@/modules/companion/utils/faceClips';
import type { ClipPlan, FaceMotion } from '@/modules/companion/utils/faceClips';
import type { CompanionFaceManifest } from '@/shared/companion-types';

/** One player per engine. */
type ClipPlayer = {
  /** Drops the clip in play and the one waiting (the state changed, or motion was turned off). */
  clear(): void;
  /** Starts `plan` now, over whatever plays. */
  play(plan: ClipPlan, now: number): void;
  /** A new sentence begins: its sounds are counted from the first again. */
  newSentence(): void;
  /** Ends a clip whose motion is done, then starts the one waiting; a clip that just ended leaves one step with no motion before the next begins, so a repeat restarts its animation. */
  advance(now: number): void;
  /** The latest sound the audio has reached (or null): its clip plays when it is new, and waits when another is in play. */
  hear(reached: { index: number; tag: string } | null, now: number): void;
  /** The frame the clip in play shows at `now`, or null when it has none left (its motion may run on). */
  frame(now: number): number | null;
  /** The motion the stylesheet plays, or null. */
  motion(): FaceMotion | null;
  /** Whether a clip is in play. */
  playing(): boolean;
  /** The next frame edge and the motion's end of the clip in play, as times after `now`. */
  deadlines(now: number): number[];
};

/** Used by `faceEngine.ts`. */
export function createClipPlayer(manifest: CompanionFaceManifest): ClipPlayer {
  // The clip in play and when it began; the one sound waiting behind it; the last sound of the sentence already played; whether a clip ended this step.
  let clip: { plan: ClipPlan; startedAt: number } | null = null;
  let queued: ClipPlan | null = null;
  let soundsPlayed = -1;
  let justEnded = false;

  return {
    clear() {
      clip = null;
      queued = null;
    },
    play(plan, now) {
      clip = { plan, startedAt: now };
    },
    newSentence() {
      soundsPlayed = -1;
    },
    advance(now) {
      justEnded = false;
      if (clip !== null && now >= clip.startedAt + clip.plan.motionMs) {
        clip = null;
        justEnded = true;
      }
      if (clip === null && !justEnded && queued !== null) {
        clip = { plan: queued, startedAt: now };
        queued = null;
      }
    },
    hear(reached, now) {
      if (reached === null || reached.index <= soundsPlayed) return;
      soundsPlayed = reached.index;
      const plan = clipForSound(reached.tag, manifest);
      if (plan === null) return;
      if (clip !== null || justEnded) queued = plan;
      else clip = { plan, startedAt: now };
    },
    frame(now) {
      if (clip === null) return null;
      const index = Math.floor((now - clip.startedAt) / clip.plan.stepMs);
      return index < clip.plan.frames.length ? clip.plan.frames[index] : null;
    },
    motion: () => (clip === null ? null : clip.plan.motion),
    playing: () => clip !== null,
    deadlines(now) {
      if (clip === null) return [];
      const { startedAt, plan } = clip;
      const index = Math.floor((now - startedAt) / plan.stepMs);
      const times = [startedAt + plan.motionMs];
      if (index < plan.frames.length) times.push(startedAt + (index + 1) * plan.stepMs);
      return times.filter((time) => time > now);
    },
  };
}
