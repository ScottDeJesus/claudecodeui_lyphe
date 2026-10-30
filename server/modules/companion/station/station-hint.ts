import { onNotification } from '@/modules/notifications/index.js';
import { onHostLivenessChanged } from '@/modules/providers/index.js';
import { chatRunRegistry, connectedClients, onSessionUpserted, WS_OPEN_STATE } from '@/modules/websocket/index.js';
import type { StationFrame } from '@/shared/station-types.js';

/**
 * The ONE hint that a chat changed, for Kaylee Station. "Did a chat change?" has a single home so the station's
 * regions never grow a second detector of the same question: the sessions list reads its sessions again on every
 * hint, and the needs list reads its needs when `states` is true.
 *
 * Four events touch it, all of them announcements the house already makes — nothing here polls:
 *   - a run starts or records an event (`chatRunRegistry.onRunChanged`): `states` is true for a start, the run's end
 *     and a permission raised, answered or withdrawn, false for every other streamed line, so a chat that is merely
 *     talking does not make the page read its needs on every line;
 *   - a session row is announced (`onSessionUpserted`: a rename, a new chat, a re-index): `states` false;
 *   - a chat gains or loses its last live host (`onHostLivenessChanged`, the `live` and `asleep` pushes): `states` false.
 *     The sessions list re-reads on every hint and so shows the new state; no need waits on a host, and the run that
 *     starts the host or the permission it raises is its own true touch;
 *   - an ask is raised (`onNotification` for `permission.required` and `agent.notification`): `states` true. It covers
 *     an ask on a run with no live writer, whose `permission_request` never passes the registry's streamed events.
 *
 * Chats belong to no account (as the sidebar's do), so the frame names none and goes to EVERY open gateway socket,
 * carrying nothing but `states`, like `followups_changed`.
 *
 * The coalescing window is a one-shot: the first touch arms a 1,000 ms timeout, a touch inside it only adds to it
 * (`states` is the OR of the window's touches), and when it closes ONE frame goes out and nothing is armed until the next
 * touch. A deadline an event sets, never a clock that checks, and two frames are always at least a second apart.
 *
 * Consumer: `companion.module.ts`, which starts it beside the three feeds and stops it with them.
 */

/** How long touches gather into one frame. */
const HINT_WINDOW_MS = 1_000;

/** The notification codes that mean an ask was raised on a chat: the two the alert feed names `asking` and `permission`. */
const ASK_RAISED_CODES: ReadonlySet<string> = new Set(['permission.required', 'agent.notification']);

/** Puts one frame on every open gateway socket; a socket that throws costs only itself its frame (host-liveness.ts sends the same way). */
function sendToEveryOpenSocket(frame: StationFrame): void {
  const message = JSON.stringify(frame);
  connectedClients.forEach((client) => {
    if (client.readyState !== WS_OPEN_STATE) return;
    try {
      client.send(message);
    } catch (error) {
      console.error(
        `[Station] could not send a ${frame.kind} frame to a client: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}

/** Starts the one hint that a chat changed; answers the stop. Consumed by `companion.module.ts`. */
export function startStationHint(): () => void {
  // The window's timer while one is open, `null` between windows. The first touch arms it; its close is the only thing that clears it.
  let windowTimer: NodeJS.Timeout | null = null;
  // Whether any touch of the open window moved a chat's state, so the one frame carries the strongest thing that happened in it.
  let windowMovedStates = false;

  function closeWindow(): void {
    const states = windowMovedStates;
    windowTimer = null;
    windowMovedStates = false;
    sendToEveryOpenSocket({ kind: 'station_sessions_changed', states });
  }

  function touch(states: boolean): void {
    windowMovedStates = windowMovedStates || states;
    if (windowTimer) return;
    windowTimer = setTimeout(closeWindow, HINT_WINDOW_MS);
    // Never keep the process alive just to say a chat changed.
    windowTimer.unref?.();
  }

  const unsubscribers = [
    chatRunRegistry.onRunChanged((_sessionId, { states }) => touch(states)),
    onSessionUpserted(() => touch(false)),
    onHostLivenessChanged(() => touch(false)),
    onNotification((_userId, event) => {
      if (ASK_RAISED_CODES.has(event.code)) touch(true);
    }),
  ];

  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    if (windowTimer) clearTimeout(windowTimer);
    windowTimer = null;
    windowMovedStates = false;
  };
}
