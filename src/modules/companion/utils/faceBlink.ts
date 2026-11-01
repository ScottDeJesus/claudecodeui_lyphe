// The blink of her face, in pure code: which frame a blink shows over the look she holds, when the next one is due in each state,
// and the blink that rides a move of her eyes or head. She blinks in every state but stopped, so a blink takes the frames of
// WHAT THE FACE SHOWS under it (`FaceLook`): a mood's face, her listening face, a gaze, or a turned pose. A manifest made before
// `blinks` has frames only for the moods, and `blinkFramesOf` says so with null.
//
// The engine owns the clock: each deadline here is something it returns in `nextAt`, and nothing in this file schedules a timer.

import { BLINK_GAP_BY_STATE, blinkAt, blinkGap, blinkIsDoubled, blinkLength, blinkSteps } from '@/modules/companion/utils/faceSchedule';
import type { Random } from '@/modules/companion/utils/faceSchedule';
import type {
  CompanionFaceBlink, CompanionFaceGaze, CompanionFaceManifest, CompanionFaceMood, CompanionFacePose,
} from '@/shared/companion-types';
import type { CompanionPresenceState } from '@/shared/types';

/** What the face shows under a blink, so the blink takes that look's frames: a mood's face, her listening face, a gaze, or a turned pose. */
export type FaceLook =
  | { kind: 'mood'; mood: CompanionFaceMood }
  | { kind: 'listening' }
  | { kind: 'gaze'; gaze: CompanionFaceGaze }
  | { kind: 'pose'; pose: CompanionFacePose };

/** The share of her eye and head moves that a blink comes with: one at every move reads as a tic, and none as a machine. */
const CARRY_SHARE = 0.4;
/**
 * A blink never starts to carry a move sooner (ms) after the last blink's end than the state's SHORTEST gap, so the rhythm table holds for every blink and a
 * move decides only WHEN inside it a blink lands, never how often she blinks: the reading sweep, which moves every 1.3 s, adds none, and she blinks seldom
 * while she reads. A state with no rhythm has none to carry.
 */
const carryApartMs = (state: CompanionPresenceState): number => BLINK_GAP_BY_STATE[state]?.[0] ?? Number.POSITIVE_INFINITY;

/** Used by `faceEngine.ts` and `.verify`'s replay: the half and closed frames of `look`, or null when the face has none (a manifest made before `blinks`). */
export function blinkFramesOf(manifest: CompanionFaceManifest, look: FaceLook): CompanionFaceBlink | null {
  switch (look.kind) {
    case 'mood': return manifest.moods[look.mood].blink;
    case 'listening': return manifest.blinks?.listening ?? null;
    case 'gaze': return manifest.blinks?.gaze?.[look.gaze] ?? null;
    case 'pose': return manifest.blinks?.poses?.[look.pose] ?? null;
  }
}

/** Used by `faceNames.ts`'s `frameNames`: each blink frame of the manifest with its name in the bake's convention, `blink.<look>.<step>`, `<step>` being `half` or `closed`. */
export function blinkNames(manifest: CompanionFaceManifest): Array<[number, string]> {
  const named = (prefix: string, blink: CompanionFaceBlink): Array<[number, string]> => [[blink.half, `${prefix}.half`], [blink.closed, `${prefix}.closed`]];
  const { listening, gaze, poses } = manifest.blinks ?? { listening: null, gaze: {}, poses: {} };
  return [
    ...Object.entries(manifest.moods).flatMap(([mood, face]) => named(`blink.${mood}`, face.blink)),
    // A `blinks` that is a record but not whole (a corrupted file) names what it holds and nothing more; the page's check refuses it before the portrait asks.
    ...(listening ? named('blink.listening', listening) : []),
    ...Object.entries(gaze ?? {}).flatMap(([name, blink]) => named(`blink.gaze.${name}`, blink)),
    ...Object.entries(poses ?? {}).flatMap(([name, blink]) => named(`blink.pose.${name}`, blink)),
  ];
}

/** Used by `faceEngine.ts`: the frame of `look` with its eyes open and nothing over it (a mood's, with its mouth closed). */
export function stillFrameOf(manifest: CompanionFaceManifest, look: FaceLook): number {
  switch (look.kind) {
    case 'mood': return manifest.moods[look.mood].mouths.closed;
    case 'listening': return manifest.states.listening;
    case 'gaze': return manifest.gaze[look.gaze];
    case 'pose': return manifest.poses[look.pose];
  }
}

