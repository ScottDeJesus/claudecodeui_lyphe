import type { CompanionLogEntry } from '@/shared/companion-types.js';

/**
 * What a voice is asked to say for one of her sentences, rebuilt from the log row of that sentence. The log keeps the
 * `display` text (no sounds in it), the `mood` and the `sounds` as offsets into the display, which is everything
 * `parseExpression` made except the `speech` text itself; writing each sound back as `<tag>` at its offset gives that text
 * again, up to the spacing around a tag (which the parse had already collapsed to single spaces).
 *
 * PURE: no I/O and no import beyond the contract's types, so it is proven on real strings under `tsx`.
 *
 * Consumer: `companion-speech.ts`, which asks for the words and the style of the sentence a page pulls.
 */

/** What the voice is given: the sentence with its sounds as `<tag>`, and the delivery style for it. */
export type Utterance = { text: string; style: string };

/** Punctuation that closes a word with no space before it, as the parse leaves it. */
const CLOSING_PUNCTUATION = /^[.,!?;:…]/;

/** Any letter or digit, in any script: a sentence with none of these (only tags, or only punctuation) has nothing to say. */
const SPOKEN_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * The display text with each sound written back as `<tag>` where its offset says: a space on each side of a tag, except
 * that a tag at the very start or end has none outside and punctuation right after it closes up. Sounds are placed in
 * order of offset, ties in the order they were made.
 */
function speechText(display: string, sounds: CompanionLogEntry['sounds']): string {
  const ordered = sounds.map((sound, order) => ({ ...sound, order })).sort((a, b) => a.at - b.at || a.order - b.order);
  const pieces: string[] = [];
  let cursor = 0;
  for (const sound of ordered) {
    // An offset is the parse's own, within the display; a row edited by hand to pass its end is clamped rather than thrown on.
    const at = Math.min(sound.at, display.length);
    pieces.push(display.slice(cursor, at), `<${sound.tag}>`);
    cursor = at;
  }
  pieces.push(display.slice(cursor));
  return pieces
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '')
    .reduce((joined, piece) => (joined === '' || CLOSING_PUNCTUATION.test(piece) ? joined + piece : `${joined} ${piece}`), '');
}

/**
 * The account's delivery note, with the sentence's mood after a semicolon when it led with one. Either may be empty; both
 * empty is no style at all. Kept to those few words on purpose: Google warns that a long style block makes the voice drift.
 */
function styleOf(deliveryNote: string, mood: string | null): string {
  const note = deliveryNote.trim();
  if (mood === null || mood.trim() === '') return note;
  return note === '' ? mood.trim() : `${note}; ${mood.trim()}`;
}

/**
 * The words and the style for the sentence in `entry`, or `null` when there is nothing to say: no text, or only tags and
 * punctuation. Consumed by `companion-speech.ts`.
 */
export function utteranceOf(entry: Pick<CompanionLogEntry, 'text' | 'mood' | 'sounds'>, deliveryNote: string): Utterance | null {
  const text = speechText(entry.text, entry.sounds);
  // The tags are removed before looking for a word to speak: `<short pause>` has letters of its own.
  if (!SPOKEN_CHARACTER.test(text.replace(/<[^<>]*>/g, ''))) return null;
  return { text, style: styleOf(deliveryNote, entry.mood) };
}
