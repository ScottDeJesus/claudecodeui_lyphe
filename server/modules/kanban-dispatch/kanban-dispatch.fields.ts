/**
 * The field vocabulary the dispatcher's notes are read with (`kanban-dispatch.notes.ts`): each reader answers the value or the reason it does not read, so a note that fails names the field that failed and nothing past the parse re-checks it.
 */

export type Payload = Record<string, unknown>;

/** A field either reads to its value or says why not, so nothing downstream checks the printout again. */
export type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Zero, the count of nothing: an absent token count or an empty tag edit. */
export const NONE = 0;
/** Reached only when no read failed, which no caller asks for. */
export const NO_FAILURE = 'payload does not read';

/** Arrays are lists and null is no value, though both are typeof 'object', so neither counts as a record. */
export function isRecord(value: unknown): value is Payload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isText(value: unknown): value is string {
  return typeof value === 'string';
}

/** Required text must hold content, since a title or step of only spaces is no title or step. */
export function isRequiredText(value: unknown): value is string {
  return isText(value) && value.trim() !== '';
}

export function ok<T>(value: T): Read<T> {
  return { ok: true, value };
}

export function fail(reason: string): Read<never> {
  return { ok: false, reason };
}

/** Names the field that refused a payload, so the log points at the actual problem. */
export function firstReason(...reads: Read<unknown>[]): string {
  for (const read of reads) {
    if (!read.ok) return read.reason;
  }
  return NO_FAILURE;
}

/** A text read as written; an absent field takes the fallback when the dispatcher means a default. */
export function textField(payload: Payload, key: string, fallback?: string): Read<string> {
  const value = payload[key];
  if (value === undefined && fallback !== undefined) return ok(fallback);
  return isText(value) ? ok(value) : fail(`${key} must be a string`);
}

export function requiredText(payload: Payload, key: string): Read<string> {
  const value = payload[key];
  return isRequiredText(value) ? ok(value) : fail(`${key} is required`);
}

/** One of a fixed set; the fallback is the value the dispatcher leaves a field to when it is omitted. */
export function oneOf<T extends string>(payload: Payload, key: string, allowed: readonly T[], fallback?: T): Read<T> {
  const value = payload[key];
  if (value === undefined && fallback !== undefined) return ok(fallback);
  const match = allowed.find((candidate) => candidate === value);
  return match === undefined ? fail(`${key} must be one of ${allowed.join(', ')}`) : ok(match);
}

/** Absent means empty, and one bad item refuses the whole list rather than dropping it quietly. */
export function texts(payload: Payload, key: string, accepts: (value: unknown) => value is string): Read<string[]> {
  const value = payload[key];
  if (value === undefined) return ok([]);
  if (!isList(value)) return fail(`${key} must be a list`);
  const items = value.filter(accepts);
  return items.length === value.length ? ok(items) : fail(`${key} has an item that is not a valid text`);
}

export function flag(payload: Payload, key: string): Read<boolean> {
  const value = payload[key];
  if (value === undefined) return ok(false);
  return typeof value === 'boolean' ? ok(value) : fail(`${key} must be true or false`);
}

/** A token count is spend, so it must be finite and non-negative; an absent count is none spent. */
export function count(payload: Payload, key: string): Read<number> {
  const value = payload[key];
  if (value === undefined) return ok(NONE);
  return typeof value === 'number' && Number.isFinite(value) && value >= NONE
    ? ok(value)
    : fail(`${key} must be a finite number of zero or more`);
}

export function recordField(payload: Payload, key: string): Read<Payload> {
  const value = payload[key];
  return isRecord(value) ? ok(value) : fail(`${key} must be an object`);
}
