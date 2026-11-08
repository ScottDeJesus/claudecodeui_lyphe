import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PendingSteer, SteerOutcome } from '@/shared/types';
import { randomHexId } from '@/shared/utils';

type UseSteeredMessagesArgs = {
  /** The open chat's id, or null before it has one. */
  sessionKey: string | null;
  /** Whether the open chat's turn is running. */
  isLoading: boolean;
  sendMessage: (message: unknown) => void;
  /** Records a sent message in the input history of the chat it was sent into. */
  recordSentMessage: (content: string, sessionKey: string | null) => void;
  /** Empties the composer of a message that has just left it (`isOpenComposer`: the chat it was typed in is still on screen). */
  takeOutOfComposer: (content: string, isOpenComposer: boolean, submitScope: string | null) => void;
  /** Whether `sessionKey` is the chat on screen right now; read when an outcome arrives, never captured. */
  isOpenSession: (sessionKey: string) => boolean;
  /** Sends a message the turn could not take as the next turn, putting it back in the composer if the queue refuses it too. */
  queueAsNextTurn: (steer: PendingSteer) => void;
  /** Puts messages the run never read back into the composer, ahead of anything typed since, with their files. */
  restoreToComposer: (unread: PendingSteer[], sessionKey: string) => void;
};

/**
 * A v4 UUID for a steered message. The id becomes the message's transcript uuid, so it must be a real one.
 * Built from `randomHexId` because `crypto.randomUUID` only exists in secure contexts, and the app is
 * often opened over plain http on a tailnet address.
 */
