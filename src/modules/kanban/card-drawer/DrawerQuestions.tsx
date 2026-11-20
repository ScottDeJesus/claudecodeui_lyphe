import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DrawerDecisions } from '@/modules/kanban/card-drawer/DrawerDecisions';
import type { KanbanMutations } from '@/modules/kanban/hooks/useKanbanMutations';
import type { KanbanCardDetail, KanbanQuestion } from '@/shared/kanban-types';
import { Button, Rule } from '@/shared/ui';

/**
 * WHAT THE RUN IS WAITING TO BE TOLD, and the one control that unblocks it.
 *
 * AN ANSWER IS WHAT SENDS THE CARD BACK OUT. A walk that stops to ask leaves its card in Open
 * questions, and it is taken up again the moment no question on it is left open — so the count at
 * the top of this section is how many answers stand between this card and its next step.
 *
 * UNDER THE QUESTIONS, THE DECISIONS TAKEN WITHOUT ASKING (`DrawerDecisions`), newest first: the
 * choices that were obvious enough not to stop for, on record where the ones that did stop are.
 *
 * EACH QUESTION IS THE DESIGN SYSTEM'S CHOICE, asked from the card that needs the answer: the
 * question, then each option a row on a hairline, the chosen ones in the accent (a word is owed),
 * "Select all that apply" over a question that takes several, and Other as the last row, whose
 * field opens under it. The count of what is still open stands at the end of the section's Rule,
 * amber and never red: nothing is broken, a decision is simply owed. Answered, a question keeps
 * its place and goes quiet — the question, then what was decided after a green tick — and a
 * reader who wants to revisit one presses Change rather than hunting for it somewhere else.
 *
 * THE ANSWER GOES THROUGH `answerQuestion` on `useKanbanMutations`, handed down by the shell: that
 * hook is where a write becomes a toast and where a refusal keeps the server's own sentence, so
 * this file reaches the network through nothing of its own.
 *
 * A SELECTION IS NOT AN ANSWER UNTIL IT IS SENT. The rows move a local draft; the Answer press is
 * the write. That is deliberate on a multi-select question, where the reader's first two presses
 * are rarely their whole answer, and it is kept on single-select ones so both behave the same way
 * under the same hand.
 */

type DrawerQuestionsProps = {
  /** The open card, as the shell read it. This section fetches nothing. */
  detail: KanbanCardDetail;
  /** The board's verbs, from the shell. This section reaches the network through none of its own. */
  writes: KanbanMutations;
};

/** Rendered by KanbanCardDrawer while autonomy is on. Nothing else mounts it. */
export function DrawerQuestions({ detail, writes }: DrawerQuestionsProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const open = detail.questions.filter((question) => !question.answered).length;
  // Nothing asked and nothing decided: the section is absent, not a heading over nothing.
  if (detail.questions.length === 0 && !detail.decisions.some((decision) => decision.questionId === null)) return null;

  return (
    <section className="flex flex-col gap-3" aria-labelledby={headingId} data-drawer-questions="">
      <Rule id={headingId} end={open > 0 ? t('kanban.questions.unanswered', { count: open }) : undefined} endTone="warn">
        {t('kanban.questions.title')}
      </Rule>

      {detail.questions.length > 0 && (
        <ul className="flex flex-col gap-5">
          {detail.questions.map((question) => (
            <QuestionRow key={question.id} question={question} answerQuestion={writes.answerQuestion} />
          ))}
        </ul>
      )}

      <DrawerDecisions detail={detail} />
    </section>
  );
}

/**
 * One question: its options, the free-text case, and what was decided.
 *
 * Its own component because the draft belongs to the QUESTION — a board card can carry a dozen,
 * and one shared draft map would let a press on the eleventh repaint the other eleven.
 */
