import crypto from 'node:crypto';

import { JWT_SECRET } from '@/modules/auth/index.js';

/**
 * The credential one chat's shell commands carry: the hex HMAC-SHA256 of `toolset:${appSessionId}`,
 * keyed by the app's signing secret.
 *
 * ONE CREDENTIAL PER CHAT, SHARED BY EVERY COMMAND A CHAT RUNS (`toolset`, `notes`, `followups`). The `toolset:`
 * prefix is the scheme's history and stays exactly as it is: the digest is already in the
 * environment of every chat that was launched, under `CLOUDCLI_TOOLSET_TOKEN`, and a different
 * derivation would lock all of them out of every command door until their next process. It is the `kanban-pm`
 * door's scheme (`deriveMetisSecret`) behind a prefix of its own, so a credential minted for that door
 * can never stand in for this one.
 *
 * NOTHING IS STORED: the launch hands the digest to the CLI, and the guard recomputes it for the
 * session id the request claims, so a restart changes nothing and a chat that has ended is simply a
 * row that is gone. A model holding one chat's credential cannot act as another chat, and the
 * operator's own JWT — which opens every user door — never enters a CLI's environment.
 *
 * Consumed by `chat-commands.guard.ts` (the doors' guard recomputes it) and, through the barrel, by
 * `toolsets.service.ts` (the launch hook puts it in the CLI's environment).
 */
export function chatCredential(appSessionId: string): string {
  return crypto.createHmac('sha256', JWT_SECRET).update(`toolset:${appSessionId}`).digest('hex');
}

/**
 * Whether `given` is the credential of that chat. Constant-time through `crypto.timingSafeEqual`,
 * and length-checked first because it throws on a length mismatch — which is itself the same
 * refusal as any other miss, the only accepted shape being a hex digest of one known length.
 * Consumed by `chat-commands.guard.ts`.
 */
export function chatCredentialMatches(appSessionId: string, given: string): boolean {
  const givenBytes = Buffer.from(given, 'utf8');
  const wantedBytes = Buffer.from(chatCredential(appSessionId), 'utf8');
  return givenBytes.length === wantedBytes.length && crypto.timingSafeEqual(givenBytes, wantedBytes);
}
