import React, { useCallback, useState } from 'react';

import type { PermissionPanelProps, Question } from '@/shared/types';
import { usePermission } from '@/modules/chat/context/PermissionContext';
import { permissionKey } from '@/modules/chat/tools/toolOutcome';
import { AskUserQuestionPanel } from '@/modules/chat/tools/InteractiveRenderers/AskUserQuestionPanel';

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
 * id is a new question, even if byte-identical, and only a fresh mount offers it.
 */
const sentByRow = new Map<string, { requestId: string; answers: Record<string, string> }>();
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
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
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
  const mayOffer = (requestId: string) => sentAnswers === null || requestId === remembered?.requestId;
  const pendingRequest = Object.keys(foldedAnswers).length > 0 || !toolName
    ? undefined
    : permissionCtx?.pendingPermissionRequests.find(
        (r) => mayOffer(r.requestId) && permissionKey(r.toolName, r.input) === rowKey,
      );
  if (pendingRequest && permissionCtx) {
    return <AskUserQuestionPanel request={pendingRequest} onDecision={decide} />;
  }

  // Shown, in order of trust: the server's folded answers, what this mount sent, what this
  // conversation remembers for the row.
  const shownAnswers = Object.keys(foldedAnswers).length > 0 ? foldedAnswers : (sentAnswers ?? remembered?.answers ?? {});
  const hasAnyAnswer = Object.keys(shownAnswers).length > 0;
  const total = questions.length;

  return (
    <div className={`space-y-2 ${className}`}>
      {questions.map((rawQuestion, idx) => {
        // Entries come from session transcripts and may be malformed; skip
        // anything that isn't a proper question object with a string prompt.
        if (!rawQuestion || typeof rawQuestion !== 'object' || typeof rawQuestion.question !== 'string') {
          return null;
        }
        const q = rawQuestion;
        const answer = shownAnswers[q.question];
        // `answer` may be a non-string (or absent) in malformed payloads.
        const answerLabels = typeof answer === 'string' ? answer.split(', ') : [];
        const skipped = !answer;
        const isExpanded = expandedIdx === idx;
        // `options` is typed as an array but comes from untrusted runtime data;
        // keep only valid entries so `.some`/`.map` below never throw.
        const options = Array.isArray(q.options)
          ? q.options.filter((opt) => opt && typeof opt === 'object' && typeof opt.label === 'string')
          : [];

        return (
          <div
            key={idx}
            className="border-gray-150 overflow-hidden rounded-lg border bg-gray-50/50 dark:border-gray-700/50 dark:bg-gray-800/30"
          >
            <button
              type="button"
              onClick={() => setExpandedIdx(isExpanded ? null : idx)}
              className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              <div className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full ${
                answerLabels.length > 0
                  ? 'bg-blue-100 dark:bg-blue-900/40'
                  : 'bg-gray-100 dark:bg-gray-800'
              }`}>
                {answerLabels.length > 0 ? (
                  <svg className="h-2.5 w-2.5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <div className="h-1.5 w-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {q.header && (
                    <span className="inline-flex items-center rounded border border-blue-100/80 bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-blue-600 dark:border-blue-800/40 dark:bg-blue-900/30 dark:text-blue-400">
                      {q.header}
                    </span>
                  )}
                  {total > 1 && (
                    <span className="text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
                      {idx + 1}/{total}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs leading-snug text-gray-600 dark:text-gray-400">
                  {q.question}
                </div>

                {!isExpanded && answerLabels.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {answerLabels.map((lbl) => {
                      const isCustom = !options.some(o => o.label === lbl);
                      return (
                        <span
                          key={lbl}
                          className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                        >
                          {lbl}
                          {isCustom && (
                            <span className="text-[9px] font-normal text-blue-400 dark:text-blue-500">(custom)</span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                )}

                {!isExpanded && skipped && hasAnyAnswer && (
                  <span className="mt-1 inline-block text-[10px] italic text-gray-400 dark:text-gray-500">
                    Skipped
                  </span>
                )}
              </div>

              <svg
                className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400 transition-transform duration-200 dark:text-gray-500 ${
                  isExpanded ? 'rotate-180' : ''
                }`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isExpanded && (
              <div className="border-t border-gray-100 px-3 pb-2.5 pt-0.5 dark:border-gray-700/40">
                <div className="ml-6.5 space-y-1">
                  {options.map((opt) => {
                    const wasSelected = answerLabels.includes(opt.label);
                    return (
                      <div
                        key={opt.label}
                        className={`flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[12px] ${
                          wasSelected
                            ? 'border border-blue-200/60 bg-blue-50/80 dark:border-blue-800/40 dark:bg-blue-900/20'
                            : 'text-gray-400 dark:text-gray-500'
                        }`}
                      >
                        <div className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${q.multiSelect ? 'rounded-[3px]' : 'rounded-full'} flex items-center justify-center border-[1.5px] ${
                          wasSelected
                            ? 'border-blue-500 bg-blue-500 dark:border-blue-400 dark:bg-blue-500'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}>
                          {wasSelected && (
                            <svg className="h-2 w-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className={wasSelected ? 'font-medium text-gray-900 dark:text-gray-100' : ''}>
                            {opt.label}
                          </span>
                          {opt.description && (
                            <span className={`mt-0.5 block text-[11px] ${
                              wasSelected ? 'text-blue-600/70 dark:text-blue-300/70' : 'text-gray-400 dark:text-gray-600'
                            }`}>
                              {opt.description}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {answerLabels.filter(lbl => !options.some(o => o.label === lbl)).map(lbl => (
                    <div
                      key={lbl}
                      className="flex items-start gap-2 rounded-lg border border-blue-200/60 bg-blue-50/80 px-2.5 py-1.5 text-[12px] dark:border-blue-800/40 dark:bg-blue-900/20"
                    >
                      <div className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${q.multiSelect ? 'rounded-[3px]' : 'rounded-full'} flex items-center justify-center border-[1.5px] border-blue-500 bg-blue-500 dark:border-blue-400 dark:bg-blue-500`}>
                        <svg className="h-2 w-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{lbl}</span>
                        <span className="ml-1 text-[10px] text-blue-500 dark:text-blue-400">(custom)</span>
                      </div>
                    </div>
                  ))}

                  {skipped && hasAnyAnswer && (
                    <div className="px-2.5 py-1 text-[11px] italic text-gray-400 dark:text-gray-500">
                      No answer provided
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {!hasAnyAnswer && total === 1 && (
        <div className="text-[11px] italic text-gray-400 dark:text-gray-500">
          Skipped
        </div>
      )}
    </div>
  );
};
