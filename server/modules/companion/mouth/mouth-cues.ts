import type { CompanionMouthCue, CompanionMouthPiece, CompanionMouthShape } from '@/shared/companion-types.js';

/**
 * Reads Rhubarb's JSON answer for one piece into the wire's `CompanionMouthPiece`. PURE: no I/O.
 *
 * Rhubarb answers `{ metadata, mouthCues: [{ start, end, value }] }` with `start` in seconds from the piece's first sample.
 * The wire wants sentence time, in order, one shape per change: so each start is offset by the piece's own start, rounded to
 * the millisecond, and a shape that repeats back to back is kept once. `end` is not read: a shape lasts until the next cue.
 *
 * An answer this does not recognise is `null`, and the piece is simply not announced: the page fills that stretch with the
 * level mouth. "Not recognised" is strict on purpose, because a wrong shape on a face is worse than a missing one: a cue
 * that is not a start in seconds and a shape of A–F or X (the server never asks for G or H), starts that do not rise, a first
 * cue that is not at the piece's start (Rhubarb covers its whole file), or no cue left inside the piece.
 *
 * Consumer: `mouth-follow.ts`.
 */

const SHAPES: ReadonlySet<string> = new Set<CompanionMouthShape>(['A', 'B', 'C', 'D', 'E', 'F', 'X']);

const toMillisecond = (seconds: number): number => Math.round(seconds * 1000) / 1000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Rhubarb's JSON answer for one piece as sentence-time cues: shapes A–F and X only, starts in order and inside the piece, offset by the piece's start, rounded to the millisecond, a shape repeated back to back kept once. Null for an answer that is not that shape. Consumed by `mouth-follow.ts`. */
export function pieceCues(answer: unknown, fromSeconds: number, toSeconds: number): CompanionMouthPiece | null {
  if (!Number.isFinite(fromSeconds) || !Number.isFinite(toSeconds) || fromSeconds < 0 || toSeconds <= fromSeconds) return null;
  if (!isRecord(answer) || !Array.isArray(answer.mouthCues)) return null;

  const from = toMillisecond(fromSeconds);
  const to = toMillisecond(toSeconds);
  const cues: CompanionMouthCue[] = [];
  for (const raw of answer.mouthCues as unknown[]) {
    if (!isRecord(raw)) return null;
    const { start, value } = raw;
    if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) return null;
    if (typeof value !== 'string' || !SHAPES.has(value)) return null;

    const at = toMillisecond(fromSeconds + start);
    if (at < from || at >= to) continue;
    const previous = cues[cues.length - 1];
    if (previous !== undefined) {
      if (at <= previous.at) return null;
      if (previous.shape === value) continue;
    }
    cues.push({ at, shape: value as CompanionMouthShape });
  }
  if (cues.length === 0 || cues[0].at !== from) return null;
  return { from, to, cues };
}
