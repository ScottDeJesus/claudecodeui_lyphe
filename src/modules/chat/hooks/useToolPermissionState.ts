import { useEffect, useMemo, useRef, useState } from 'react';

import type { PendingPermissionRequest } from '@/shared/types';
import { permissionKey, type ToolPermissionState } from '@/modules/chat/tools/toolOutcome';

/** The calls a person has been asked about, and the conversation they were asked in. */
type PromptedCalls = { sessionId: string | null; keys: ReadonlySet<string> };

const EMPTY: ReadonlySet<string> = new Set();

/** Asks what the permission layer knows about one tool call. */
export type ReadToolPermissionState = (toolName: string | undefined, toolInput: unknown) => ToolPermissionState;

/**
 * Remembers which tool calls a person was asked about, so a row that was
 * hand-allowed never claims to have run on its own.
 *
 * Used by chat's ChatInterface, which hands the reader down to the transcript.
 *
 * The pending list is cleared the instant a decision is sent
 * (useChatRealtimeHandlers.ts, `permission_resolved`), so it answers "is this
 * blocked right now" and nothing else — the row would flip straight from
 * "Waiting for you" to "Finished" while the person still had their
 * finger on the button. This keeps the keys it has seen for as long as the answer
 * is knowable, which is one conversation: a transcript on disk records that a
 * tool ran, never that anyone was asked.
 *
 * Emptied when the conversation changes, and that is not housekeeping. The chat
 * view is NOT remounted between conversations (WorkspaceMain renders one
 * ChatInterface with no key), so a set that outlived the conversation would let a
 * later call — same tool, byte-identical input, auto-approved by the rule the
 * first prompt created — claim a person was asked when nobody was.
 *
 * Calls are keyed by tool name AND input. Name alone lights up every result-less
 * row of that tool — an aborted run leaves those behind forever, and two
 * parallel calls of one tool would both claim the prompt meant for one of them.
 */
export function useToolPermissionState(
  pendingPermissionRequests: PendingPermissionRequest[],
  sessionId: string | null | undefined,
): ReadToolPermissionState {
  // Every call a prompt has been raised for, stamped with the conversation it
  // was raised in. State, not a ref, so adding one re-renders the rows that read
  // it; the ref beside it keeps the effect from re-running on its own update.
  const [prompted, setPrompted] = useState<PromptedCalls>(() => ({ sessionId: sessionId ?? null, keys: EMPTY }));
  const promptedRef = useRef(prompted);

  useEffect(() => {
    const scoped = promptedRef.current.sessionId === (sessionId ?? null)
      ? promptedRef.current
      : { sessionId: sessionId ?? null, keys: EMPTY };
    const unseen = pendingPermissionRequests
      .map((request) => permissionKey(request.toolName, request.input))
      .filter((key) => !scoped.keys.has(key));
    if (unseen.length === 0 && scoped === promptedRef.current) return;

    const next = { sessionId: scoped.sessionId, keys: new Set([...scoped.keys, ...unseen]) };
    promptedRef.current = next;
    setPrompted(next);
  }, [pendingPermissionRequests, sessionId]);

  // Read during render rather than waiting for that effect: a conversation switch
  // must drop the old answers on the first paint of the new transcript, not one
  // commit later.
  const promptedKeys = prompted.sessionId === (sessionId ?? null) ? prompted.keys : EMPTY;

  const pendingKeys = useMemo(
    () => new Set(pendingPermissionRequests.map((request) => permissionKey(request.toolName, request.input))),
    [pendingPermissionRequests],
  );

  return useMemo<ReadToolPermissionState>(
    () => (toolName, toolInput) => {
      if (!toolName) return 'idle';
      const key = permissionKey(toolName, toolInput);
      if (pendingKeys.has(key)) return 'waiting';
      return promptedKeys.has(key) ? 'prompted' : 'idle';
    },
    [pendingKeys, promptedKeys],
  );
}
