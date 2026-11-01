import { performance } from 'node:perf_hooks';

import { onSessionArchiveChanged, onSessionsDeleted } from '@/modules/database/index.js';
import { onNotification } from '@/modules/notifications/index.js';
import { onHostLivenessChanged } from '@/modules/providers/index.js';
import { chatRunRegistry, connectedClients, onSessionUpserted, WS_OPEN_STATE } from '@/modules/websocket/index.js';
import type { StationFrame } from '@/shared/station-types.js';

/**
 * The ONE hint that a chat changed, for Kaylee Station. "Did a chat change?" has a single home so the station's
 * regions never grow a second detector of the same question: the sessions list reads its sessions again on every
 * hint, and the needs list reads its needs when `states` is true.
 *
 * Six events touch it, all of them announcements the house already makes — nothing here polls:
 *   - a run starts or records an event (`chatRunRegistry.onRunChanged`): `states` is true for a start, the run's end
 *     and a permission raised, answered or withdrawn, false for every other streamed line, so a chat that is merely
 *     talking does not make the page read its needs on every line;
 *   - a session row is announced (`onSessionUpserted`: a rename, a new chat, a re-index): `states` false;
 *   - a chat row is deleted (`onSessionsDeleted`) or archived or restored (`onSessionArchiveChanged`): `states` false. Neither is
 *     announced by the session broadcaster, and each moves a chat on or off the list the page reads;
 *   - a chat gains or loses its last live host (`onHostLivenessChanged`, the `live` and `asleep` pushes): `states` false.
 *     The sessions list re-reads on every hint and so shows the new state; no need waits on a host, and the run that
 *     starts the host or the permission it raises is its own true touch;
 *   - an ask is raised (`onNotification` for `permission.required` and `agent.notification`): `states` true. It covers
 *     an ask on a run with no live writer, whose `permission_request` never passes the registry's streamed events.
 *
 * Chats belong to no account (as the sidebar's do), so the frame names none and goes to EVERY open gateway socket,
 * carrying nothing but `states`, like `followups_changed`.
 *
 * A frame goes out at once when none went in the last second: the first touch of a quiet stretch rides its own frame, so
 * the page hears a chat's first change in the same moment. A touch inside the second after a frame sets one deadline, the
 * close of that second, and the touches after it only add to it (`states` is the OR of the folded touches); at the close
 * ONE frame goes out. Nothing is armed between touches: the close is a deadline a touch sets, never a clock that checks,
 * and two frames are never less than a second apart, the station's cap on them.
 *
 * Consumer: `companion.module.ts`, which starts it beside the three feeds and stops it with them.
 */

/** The least time between two frames: touches inside it fold into the one frame at its close. */
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
  // When the last frame went out, on the monotonic clock (a wall-clock step must not stretch or cut the second); minus infinity
  // until the first, so the first touch of the process is sent at once.
  let lastFrameAt = Number.NEGATIVE_INFINITY;
  // The timer of the one deadline a touch inside the second sets (the second's close), `null` while none is set. Its firing is the only thing that clears it.
  let closeTimer: NodeJS.Timeout | null = null;
  // Whether any touch folded into the open deadline moved a chat's state, so the one frame carries the strongest thing that happened.
  let foldedMovedStates = false;

  function sendFrame(states: boolean): void {
    lastFrameAt = performance.now();
    sendToEveryOpenSocket({ kind: 'station_sessions_changed', states });
  }

  function armClose(): void {
    // `ceil` and the 1 ms floor: a timer must never fire before the second is out.
    const remainingMs = Math.max(1, Math.ceil(HINT_WINDOW_MS - (performance.now() - lastFrameAt)));
    closeTimer = setTimeout(closeWindow, remainingMs);
    // Never keep the process alive just to say a chat changed.
    closeTimer.unref?.();
  }

  function closeWindow(): void {
    closeTimer = null;
    // Node may fire a timer a fraction of a millisecond early; the second is whole or the frame waits for the rest of it.
    if (performance.now() - lastFrameAt < HINT_WINDOW_MS) {
      armClose();
      return;
    }
    const states = foldedMovedStates;
    foldedMovedStates = false;
    sendFrame(states);
  }

  function touch(states: boolean): void {
    if (closeTimer) {
      foldedMovedStates = foldedMovedStates || states;
      return;
    }
    if (performance.now() - lastFrameAt >= HINT_WINDOW_MS) {
      sendFrame(states);
      return;
    }
    foldedMovedStates = states;
    armClose();
  }

  const unsubscribers = [
    chatRunRegistry.onRunChanged((_sessionId, { states }) => touch(states)),
    onSessionUpserted(() => touch(false)),
    onSessionsDeleted(() => touch(false)),
    onSessionArchiveChanged(() => touch(false)),
    onHostLivenessChanged(() => touch(false)),
    onNotification((_userId, event) => {
      if (ASK_RAISED_CODES.has(event.code)) touch(true);
    }),
  ];

  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
    foldedMovedStates = false;
  };
}
