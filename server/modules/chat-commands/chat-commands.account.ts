import { userDb } from '@/modules/database/index.js';
import { listLiveHosts } from '@/modules/providers/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';

/**
 * Which account a chat acts for — the one question a command door has to answer before it touches
 * anything an account owns.
 *
 * THE `sessions` TABLE DOES NOT RECORD IT. A chat row names its project, its model and its tool sets
 * and no owner, so the owner is read where the app records WHO STARTED THE RUN: the run registry
 * (the writer's `userId`, set from the websocket that sent the turn), and for a CLI that outlived the
 * API the live host's meta (`userId`, written at spawn and read back at re-adoption). Both hold the
 * account the browser was signed in as when the turn was sent, which is the operator of that chat.
 *
 * A chat whose account cannot be named — a run started by something with no login, such as a
 * scheduled message of an earlier build — answers `null`, and the door refuses: a note written for
 * the wrong account is worse than a note not written, so nothing is guessed (`users` holds more than
 * one account on this box, so "the only account" is not an answer either).
 */

/** A stored `userId` as an account id, or null when it is not a positive integer. */
function asAccountId(value: unknown): number | null {
  const id = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The id of the active account the chat acts for, or null. Consumed by `notes.command-routes.ts` and
 * `followups.command-routes.ts` (on `add`), the command doors that write an account's rows.
 */
export function accountOfChat(appSessionId: string): number | null {
  const fromRun = asAccountId(chatRunRegistry.getRun(appSessionId)?.writer.userId);
  // Asked second and only when the run registry has no answer: it reads the tmux server and every
  // host's meta, which a command made inside a turn never needs.
  const accountId =
    fromRun ?? asAccountId(listLiveHosts().find((host) => host.appSessionId === appSessionId)?.userId);
  if (accountId === null) return null;

  // An account that has since been deactivated is not one a chat may keep writing for.
  return userDb.getUserById(accountId) === undefined ? null : accountId;
}
