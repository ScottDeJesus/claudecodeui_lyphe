import { createHash } from 'node:crypto';

import type {
  CompanionFaceBlink,
  CompanionFaceClip,
  CompanionFaceGaze,
  CompanionFaceManifest,
  CompanionFaceMood,
  CompanionFaceMouth,
  CompanionFacePose,
  CompanionFaceTier,
} from '@/shared/companion-types.js';

/**
 * THE RECIPE: the one home of every frame's sliders, every clip's frames and pace, and the framing. Nothing else in the
 * bake holds a number that shapes a frame; tuning her face is changing a value here and baking again.
 *
 * A frame is the twelve LivePortrait expression sliders (`FaceSliders`); every slider a table does not name is 0, and
 * the node's other inputs (src_ratio, sample_ratio, sample_parts) take the node's defaults. A frame is its mood's sliders
 * plus its mouth's, summed and clamped to the node's own range (`SLIDER_RANGES`, nodes.py:844-857): ComfyUI refuses a
 * prompt holding any value past its max, and whispered's woo 3 plus o2's woo 14 is 17 where the node stops at 15.
 *
 * Signs, read off the contact sheet (the node negates yaw inside, nodes.py:886; directions are the screen's, `left` is
 * toward the window's left edge): `blink` negative closes; `pupil_x` positive looks left; `pupil_y` positive looks up;
 * `rotate_yaw` negative turns left; `rotate_pitch` negative looks up (positive dips the head: the sigh).
 *
 * Frame names are the one convention shared by the CLI's lines, the contact sheet, the page's replay and the page's stamp:
 * `mood.<mood>.<mouth>`, `blink.<mood>.half` and `.closed`, `gaze.<gaze>`, `pose.<pose>`, `state.listening`,
 * `state.failed`, `state.surprise`, `clip.<clip>.<n>`, and after the clips the blinks of the looks that are not a mood's face:
 * `blink.listening.<step>`, `blink.gaze.<gaze>.<step>` and `blink.pose.<pose>.<step>`, `<step>` being `half` or `closed`, and last
 * `brow.<mood>`: each mood's closed face with her brows lifted, which the page shows at the end of a question.
 */

/** The node's commit, which the recipe's id and every cached frame are keyed by: another commit may render another crop. Pinned by scripts/install-comfyui.sh. */
const NODE_COMMIT = '3bba732915e2';

/** The twelve sliders of the node's ExpressionEditor, by the node's own input names. Consumed by `comfyui.ts` (the prompt) and `face-bake.ts`. */
export type FaceSliders = {
  rotate_pitch: number; rotate_yaw: number; rotate_roll: number;
  blink: number; eyebrow: number; wink: number; pupil_x: number; pupil_y: number;
  aaa: number; eee: number; woo: number; smile: number;
};

type SliderDelta = Partial<FaceSliders>;

/** How the generator's crop becomes the disc's frame. Consumed by `face-atlas.ts` (the cut and the pad), `face-bake.ts` (the cache and the tiers), `face-avatars.ts` and the CLI. */
export type FaceFraming = {
  /** The node's crop_factor: the crop is this many face sides across, so the face's side is 512 / cropFactor preview pixels. */
  cropFactor: number;
  /** The disc's square, in face sides. */
  discSide: number;
  /** How far the disc's centre is raised above the face's centre, in face sides: the hair above the face wants room. */
  discRaise: number;
  /**
   * Pixels per side of the cut frames of each TIER of the atlas, smallest first (`cutFrame`, `packSheets`): a page draws the smallest
   * that covers the pixels it is drawn at. The largest is the disc's native square, `discSide × 512 / cropFactor` preview pixels (448
   * for the current framing), cut with no resampling; `cutFrame` refuses a tier above it. Hashed into the recipe's id, so a tier added
   * or dropped is a new face: a face's files are immutable under their id.
   */
  frameSizes: number[];
  /** The mirrored band added on every side of the photo before the node sees it, in photo sizes: it keeps the crop from running off the image, and lies outside the disc. */
  pad: number;
};

/** The house framing: Dark hair's, and the default of every account's own photo. Another look's framing (`face-avatars.ts`) is its own object of the same shape. Consumed by `face-avatars.ts`, `face-files.ts` and `face.service.ts`. */
export const FACE_FRAMING: FaceFraming = { cropFactor: 2.0, discSide: 1.75, discRaise: 0.05, frameSizes: [256, 448], pad: 0.5 };

