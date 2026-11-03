import { sessionsDb } from '@/modules/database/index.js';
import { onHostLivenessChanged, type HostEnd } from '@/modules/providers/list/claude/session-host/index.js';
import { providerRuntimeService } from '@/modules/providers/services/provider-runtime.service.js';
import { broadcastSessionArchiveChanged, chatRunRegistry } from '@/modules/websocket/index.js';

/**
 * Closing a chat when it goes to sleep — the cleanup that replaces a sweep. A chat is ASLEEP when its
 * last session host has ended (`host-liveness.ts`); when that happens to a chat that is unpinned, not
 * working and not waiting on him, the chat is closed: archived, which is all "close" is (the
 * Closed filter lists it, "Reopen" is the restore). Nothing is deleted — the transcript, the last
 * reply and the chat's followups stay as they were.
 *
 * WHICH ENDS COUNT AS SLEEP, decided from the exit the host reported (`HostEnd`):
 * - A CLEAN exit — code 0, no signal — is a CLI wound down by the end of its stdin: the idle closer
 *   and an ordinary `close()`. The chat is asleep; it is closed (if the guards below allow).
 * - Anything else is not: a Stop (the CLI exits 1 after an interrupted turn), a `kill-session`, the
 *   tmux server going down, a socket lost with no exit frame (code none, signal SIGHUP — which is
 *   also what the install sweep winding down an idle host reads as: the retire's `hello` makes the
 *   host end the API's attached socket, so no exit frame arrives), a node's channel closing. The
 *   chat did not fall asleep, something took it down, and a chat that was cut off is the last one
 *   to hide. A Claude CLI update therefore closes nothing.
 * - A SERVER SHUTDOWN OR RESTART is not heard at all: while the API exits, `host-liveness.ts` pushes
 *   nothing (D-10, a detach and not an end), and this listener is armed only after the boot's re-adoption
 *   has handed every surviving host back (`startSessionAutoClose`, called by `soleServerDuties`), so
 *   nothing a boot reconciles — a host retired by the boot's version test, a host that never
 *   re-attached — is a sleep this closes over.
 *
 * THE GUARDS, read synchronously inside the push — the SDK's own exit handling has not yet run its
 * continuations, so a prompt the CLI was parked on is still on the gateway:
 * - working: a run is registered and running (`chatRunRegistry.isProcessing`) — a message that
 *   raced the idle close has already registered its run;
 * - waiting: a permission request or question is pending on him (`getPendingApprovalsForSession`);
 * - pinned, and which chats are his at all (the simple list's members, no scratch-root chat, no
 *   synced transcript): one conditional UPDATE (`archiveIfAutoClosable`), so a pin set at the
 *   same instant cannot be closed over.
 * Only Claude chats have a host, so only they ever sleep — a chat of another provider is never closed here.
 *
 * Consumed by `server/index.ts`, through the providers barrel.
 */

/** The `asleep` pushes that are a sleep: a CLI that wound down by itself. See the rules above. */
function endedBySleep(end: HostEnd | null): boolean {
  return end !== null && end.code === 0 && end.signal === null;
}

/** Why a chat the UPDATE did not close was left open, in words for the log: the row says which of the rules held. */
function whyLeftOpen(sessionId: string): string {
  const row = sessionsDb.getSessionById(sessionId);
  if (!row) return 'it has no row';
  if (row.isArchived) return 'it is already closed';
  if (row.pinned === 1) return 'it is pinned';
  return 'it is not a chat of the simple list (an untagged chat, a scratch-root project, an archived project or a synced transcript)';
}

/** One chat that just lost its last host: closes it when every guard allows, and says so. */
function closeIfIdle(sessionId: string): void {
  if (chatRunRegistry.isProcessing(sessionId)) {
    console.log(`[SessionAutoClose] ${sessionId} fell asleep with a run in progress; left open`);
    return;
  }
  if (providerRuntimeService.getPendingApprovalsForSession(sessionId).length > 0) {
    console.log(`[SessionAutoClose] ${sessionId} fell asleep waiting on a question or permission; left open`);
    return;
  }
  if (!sessionsDb.archiveIfAutoClosable(sessionId)) {
    console.log(`[SessionAutoClose] ${sessionId} fell asleep; left open: ${whyLeftOpen(sessionId)}`);
    return;
  }

  console.log(`[SessionAutoClose] closed ${sessionId}: it fell asleep unpinned`);
  broadcastSessionArchiveChanged([sessionId], true);
}

let armed = false;

/**
 * Arms the auto-close: from here on a chat that falls asleep is closed as the rules above say. Called
 * once by the sole server after its boot re-adoption; a second call changes nothing. Consumed by
 * `server/index.ts`.
 */
export function startSessionAutoClose(): void {
  if (armed) return;
  armed = true;

  onHostLivenessChanged((sessionIds, change, end) => {
    if (change !== 'asleep') return;
    if (!endedBySleep(end)) {
      console.log(`[SessionAutoClose] ${sessionIds.join(', ')} lost its host without winding down (code ${end?.code ?? 'none'}, signal ${end?.signal ?? 'none'}); not a sleep, left open`);
      return;
    }
    for (const sessionId of sessionIds) {
      try {
        closeIfIdle(sessionId);
      } catch (error) {
        console.error('[SessionAutoClose] could not close a chat that fell asleep', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
}
