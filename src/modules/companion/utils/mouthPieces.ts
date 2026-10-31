import type { CompanionFrame, CompanionMouthPiece, CompanionMouthShape } from '@/shared/companion-types';

// What a page hears of her mouth: the timed shapes of each piece of a sentence's audio (`companion_mouth`), kept just long enough for her
// face to look them up. PURE and React-free: `useCompanionVoice` makes one store for the page's life, the provider's socket handler feeds
// it, and the portrait's loop reads it through `voice.mouth(turnId, index)` on every animation frame, so a piece that lands mid-sentence
// takes over at the very next frame and nothing in React redraws.

/** How many turns of pieces a page keeps: her three most recent. A sentence is only ever looked up while it sounds, and a reply that is replayed (the speech door answers a sentence it cached) announces its pieces again. */
const TURNS_KEPT = 3;

/** Rhubarb's shapes as the wire spells them (`CompanionMouthShape`). */
const SHAPES: ReadonlySet<string> = new Set<CompanionMouthShape>(['A', 'B', 'C', 'D', 'E', 'F', 'X']);

/** What `of` answers for a sentence nothing has been heard of: one frozen list, so a reader that compares by identity sees no change. */
const NO_PIECES: readonly CompanionMouthPiece[] = Object.freeze([]);

type MouthFrame = Extract<CompanionFrame, { kind: 'companion_mouth' }>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isSeconds = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** A piece's cues are shapes A–F or X, each at a moment inside `from`..`to`, each later than the one before. At least one: a piece with none says nothing. */
function isPiece(value: unknown): value is CompanionMouthPiece {
  if (!isRecord(value) || !isSeconds(value.from) || !isSeconds(value.to) || value.to <= value.from) return false;
  const { from, to, cues } = value;
  if (!Array.isArray(cues) || cues.length === 0) return false;
  let previous = Number.NEGATIVE_INFINITY;
  for (const cue of cues as unknown[]) {
    if (!isRecord(cue) || !isSeconds(cue.at) || typeof cue.shape !== 'string' || !SHAPES.has(cue.shape)) return false;
    if (cue.at < from || cue.at >= to || cue.at <= previous) return false;
    previous = cue.at;
  }
  return true;
}

/**
 * Whether a socket frame is a well-formed `companion_mouth`: a turn id, a sentence index, and a piece whose shapes are A–F or X with
 * their cues in order inside `from`..`to`. A frame that fails it is dropped by the provider like a frame of an unknown kind: a wrong shape
 * on her face is worse than none, since the level mouth fills in wherever no shape holds. Consumed by this module's CompanionProvider.
 */
export function isMouthFrame(value: unknown): value is MouthFrame {
  return isRecord(value)
    && value.kind === 'companion_mouth'
    && typeof value.turnId === 'string' && value.turnId !== ''
    && typeof value.index === 'number' && Number.isInteger(value.index) && value.index >= 0
    && isPiece(value.piece);
}

/**
 * A page's timed shapes by turn and sentence: the three most recent turns kept, and a piece announced again (the same `from`)
 * replacing itself. Made once by this module's `useCompanionVoice`, which hands its `of` to her face as `mouth` and its `hear` and
 * `forget` to the provider (a Clear forgets).
 *
 * A turn counts as recent from the first piece heard of it, and the oldest turn goes when a fourth arrives. Each list `of` answers is
 * a snapshot, never changed afterwards (a piece landing makes a new list), so a reader may hold the one it was given.
 */
export function createMouthPieces(): {
  hear(frame: { turnId: string; index: number; piece: CompanionMouthPiece }): void;
  of(turnId: string, index: number): readonly CompanionMouthPiece[];
  forget(): void;
} {
  // Turn id -> sentence index -> its pieces by `from`, in the order the turns were first heard (a Map iterates in insertion order, so the first key is the oldest turn).
  const turns = new Map<string, Map<number, readonly CompanionMouthPiece[]>>();

  return {
    hear({ turnId, index, piece }) {
      let sentences = turns.get(turnId);
      if (sentences === undefined) {
        sentences = new Map();
        turns.set(turnId, sentences);
        if (turns.size > TURNS_KEPT) {
          const oldest = turns.keys().next().value;
          if (oldest !== undefined) turns.delete(oldest);
        }
      }
      const held = sentences.get(index) ?? NO_PIECES;
      // Pieces finish in whatever order Rhubarb answers them, so each takes its place by `from` and a repeat of one replaces it.
      const next = [...held.filter((other) => other.from !== piece.from), piece].sort((a, b) => a.from - b.from);
      sentences.set(index, next);
    },
    of: (turnId, index) => turns.get(turnId)?.get(index) ?? NO_PIECES,
    forget() {
      turns.clear();
    },
  };
}
