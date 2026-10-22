import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isRecord } from './usage-windows.js';

/**
 * WHICH Claude account the live login is — as eight hex of a digest, and never the account itself.
 *
 * A usage limit belongs to an ACCOUNT, and this box's login changes when a re-login signs a new one
 * in. The meter's reading therefore has to name the login it came from, in a form the pacer can file
 * a row under and no surface can read an identity out of.
 *
 * THE RECIPE IS `plan_runner/claude_account.digest`, byte for byte: sha256 over the TRIMMED UTF-8
 * `oauthAccount.accountUuid` in `~/.claude.json`, first eight hex — where "trimmed" is Python's
 * `str.strip()` set, not JavaScript's `trim` (they differ; `pythonStrip` below spells the set out).
 * The Python side files stream readings under the same digest, so the two sources land in one
 * account's history only while both sides compute it the same way. Change one, change both.
 *
 * THE UUID AND THE EMAIL ARE READ AND DROPPED INSIDE `liveAccountDigest`: nothing here returns,
 * logs, prints or stores either. A digest is what the pacer's store holds, what a launch records
 * beside its `resets_at`, and what the dispatcher compares when it decides a wait still applies.
 *
 * READ FRESH ON EVERY CALL, deliberately. The CLI rewrites that ~90 KB file often, and the whole
 * point of the digest is to name the login whose token was read in the same moment; a cached one
 * could attribute the incoming account's percentages to the outgoing one for a whole TTL. One read
 * per three-minute poll is nothing beside the request it rides.
 *
 * UNKNOWN IS A FIRST-CLASS ANSWER, and it is the empty string. A missing file, a half-written one,
 * a failed parse, a missing key and a value that is not text ALL answer `''`. Every caller treats it
 * as "no evidence": the meter files no reading under an account nobody can name, and the pacer's
 * store never gains a row with a blank owner. `liveAccountDigest` NEVER RAISES, because its caller
 * is a poll route that is forbidden to fail.
 *
 * THE PATH IS FIXED, and not environment-redirectable. A variable that moved it could name an
 * account whose token this process is not holding — the same reason `credentialsPath` in
 * `usage.service.ts` is not.
 */

/** How many hex of the sha256 stand for an account — `claude_account.DIGEST_HEX`. */
const DIGEST_HEX = 8;

/** A file past this is not the CLI's config. The live one is ~90 KB; the bound only keeps a wrong
 *  path (a log, a database) from being slurped into the server's memory. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Is this UTF-16 code unit whitespace to Python's `str.strip()`?
 *
 * ⚠ NOT JAVASCRIPT'S `trim`. Python also strips U+001C–U+001F and U+0085, and keeps U+FEFF (a BOM),
 * which JS strips. The twin must hash exactly what `claude_account.digest` hashes, or a padded uuid
 * files one login's readings under two digests. Spelled as code points rather than one regex so the
 * set is readable and cannot drift from the list in the comment.
 */
function isPythonSpace(code: number): boolean {
  return (
    (code >= 0x09 && code <= 0x0d) ||
    (code >= 0x1c && code <= 0x1f) ||
    code === 0x20 ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

/** `str.strip()` on the JS side: that exact set off both ends, and nothing else. */
function pythonStrip(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isPythonSpace(value.charCodeAt(start))) start += 1;
  while (end > start && isPythonSpace(value.charCodeAt(end - 1))) end -= 1;
  return value.slice(start, end);
}

/** The live identity file — the identity, plus the CLI's unrelated state beside it. */
function identityPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

/**
 * The digest of the account in use now, or `''` when it cannot be told.
 *
 * Consumers: `usage.service.ts`'s `measure`, which files every good reading under it
 * (`pacer-door.ts`). The uuid never leaves this function.
 */
export function liveAccountDigest(): string {
  try {
    if (fs.statSync(identityPath()).size > MAX_BYTES) return '';
    const parsed: unknown = JSON.parse(fs.readFileSync(identityPath(), 'utf8'));
    const oauthAccount = isRecord(parsed) ? parsed.oauthAccount : null;
    const uuid = isRecord(oauthAccount) ? oauthAccount.accountUuid : null;
    if (typeof uuid !== 'string') return '';
    const account = pythonStrip(uuid);
    if (!account) return '';
    return createHash('sha256').update(account, 'utf8').digest('hex').slice(0, DIGEST_HEX);
  } catch {
    return ''; // absent, mid-write or not JSON: unknown, never an exception on a poll
  }
}