function createSteerMessageId(): string {
  const hex = randomHexId();
  // The version nibble is 4; the variant nibble keeps its two low bits and sets the top one.
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20)}`;
}

/** Whether a live user message is the echo of the steered message with this id. */
function isEchoOfSteer(echoId: string, messageId: string): boolean {
  // A text-only message is echoed under its own id; one with images is split into parts named
  // `<id>_text_<n>` / `<id>_images`.
  return echoId === messageId || echoId.startsWith(`${messageId}_`);
}

/**
 * The messages this tab sent into a running turn (`chat.steer`) that the agent has not read yet. Each is a
 * card above the composer until its echo reaches the transcript. A run that ends without the message
 * (stopped, failed) puts the text back in the composer; a refusal (the turn had already ended) queues it as
 * the next turn; a run that ends on its own retires the card, because the CLI runs the message as its next turn.
 *
 * Used by chat's useChatComposerState, which owns the composer, the queue and the socket this acts through.
 */
export function useSteeredMessages({
  sessionKey,
  isLoading,
  sendMessage,
  recordSentMessage,
  takeOutOfComposer,
  isOpenSession,
  queueAsNextTurn,
  restoreToComposer,
}: UseSteeredMessagesArgs) {
  // Every message this tab steered that is not settled yet. It is the cards' whole content, and it cannot be
  // derived: nothing else on the page remembers a message once it has left the composer.
  const [pendingSteers, setPendingSteers] = useState<PendingSteer[]>([]);
  // Read by the outcome handler, which the realtime listener calls between renders: a refusal can follow an
  // acceptance before React re-renders. Written only through `updatePendingSteers`, with the state.
  const pendingSteersRef = useRef(pendingSteers);
  // Whether the open chat's turn was running as of the last commit, for the same reason: an outcome is handled
  // between renders. Written only by the effect below, which reads it first as the PREVIOUS value to find the
  // moment a turn ends.
  const isLoadingRef = useRef(isLoading);

  // Every change to the pending steers goes through here so the ref the outcome handler reads is never
  // behind the state.
  const updatePendingSteers = useCallback((update: (current: PendingSteer[]) => PendingSteer[]) => {
    const next = update(pendingSteersRef.current);
    pendingSteersRef.current = next;
    setPendingSteers(next);
  }, []);

  // Sends a message into the session's running turn (`chat.steer`): the agent reads it at its next tool
  // call, without the turn stopping. It leaves the composer at once, as a sent message does, and waits as
  // a card until the agent reads it. Attachments must already be uploaded. Sent as typed, with no `/plain`
  // prefix: that is a command for a message that opens a turn, and the queue does not add it either.
  const steerIntoRunningTurn = useCallback(
    (
      message: { content: string; attachments: File[]; uploadedAttachments: unknown[] },
      steerSessionKey: string,
      submitScope: string | null,
    ) => {
      const messageId = createSteerMessageId();
      updatePendingSteers((current) => [...current, {
        messageId,
        sessionKey: steerSessionKey,
        submitScope,
        content: message.content,
        attachments: message.attachments,
        uploadedAttachments: message.uploadedAttachments,
        status: 'sending',
      }]);
      sendMessage({
        type: 'chat.steer',
        sessionId: steerSessionKey,
        messageId,
        content: message.content,
        options: { attachments: message.uploadedAttachments },
      });
      recordSentMessage(message.content, steerSessionKey);
      takeOutOfComposer(message.content, isOpenSession(steerSessionKey), submitScope);
    },
    [isOpenSession, recordSentMessage, sendMessage, takeOutOfComposer, updatePendingSteers],
  );

  /** Settles a steered message as the realtime handler reports on it; handed to the realtime handler by ChatInterface. */
  const handleSteerOutcome = useCallback(
    (outcomeSessionId: string, messageId: string, outcome: SteerOutcome) => {
      if (outcome === 'delivered') {
        if (pendingSteersRef.current.some((steer) => isEchoOfSteer(messageId, steer.messageId))) {
          updatePendingSteers((current) => current.filter((steer) => !isEchoOfSteer(messageId, steer.messageId)));
        }
        return;
      }

      if (outcome === 'run_finished') {
        // The run ended on its own. A message the server took is no longer waiting to be read in this
        // run: the CLI read it, or runs it as its next turn. (One not yet confirmed is left to its
        // reply, which is a refusal or an acceptance and settles it.)
        updatePendingSteers((current) => current.filter(
          (steer) => steer.sessionKey !== outcomeSessionId || steer.status !== 'accepted',
        ));
        return;
      }

      const steer = pendingSteersRef.current.find((candidate) => candidate.messageId === messageId);
      if (!steer) {
        return;
      }
      if (outcome === 'accepted') {
        // The turn can have ended while the acceptance was on the wire; its message is then the CLI's
        // to run, and a card nothing will ever clear is not left standing.
        updatePendingSteers((current) => (isLoadingRef.current
          ? current.map((candidate) => (candidate.messageId === messageId ? { ...candidate, status: 'accepted' } : candidate))
          : current.filter((candidate) => candidate.messageId !== messageId)));
        return;
      }

      updatePendingSteers((current) => current.filter((candidate) => candidate.messageId !== messageId));
      if (outcome === 'failed') {
        // The server turned the message away for a reason of its own, and said why in the conversation. Nothing was
        // sent into any turn, so the text and its files go back in the composer, ahead of anything typed since.
        restoreToComposer([steer], steer.sessionKey);
        return;
      }

      // Refused: the turn had already ended when it arrived. The user meant it for this conversation
      // now, so it goes out as the next turn — the queue sends it as soon as the session is idle, which
      // it about is.
      queueAsNextTurn(steer);
    },
    [queueAsNextTurn, restoreToComposer, updatePendingSteers],
  );

  // The run ended with a steered message the server took but the agent never read, and no `run_finished`
  // outcome retired it — the user stopped the run, or it failed. Nothing will send it now, so it goes back
  // into the composer rather than vanishing or being sent behind the user's back after a Stop.
  useEffect(() => {
    const wasLoading = isLoadingRef.current;
    isLoadingRef.current = isLoading;
    if (!wasLoading || isLoading || !sessionKey) {
      return;
    }
    const unread = pendingSteersRef.current.filter(
      (steer) => steer.sessionKey === sessionKey && steer.status === 'accepted',
    );
    if (unread.length === 0) {
      return;
    }
    updatePendingSteers((current) => current.filter((steer) => !unread.includes(steer)));
    restoreToComposer(unread, sessionKey);
  }, [isLoading, restoreToComposer, sessionKey, updatePendingSteers]);

  // Cards belong to the session they were sent into; switching away drops them (the messages
  // themselves are already the run's, on the server).
  useEffect(() => {
    if (pendingSteersRef.current.some((steer) => steer.sessionKey !== sessionKey)) {
      updatePendingSteers((current) => current.filter((steer) => steer.sessionKey === sessionKey));
    }
  }, [sessionKey, updatePendingSteers]);

  // Only the open session's cards are shown.
  const visiblePendingSteers = useMemo(
    () => pendingSteers.filter((steer) => steer.sessionKey === sessionKey),
    [pendingSteers, sessionKey],
  );

  return { pendingSteers: visiblePendingSteers, steerIntoRunningTurn, handleSteerOutcome };
}
