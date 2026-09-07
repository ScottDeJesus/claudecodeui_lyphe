import { api } from '@/shared/api';
import { GIT_DELEGATION_COMMAND } from '@/shared/constants';

/**
 * Opens the conversation the delegated command will run in, and hands back its session id.
 *
 * Used by `useGitDelegation`. Separate from the send below so the caller can record the run
 * BEFORE a single frame goes out — the alternative leaves a window, however small, in which the
 * run's own events arrive for a run nothing is watching yet.
 *
 * It throws rather than returning a null id: a press that did not become a conversation has a
 * reason, and the card has a line to say it in.
 */
export async function createDelegationSession(projectPath: string): Promise<string> {
  const response = await api.providers.createSession({
    provider: 'claude',
    projectPath,
    initialMessage: GIT_DELEGATION_COMMAND,
  });
  if (!response.ok) {
    throw new Error(`The server would not start a conversation (${response.status}).`);
  }

  const body = (await response.json()) as { data?: { sessionId?: string } };
  const sessionId = body?.data?.sessionId;
  if (!sessionId) {
    throw new Error('The server started no conversation to run the command in.');
  }

  return sessionId;
}

/**
 * Sends the prompt, and puts this socket in the run's audience.
 *
 * The whole of the client's part in a git write: one frame carrying the command name, one that
 * subscribes. Everything else about the run — provider, working directory, project path — the
 * server resolves from the session row.
 */
export function sendDelegationPrompt(sessionId: string, sendMessage: (message: unknown) => void): void {
  sendMessage({
    type: 'chat.send',
    sessionId,
    // The command NAME, byte for byte, as the whole prompt: the estate's push guard reads the
    // prompt and allows leading whitespace only, so an added newline, a trailing space or the
    // command's expanded text would each cost this run the push it exists for.
    content: GIT_DELEGATION_COMMAND,
    // Four fields and no more. Everything the composer also sends — cwd, projectPath,
    // attachments, tool settings — is either resolved from the session row by the server or has
    // no meaning here, and a client sending its own cwd would be claiming to decide which
    // directory this writes in.
    options: {
      provider: 'claude',
      model: 'sonnet',
      permissionMode: 'bypassPermissions',
      skipPermissions: true,
    },
  });

  // Puts this socket in the run's audience explicitly rather than relying on having been the one
  // that sent the frame. The shape is the gateway's own (`chat.subscribe { sessions: […] }`,
  // chat-websocket.service.ts:453) — a bare `sessionId` here is silently ignored.
  sendMessage({ type: 'chat.subscribe', sessions: [{ sessionId, lastSeq: 0 }] });
}