function QuestionRow({
  question,
  answerQuestion,
}: {
  question: KanbanQuestion;
  answerQuestion: KanbanMutations['answerQuestion'];
}) {
  const { t } = useTranslation();
  const otherId = useId();

  const [selected, setSelected] = useState<string[]>(question.selected);
  const [other, setOther] = useState(question.other);
  // A question that offers nothing to pick ("What are the exact steps?") is answered in the
  // reader's own words and no other way: its field stands open, and there is no "Something else"
  // to press, because there is nothing for it to be other than.
  const freeOnly = question.otherOn && question.options.length === 0;
  // Otherwise seeded from the question's own text: this says the reader is giving a free answer.
  const [usingOther, setUsingOther] = useState(freeOnly || question.other.trim().length > 0);
  const [changing, setChanging] = useState(false);

  /** Single-select replaces, multi toggles. View state only — nothing is sent from here. */
  const choose = (option: string) => {
    setSelected((held) => {
      if (!question.multi) return [option];
      return held.includes(option) ? held.filter((choice) => choice !== option) : [...held, option];
    });
  };

  const answer = async () => {
    // A free-text answer the reader toggled OFF is not sent: `usingOther` says whether they are
    // giving one, and the empty string is what the server stores for a question answered from its
    // own options.
    const landed = await answerQuestion(question.id, { selected, other: usingOther ? other : '' });
    // Only once the write has landed. The shell's own re-read is what repaints this row as
    // answered — a refusal leaves the editor open over the reader's selection, which is the only
    // state in which they can try again.
    if (landed) setChanging(false);
  };

  const answered = question.answered && !changing;
  const canAnswer = selected.length > 0 || (usingOther && other.trim().length > 0);
  const decision = [...question.selected, question.other].filter((part) => part.trim().length > 0).join(' · ');

  return (
    <li className="ast-choice" data-multi={question.multi ? 'true' : 'false'} data-question={question.id}>
      <p className="ast-choice-q">{question.text}</p>

      {answered ? (
        <div className="flex items-start gap-2">
          {/* The decision itself, not a checkmark alone: "answered" tells the reader nothing they can act on, and the word that
              was chosen tells them everything. */}
          <p className="ast-choice-said min-w-0 flex-1">{decision.length > 0 ? decision : t('kanban.questions.answeredBlank')}</p>
          <Button variant="outline" size="sm" className="h-7 shrink-0 px-2 finger:h-11" onClick={() => setChanging(true)}>
            {t('kanban.questions.change')}
          </Button>
        </div>
      ) : (
        <>
          {question.multi && <p className="-mt-1 text-xs text-muted-foreground">{t('kanban.questions.multiHint')}</p>}

          {!freeOnly && (
            <div className="ast-choice-list" role="group" aria-label={question.text}>
              {question.options.map((option) => (
                <button key={option} type="button" className="ast-choice-opt" aria-pressed={selected.includes(option)} onClick={() => choose(option)}>
                  <span className="ast-choice-opt-mark" aria-hidden="true" />
                  <span className="min-w-0 flex-1">{option}</span>
                </button>
              ))}

              {/* Offered only when the asker allowed it. A free-text answer nobody asked for is a decision recorded in a
                  vocabulary the run cannot read. */}
              {question.otherOn && (
                <button type="button" className="ast-choice-opt" aria-pressed={usingOther} onClick={() => setUsingOther((using) => !using)}>
                  <span className="ast-choice-opt-mark" aria-hidden="true" />
                  <span className="min-w-0 flex-1">{t('kanban.questions.other')}</span>
                </button>
              )}
            </div>
          )}

          <div className={`flex flex-wrap gap-2${freeOnly ? ' hidden' : ''}`} role="group" aria-label={question.text}>
            {question.options.map((option) => (
              <Chip
                key={option}
                size="sm"
                selected={selected.includes(option)}
                onClick={() => choose(option)}
              >
                {option}
              </Chip>
            ))}

            {/* Always offered beside the options: when none of them is what the reader wants, their
                own words are the answer, and the run is handed them as "In his words". */}
            {!freeOnly && (
              <Chip
                size="sm"
                selected={usingOther}
                onClick={() => setUsingOther((using) => !using)}
              >
                {t('kanban.questions.other')}
              </Chip>
            )}
          </div>

          {usingOther && (
            <input
              id={otherId}
              value={other}
              onChange={(event) => setOther(event.target.value)}
              placeholder={t('kanban.questions.otherPlaceholder')}
              // With nothing else to pick, the field IS the question's answer and is named for it.
              aria-label={freeOnly ? question.text : t('kanban.questions.other')}
              className="bug-field"
            />
          )}

          <div className="flex items-center justify-end gap-2">
            {question.answered && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 finger:h-11"
                onClick={() => {
                  // Cancel DISCARDS: the row returns to the decision on RECORD, so a later Change opens what is stored rather
                  // than the draft the reader walked away from.
                  setSelected(question.selected);
                  setOther(question.other);
                  setUsingOther(freeOnly || question.other.trim().length > 0);
                  setChanging(false);
                }}
              >
                {t('kanban.questions.cancel')}
              </Button>
            )}
            <Button
              variant="tonal"
              size="sm"
              className="h-8 finger:h-11"
              // Refused before it is pressed rather than after a round trip: the server filters an empty selection away too,
              // and an answer of nothing is not an answer.
              disabled={!canAnswer}
              onClick={() => void answer()}
            >
              {t('kanban.questions.answer')}
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