type Blink = { startedAt: number; steps: ReturnType<typeof blinkSteps> };

/** When the lids are next closed: now if they are, else the start of the closed step still ahead, and now when none is (the blink's second half). */
function closedFrom(blink: Blink, now: number): number {
  let start = blink.startedAt;
  for (const [look, ms] of blink.steps) {
    if (look === 'closed' && now < start + ms) return Math.max(now, start);
    start += ms;
  }
  return now;
}

/** Used by `faceEngine.ts`: one per engine. It holds the blink in play, the next one's deadline (drawn from the state's range) and the blink a move carries. */
export function createBlinker(random: Random) {
  let blink: Blink | null = null;
  // When the scheduled blink is due; null while the state has none (failed, cut).
  let due: number | null = null;
  // The state the gap after a blink is drawn from, as the engine last said.
  let state: CompanionPresenceState = 'idle';
  let lastEndedAt = Number.NEGATIVE_INFINITY;

  const gapFrom = (from: number): number | null => (BLINK_GAP_BY_STATE[state] === undefined ? null : from + blinkGap(random, state));
  const retire = (now: number): void => {
    if (blink !== null && blinkAt(blink.steps, now - blink.startedAt) === null) blink = null;
  };
  /** A blink from `now`: the scheduled one, or the one a move carries, which counts as the scheduled one and draws the gap after it. */
  const begin = (now: number): Blink => {
    const steps = blinkSteps(blinkIsDoubled(random));
    lastEndedAt = now + blinkLength(steps);
    due = gapFrom(lastEndedAt);
    blink = { startedAt: now, steps };
    return blink;
  };

  return {
    /** The frame a blink shows over `look` now (null when no blink is in play, or the face has no frames for the look) and the next ms it wants a call at (the end of the step it is in). */
    frame(now: number, look: FaceLook, manifest: CompanionFaceManifest): { frame: number | null; nextAt: number | null } {
      retire(now);
      const step = blink === null ? null : blinkAt(blink.steps, now - blink.startedAt);
      if (blink === null || step === null) return { frame: null, nextAt: null };
      const frames = blinkFramesOf(manifest, look);
      // Between the two blinks of a double the eyes are open: the look's own frame.
      const frame = step.look === 'open' ? stillFrameOf(manifest, look) : frames === null ? null : frames[step.look];
      return { frame, nextAt: blink.startedAt + step.untilMs };
    },
    /** Starts the scheduled blink when it is due and the face is free. `state` is the one the gap after it is drawn from. */
    tick(now: number, next: CompanionPresenceState, free: boolean): void {
      state = next;
      retire(now);
      if (free && blink === null && due !== null && due <= now) begin(now);
    },
    /**
     * A move of the eyes or the head is about to happen. It answers when the move should land: now, or at the closed step of a
     * blink it starts (40% of the time, never within the state's shortest gap of the last blink's end). A move that falls in a blink already in play
     * lands under its closed lids, so asking again until the answer is now is the way to wait for it.
     */
    carry(now: number): number {
      retire(now);
      const riding = blink ?? (now - lastEndedAt < carryApartMs(state) || random() >= CARRY_SHARE ? null : begin(now));
      return riding === null ? now : closedFrom(riding, now);
    },
    /** The state changed: the next blink is drawn from its range, counted from now, and a blink that carries a move waits out the state's shortest gap from now too. */
    enter(now: number, next: CompanionPresenceState): void {
      state = next;
      due = gapFrom(now);
      lastEndedAt = now;
    },
    /** When the scheduled blink is due (null when the state has none). */
    dueAt: (): number | null => due,
    /** A scheduled blink that fell due while the face could not blink lapses: the next is drawn from when it was due. */
    renew(): void {
      if (due !== null) due = gapFrom(due);
    },
    /** One plain blink, outside the schedule and drawing nothing: the cut's. */
    single(now: number): void {
      const steps = blinkSteps(false);
      blink = { startedAt: now, steps };
      lastEndedAt = now + blinkLength(steps);
    },
    clear(): void {
      blink = null;
    },
    /** Whether a blink is in play at `now`, counting one whose last step ended since the engine last asked: the step out of it is a hard swap too. */
    inBlink: (now: number): boolean => blink !== null && blink.startedAt <= now,
  };
}
