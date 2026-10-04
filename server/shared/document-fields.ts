// --------------------------- reading a field out of a dispatcher document ---------------------------
//
// The vocabulary a lane reads the dispatcher's JSON document with — `dispatcher-state.service.ts` for
// `status --json` and its readers beside it, the roadmap module for `roadmap show --json` — so the
// module that knows what the fields MEAN does not have to invent a `typeof` test for each one.
// Consumed by the dispatcher module (through `dispatcher-state.transport.ts`, which re-exports the
// whole set to its readers) and by the roadmap module's state read. What is different here is the
// direction of a bad field — these REFUSE it by name rather than coercing it to a default, because a
// body a lane cannot read is a different build of the dispatcher and not a torn file (see the
// dispatcher state service's head). The refusal sentences name the document that failed, so a journal
// line says which command's body this build could not read: `dispatcher status --json` unless the
// caller names another.

/** The document a refusal names when its caller names none — the one this vocabulary was written for. */
const STATUS_DOCUMENT = 'dispatcher status --json';

/** Text, and only text: `Object.is` semantics are not wanted — a boxed String is not a string. */
export const isText = (value: unknown): value is string => typeof value === 'string';

/** A number that renders as one. `typeof` alone admits `NaN`, and `Infinity` is not a cost. */
export const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A member of the document's two-valued and three-valued fields. */
export const isFlag = (value: unknown): value is boolean => typeof value === 'boolean';

/** A JSON object — never an array, which `typeof` calls one too. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A field the document may leave unset. */
export const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value);

/** A field the document leaves unset when nothing has measured it (`ceiling`, `daemon.pid`). */
export const isCountOrNull = (value: unknown): value is number | null => value === null || isCount(value);

/** A JSON array. */
export const isList = (value: unknown): value is unknown[] => Array.isArray(value);

/** A record's field, without asserting the record is one — `undefined` for anything that is not a record. */
export function field(record: unknown, name: string): unknown {
  return isRecord(record) ? record[name] : undefined;
}

/**
 * A field that must be there, read through `ok`, or the body is refused BY NAME.
 *
 * The name is the field's path in the document (`plan.goal`, `stage.verdict`) and the name is the
 * whole point: the journal line says which field this build could not read, which is what turns "the
 * card went stale" into a one-glance diagnosis. `document` is the command whose body is being read
 * (`dispatcher roadmap show --json`), named in the sentence so two lanes reading two documents do not
 * leave the same line in the journal; it defaults to `dispatcher status --json`.
 */
export function need<T>(
  value: unknown,
  ok: (candidate: unknown) => candidate is T,
  where: string,
  document: string = STATUS_DOCUMENT,
): T {
  if (!ok(value)) throw new Error(`${document} answered no ${where}`);
  return value;
}

/** Every entry of a list, read through `read` — the list itself must be there. */
export function each<T>(
  value: unknown,
  where: string,
  read: (entry: unknown) => T,
  document: string = STATUS_DOCUMENT,
): T[] {
  return need(value, isList, where, document).map(read);
}

/** One word out of a closed vocabulary — the document's status words and its two providers. */
export function oneOf<T extends string>(
  value: unknown,
  words: readonly T[],
  where: string,
  document: string = STATUS_DOCUMENT,
): T {
  const word = need(value, isText, where, document);
  if (!(words as readonly string[]).includes(word)) {
    throw new Error(`${document} answered the ${where} ${word}`);
  }
  return word as T;
}