/** The node's own range for each slider; each frame's sum is clamped to it. */
const SLIDER_RANGES: Record<keyof FaceSliders, readonly [number, number]> = {
  blink: [-20, 5], eyebrow: [-10, 15], wink: [0, 25], pupil_x: [-15, 15], pupil_y: [-15, 15],
  aaa: [-30, 120], eee: [-20, 15], woo: [-20, 15], smile: [-0.3, 1.3],
  rotate_pitch: [-20, 20], rotate_yaw: [-20, 20], rotate_roll: [-20, 20],
};

const SLIDER_NAMES = Object.keys(SLIDER_RANGES) as Array<keyof FaceSliders>;

/** Added to every frame of the mood. */
const MOODS: Record<CompanionFaceMood, SliderDelta> = {
  neutral: {},
  delighted: { smile: 0.55, eyebrow: 4, blink: -3 },
  playful: { smile: 0.4, wink: 5, eyebrow: 2, pupil_x: 3 },
  gentle: { smile: 0.2, eyebrow: 2, blink: -3 },
  thoughtful: { smile: -0.1, eyebrow: -2, pupil_x: 6, pupil_y: 5 },
  brisk: { smile: 0.15, eyebrow: 3, blink: 2 },
  soft: { smile: 0.25, eyebrow: 1, blink: -5 },
  whispered: { smile: 0.05, eyebrow: 3, blink: -4, woo: 3 },
  mock_serious: { smile: -0.25, eyebrow: -5, blink: -3 },
};

/** Added on top of the mood. `a` is "ah", `e` "ee", `o` "oo"; 1 is half open, 2 full. */
const MOUTHS: Record<CompanionFaceMouth, SliderDelta> = {
  closed: {},
  a1: { aaa: 35 }, a2: { aaa: 70 },
  e1: { eee: 8, aaa: 10 }, e2: { eee: 14, aaa: 20 },
  o1: { woo: 8, aaa: 10 }, o2: { woo: 14, aaa: 25 },
};

/** The `blink` a half-closed and a closed frame SET (not add), on the mood with its mouth closed. */
const BLINKS = { half: -10, closed: -20 };

/** Neutral, with the eyes looking and the head still. `pupil_x` is positive toward the screen's left, `pupil_y` positive upward. */
const GAZE: Record<CompanionFaceGaze, SliderDelta> = {
  left: { pupil_x: 12 }, right: { pupil_x: -12 }, up: { pupil_y: 10 }, down: { pupil_y: -10 },
  up_left: { pupil_x: 9, pupil_y: 8 }, up_right: { pupil_x: -9, pupil_y: 8 },
  down_left: { pupil_x: 9, pupil_y: -8 }, down_right: { pupil_x: -9, pupil_y: -8 },
};

/** Neutral, the head turned and the eyes following. `rotate_yaw` is negative toward the screen's left; `rotate_pitch` is negative looking up. */
const POSES: Record<CompanionFacePose, SliderDelta> = {
  left_10: { rotate_yaw: -10, pupil_x: 5 }, left_20: { rotate_yaw: -20, pupil_x: 8 },
  right_10: { rotate_yaw: 10, pupil_x: -5 }, right_20: { rotate_yaw: 20, pupil_x: -8 },
  up_5: { rotate_pitch: -5, pupil_y: 4 }, up_10: { rotate_pitch: -10, pupil_y: 7 },
  down_5: { rotate_pitch: 5, pupil_y: -4 }, down_10: { rotate_pitch: 10, pupil_y: -7 },
};

const STATES = {
  listening: { eyebrow: 5, blink: 3, smile: 0.2 },
  failed: { smile: -0.2, blink: -7, eyebrow: -1, pupil_y: -4 },
  surprise: { eyebrow: 12, blink: 5, aaa: 30, woo: 6 },
} satisfies Record<string, SliderDelta>;

/** Added to a mood's closed face for its `brow.<mood>` frame: her brows lifted and her eyes a little wider, the mouth left closed so the mood's smile stands. */
const QUESTION_BROW: SliderDelta = { eyebrow: 6, blink: 2 };

const LAUGH_BASE: SliderDelta = { smile: 1.1, eyebrow: 5, blink: -6 };
const GIGGLE_BASE: SliderDelta = { smile: 0.9, eyebrow: 3, blink: -6 };

