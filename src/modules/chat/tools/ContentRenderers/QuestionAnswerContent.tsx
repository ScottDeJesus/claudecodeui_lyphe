import React, { useCallback, useState } from 'react';

import type { PermissionPanelProps, Question } from '@/shared/types';
import { usePermission } from '@/modules/chat/context/PermissionContext';
import { permissionKey, wasPermissionSettled } from '@/modules/chat/tools/toolOutcome';
import { AskUserQuestionPanel } from '@/modules/chat/tools/InteractiveRenderers/AskUserQuestionPanel';
import { AnsweredQuestion } from '@/modules/chat/tools/ContentRenderers/AnsweredQuestion';

/**
 * What this tab answered, by conversation AND row identity, so a REMOUNTED card still shows
 * it. The server folds answers into the tool input only on the next history load
 * (`unifyAskCall`), and the row un-pins the instant its decision is sent, so a lazy row can be
 * swapped out and back before that fold — component state alone would come back empty and
 * read "Skipped". Scoped to the conversation because the chat view is not remounted between
 * conversations (the hazard `useToolPermissionState` documents): an answer given in one chat
 * must never dress up the same question in another.
 *
 * This memory is DISPLAY only. It is consulted after — never instead of — the search for a
 * pending request. The requestId it records has one job: to recognise a REPLAY. A decision
 * whose socket frame was dropped (`sendMessage` warns and drops when the socket is not open,
 * and the pending list is pruned regardless) leaves the server still waiting, and on reconnect
 * it re-sends the request under the same id — that request must be offered again, and a card
 * that already answered it is the one card allowed to offer it. A new request with a different
 * id is a new question, even if byte-identical, and only a fresh mount offers it — UNLESS this
 * card's own answer was never settled by the run: an API handed over between the prompt and the
 * tap held no such request, the decision was a silent no-op, and the successor re-issued the
 * prompt under a new id (measured 2026-09-17). `wasPermissionSettled` is what tells the two
 * apart, and that door opens ONCE: the first request it lets through is remembered (`hatchId`),
 * and once anyone settles that one the card is closed for good, so a later byte-identical
 * question in the same conversation belongs to its own fresh card and never doubles the panel.
 */
const sentByRow = new Map<string, { requestId: string; answers: Record<string, string>; hatchId?: string }>();
const rowMemoryKey = (sessionId: string | null, rowKey: string) => `${sessionId ?? ''}::${rowKey}`;

type QuestionAnswerContentProps = {
  questions: Question[];
  answers: Record<string, string>;
  /** The row's tool name and parsed input — the identity a pending request is matched on. */
  toolName?: string;
  toolInput?: unknown;
  className?: string;
};

/**
 * Rendered by chat's ToolRenderer to show an AskUserQuestion tool's questions
 * and the answers the user picked — and, while the run is still waiting on
 * them, the panel that answers them, so the question is asked in ONE place.
 */
// Exception to the stateless ContentRenderer pattern: multi-question navigation requires local state.
export const QuestionAnswerContent: React.FC<QuestionAnswerContentProps> = ({
  questions,
  answers,
  toolName,
  toolInput,
  className = '',
}) => {
  const permissionCtx = usePermission();
  // The identity the permission layer uses for this row (a request carries no tool-use id).
  const rowKey = permissionKey(toolName, toolInput);
  const memoryKey = rowMemoryKey(permissionCtx?.sessionId ?? null, rowKey);
  // What THIS mount answered. `{}` records a skip. Not seeded from memory: a fresh mount with
  // nothing answered is how a new card for a repeated question is told apart from the old one.
  const [sentAnswers, setSentAnswers] = useState<Record<string, string> | null>(null);
  const decide = useCallback<PermissionPanelProps['onDecision']>((requestIds, decision) => {
    const sent = (decision.updatedInput as { answers?: Record<string, string> } | undefined)?.answers ?? {};
    sentByRow.set(memoryKey, { requestId: Array.isArray(requestIds) ? requestIds[0] : requestIds, answers: sent });
    setSentAnswers(sent);
    permissionCtx?.handlePermissionDecision(requestIds, decision);
  }, [permissionCtx, memoryKey]);

  // Tool inputs are runtime data loaded from session transcripts and may be
  // malformed (e.g. `questions` arriving as a non-array). Guard with
  // Array.isArray so a single bad payload can't crash the whole chat view
  // with "e.map is not a function".
  if (!Array.isArray(questions) || questions.length === 0) {
    return null;
  }

  // While the run is blocked on THIS question, the card is the answer panel — the same shape
  // PlanDisplay uses for ExitPlanMode. The pending request is matched by `permissionKey`, so an
  // earlier card with other options or headers never grows a live panel. Decided FIRST, and
  // from facts, not memory: the server has not folded answers in (the card is not finished),
  // and a request is pending for this row that this mount may offer — any request if this mount
  // has answered nothing (a fresh card for a new question), or only its OWN request if it has
  // (a replay of a decision whose frame was dropped; a NEWER identical question belongs to the
  // fresh card further down, not to the old one still on screen). The click sends the decision
  // down the same socket every permission uses, the request leaves the pending list, and the
  // card falls through to the answered summary below.
  const foldedAnswers = answers && typeof answers === 'object' ? answers : {};
  const remembered = sentByRow.get(memoryKey);
  const answeredId = remembered?.requestId;
  const hatchOpen = answeredId !== undefined
    && !wasPermissionSettled(answeredId)
    && (remembered?.hatchId === undefined || !wasPermissionSettled(remembered.hatchId));
  const mayOffer = (requestId: string) =>
    sentAnswers === null || requestId === answeredId || hatchOpen;
  const pendingRequest = Object.keys(foldedAnswers).length > 0 || !toolName
    ? undefined
    : permissionCtx?.pendingPermissionRequests.find(
        (r) => mayOffer(r.requestId) && permissionKey(r.toolName, r.input) === rowKey,
      );
  if (pendingRequest && permissionCtx) {
    // The request the hatch let through: its settlement, by this card or any other, closes the hatch.
    if (remembered && remembered.hatchId === undefined && pendingRequest.requestId !== answeredId) {
      remembered.hatchId = pendingRequest.requestId;
    }
    return <AskUserQuestionPanel request={pendingRequest} onDecision={decide} />;
  }

  // Shown, in order of trust: the server's folded answers, what this mount sent, what this
  // conversation remembers for the row.
  const shownAnswers = Object.keys(foldedAnswers).length > 0 ? foldedAnswers : (sentAnswers ?? remembered?.answers ?? {});
  const hasAnyAnswer = Object.keys(shownAnswers).length > 0;

  return (
    <div className={`divide-y divide-border ${className}`}>
      {questions.map((question, idx) =>
        // Entries come from session transcripts and may be malformed; skip anything that is not a
        // question object with a string prompt.
        question && typeof question === 'object' && typeof question.question === 'string' ? (
          <AnsweredQuestion
            key={idx}
            question={question}
            answer={shownAnswers[question.question]}
            index={idx}
            total={questions.length}
            anyAnswered={hasAnyAnswer}
          />
        ) : null,
      )}
    </div>
  );
};
