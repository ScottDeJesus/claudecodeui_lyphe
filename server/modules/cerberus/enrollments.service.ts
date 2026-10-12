import crypto from 'node:crypto';

import { cerberusEnrollDb, cerberusNodesDb } from '@/modules/database/index.js';
import type { CerberusEnrollment, CerberusEnrollmentStatus, CerberusGatewayState } from '@/shared/cerberus-types.js';
import { AppError } from '@/shared/utils.js';

import { MAX_LABEL_LENGTH, NODE_ID_PATTERN } from './definition-document.js';

/**
 * Enrollments: how a new machine becomes a node.
 *
 * A person names the node and center mints a ONE-TIME TOKEN for it. The token is shown once, as
 * `XXXX-XXXX-XXXX`, inside the command the person runs on the new machine; only its sha256 is kept,
 * so the store never holds a token that could still enroll anyone. The token names the node it may
 * create, lives 15 minutes (the spec's Table 4), and is spent by the gateway when the warden's
 * `hello` arrives (`warden-enrollment.ts`) — never by this file.
 *
 * THE TOKEN'S ALPHABET leaves out the characters a person misreads when reading a screen aloud or
 * typing it from a phone: no `0`/`O`, no `1`/`I`/`L`. Twelve characters of 31 are about 59 bits, drawn
 * with `crypto.randomInt`, which is uniform (a modulo over random bytes is not).
 *
 * REFUSALS, as `AppError`s: 400 `CERBERUS_BAD_NAME` (not the node grammar, which also rules out
 * `center`) and `CERBERUS_BAD_DESC`; 409 `CERBERUS_NAME_TAKEN` (a node of that name exists);
 * 409 `CERBERUS_NOT_LISTENING` while the gateway is not — a command whose address answers nothing
 * would only send the person to the new machine to fail there.
 *
 * `enrollmentStatus` is what the screen polls while the install runs: how far the newest token for
 * the name has got, and the node it made.
 *
 * Consumers: `cerberus.routes.ts` (`POST /enrollments` and `GET /enrollments/:name`).
 */

/** How long a token may be presented after it is issued. */
const TOKEN_LIFETIME_MS = 15 * 60 * 1000;

const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TOKEN_GROUPS = 3;
const TOKEN_GROUP_LENGTH = 4;

/** A fresh token, `XXXX-XXXX-XXXX`. */
function newToken(): string {
  const groups: string[] = [];
  for (let group = 0; group < TOKEN_GROUPS; group += 1) {
    let text = '';
    for (let place = 0; place < TOKEN_GROUP_LENGTH; place += 1) {
      text += TOKEN_ALPHABET[crypto.randomInt(TOKEN_ALPHABET.length)];
    }
    groups.push(text);
  }
  return groups.join('-');
}

/** The description the node row will carry: trimmed, empty as null, and short enough to print on a row. */
function readDesc(desc: string | null | undefined): string | null {
  if (desc === undefined || desc === null) return null;
  const trimmed = desc.trim();
  if (trimmed.length > MAX_LABEL_LENGTH) {
    throw new AppError(`A description can be ${MAX_LABEL_LENGTH} characters at most.`, { code: 'CERBERUS_BAD_DESC', statusCode: 400 });
  }
  return trimmed === '' ? null : trimmed;
}

/**
 * Mints a token for a node called `name` and answers it with the command that uses it. The gateway
 * must be listening: the command carries `CERBERUS_LISTEN` as written, so an IPv6 address keeps its
 * brackets.
 */
export function mintEnrollment(input: { name: string; desc?: string | null }, gateway: CerberusGatewayState): CerberusEnrollment {
  const { name } = input;
  if (!NODE_ID_PATTERN.test(name)) {
    throw new AppError(
      'A node name is lower case letters, digits and hyphens, starts with a letter or digit, is at most 32 characters, and is never "center".',
      { code: 'CERBERUS_BAD_NAME', statusCode: 400 }
    );
  }
  const desc = readDesc(input.desc);
  if (cerberusNodesDb.get(name)) {
    throw new AppError(`A node called "${name}" is already enrolled.`, { code: 'CERBERUS_NAME_TAKEN', statusCode: 409 });
  }
  const listen = gateway.address === null ? null : (gateway.listen ?? gateway.address);
  if (listen === null) {
    throw new AppError('The warden gateway is not listening, so a new machine would have nothing to dial.', {
      code: 'CERBERUS_NOT_LISTENING',
      statusCode: 409,
    });
  }

  const token = newToken();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + TOKEN_LIFETIME_MS;
  cerberusEnrollDb.insert({
    token_hash: crypto.createHash('sha256').update(token).digest('hex'),
    name,
    desc,
    issued_at: issuedAt,
    expires_at: expiresAt,
  });

  return {
    name,
    token,
    command: `curl -fsSL http://${listen}/cerberus/enroll.sh | sudo sh -s -- --name ${name} --token ${token}`,
    expiresAt,
  };
}

/**
 * How far enrolling `name` has got: the newest token's state (`waiting`, `used`, `expired`, or
 * `unknown` when none was ever minted for the name, or it was pruned), when the install's enroll step
 * spent it (`installRanAt`), and the node it made with its first heartbeat.
 */
export function enrollmentStatus(name: string): CerberusEnrollmentStatus {
  const token = cerberusEnrollDb.latestForName(name);
  const node = cerberusNodesDb.get(name);

  let tokenState: CerberusEnrollmentStatus['token'] = 'unknown';
  if (token) {
    tokenState = token.used_at !== null ? 'used' : token.expires_at <= Date.now() ? 'expired' : 'waiting';
  }

  return {
    name,
    token: tokenState,
    installRanAt: token?.used_at ?? null,
    node: node
      ? { enrolledAt: node.enrolled_at, wardenVersion: node.warden_version, firstHeartbeatAt: node.first_heartbeat_at }
      : null,
  };
}