/** Each clip's pace and its own frames, `clip.<clip>.<n>`. The gasp's frames play either side of `state.surprise` (`clipPlaylist`). */
const CLIPS: Record<CompanionFaceClip, { fps: number; frames: SliderDelta[] }> = {
  laugh: {
    fps: 12,
    frames: [
      { ...LAUGH_BASE, aaa: 60 }, { ...LAUGH_BASE, aaa: 25 }, { ...LAUGH_BASE, aaa: 65 },
      { ...LAUGH_BASE, aaa: 20 }, { ...LAUGH_BASE, aaa: 55 }, { ...LAUGH_BASE, smile: 0.9, blink: -4, aaa: 10 },
    ],
  },
  giggle: { fps: 12, frames: [20, 8, 22, 6].map((aaa) => ({ ...GIGGLE_BASE, aaa })) },
  gasp: { fps: 10, frames: [{ eyebrow: 6, blink: 3, aaa: 15 }, { eyebrow: 8, aaa: 10 }] },
  sigh: {
    fps: 8,
    frames: [
      { blink: -8, eyebrow: -2, woo: 4, rotate_pitch: 4 },
      { blink: -12, eyebrow: -2, woo: 6, rotate_pitch: 6 },
      { blink: -6, rotate_pitch: 3 },
    ],
  },
};

/** One frame of the face: its name and the sliders that make it. Consumed by `face-bake.ts`. */
export type RecipeFrame = { name: string; sliders: FaceSliders };

/**
 * The sum of the deltas on a zero face, each slider clamped to the node's range and rounded so a float sum never leaks
 * into a cache key. `overrides` SET sliders after the sum (a blink frame sets `blink`; it never adds to the mood's).
 */
function composeSliders(deltas: SliderDelta[], overrides: SliderDelta = {}): FaceSliders {
  const sliders = {} as FaceSliders;
  for (const name of SLIDER_NAMES) {
    const sum = overrides[name] ?? deltas.reduce((total, delta) => total + (delta[name] ?? 0), 0);
    const [min, max] = SLIDER_RANGES[name];
    sliders[name] = Math.round(Math.min(max, Math.max(min, sum)) * 1000) / 1000;
  }
  return sliders;
}

const moodNames = Object.keys(MOODS) as CompanionFaceMood[];
const mouthNames = Object.keys(MOUTHS) as CompanionFaceMouth[];
const gazeNames = Object.keys(GAZE) as CompanionFaceGaze[];
const poseNames = Object.keys(POSES) as CompanionFacePose[];
const clipNames = Object.keys(CLIPS) as CompanionFaceClip[];

let listedFrames: RecipeFrame[] | null = null;

/** Every frame of the face in bake order, `mood.neutral.closed` first. Consumed by `face-bake.ts`, which renders them in this order and numbers the atlas by it. */
export function recipeFrames(): RecipeFrame[] {
  if (listedFrames) return listedFrames;
  const frames: RecipeFrame[] = [];
  const add = (name: string, deltas: SliderDelta[], overrides?: SliderDelta) =>
    frames.push({ name, sliders: composeSliders(deltas, overrides) });

  for (const mood of moodNames) {
    for (const mouth of mouthNames) add(`mood.${mood}.${mouth}`, [MOODS[mood], MOUTHS[mouth]]);
  }
  // A blink is its look's deltas with `blink` SET: half, then closed.
  const addBlink = (name: string, delta: SliderDelta) => {
    add(`${name}.half`, [delta], { blink: BLINKS.half });
    add(`${name}.closed`, [delta], { blink: BLINKS.closed });
  };
  for (const mood of moodNames) addBlink(`blink.${mood}`, MOODS[mood]);
  for (const gaze of gazeNames) add(`gaze.${gaze}`, [GAZE[gaze]]);
  for (const pose of poseNames) add(`pose.${pose}`, [POSES[pose]]);
  for (const [state, delta] of Object.entries(STATES)) add(`state.${state}`, [delta]);
  for (const clip of clipNames) CLIPS[clip].frames.forEach((delta, n) => add(`clip.${clip}.${n}`, [delta]));
  // The blinks of the looks that are not a mood's face, after the clips so every index before them stands.
  addBlink('blink.listening', STATES.listening);
  for (const gaze of gazeNames) addBlink(`blink.gaze.${gaze}`, GAZE[gaze]);
  for (const pose of poseNames) addBlink(`blink.pose.${pose}`, POSES[pose]);
  // Each mood's brows lifted, after the blinks for the same reason.
  for (const mood of moodNames) add(`brow.${mood}`, [MOODS[mood], QUESTION_BROW]);

  listedFrames = frames;
  return frames;
}

