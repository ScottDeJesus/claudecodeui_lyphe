import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
import { QuestionText } from '@/modules/chat';
import type { DispatcherAsk } from '@/shared/types';
import { Button, Input, QuestionOptionRow } from '@/shared/ui';

/** The round this form answers: `DispatcherAsk` narrowed to its questions kind — a designer's questions, which the plan waits on. */
type RoundAsk = Extract<DispatcherAsk, { kind: 'questions' }>;

/** One question's answer as it is being composed: the offered label picked, the words typed in its `Other…` field, and whether that field is open. */
type RoundPick = { picked: string | null; other: string; otherOpen: boolean };

/**
 * What one slot holds as an answer right now: the picked label, else the typed words while the Other
 * field is open and has some — `null` while the question has no answer at all, which is what the
 * Send button counts.
 */
function answerOf(pick: RoundPick): string | null {
  if (pick.picked !== null) return pick.picked;
  const words = pick.other.trim();
  return pick.otherOpen && words ? words : null;
}

/**
 * A ROUND'S ANSWER FORM — every one of a designer's questions, and one Send for all of them.
 *
 * THE QUESTIONS ARE ONE REGION, STACKED, AND IT IS BOUNDED. They scroll in the same
 * `max-h-[50dvh]` box the census does (`LockAnswer`), focusable (`tabIndex={0}`) so the whole round
 * can be read from the keyboard, and named for the plan whose questions these are — a round carries
 * no header of its own, where a lock's region is named for `ask.header`. Nothing is folded, paged or
 * abbreviated: a round is a handful of questions, and the reader answers them by reading them.
 *
 * EVERY QUESTION IS THE CHAT'S OWN QUESTION SHAPE. Its words are `QuestionText` — the same markdown
 * renderer a question in the transcript goes through — its answer rows are `QuestionOptionRow` with
 * `choice="radio"` and NO key hint, and under them the dashed `Other…` row and, once it is pressed,
 * its field; the row sits OUTSIDE the group, as it does in the chat, because it opens a field rather
 * than being a fourth answer. The option rows are the app's one option everywhere (`@/shared/ui`), so
 * a question looks the same in the chat, on the card, and in the record of what was chosen.
 *
 * ONE ANSWER A QUESTION, AND SEND TAKES THEM ALL. Picking an offered label closes that question's
 * Other field; opening Other takes the question off the labels. The typed words are KEPT where they
 * were on both moves — a reader who typed and then changed his mind has not untyped anything. Send
 * sits under the region, never inside it, and is enabled the moment ANY question has an answer; it
 * carries one entry a question, keyed by the question's own text — the AskUserQuestion contract's
 * key, and the same one `LockAnswer` answers its lock by.
 *
 * `busy` IS READ, NEVER GUESSED: the control that sends — `Send answers` — refuses a press while
 * the lane is carrying the round, so one answer is never sent twice. The rows and the Other field
 * above only compose it, and stay live on purpose: a press among them during flight changes what a
 * LATER send would carry, and nothing already on its way.
 *
 * Used by `PlanAsk`, as the form its round branch draws; nothing else mounts it.
 */
