import type { CerberusRedItem } from './cerberus-red-copy.service.js';

/**
 * What a red-watch page says of its check's DIAGNOSIS, in words: the shape an item may carry it in, the
 * summary's first sentence as the cause, and the proposed fix as one sentence. Where each line sits and how
 * far it is cut belongs to `cerberus-red-copy.service.ts`, which imports this and cuts with its own `clip`.
 *
 * A diagnosis is the stored one of the check's trouble (`modules/cerberus/red-watch-diagnosis.ts`): a summary of
 * the likely cause, and at most one proposed fix. Nothing here is run; the page only tells the operator what
 * the read-only diagnosis found and what it would do.
 */

export type CerberusRedDiagnosis = NonNullable<CerberusRedItem['diagnosis']>;

/** A cause ends at the first `.`, `!` or `?` that is followed by a space and a capital letter or a digit: "v1.2", "e.g. the" and a filename's dot do not end it. */
const FIRST_SENTENCE = /^.*?[.!?](?= [\p{Lu}0-9])/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Whitespace of every kind folded to single spaces: a page's line is one line, however the diagnosis wrapped it. */
function folded(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A diagnosis as an item may carry it — `{ summary, fix: { name, cmd } | null }` — or `undefined` for anything else, which pages as if it had none. */
export function readDiagnosis(raw: unknown): CerberusRedDiagnosis | undefined {
  if (!isRecord(raw) || !isText(raw.summary)) return undefined;
  if (raw.fix === null) return { summary: raw.summary, fix: null };
  if (!isRecord(raw.fix) || !isText(raw.fix.name) || !isText(raw.fix.cmd)) return undefined;
  return { summary: raw.summary, fix: { name: raw.fix.name, cmd: raw.fix.cmd } };
}

/** The summary's first sentence, whitespace folded; the whole summary when no sentence ends before its last word. */
export function causeOf(summary: string): string {
  const text = folded(summary);
  return FIRST_SENTENCE.exec(text)?.[0] ?? text;
}

/** `Proposed fix: <name> — <cmd>`, or `No fix proposed.` for a diagnosis that proposed none. */
export function fixSentence(fix: CerberusRedDiagnosis['fix']): string {
  return fix === null ? 'No fix proposed.' : `Proposed fix: ${folded(fix.name)} — ${folded(fix.cmd)}`;
}