/** JSON with every object's keys sorted, so two equal recipes hash alike however their tables were ordered. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The recipe's id for a look made with `framing` (the house's by default): the first 8 hex of the sha256 of the recipe as
 * canonical JSON, plus the node's commit. It hashes the frames as composed (names and clamped sliders, in order) and the
 * framing, so a change to any table, clamp or that look's framing value is a new id and so a new face, while another look's
 * face stands. The second half of every face id (`<photoId>-<recipeId>`); consumed by `face-files.ts`.
 */
export function recipeId(framing: FaceFraming = FACE_FRAMING): string {
  const recipe = canonicalJson({ framing, frames: recipeFrames() });
  return createHash('sha256').update(recipe + NODE_COMMIT).digest('hex').slice(0, 8);
}

/**
 * The key a frame's cached crop lives under: a hash of every input that shapes the generator's crop — the sliders,
 * crop_factor, the pad and the node's commit. The disc's side and raise are NOT in it: they only change the cut, so a
 * framing tune re-cuts cached crops and renders nothing. `framing` is the look's (the house's by default). Consumed by
 * `face-bake.ts`, the `frames/` cache.
 */
export function frameCacheKey(sliders: FaceSliders, framing: FaceFraming = FACE_FRAMING): string {
  const shaping = canonicalJson({ sliders, cropFactor: framing.cropFactor, pad: framing.pad, node: NODE_COMMIT });
  return createHash('sha256').update(shaping).digest('hex').slice(0, 16);
}

/** The names a clip plays, in order: its own frames, except the gasp, which plays `state.surprise` between its two. */
function clipPlaylist(clip: CompanionFaceClip): string[] {
  const own = CLIPS[clip].frames.map((_, n) => `clip.${clip}.${n}`);
  return clip === 'gasp' ? [own[0], 'state.surprise', own[1]] : own;
}

/**
 * The manifest of a face whose frames are placed by `frames` on the sheets of each of `tiers` (smallest first, as
 * `FACE_FRAMING.frameSizes`): every number an index into `frames`, found by the frame's name so the manifest and the recipe
 * cannot drift. The smallest tier is the manifest's own `frameSize` and `sheets`; the rest are its `largerTiers`. Consumed by
 * `face-bake.ts`, which writes it last.
 */
export function buildManifest(faceId: string, tiers: CompanionFaceTier[], frames: CompanionFaceManifest['frames']): CompanionFaceManifest {
  const [smallest, ...larger] = tiers;
  const indexByName = new Map(recipeFrames().map((frame, index) => [frame.name, index]));
  const at = (name: string): number => {
    const index = indexByName.get(name);
    if (index === undefined) throw new Error(`the recipe names no frame "${name}"`);
    return index;
  };
  const table = <K extends string, V>(keys: K[], value: (key: K) => V) => Object.fromEntries(keys.map((key) => [key, value(key)])) as Record<K, V>;
  const record = <K extends string>(keys: K[], name: (key: K) => string) => table(keys, (key) => at(name(key)));
  const blinkOf = (name: string): CompanionFaceBlink => ({ half: at(`${name}.half`), closed: at(`${name}.closed`) });

  return {
    version: 1,
    faceId,
    frameSize: smallest.frameSize,
    sheets: smallest.sheets,
    ...(larger.length > 0 ? { largerTiers: larger } : {}),
    frames,
    moods: Object.fromEntries(
      moodNames.map((mood) => [mood, {
        mouths: record(mouthNames, (mouth) => `mood.${mood}.${mouth}`),
        blink: blinkOf(`blink.${mood}`),
      }]),
    ) as CompanionFaceManifest['moods'],
    gaze: record(gazeNames, (gaze) => `gaze.${gaze}`),
    poses: record(poseNames, (pose) => `pose.${pose}`),
    states: { listening: at('state.listening'), failed: at('state.failed'), surprise: at('state.surprise') },
    clips: Object.fromEntries(
      clipNames.map((clip) => [clip, { fps: CLIPS[clip].fps, frames: clipPlaylist(clip).map(at) }]),
    ) as CompanionFaceManifest['clips'],
    blinks: {
      listening: blinkOf('blink.listening'),
      gaze: table(gazeNames, (gaze) => blinkOf(`blink.gaze.${gaze}`)),
      poses: table(poseNames, (pose) => blinkOf(`blink.pose.${pose}`)),
    },
    brows: record(moodNames, (mood) => `brow.${mood}`),
  };
}
