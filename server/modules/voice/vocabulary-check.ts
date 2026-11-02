import { isRecord } from '@/shared/document-fields.js';
import type { VocabularyEntry } from '@/shared/types.js';

import { phraseKey } from './vocabulary-match.js';

const MAX_ENTRIES = 100;
const MAX_SPELLING_CHARS = 60;
const MAX_PRONUNCIATION_CHARS = 80;
const MAX_FORMS_PER_ENTRY = 40;
const MAX_FORM_CHARS = 60;

const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const SHAPE_SENTENCE = 'each with a spelling, a pronunciation and a list of misheard forms';

type Checked<TValue> = TValue | { problem: string };

/** Trimmed, with every inner run of white space one space: the form a text is stored in. */
function tidied(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** One text field: its tidied value, or the sentence for why it is not one. `what` names it for the person ("Entry 2's spelling"). */
function checkedText(value: unknown, what: string, limit: number): Checked<string> {
  if (typeof value !== 'string') return { problem: `${what} must be text.` };
  const text = tidied(value);
  if (!HAS_LETTER_OR_DIGIT.test(text)) return { problem: `${what} needs at least one letter or digit.` };
  if (text.length > limit) return { problem: `${what} is longer than ${limit} characters.` };
  return text;
}

/**
 * One entry, normalised: a blank pronunciation is the spelling ("say it as written"); a blank misheard form is dropped; a
 * form already listed (case-insensitively) is dropped; a form equal to the entry's own spelling is dropped, because it would
 * rewrite the right word to itself.
 */
function checkEntry(value: unknown, position: number): Checked<VocabularyEntry> {
  const entryName = `Entry ${position}`;
  if (!isRecord(value)) return { problem: `${entryName} must be an object, ${SHAPE_SENTENCE}.` };

  const spelling = checkedText(value.spelling, `${entryName}'s spelling`, MAX_SPELLING_CHARS);
  if (typeof spelling !== 'string') return spelling;
  const name = `“${spelling}”`;

  const saysNothing = value.pronunciation === undefined || (typeof value.pronunciation === 'string' && value.pronunciation.trim() === '');
  const pronunciation = saysNothing ? spelling : checkedText(value.pronunciation, `${name}'s pronunciation`, MAX_PRONUNCIATION_CHARS);
  if (typeof pronunciation !== 'string') return pronunciation;

  const rawForms: unknown = value.misheard ?? [];
  if (!Array.isArray(rawForms)) return { problem: `${name}'s misheard forms must be a list of texts.` };
  const spellingKey = phraseKey(spelling);
  const seen = new Set<string>();
  const misheard: string[] = [];
  for (const rawForm of rawForms) {
    if (typeof rawForm === 'string' && rawForm.trim() === '') continue;
    const form = checkedText(rawForm, `A misheard form of ${name}`, MAX_FORM_CHARS);
    if (typeof form !== 'string') return form;
    if (seen.has(form.toLowerCase()) || phraseKey(form) === spellingKey) continue;
    seen.add(form.toLowerCase());
    misheard.push(form);
  }
  if (misheard.length > MAX_FORMS_PER_ENTRY) return { problem: `${name} lists more than ${MAX_FORMS_PER_ENTRY} misheard forms.` };
  return { spelling, pronunciation, misheard };
}

/**
 * Checks a whole vocabulary and answers it normalised, or the sentence for why it is refused. Refused: a list that is not a
 * list of entries or is longer than 100, an entry with no spelling, a text over its length cap, a spelling listed twice, and a
 * misheard form that two entries claim or that is another entry's spelling (the correction could not know which word was
 * meant, or would rewrite a right word). A form counts as the same whatever its case and whether its words are joined by a
 * space or a hyphen. The same check serves a stored list (which, failing, reads as never saved) and a save (refused, naming
 * the form). Consumed by `voice-settings.ts` (the read of a stored list) and `vocabulary.ts` (the save).
 */
export function checkVocabulary(value: unknown): { entries: VocabularyEntry[] } | { problem: string } {
  if (!Array.isArray(value)) return { problem: `The vocabulary must be a list of entries, ${SHAPE_SENTENCE}.` };
  if (value.length > MAX_ENTRIES) return { problem: `The vocabulary holds at most ${MAX_ENTRIES} entries.` };

  const entries: VocabularyEntry[] = [];
  const spellingKeys = new Set<string>();
  for (const [index, raw] of value.entries()) {
    const entry = checkEntry(raw, index + 1);
    if ('problem' in entry) return entry;
    const key = phraseKey(entry.spelling);
    if (spellingKeys.has(key)) return { problem: `“${entry.spelling}” is listed twice: each spelling is one entry.` };
    spellingKeys.add(key);
    entries.push(entry);
  }

  const ownerOfForm = new Map<string, string>();
  for (const entry of entries) {
    for (const form of entry.misheard) {
      const key = phraseKey(form);
      // The entry's own spelling was dropped from its forms above, so a spelling found here belongs to another entry.
      if (spellingKeys.has(key)) {
        return { problem: `“${form}” is an entry of its own, so it cannot also be a misheard form of ${entry.spelling}.` };
      }
      const owner = ownerOfForm.get(key);
      if (owner !== undefined && owner !== entry.spelling) {
        return { problem: `“${form}” is listed as misheard under both ${owner} and ${entry.spelling}: a misheard form belongs to one entry.` };
      }
      ownerOfForm.set(key, entry.spelling);
    }
  }
  return { entries };
}
