import { cerberusEnrollDb, cerberusNodesDb, getCerberusConnection } from '@/modules/database/index.js';
import type { CerberusNodeCert } from '@/shared/cerberus-types.js';

import { centerPublicKey, fingerprintOf, signText } from './center-key.js';
import type { WardenAuthResult } from './warden-auth.js';

/**
 * The one write that makes a node: spend its token, insert its row, and issue its certificate.
 *
 * The spend and the insert share ONE transaction (taken `IMMEDIATE`, so the write lock is held before
 * either statement runs). `markUsed` is a single `UPDATE … WHERE used_at IS NULL AND expires_at > ?`
 * and its `changes` is the verdict: of two sockets presenting one token, exactly one sees 1. A thrown
 * insert (a name that was taken in the meantime) rolls the spend back with it, so a failed enrollment
 * never burns a token the operator can still use.
 *
 * THE CERTIFICATE binds a node's name to the fingerprint of the key it enrolled with, signed by center
 * over the bytes `cerberus-cert\n<node>\n<fingerprint>\n<issuedAt>` — the layout `CerberusNodeCert`
 * documents and the warden verifies. `centerKey` is the key being pinned, so it is not in the text.
 * It is a pure function of the node row (`id`, `cert_fingerprint`, `enrolled_at`), and ed25519 signs
 * deterministically, so the same bytes can be issued again: a warden whose enrollment `welcome` was
 * lost on the wire (the row and the spend already committed) is handed it in its connect `welcome`,
 * and is never left unable to learn the key it must pin.
 *
 * Consumers: `warden-link.ts` (the hello of a node that has no row yet: `enrollNode`; the hello of
 * one that has: `issueCert`).
 */

/** The parts of a `hello` the node row records. */
type EnrollmentHello = { version: string; facts: Record<string, unknown>; machineId: string | null };

type EnrollRequest = Extract<WardenAuthResult, { kind: 'enroll' }>;

/**
 * Issues a node's certificate: `issuedAt` is the moment of enrollment, so a re-issue is byte for byte
 * the one first sent. Throws only if center's key cannot sign.
 */
export function issueCert(node: string, fingerprint: string, issuedAt: number): CerberusNodeCert {
  return {
    node,
    fingerprint,
    issuedAt,
    centerKey: centerPublicKey(),
    sig: signText(`cerberus-cert\n${node}\n${fingerprint}\n${issuedAt}`),
  };
}

/**
 * Enrolls the node `request` names. Answers its certificate, or the refusal to send the warden:
 * `token used` when the spend did not land, `enrollment failed` when the write itself threw.
 */
export function enrollNode(request: EnrollRequest, hello: EnrollmentHello, now: number): { cert: CerberusNodeCert } | { refusal: string } {
  const fingerprint = fingerprintOf(request.publicKey);
  try {
    // Signed BEFORE the commit: a failure to sign refuses the enrollment with the token still
    // unspent, instead of leaving a spent token and a node row whose warden got no certificate.
    const cert = issueCert(request.name, fingerprint, now);
    const spent = getCerberusConnection()
      .transaction(() => {
        if (cerberusEnrollDb.markUsed(request.tokenHash, request.name, now) !== 1) return false;
        cerberusNodesDb.insert({
          id: request.name,
          desc: request.desc,
          public_key: request.publicKey,
          cert_fingerprint: fingerprint,
          warden_version: hello.version,
          machine_id: hello.machineId,
          facts: JSON.stringify(hello.facts),
          enrolled_at: now,
        });
        return true;
      })
      .immediate();
    return spent ? { cert } : { refusal: 'token used' };
  } catch (error) {
    console.error(`[Cerberus] enrolling node ${request.name} failed: ${error instanceof Error ? error.message : String(error)}`);
    return { refusal: 'enrollment failed' };
  }
}