export function RoundAnswer({ ask, onAnswered }: { ask: RoundAsk; onAnswered: () => void }) {
  const { t } = useTranslation();
  // The lane's own door for this plan — the card's presses go through no route of their own — and
  // whichever verb it is carrying, read below as one fact about THIS form.
  const { answer, busy: carrying } = useDispatcherVerbs(ask.plan);

  // Whether the lane is carrying this plan's answer right now. Essential: the one control below that
  // CARRIES the round — Send answers — reads it, so one round is never sent twice.
  const busy = carrying === 'answer';

  // One slot a question, in the round's own order: what is picked, what is typed, which Other field is open. Essential: a round is answered question by question and sent ONCE, so all three facts are this form's own state until Send carries them together.
  const [picks, setPicks] = useState<RoundPick[]>(
    () => ask.questions.map(() => ({ picked: null, other: '', otherOpen: false })),
  );

  // Pick an offered label: that is the question's one answer, so its Other field closes over it.
  const pickOption = (index: number, label: string) => {
    setPicks((slots) => slots.map((slot, at) => (at === index ? { ...slot, picked: label, otherOpen: false } : slot)));
  };

  // Open or close a question's Other field: opening it takes the answer off the offered labels, and closing it leaves the typed words where they were.
  const toggleOther = (index: number) => {
    setPicks((slots) => slots.map((slot, at) => (at === index ? { ...slot, picked: null, otherOpen: !slot.otherOpen } : slot)));
  };

  // The Other field's own value, exactly as typed.
  const typeOther = (index: number, words: string) => {
    setPicks((slots) => slots.map((slot, at) => (at === index ? { ...slot, other: words } : slot)));
  };

  // What this round would send right now: one entry a question that has an answer, keyed by the question's own text. Derived from the slots on every draw, never stored — the count below IS the enabled state of Send.
  const answers: Record<string, string> = {};
  ask.questions.forEach((question, index) => {
    const answer = answerOf(picks[index]);
    if (answer !== null) answers[question.text] = answer;
  });
  const ready = Object.keys(answers).length > 0;

  // Send: every answered question at once, by that same key. The map handed over is the one derived
  // above for THIS draw, so what travels is exactly what the rows say was chosen.
  const pressSend = () => {
    void answer(ask, answers).then((took) => {
      if (took) onAnswered();
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div
        data-ask-region
        role="region"
        aria-label={ask.plan}
        tabIndex={0}
        className="scrollbar-thin max-h-[50dvh] min-h-0 overflow-y-auto overscroll-contain rounded-md border border-border bg-card px-3 py-2"
      >
        <div className="flex min-w-0 flex-col gap-3">
          {ask.questions.map((question, index) => (
            <div key={`${index}:${question.text}`} data-ask-question className="flex min-w-0 flex-col gap-1.5">
              <QuestionText text={question.text} />
              {/* role="radiogroup", because picking a row here IS the answer — one per question, not a
                  toggle — and `choice` is what gives each row that role and its `aria-checked`. */}
              <div role="radiogroup" aria-label={question.text} className="flex min-w-0 flex-col gap-1.5">
                {question.options.map((option) => (
                  <QuestionOptionRow
                    key={option}
                    label={option}
                    selected={picks[index].picked === option}
                    choice="radio"
                    onClick={() => pickOption(index, option)}
                  />
                ))}
              </div>
              {/* The Other row is OUTSIDE the group, as it is in the chat (`AskUserQuestionPanel`): it
                  is a door to a field rather than a fourth answer, it really does switch off, and a
                  `radiogroup` may hold nothing but radios. The row below it is the field it opened. */}
              <QuestionOptionRow
                label={t('dispatcher.ask.other')}
                selected={picks[index].otherOpen}
                dashed
                onClick={() => toggleOther(index)}
              />
              {/* The field the PRESS opened, and the only thing here that ever takes focus: the press
                  that opened it means "I am typing", exactly as the chat's `Other` row does. Nothing
                  focuses on mount — a card that grabs the caret takes it from whatever the reader was
                  doing when the lane moved. */}
              {picks[index].otherOpen && (
                <Input
                  data-ask-other
                  autoFocus
                  value={picks[index].other}
                  onChange={(event) => typeOther(index, event.target.value)}
                  placeholder={t('dispatcher.ask.otherPlaceholder')}
                  aria-label={t('dispatcher.ask.otherPlaceholder')}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          data-ask-send
          type="button"
          size="sm"
          className="h-8"
          disabled={busy || !ready}
          onClick={pressSend}
        >
          {t('dispatcher.ask.sendAnswers')}
        </Button>
      </div>
    </div>
  );
}
