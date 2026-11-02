// Her head on the portrait's two layers. The engine answers it (`FaceDraw.head`, from `faceHead.ts`) on every step; this writes it as `--kaylee-bob`
// (% of the layer) and `--kaylee-roll` (degrees) on each layer, and the stylesheet turns them into the layer's own `translate` and `rotate`.
// The face layer takes the value as it comes; the hair layer takes the newest value at least `--kaylee-lag` old, from a short history, so the hair
// follows the face by the one lag the stylesheet gives it. A value is written only when it changes, and the variables come off both layers once the
// engine is at rest and the hair's value has come to rest too. This file touches the nodes it is handed and nothing else: it is not part of the engine.

import type { FaceHead } from '@/modules/companion/utils/faceHead';

const BOB = '--kaylee-bob';
const ROLL = '--kaylee-roll';
/**
 * The most answers of the engine the history may hold. It is a bound, not the history's length: samples older than the one the hair shows are dropped as
 * time passes, so the history is the hair's lag of steps and one more, and 64 of them span that lag at any screen up to about 700 frames a second.
 */
const TRAIL_LENGTH = 64;

/** One answer of the engine: when (`performance.now()`) and what (null: at rest). */
type HeadSample = { at: number; head: FaceHead | null };
/** What a layer's two variables hold as written, so a value that has not changed is not written again. */
type HeadWords = { bob: string; roll: string };

/** A head as the variables hold it, to a thousandth (the unary plus drops a `-0`); rest is none of either. */
const wordsOf = (head: FaceHead | null): HeadWords => ({ bob: `${+(head?.bob ?? 0).toFixed(3)}%`, roll: `${+(head?.roll ?? 0).toFixed(3)}deg` });

function writeWords(layer: HTMLElement, before: HeadWords | null, words: HeadWords): void {
  if (before?.bob !== words.bob) layer.style.setProperty(BOB, words.bob);
  if (before?.roll !== words.roll) layer.style.setProperty(ROLL, words.roll);
}

/** Used by CompanionPortrait: the history and what each layer holds, made once and kept in a ref across the loop's restarts (never React state). */
export const createHeadMemory = (): { trail: HeadSample[]; face: HeadWords | null; hair: HeadWords | null } => ({ trail: [], face: null, hair: null });

/**
 * Used by CompanionPortrait's loop on every step: writes `head` (the engine's answer at `now`, null at rest) onto the layers. The hair gets the newest
 * sample at least `lagMs` old, or the oldest while the bound has pushed every old-enough sample out (a screen above about 700 Hz), and rest before that.
 * Answers whether the hair is still on its way, for which the loop keeps asking for frames; false once nothing is written and nothing waits.
 */
export function stampHead(
  memory: ReturnType<typeof createHeadMemory>, faceLayer: HTMLElement, hairLayer: HTMLElement, lagMs: number, head: FaceHead | null, now: number,
): boolean {
  const { trail } = memory;
  if (head === null && trail.length === 0) return false;
  trail.push({ at: now, head });
  if (trail.length > TRAIL_LENGTH) trail.shift();
  let dueIndex = trail.length === TRAIL_LENGTH ? 0 : -1;
  trail.forEach((sample, k) => {
    if (sample.at <= now - lagMs) dueIndex = k;
  });
  // Time only moves on, so the samples before the one the hair shows now are never read again.
  if (dueIndex > 0) trail.splice(0, dueIndex);
  const due: HeadSample | undefined = dueIndex < 0 ? undefined : trail[0];
  if (head === null && due !== undefined && due.head === null) {
    for (const layer of [faceLayer, hairLayer]) for (const name of [BOB, ROLL]) layer.style.removeProperty(name);
    trail.length = 0;
    memory.face = null;
    memory.hair = null;
    return false;
  }
  const face = wordsOf(head);
  const hair = wordsOf(due?.head ?? null);
  writeWords(faceLayer, memory.face, face);
  writeWords(hairLayer, memory.hair, hair);
  memory.face = face;
  memory.hair = hair;
  return true;
}
