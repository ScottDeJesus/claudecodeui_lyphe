import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanMutations } from '@/modules/kanban/hooks/useKanbanMutations';
import type { KanbanCardDetail, KanbanQuestion } from '@/shared/kanban-types';
import { Badge, Button, Chip, Input } from '@/shared/ui';

/**
 * WHAT THE RUN IS WAITING TO BE TOLD, and the one control that unblocks it.
 *
 * THIS IS THE SECTION THAT UNLOCKS APPROVAL. A card cannot be approved while anybody is still
 * waiting on an answer, so the count at the top of this section is the same number the approve
 * control reads further down — one truth, `answered = 0`, spelled in two places that cannot
 * disagree because both come off the one fetch.
 *
 * UNANSWERED IS THE LOUD STATE. An open question is amber and never red: nothing is broken, a
 * decision is simply owed. Answered rows keep their place and go quiet — they are the record of
 * what was decided, and a reader who wants to revisit one presses Change rather than hunting for
 * it somewhere else.
 *
 * THE ANSWER GOES THROUGH `answerQuestion` on `useKanbanMutations`, handed down by the shell: that
 * hook is where a write becomes a toast and where a refusal keeps the server's own sentence, so
 * this file reaches the network through nothing of its own.
 *
 * A SELECTION IS NOT AN ANSWER UNTIL IT IS SENT. Chips move a local draft; the Answer press is
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

  return (
    <section className="flex flex-col gap-3" aria-labelledby={headingId}>
      <div className="flex items-center gap-2">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
          {t('kanban.questions.title')}
        </h3>
        {open > 0 && (
          <Badge tone="warn" className="vv-badge--compact">
            {t('kanban.questions.unanswered', { count: open })}
          </Badge>
        )}
      </div>

      {detail.questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('kanban.questions.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {detail.questions.map((question) => (
            <QuestionRow key={question.id} question={question} answerQuestion={writes.answerQuestion} />
          ))}
        </ul>
      )}
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
  // Seeded from the question's own text rather than from `otherOn`: `otherOn` says the asker
  // ALLOWED a free answer, this says the reader is giving one.
  const [usingOther, setUsingOther] = useState(question.other.trim().length > 0);
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
    <li className="vv-card flex flex-col gap-2 p-3">
      <p className="text-sm leading-snug text-foreground">{question.text}</p>

      {answered ? (
        <div className="flex flex-wrap items-center gap-2">
          {/* The decision itself, not a checkmark: "answered" tells the reader nothing they can
              act on, and the word that was chosen tells them everything. */}
          <Badge tone="positive" className="vv-badge--compact">
            {decision.length > 0 ? decision : t('kanban.questions.answeredBlank')}
          </Badge>
          <Button variant="ghost" size="sm" className="ml-auto h-7 px-2" onClick={() => setChanging(true)}>
            {t('kanban.questions.change')}
          </Button>
        </div>
      ) : (
        <>
          {question.multi && (
            <p className="text-xs text-muted-foreground">{t('kanban.questions.multiHint')}</p>
          )}

          <div className="flex flex-wrap gap-2" role="group" aria-label={question.text}>
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

            {/* Offered only when the asker allowed it. A free-text answer nobody asked for is a
                decision recorded in a vocabulary the run cannot read. */}
            {question.otherOn && (
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
            <Input
              id={otherId}
              value={other}
              onChange={(event) => setOther(event.target.value)}
              placeholder={t('kanban.questions.otherPlaceholder')}
              aria-label={t('kanban.questions.other')}
              className="h-8"
            />
          )}

          <div className="flex items-center gap-2">
            {question.answered && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => {
                  // Cancel DISCARDS: the row returns to the decision on RECORD, so a later Change
                  // opens what is stored rather than the draft the reader walked away from.
                  setSelected(question.selected);
                  setOther(question.other);
                  setUsingOther(question.other.trim().length > 0);
                  setChanging(false);
                }}
              >
                {t('kanban.questions.cancel')}
              </Button>
            )}
            <Button
              variant="tonal"
              size="sm"
              className="ml-auto h-8"
              // Refused before it is pressed rather than after a round trip: the server filters an
              // empty selection away too, and an answer of nothing is not an answer.
              disabled={!canAnswer}
              onClick={answer}
            >
              {t('kanban.questions.answer')}
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
