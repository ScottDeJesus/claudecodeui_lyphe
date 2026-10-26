import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import type { ChatWebSocketDependencies } from '@/modules/websocket/services/chat-websocket.service.js';
import type { ProviderPermissionDecision } from '@/shared/types.js';

/**
 * Stops one app session's running turn and emits the terminal `complete` on its behalf (runtimes skip
 * their own `complete` for an aborted run, and the registry drops any duplicate).
 *
 * Answers `'not_running'` when the session has no run in flight, so each caller words that for its own
 * audience: the socket handler as a `NO_ACTIVE_RUN` protocol error, the companion as a sentence to her.
 *
 * Consumed by `chat-websocket.service.ts` (`chat.abort` and a detached turn that interrupts the run in
 * its way) and by the companion module's `stop_session`, so a stop from any door is the same stop.
 */
export async function abortChatRun(
  sessionId: string,
  dependencies: ChatWebSocketDependencies,
): Promise<'stopped' | 'not_running'> {
  const run = chatRunRegistry.getRun(sessionId);
  if (!run || run.status !== 'running') {
    return 'not_running';
  }

  const success = await dependencies.runtime.abort(run.provider, sessionId);

  // Scoped to the run that was stopped: if it settled on its own while the abort was awaited (a late Stop
  // does, see `stopTurn`) and a queued turn already started the session's next run, the session-keyed
  // `completeRun` would end that successor.
  chatRunRegistry.completeRunIfCurrent(run, {
    exitCode: success ? 0 : 1,
    aborted: true,
  });
  return 'stopped';
}

/**
 * Hands a tool-approval decision to the pending approval it answers (Claude is the only provider with
 * interactive approvals today, but the verb is provider-neutral).
 *
 * Consumed by `chat-websocket.service.ts` (`chat.permission-response`) and by the companion module's
 * `answer_session`, so an answer given in the chat and one given to her settle the approval alike.
 */
export function answerChatPermission(
  requestId: string,
  decision: ProviderPermissionDecision,
  dependencies: ChatWebSocketDependencies,
): void {
  dependencies.runtime.resolveToolApproval(requestId, decision);
}
