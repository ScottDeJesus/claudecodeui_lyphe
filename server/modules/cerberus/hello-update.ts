import type { CerberusHelloBody } from '@/shared/cerberus-types.js';

/**
 * The `update` a warden's `hello` carries, read leniently.
 *
 * It is how an update ends after a restart (see `CerberusHelloBody.update`): the new release's hello
 * names the update and the version it came up as, and an old release the launcher took back names the
 * update and why. A value that is neither shape reads as "no update on this hello" — a hello that
 * cannot say how an update went is still a hello, and refusing it would keep the warden from linking.
 *
 * Consumers: `warden-link.ts` (`readHello`), which hands the result to the `onHello` listeners; the
 * updates driver reads it there.
 */

/** The two shapes a hello's `update` may take. */
type HelloUpdate = NonNullable<CerberusHelloBody['update']>;

/** A non-empty string field of `record`, or `null`. */
function textField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The `update` of a hello body as `{ updateId, from, to }` or `{ updateId, failed, reason }`, else `null`. */
export function readHelloUpdate(value: unknown): HelloUpdate | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const updateId = textField(record, 'updateId');
  if (updateId === null) return null;

  const from = textField(record, 'from');
  const to = textField(record, 'to');
  if (from !== null && to !== null) return { updateId, from, to };

  const failed = textField(record, 'failed');
  if (failed !== null && typeof record.reason === 'string') return { updateId, failed, reason: record.reason };
  return null;
}
