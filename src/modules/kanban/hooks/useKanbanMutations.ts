import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  KanbanAttachment,
  KanbanCardSummary,
  KanbanChecklistItem,
  KanbanIssue,
  KanbanPriority,
  KanbanQuestion,
  KanbanStatus,
} from '@/shared/kanban-types';
import { api, readApiJson } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';

/**
 * THE BOARD'S WRITE VERBS, and the two things every one of them owes the reader: the card as the
 * server now holds it, and a sentence when the write did not land.
 *
 * THE SERVER'S CARD IS THE ONLY CARD THIS HOOK PAINTS. Every verb answers with the row it wrote,
 * and that row — not the one the board was guessing at — is what goes back through `applyCard`.
 * A move the server placed somewhere other than where the reader dropped it therefore lands where
 * the SERVER put it, and a refused write hands back the row the board was holding before, so the
 * card returns to the lane the reader found it in rather than staying where they tried to put it.
 *
 * TWO FAMILIES, ONE FAILURE PATH. The verbs the board's own chrome calls answer with a card and go
 * through `writeCard`; the drawer's ledger verbs — a question answered, an issue filed, a step
 * marked — answer with the row THEY wrote and go through `send` alone. Neither family needs a
 * `previous` to put back: the ledger sections read the shell's one fetch, so a refused write leaves
 * the screen showing the state the server still holds, which is the same guarantee by a cheaper
 * route. Both families report a failure through the same `reported`, so a refusal reaches the
 * reader as the server's own sentence whichever verb met it.
 *
 * A REFUSAL IS A VERDICT, NOT AN ERROR: the server's own message travels in the body, and the
 * toast carries it whole rather than replacing it with a generic sentence that says nothing about
 * which rule was met. That is what makes a 409 from the approve gate legible as the gate's verdict
 * rather than as a failed save.
 */

export type KanbanMoveInput = {
  cardId: string;
  status: KanbanStatus;
  /** The card that will sit directly ABOVE the moved card, or null at the head of the lane. */
  afterId: string | null;
  /** The card that will sit directly BELOW it, or null at the end. */
  beforeId: string | null;
};

/** The four fields the drawer edits, and the one verb that writes them. A field left out is a
 *  field this press is not about — never a field emptied. */
export type KanbanCardPatch = {
  title?: string;
  priority?: KanbanPriority;
  description?: string;
  body?: string;
  closingRemarks?: string;
};

export type KanbanMutations = {
  createCard: (boardId: string, input: { title: string; status: KanbanStatus }) => Promise<KanbanCardSummary | null>;
  updateCard: (cardId: string, patch: KanbanCardPatch) => Promise<KanbanCardSummary | null>;
  moveCard: (input: KanbanMoveInput, previous?: KanbanCardSummary | null) => Promise<KanbanCardSummary | null>;
  archiveCard: (cardId: string, previous?: KanbanCardSummary | null) => Promise<KanbanCardSummary | null>;
  /** Archives every card named — the whole of "Clear done". Nothing is deleted. */
  clearLane: (cardIds: string[]) => Promise<void>;
  addTag: (cardId: string, tag: string) => Promise<KanbanCardSummary | null>;
  removeTag: (cardId: string, tag: string) => Promise<KanbanCardSummary | null>;
  approveCard: (cardId: string) => Promise<KanbanCardSummary | null>;
  unapproveCard: (cardId: string) => Promise<KanbanCardSummary | null>;
  answerQuestion: (
    questionId: string,
    input: { selected: string[]; other?: string }
  ) => Promise<KanbanQuestion | null>;
  fileIssue: (cardId: string, text: string) => Promise<KanbanIssue | null>;
  resolveIssue: (issueId: string) => Promise<KanbanIssue | null>;
  addChecklistItem: (cardId: string, text: string) => Promise<KanbanChecklistItem | null>;
  updateChecklistItem: (
    itemId: string,
    patch: { state?: KanbanChecklistItem['state']; note?: string }
  ) => Promise<KanbanChecklistItem | null>;
  /** Posts one file's bytes to the card and answers the row the server stored, or `null` when the
   *  door refused it — its sentence reaches the reader through the same toast every other verb's
   *  refusal does. The card's own list is repainted by the frame the write broadcasts. */
  uploadAttachment: (cardId: string, file: File) => Promise<KanbanAttachment | null>;
  /** Destroys one attachment's row and its bytes. `true` when there was something to remove. */
  removeAttachment: (cardId: string, attachmentId: string) => Promise<boolean>;
};

