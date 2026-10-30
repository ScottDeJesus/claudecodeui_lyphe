import { companionDb } from '@/modules/database/index.js';
import type { CompanionCarriedLine } from '@/shared/companion-types.js';

/**
 * THE LINES AN ACTION CARRIES: Rework notes, a questions round's answers and a run's rulings are HIS words, never hers. The
 * prepare takes the lines she says he spoke and finds each in her log; a line that is not there, as he spoke it, is refused,
 * naming the line, so nothing he did not say travels to a designer or a runner (ruling 3).
 *
 * A carried line must equal one of his SPOKEN lines of the last 30 minutes (`heardSince`, folded the way the check of his word
 * folds: trimmed, whitespace one space). A typed line is not carried: typing is not his word. Two entries that equal one line are
 * two lines only when he said it twice — each entry takes the newest line not yet taken. The lines come back in the order she
 * listed them, so a caller can put each back with the question it answers; `inOrderSaid` puts a group in the order HE said them,
 * which is the order they are joined in, whatever order she listed them.
 *
 * Consumer: `action-recipe.ts` (the notes of a Rework, the rulings of a resumed run, each question's answers).
 */

/** How far back a carried line may have been spoken. Notes are given before the action is prepared; half an hour is "just now". */
const CARRIED_WINDOW_MS = 30 * 60_000;

/** A line as the match reads it: trimmed, every run of whitespace one space (the fold `checkHisWord` makes). */
const folded = (text: string): string => text.trim().replace(/\s+/g, ' ');

/** The carried lines (in the order asked for), or the sentence that refuses and names the line that is not his. */
type CarriedResolution = { ok: true; lines: CompanionCarriedLine[] } | { ok: false; sentence: string };

/**
 * Finds each of `wanted` among his spoken lines of the last 30 minutes. The window opens at `nowMs` minus
 * `CARRIED_WINDOW_MS` (the store's own stamp shape, which `heardSince` requires). The refusal names the first line that is not
 * found and says what to do: ask him to say it aloud, then prepare again.
 */
export function resolveCarriedLines(userId: number, wanted: readonly string[], nowMs: number = Date.now()): CarriedResolution {
  if (wanted.length === 0) return { ok: true, lines: [] };
  const since = new Date(nowMs - CARRIED_WINDOW_MS).toISOString();
  // Newest first, so each entry takes the newest line it equals that no earlier entry took.
  const spoken = companionDb
    .heardSince(userId, since)
    .filter((row) => row.role === 'operator' && row.via === 'spoken')
    .sort((a, b) => b.id - a.id);
  const taken = new Set<number>();
  const found: CompanionCarriedLine[] = [];
  for (const text of wanted) {
    const key = folded(text);
    const row = key === '' ? undefined : spoken.find((candidate) => !taken.has(candidate.id) && folded(candidate.text) === key);
    if (row === undefined) {
      const shown = text.length > 120 ? `${text.slice(0, 117)}…` : text;
      return {
        ok: false,
        sentence: `"${shown}" is not a line he spoke in the last 30 minutes, so it cannot travel as his words. Ask him to say it aloud, then prepare the action again with his line exactly as he said it.`,
      };
    }
    taken.add(row.id);
    found.push({ logId: row.id, at: row.at, text: row.text });
  }
  return { ok: true, lines: found };
}

/** A group of carried lines in the order he said them (by log id): the order Rework notes, answers and rulings are joined in. Consumed by `action-recipe.ts`. */
export const inOrderSaid = (lines: readonly CompanionCarriedLine[]): CompanionCarriedLine[] => [...lines].sort((a, b) => a.logId - b.logId);
