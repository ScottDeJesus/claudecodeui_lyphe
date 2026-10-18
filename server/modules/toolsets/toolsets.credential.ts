import crypto from 'node:crypto';

import { JWT_SECRET } from '@/modules/auth/index.js';

/**
 * The credential one chat's CLI carries to switch that chat's tool sets: the hex HMAC-SHA256 of
 * `toolset:${appSessionId}`, keyed by the app's signing secret.
 *
 * It is the `kanban-pm` door's scheme (`deriveMetisSecret`) behind a `toolset:` prefix, so a
 * credential minted for one door can never stand in for the other's. NOTHING IS STORED: the
 * launch hands the digest to the CLI, and the guard recomputes it for the session id the request
 * claims, so a restart changes nothing and a chat that has ended is simply a row that is gone. A
 * model holding one chat's credential cannot switch another chat's sets, and the operator's own
 * JWT — which opens every user door — never enters a CLI's environment.
 *
 * Consumed by `toolsets.service.ts` (the launch hook puts it in the CLI's environment) and
 * `toolsets.routes.ts` (the command door's guard recomputes it).
 */
export function toolsetCredential(appSessionId: string): string {
  return crypto.createHmac('sha256', JWT_SECRET).update(`toolset:${appSessionId}`).digest('hex');
}

/**
 * Whether `given` is the credential of that chat. Constant-time through `crypto.timingSafeEqual`,
 * and length-checked first because it throws on a length mismatch — which is itself the same
 * refusal as any other miss, the only accepted shape being a hex digest of one known length.
 * Consumed by `toolsets.service.ts`, which the command door's guard asks.
 */
export function toolsetCredentialMatches(appSessionId: string, given: string): boolean {
  const givenBytes = Buffer.from(given, 'utf8');
  const wantedBytes = Buffer.from(toolsetCredential(appSessionId), 'utf8');
  return givenBytes.length === wantedBytes.length && crypto.timingSafeEqual(givenBytes, wantedBytes);
}
