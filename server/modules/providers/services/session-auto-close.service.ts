import { sessionsDb } from '@/modules/database/index.js';
import { isApiExiting, onHostLivenessChanged, type HostEnd } from '@/modules/providers/list/claude/session-host/index.js';
import { providerRuntimeService } from '@/modules/providers/services/provider-runtime.service.js';
import { broadcastSessionArchiveChanged, chatRunRegistry } from '@/modules/websocket/index.js';

/**
 * Closing a chat when it goes to sleep — the cleanup that replaces a sweep. A chat is ASLEEP when its
 * last session host has ended (`host-liveness.ts`); when that happens to a chat that is unpinned, not
 * working and not waiting on him, the chat is closed: archived, which is all "close" is (the
 * Closed filter lists it, "Reopen" is the restore). Nothing is deleted — the transcript, the last
 * reply and the chat's followups stay as they were.
 *
 * WHICH ENDS CLOSE A CHAT: every way the last host can end. The idle closer and an ordinary `close()` (a clean exit), a
 * Stop (the CLI exits 1 after an interrupted turn), a `kill-session`, the tmux server going down, a socket lost with no
 * exit frame (code none, signal SIGHUP — a dropped connection), a node's channel closing: the chat has no CLI behind it,
 * and an unpinned one closes. The exit code is not read, because it says how the CLI left and not whether the chat is
 * still wanted; the pin is how he keeps one.
 *
 * WHAT NEVER CLOSES A CHAT: the server's own acts, which are the server's and not the chat's sleeping.
 * - SHUTDOWN, THE DRAIN WINDOW AND A RESTART. `isApiExiting()` is true from the first SIGTERM or SIGINT — set by `facade.ts`'s
 *   own signal handlers, which are registered at module import and so run before `server/index.ts`'s shutdown handler — and
 *   stays true to the exit. A host whose socket closes in that time was detached, not ended (D-10): `host-liveness.ts` pushes no
 *   `asleep` for it, and this listener checks the same flag first so the guarantee does not rest on that one `if` alone.
 *   The successor's boot is covered the other way round: this listener is armed only after the boot's re-adoption
 *   (`startSessionAutoClose`, called by `soleServerDuties`), so a host the boot retires, re-binds or finds gone is a reconcile
 *   this never hears.
 * - A RETIREMENT THE SERVER ISSUES (`HostEnd.retiredByServer`): the install sweep winding down an idle host after a
 *   Claude CLI update. The retire's `hello` makes the host end the API's attached socket, so the end reads as a lost
 *   socket (code none, signal SIGHUP) and only this mark tells it from a connection that dropped. The chat stays open and
 *   its next message spawns fresh on the new build; an update therefore closes nothing.
 *
 * THE GUARDS, read synchronously inside the push — the SDK's own exit handling has not yet run its
 * continuations, so a prompt the CLI was parked on is still on the gateway:
 * - working: a run is registered and running (`chatRunRegistry.isProcessing`) — a message that
 *   raced the end has already registered its run;
 * - waiting: a permission request or question is pending on him (`getPendingApprovalsForSession`);
 * - pinned, and which chats are his at all (the simple list's members, no scratch-root chat, no
 *   synced transcript, no tree chat that was never tagged for the list): one conditional UPDATE
 *   (`archiveIfAutoClosable`), so a pin set at the same instant cannot be closed over.
 * Only Claude chats have a host, so only they ever sleep — a chat of another provider is never closed here.
 *
 * Consumed by `server/index.ts`, through the providers barrel.
 */

/**
 * Why this end of a chat's last host is the server's own act and not the chat's sleeping, as words for the log — or null when
 * it is a sleep. The one place that names the exceptions to "every end closes".
 */
function notASleepBecause(end: HostEnd | null): string | null {
  if (isApiExiting()) return 'this server is shutting down';
  if (end?.retiredByServer) return 'this server retired the host on purpose (the install sweep after a Claude CLI update)';
  return null;
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
    const reason = notASleepBecause(end);
    if (reason !== null) {
      console.log(`[SessionAutoClose] ${sessionIds.join(', ')} lost its host but ${reason}; not a sleep, left open`);
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
