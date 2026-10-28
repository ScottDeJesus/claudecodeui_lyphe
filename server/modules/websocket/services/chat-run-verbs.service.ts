import { sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import type { ChatWebSocketDependencies } from '@/modules/websocket/services/chat-websocket.service.js';
import type { LLMProvider, NormalizedMessage, ProviderPermissionDecision } from '@/shared/types.js';

/**
 * The Stop of a chat whose process is mid-turn with no run in the registry. The runtime's own word decides
 * ("a turn is in flight" / "a turn is about to start", `describeProcessActivity`); a chat busy only with background
 * work has no turn to stop, and Stop leaves that work alone as it always has. The runtime's abort ends the turn; there
 * is no run to complete, so the answer is the whole effect.
 */
async function abortUnregisteredTurn(
  sessionId: string,
  dependencies: ChatWebSocketDependencies,
): Promise<'stopped' | 'not_running'> {
  const provider = sessionsDb.getSessionById(sessionId)?.provider as LLMProvider | undefined;
  if (!provider || !dependencies.runtime.hasRuntime(provider)) return 'not_running';
  const activity = dependencies.runtime.activity(provider, sessionId);
  if (!activity.busy || !activity.why?.startsWith('a turn ')) return 'not_running';
  await dependencies.runtime.abort(provider, sessionId);
  return 'stopped';
}

/**
 * Stops one app session's running turn and emits the terminal `complete` on its behalf (runtimes skip
 * their own `complete` for an aborted run, and the registry drops any duplicate).
 *
 * A turn can run with no registered run: a steer that missed its turn is the CLI's next turn and a background
 * task's wake-up is another, and neither opens a run. Stop reaches those too: with no running run it asks the
 * runtime whether the chat's process is in a turn (`abortUnregisteredTurn`) and stops that.
 *
 * Answers `'not_running'` when the session has no turn in flight at all, so each caller words that for its own
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
    return abortUnregisteredTurn(sessionId, dependencies);
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

/**
 * Folds `content` into the turn a session is running now, so a correction reaches the session while it works instead of
 * after it has finished the wrong thing, and writes `echo` (the message as the chat should show it) onto that run's writer
 * once the fold has happened, so every page watching the run sees the brief in its place in the stream.
 *
 * Answers `'not_running'` — and writes nothing — when the session has no run in flight, or its runtime has no turn
 * pending to fold into (the turn ended in the instant before the push, a compaction holds the chat, the provider keeps no
 * live process). The caller then starts a turn instead, so a steer never silently vanishes.
 *
 * Consumed by the companion module's `send_to_session` and the panel's Send steer (through its send verb): the one door a
 * message enters a running turn by.
 */
export async function steerChatRun(
  sessionId: string,
  content: string,
  echo: NormalizedMessage,
  dependencies: ChatWebSocketDependencies,
): Promise<'folded' | 'not_running'> {
  const run = chatRunRegistry.getRun(sessionId);
  if (!run || run.status !== 'running') {
    return 'not_running';
  }

  if ((await dependencies.runtime.steer(run.provider, sessionId, content)) !== 'folded') {
    return 'not_running';
  }

  // The run read above may have ended during the await; its writer still sequences the echo harmlessly then (a
  // completed run drops a frame it cannot deliver), and the history read carries the persisted row either way.
  run.writer.send(echo);
  return 'folded';
}
