import type { VocabularyEntry } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import { checkVocabulary } from './vocabulary-check.js';
import { readStoredVocabulary, saveStoredVocabulary } from './voice-settings.js';

/**
 * The house words an account holds until it saves its own list (after which its list is the truth, an emptied one included).
 * A pronunciation equal to the spelling means "say it as written". "Lyphe" is said "life", and "life" is a real word, so it is
 * never one of Lyphe's misheard forms.
 */
const SEED_VOCABULARY: readonly VocabularyEntry[] = [
  { spelling: 'Kaylee', pronunciation: 'Kaylee', misheard: ['Kailee', 'Kaylie', 'Kayley', 'Kaley', 'Kayleigh', 'Kaili'] },
  {
    spelling: 'lypheCli',
    pronunciation: 'life C-L-I',
    misheard: ['life CLI', 'life see ally', 'Life Klee', 'lifeCLI', 'life cli', 'Lyfe CLI', 'lyphe CLI', 'life C L I'],
  },
  { spelling: 'Restorly', pronunciation: 'Restore-lee', misheard: ['Restorely', 'Restore Lee', 'Restoreli', 'Restorley', 'Restorli'] },
  { spelling: 'Headscale', pronunciation: 'Headscale', misheard: ['head scale', 'Head-scale'] },
  { spelling: 'Cerberus', pronunciation: 'Cerberus', misheard: ['Cerebrus', 'Serberus', 'Cerberous', 'Sarberus'] },
  { spelling: 'dactyl', pronunciation: 'dack-tull', misheard: ['dactile', 'dactil', 'dactle', 'dack till', 'dactal'] },
  { spelling: 'Athena', pronunciation: 'Athena', misheard: ['Athina', 'Atheena'] },
  { spelling: 'Hermes', pronunciation: 'Hermes', misheard: ['Hermies', 'Hermease', 'Her mees'] },
  { spelling: 'Lyphe', pronunciation: 'life', misheard: ['Lyfe', 'Lyph', 'Lyphy', 'Lifey'] },
];

/** The seed as a stored list would read: normalised by the same check (a form that repeats another in a different case is dropped, once). */
const SEED = ((): readonly VocabularyEntry[] => {
  const checked = checkVocabulary(SEED_VOCABULARY);
  // A fault of this file, not of an account's data: loud at first import, never a silent empty list.
  if ('problem' in checked) throw new Error(`The seed vocabulary is invalid: ${checked.problem}`);
  return checked.entries;
})();

/**
 * The account's vocabulary, read fresh on every call (never cached, so a saved entry applies on the next press with no restart):
 * its own saved list when it has one, an emptied list included, else the seed. A stored list that fails its check reads as
 * never saved. A copy either way: a caller that edits its list edits neither the seed nor the next read.
 * Consumed by `gemini-transcribe.ts`, `local-transcribe.ts` and `voice-provider.ts` (every transcriber, the net and the hints), `gemini-speech.ts`
 * and `voice-provider.ts` (the respelling for speech) and the vocabulary routes.
 */
export function readVocabulary(userId: number): VocabularyEntry[] {
  return (readStoredVocabulary(userId) ?? SEED).map((entry) => ({ ...entry, misheard: [...entry.misheard] }));
}

/**
 * Replaces the account's whole vocabulary with `value` and answers it as stored (normalised: see `checkVocabulary`). A list
 * that is refused throws AppError `VOICE_VOCABULARY_INVALID` (400) whose sentence names the entry or the form; nothing is
 * written then. An empty list is stored as empty, which turns the vocabulary off for the account.
 * Consumed by the vocabulary route (`PUT /api/voice/vocabulary`).
 */
export function saveVocabulary(userId: number, value: unknown): VocabularyEntry[] {
  const checked = checkVocabulary(value);
  if ('problem' in checked) {
    throw new AppError(checked.problem, { code: 'VOICE_VOCABULARY_INVALID', statusCode: 400, details: { field: 'vocabulary' } });
  }
  saveStoredVocabulary(userId, checked.entries);
  return readVocabulary(userId);
}
