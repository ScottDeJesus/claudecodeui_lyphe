import crypto from 'node:crypto';

import { cerberusMutesDb } from '@/modules/database/index.js';
import type { CerberusMute } from '@/shared/cerberus-types.js';
import { AppError } from '@/shared/utils.js';

import { hintChanged } from './cerberus-broadcast.js';
import { findActiveCheck } from './read-model/check-views.js';
import { toMuteView } from './read-model/overlays.js';

/**
 * Mutes: a person telling Cerberus "I know about this one" for a while.
 *
 * A mute is Cerberus-side only — the warden never hears of it, so a muted check keeps running and
 * recording; the read model lays the mute over a warn, failing or denied reading when it renders, and
 * nothing is ever rewritten. Rows are appended, and the one update a mute ever gets is `lifted_at`.
 *
 * THE BOUNDS. A mute is for a day at most: `until` must lie in `(now, now + 24 h]`. A longer silence
 * is a decision to stop watching, and that is a definition change (retire the check), not a mute —
 * so there is no way to mute something and forget it for a month. A refusal is a 400
 * `CERBERUS_BAD_MUTE`; a check that is not an active one is a 404 `CERBERUS_UNKNOWN_CHECK`, and a mute
 * that does not exist a 404 `CERBERUS_UNKNOWN_MUTE`. An empty reason is stored as "No reason given",
 * so the activity feed never has a mute with a blank line under it; a reason is at most 500
 * characters, since the feed prints it whole.
 *
 * Both writes end in `hintChanged`, after the row is written: the screen's strips and "needs you"
 * list read differently the moment a mute lands or lifts.
 *
 * Consumers: `cerberus.routes.ts` (`POST /mutes` and `POST /mutes/:id/lift`, with `by` the signed-in
 * user's name).
 */

/** The longest a mute may run from the moment it is made. */
const MAX_MUTE_MS = 24 * 60 * 60 * 1000;

const MAX_REASON_LENGTH = 500;

const NO_REASON_GIVEN = 'No reason given';

function badMute(message: string): AppError {
  return new AppError(message, { code: 'CERBERUS_BAD_MUTE', statusCode: 400 });
}

/**
 * Mutes one active check until `until` (epoch ms). Answers the mute as the wire carries it.
 * `by` is who asked: the route passes the signed-in user's name.
 */
export function createMute(input: { node: string; key: string; until: number; reason: string }, by: string): CerberusMute {
  // The check first: a mute for something that is not there is a different mistake from a bad time.
  // Throws the 404 itself; the row it finds is not needed.
  findActiveCheck(input.node, input.key);
  const now = Date.now();

  if (!Number.isSafeInteger(input.until)) throw badMute('until must be a whole number of milliseconds.');
  if (input.until <= now) throw badMute('until must be in the future.');
  if (input.until > now + MAX_MUTE_MS) throw badMute('A mute lasts 24 hours at most.');

  const trimmedReason = input.reason.trim();
  if (trimmedReason.length > MAX_REASON_LENGTH) throw badMute(`A reason can be ${MAX_REASON_LENGTH} characters at most.`);

  const row = {
    id: crypto.randomUUID(),
    node: input.node,
    check_key: input.key,
    from_at: now,
    until_at: input.until,
    reason: trimmedReason === '' ? NO_REASON_GIVEN : trimmedReason,
    by,
    lifted_at: null,
  };
  cerberusMutesDb.insert(row);

  hintChanged({ nodes: [input.node], checks: [`${input.node}/${input.key}`] });
  return toMuteView(row);
}

/**
 * Lifts a mute now. A 404 for one that does not exist. A mute already lifted — or already run out —
 * is answered as it stands, and tells no screen anything: only a lift this call made is hinted.
 */
export function liftMute(id: string): CerberusMute {
  const existing = cerberusMutesDb.get(id);
  if (!existing) {
    throw new AppError(`No mute ${id} exists.`, { code: 'CERBERUS_UNKNOWN_MUTE', statusCode: 404 });
  }

  if (cerberusMutesDb.lift(id, Date.now())) {
    hintChanged({ nodes: [existing.node], checks: [`${existing.node}/${existing.check_key}`] });
  }
  // Read again: the row now carries `lifted_at`, or is exactly what it was.
  return toMuteView(cerberusMutesDb.get(id) ?? existing);
}
