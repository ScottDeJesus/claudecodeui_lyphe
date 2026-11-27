import type { RealtimeClientConnection } from '@/shared/types.js';

/**
 * Numeric readyState for an open WebSocket connection.
 *
 * We keep this in module state so services that broadcast updates do not need
 * to import `ws` directly just to compare open/closed state.
 */
export const WS_OPEN_STATE = 1;

/**
 * Shared registry of active chat WebSocket connections.
 *
 * Project/session services publish realtime updates by iterating this set.
 */
export const connectedClients = new Set<RealtimeClientConnection>();

/**
 * Which account each gateway socket belongs to.
 *
 * A WeakMap so a socket that closes and is dropped from `connectedClients` takes its entry with it:
 * there is no `delete` to forget. The id is kept as a string because the two auth paths hand it over
 * as a number or a string and a lookup must not care which.
 */
const socketUsers = new WeakMap<RealtimeClientConnection, string>();

/**
 * Records that this gateway socket belongs to `userId`.
 *
 * Called once per connection by `handleChatConnection`, when the upgrade request names its user.
 * Consumed by `sendToUser` and `isUserConnected` below, which only ever read what is written here.
 */
export function registerSocketUser(ws: RealtimeClientConnection, userId: string | number): void {
  socketUsers.set(ws, String(userId));
}

/**
 * Sends one JSON frame to every open gateway socket of this account. Consumed by the companion
 * module's store, which puts her frames on this account's pages and no one else's.
 */
export function sendToUser(userId: string | number, payload: unknown): void {
  const wanted = String(userId);
  // Serialised first and once, whoever is connected: a payload JSON cannot carry (a BigInt, a cycle, or
  // a value that stringifies to nothing, which `ws` would send as an empty binary frame) fails the same
  // way for an account with no page as for one with three. A frame is a notification and the caller's
  // write is already committed, so the failure is logged here and never thrown into it.
  let frame: string | undefined;
  try {
    frame = JSON.stringify(payload);
  } catch (error) {
    console.error('[Gateway] sendToUser could not serialise its payload', { userId: wanted, error: error instanceof Error ? error.message : String(error) });
    return;
  }
  if (frame === undefined) {
    console.error('[Gateway] sendToUser was given a payload with no JSON form', { userId: wanted });
    return;
  }

  for (const client of connectedClients) {
    if (socketUsers.get(client) !== wanted || client.readyState !== WS_OPEN_STATE) {
      continue;
    }
    // Per socket: one page whose send throws must not cost the account's other pages their frame.
    try {
      client.send(frame);
    } catch (error) {
      console.error('[Gateway] sendToUser could not write to one socket', { userId: wanted, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

/**
 * Sends one JSON frame to every open gateway socket, whoever's page it is. Consumed by the hint and
 * state frames that name no account (`jev_changed`, `heal_changed` and their kin, MAN-453): every tab
 * that hears one reads its own route again.
 *
 * Serialised once, for the reason `sendToUser` gives; a payload with no JSON form is logged and sent
 * nowhere, never thrown into a caller whose write already landed.
 */
export function broadcastToAll(payload: unknown): void {
  let frame: string | undefined;
  try {
    frame = JSON.stringify(payload);
  } catch (error) {
    console.error('[Gateway] broadcastToAll could not serialise its payload', { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  if (frame === undefined) {
    console.error('[Gateway] broadcastToAll was given a payload with no JSON form');
    return;
  }

  for (const client of connectedClients) {
    if (client.readyState !== WS_OPEN_STATE) {
      continue;
    }
    // Per socket: one page whose send throws is skipped, and every other page still gets its frame.
    try {
      client.send(frame);
    } catch (error) {
      console.error('[Gateway] broadcastToAll could not write to one socket', { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

/**
 * Whether any gateway socket of this account is open. Consumed by the companion's alert feed, which
 * has nothing to say to a page that is not there.
 */
export function isUserConnected(userId: string | number): boolean {
  const wanted = String(userId);

  for (const client of connectedClients) {
    if (socketUsers.get(client) === wanted && client.readyState === WS_OPEN_STATE) {
      return true;
    }
  }
  return false;
}
