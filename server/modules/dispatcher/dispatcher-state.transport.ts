import { readDispatcherJson } from '@/shared/dispatcher-command.js';
import { each, isCount, isCountOrNull, isFlag, isText, isTextOrNull, need, oneOf } from '@/shared/document-fields.js';
import type { DispatcherModelChoice } from '@/shared/types.js';

// The dispatcher lane's readers import the field vocabulary from here, so its import surface is
// the one it always had; the readers themselves live in `@/shared/document-fields.ts`.
export { each, field, isCount, isCountOrNull, isFlag, isRecord, isText, isTextOrNull, need, oneOf } from '@/shared/document-fields.js';

/**
 * The dispatcher lane's side of reading `dispatcher status --json`: the one command it runs, the
 * ceiling its document may weigh, and the tolerant readers for fields a build older than the field
 * did not write — and nothing about what the body MEANS.
 *
 * The dispatcher is a command, not a directory: this lane has no files to stat and no receipt to
 * classify, only one process to run and one document to parse. That document is printed whole by a
 * process that then exits (`hooks/dispatcher/cmd/status.py`), so there is no file a live writer may be
 * replacing at this instant and no torn read to be patient with. The process and its failure sentences
 * are `@/shared/dispatcher-command.ts`'s; every failure of it is a THROW, and the caller's contract
 * (`dispatcher-state.service.ts`) is to keep the last good picture rather than to guess.
 */

/**
 * How much the document may weigh.
 *
 * A plan's `goal` is free text of any length and `report.py` carries it whole, so a store of a few
 * dozen plans runs to megabytes: `execFile`'s own 1 MiB is not headroom enough here. Stated rather
 * than left to the default, so the ceiling is a number written down here. A document past it reaches
 * the journal as `did not answer:` and the document's own opening, not as a word about the buffer
 * (`readDispatcherJson` says why) — a line that quotes the document is this number too low.
 */
const STATUS_MAX_BUFFER = 4 * 1024 * 1024;

// --------------------------- reading a field a build older than it did not write ---------------------------

/**
 * A count that a build OLDER than the field did not write, read as 0 — and refused by name when the
 * key is there but is not a count.
 *
 * This is the one tolerant read here, and the tolerance is exact: `undefined` is an absent KEY, which
 * is a different build of the dispatcher talking and not a torn or corrupted one — refusing a whole
 * plan because a field was invented after that build shipped would blank the operator's screen for a
 * reason that is not the reader's to punish. A key that IS there and is malformed is still refused,
 * which is the case this vocabulary exists for.
 */
export function countSince(value: unknown, where: string): number {
  return value === undefined ? 0 : need(value, isCount, where);
}

/**
 * A count-or-null a build OLDER than the field did not write, read as `null` — refused by name when
 * the key IS there and is neither.
 *
 * `countSince`'s doctrine for a figure whose absence must stay absent: `tokens_cache_read` is `null`
 * where the dispatcher cannot state it (a record written before the field, or a sum over one), and a
 * build that never wrote the key cannot state it either. Reading either as `0` would draw a
 * `0% cache` that nothing measured.
 */
export function countOrNullSince(value: unknown, where: string): number | null {
  return value === undefined ? null : need(value, isCountOrNull, where);
}

/** A list of names — a plan's waits, a phase's `start_here`. */
export function names(value: unknown, where: string): string[] {
  return each(value, where, (entry) => need(entry, isText, where));
}

/**
 * A text-or-null field a build OLDER than the field did not write, read as `null` — refused by name
 * when the key IS there and is not text-or-null.
 *
 * `countSince`'s doctrine, applied to a string: absence is another build of the dispatcher talking,
 * a malformed value is a build this lane cannot draw. It is what lets a field added after a build
 * shipped (`plan.arc`) reach an older server's reader as "nothing to say" instead of blanking every
 * plan on the operator's screen.
 */
export function textSince(value: unknown, where: string): string | null {
  return value === undefined ? null : need(value, isTextOrNull, where);
}

/**
 * A flag a build OLDER than the field did not write, read as `false` — refused by name when the key
 * IS there and is not a flag.
 *
 * `countSince`'s doctrine, applied to the third shape a tolerated field can have. `false` is the
 * honest reading of an absent key and not merely a convenient one: every flag read this way says
 * something HAS happened (a walk has launched, an arc is walking), and a build that never wrote the
 * key is a build under which nothing of the sort was ever recorded — so a card drawn from it offers
 * the gate's verb rather than a stopped plan's, which is exactly what that build's plans are.
 */
export function flagSince(value: unknown, where: string): boolean {
  return value === undefined ? false : need(value, isFlag, where);
}

/** The three words a model word may be (`hooks/plan_runner/run_model.py:WORDS`), the ONE list — `readDispatcherModelChoice` checks a request against the same three. */
export const MODEL_CHOICES: readonly DispatcherModelChoice[] = ['deepseek', 'claude', 'auto'];

/**
 * A model word a build OLDER than the field did not write, read as `null`, and refused by name when
 * the key is there and is not one of the three.
 *
 * `null` is the shape a row with no word of its own already has downstream — a plan that carries none
 * follows its arc, and `effectiveModelWord` turns the end of that chain into the store's default
 * (`claude`). So an older dispatcher's document draws the default its plans would really run under,
 * rather than a lane that went stale for a field it never wrote.
 */
export function modelSince(value: unknown, where: string): DispatcherModelChoice | null {
  return value === undefined || value === null ? null : oneOf(value, MODEL_CHOICES, where);
}

/**
 * One `dispatcher status --json`, as the parsed body — `readDispatcherJson` with this lane's argv and
 * ceiling. `env` comes from the caller — `dispatcher.module.ts` is the one place that reads the
 * environment.
 */
export async function readDispatcherDocument(
  bin: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
): Promise<unknown> {
  return readDispatcherJson(['status', '--json'], { bin, timeoutMs, env }, STATUS_MAX_BUFFER);
}