type KanbanMutationOptions = {
  /** Puts one card where the server says it belongs, in place. */
  applyCard: (card: KanbanCardSummary | null) => void;
};

/** Called ONCE, by the panel, with the lanes hook's own applier. */
export function useKanbanMutations({ applyCard }: KanbanMutationOptions): KanbanMutations {
  const { t } = useTranslation();
  const toast = useToast();

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reported = useCallback(
    (error: unknown) => {
      console.warn('[useKanbanMutations] the write did not complete:', error);
      if (!mountedRef.current) return;
      toast({
        tone: 'warn',
        title: t('kanban.toast.cardNotSaved'),
        message: error instanceof Error ? error.message : undefined,
      });
    },
    [t, toast]
  );

  /**
   * One request, and the one place a failure becomes a sentence. EVERY verb below goes through it,
   * so no verb can fail silently and none of them has to remember to report.
   */
  const send = useCallback(
    async <T,>(request: () => Promise<Response>): Promise<T | null> => {
      try {
        return await readApiJson<T>(await request());
      } catch (error) {
        reported(error);
        return null;
      }
    },
    [reported]
  );

  /**
   * A write whose answer IS the card, and whose failure puts the card back.
   *
   * `said` is what this verb announces when it LANDS, and it is absent for the verbs whose own
   * screen is the answer: a move announces through the board's live region, and a created card
   * opens its drawer. `ToastRequest` carries a title, a message and a tone and no action slot, so
   * there is no undo to hang here — `src/shared/types.ts`, where one would have to be added, is
   * not this phase's to open. An archive therefore states what happened and stops there.
   */
  const writeCard = useCallback(
    async (
      request: () => Promise<Response>,
      previous?: KanbanCardSummary | null,
      said?: string
    ): Promise<KanbanCardSummary | null> => {
      const body = await send<{ card: KanbanCardSummary }>(request);
      if (body === null) {
        // The board goes back to what it was holding. Without this a failed move leaves the card
        // in the wrong lane until something else happens to refetch it.
        if (mountedRef.current && previous) applyCard(previous);
        return null;
      }

      const card = body.card ?? null;
      if (mountedRef.current) {
        applyCard(card);
        if (said) toast({ tone: 'positive', title: said });
      }
      return card;
    },
    [send, applyCard, toast]
  );

  const createCard = useCallback(
    (boardId: string, input: { title: string; status: KanbanStatus }) =>
      writeCard(() => api.kanban.createCard(boardId, input)),
    [writeCard]
  );

  const updateCard = useCallback(
    (cardId: string, patch: KanbanCardPatch) => writeCard(() => api.kanban.updateCard(cardId, patch)),
    [writeCard]
  );

  const moveCard = useCallback(
    (input: KanbanMoveInput, previous?: KanbanCardSummary | null) =>
      writeCard(
        () => api.kanban.moveCard(input.cardId, { status: input.status, afterId: input.afterId, beforeId: input.beforeId }),
        previous
      ),
    [writeCard]
  );

  const archiveCard = useCallback(
    (cardId: string, previous?: KanbanCardSummary | null) =>
      writeCard(() => api.kanban.archiveCard(cardId), previous, t('kanban.toast.cardArchived')),
    [writeCard, t]
  );

  const addTag = useCallback(
    (cardId: string, tag: string) => writeCard(() => api.kanban.addTag(cardId, tag)),
    [writeCard]
  );

  const removeTag = useCallback(
    (cardId: string, tag: string) => writeCard(() => api.kanban.removeTag(cardId, tag)),
    [writeCard]
  );

  const approveCard = useCallback(
    (cardId: string) => writeCard(() => api.kanban.approveCard(cardId)),
    [writeCard]
  );

  const unapproveCard = useCallback(
    (cardId: string) => writeCard(() => api.kanban.unapproveCard(cardId)),
    [writeCard]
  );

  // The ledger verbs below answer with their OWN row, and put nothing back: the drawer paints what
  // the shell's one fetch returned, so a write that did not land leaves that fetch's state standing
  // — the same "nothing changed" a revert would produce, without a second copy to keep right.

  const answerQuestion = useCallback(
    async (questionId: string, input: { selected: string[]; other?: string }) => {
      const body = await send<{ question: KanbanQuestion }>(() => api.kanban.answerQuestion(questionId, input));
      return body?.question ?? null;
    },
    [send]
  );

  const fileIssue = useCallback(
    async (cardId: string, text: string) => {
      const body = await send<{ issue: KanbanIssue }>(() => api.kanban.fileIssue(cardId, { text }));
      return body?.issue ?? null;
    },
    [send]
  );

  const resolveIssue = useCallback(
    async (issueId: string) => {
      const body = await send<{ issue: KanbanIssue }>(() => api.kanban.resolveIssue(issueId, {}));
      return body?.issue ?? null;
    },
    [send]
  );

  const addChecklistItem = useCallback(
    async (cardId: string, text: string) => {
      const body = await send<{ item: KanbanChecklistItem }>(() => api.kanban.addChecklistItem(cardId, { text }));
      return body?.item ?? null;
    },
    [send]
  );

  const updateChecklistItem = useCallback(
    async (itemId: string, patch: { state?: KanbanChecklistItem['state']; note?: string }) => {
      const body = await send<{ item: KanbanChecklistItem }>(() => api.kanban.updateChecklistItem(itemId, patch));
      return body?.item ?? null;
    },
    [send]
  );

  // The card's attachment bytes, on the same footing as the ledger verbs above: each answers WHAT
  // THE ROUTE ANSWERED and nothing more — the stored row, or whether the bytes were there to
  // destroy. Neither puts a card back: the upload's answer arrives before the card's own frame
  // does, and the drawer paints the card, so the list comes right by the one path that can never
  // disagree with the count on the card's face.

  const uploadAttachment = useCallback(
    async (cardId: string, file: File) => {
      const body = await send<{ attachment: KanbanAttachment }>(() => api.kanban.uploadAttachment(cardId, file));
      return body?.attachment ?? null;
    },
    [send]
  );

  const removeAttachment = useCallback(
    async (cardId: string, attachmentId: string) => {
      const body = await send<{ ok: boolean }>(() => api.kanban.removeAttachment(cardId, attachmentId));
      return body?.ok ?? false;
    },
    [send]
  );

  const clearLane = useCallback(
    async (cardIds: string[]) => {
      // One press, many writes: the lane's cards go one at a time, and each one that lands is
      // removed from the board as its answer arrives rather than after the last one returns.
      let cleared = 0;
      for (const cardId of cardIds) {
        if (await writeCard(() => api.kanban.archiveCard(cardId))) cleared += 1;
      }

      // ONE sentence for the whole press rather than one per card: "Clear done" is a single act,
      // and a lane of thirty would otherwise stack thirty toasts over the reader.
      //
      // AND ONLY IF IT HAPPENED. Every card the server refused has already been reported by
      // `writeCard` with the server's own reason, so a press that emptied nothing — a lane whose
      // writes were all refused — would otherwise end on a success sentence sitting directly under
      // the refusals, contradicting them. Zero landed cards is not a cleared lane.
      if (mountedRef.current && cleared > 0) {
        toast({ tone: 'positive', title: t('kanban.toast.laneCleared') });
      }
    },
    [writeCard, t, toast]
  );

  return {
    createCard,
    updateCard,
    moveCard,
    archiveCard,
    clearLane,
    addTag,
    removeTag,
    approveCard,
    unapproveCard,
    answerQuestion,
    fileIssue,
    resolveIssue,
    addChecklistItem,
    updateChecklistItem,
    uploadAttachment,
    removeAttachment,
  };
}
