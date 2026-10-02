import { useRef, useState } from 'react';
import type { HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
import { useSnapStrip } from '@/modules/dispatcher/hooks/useSnapStrip';
import { SnapStrip, SnapStripItem } from '@/modules/dispatcher/SnapStrip';
import { StatusFlow } from '@/modules/dispatcher/StatusFlow';
import { QuestionText } from '@/modules/chat';
import type { DispatcherAsk, LaneFlowNode } from '@/shared/types';
import { Button, Input, QuestionOptionRow } from '@/shared/ui';

/** The round this form answers: `DispatcherAsk` narrowed to its questions kind — a designer's questions, which the plan waits on. */
type RoundAsk = Extract<DispatcherAsk, { kind: 'questions' }>;

/** One question's answer as it is being composed: the offered label picked, the words typed in its `Other…` field, and whether that field is open. */
type RoundPick = { picked: string | null; other: string; otherOpen: boolean };

/**
 * The page the reader is not on. `inert` takes its controls out of the tab order and out of reach, so
 * Tab can only enter the question in view and the browser's focus-scroll never slides the strip back
 * to an earlier page. Spread through a typed cast because React 18's JSX types do not carry the
 * attribute (`CardFold.tsx` does the same): its presence is the whole of its meaning.
 */
const OFF_VIEW = { inert: '' } as unknown as HTMLAttributes<HTMLLIElement>;

/**
 * How long a pick that paged the strip refuses the next option press. The next question is sliding
 * under the pointer, and a repeat tap at the same spot (a double-click, a bounced touch) would answer
 * a question the reader has not seen. A window and not the strip's own `intended`: the strip drops
 * that ask on every pointerdown, so a tap would clear it before its click arrived.
 */
const PAGING_SETTLE_MS = 500;

/** The clock `PAGING_SETTLE_MS` is counted on, read from an event handler and never from a draw. */
const pressClock = () => performance.now();

/**
 * What one slot holds as an answer right now: the picked label, else the typed words while the Other
 * field is open and has some — `null` while the question has no answer at all, which is what the
 * map's nodes and the Send button count.
 */
function answerOf(pick: RoundPick): string | null {
  if (pick.picked !== null) return pick.picked;
  const words = pick.other.trim();
  return pick.otherOpen && words ? words : null;
}

/**
 * The question a pick pages to: the first one after `from` that has no answer, wrapping round to the
 * ones before it — `null` when every question has one, and the reader stays where they are.
 */
function nextUnanswered(picks: RoundPick[], from: number): number | null {
  for (let distance = 1; distance < picks.length; distance += 1) {
    const at = (from + distance) % picks.length;
    if (answerOf(picks[at]) === null) return at;
  }
  return null;
}

/**
 * A ROUND'S ANSWER FORM — every one of a designer's questions, one at a time, and one Send for all of
 * them.
 *
 * THE QUESTIONS ARE PAGED, NOT WALLED (operator, 2026-10-01: "Plan card questions should display the
 * questions on a left/right swipe similar to plan cards inside arcs. Less scrolling the better"). It
 * is the arc deck's own strip (`SnapStrip`, whose rules are there) with a question for each page: one
 * question in view, moved by a swipe or a trackpad, by the arrows with `Question N of M` between
 * them, and by Left/Right made inside the strip — and the strip is as tall as the question in view,
 * so the form has no scroll box of its own and its one scrollbar is the page's. A page is a question,
 * its options, the Other row and, once it is pressed, its field; nothing is abbreviated, and a
 * round of one question draws that page alone, with no map and no arrows to move to nothing.
 *
 * THE MAP IS THE ROUND AT A GLANCE (`StatusFlow`, one node a question, in the pages' order): the node
 * of the question in view is the selected one, an answered question wears `✓` and the tone of a
 * done thing, an unanswered one its place in the round and none — so which questions still need a
 * word is read without paging to them — and a press on any node pages the strip straight to its
 * question (`goTo`).
 *
 * A PICK PAGES ON, AND NOTHING ELSE DOES. Choosing an offered label has finished that page, so the
 * strip goes to the NEXT UNANSWERED question (`nextUnanswered`: forward from this one, then round to
 * the earlier ones), and focus goes to the strip so the next Tab enters that question. Opening
 * `Other…` or typing in its field never moves the strip — the reader is still on the page, writing —
 * and the last answer picked leaves the reader where they are, with Send enabled. Only the question
 * in view takes focus or presses (`OFF_VIEW`), and an option press within `PAGING_SETTLE_MS` of a
 * paging pick is dropped. Nothing focuses on mount, and the strip is not asked to centre on any
 * question but the first.
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
 * sits under the strip, never on a page, and is enabled only once EVERY question has an answer: a
 * question on a page the reader has not paged to is not one they have declined. It carries one entry
 * a question, keyed by the question's own text — the AskUserQuestion contract's key, and the same
 * one `LockAnswer` answers its lock by — in the round's own order.
 *
 * `busy` IS READ, NEVER GUESSED: the control that sends — `Send answers` — refuses a press while
 * the lane is carrying the round, so one answer is never sent twice. The rows and the Other field
 * on the pages only compose it, and stay live on purpose: a press among them during flight changes
 * what a LATER send would carry, and nothing already on its way.
 *
 * `data-ask-strip`, `data-ask-viewing`, `data-ask-prev` and `data-ask-next` are the strip's handles,
 * `data-ask-question` a page's, beside the Other field's and Send's.
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

  // The strip the pages ride, held here because a pick pages it (`goTo`) and the map reads which page is in view. It opens on the first question: a round has no walk, so no question is further along than another.
  const questionCount = ask.questions.length;
  const strip = useSnapStrip(0, questionCount);
  // When the last pick paged the strip. Essential: it is the one fact `pickOption` needs to refuse a repeat tap while the next question is still sliding in, and nothing else records it. A ref: it paints nothing.
  const lastPagedAt = useRef(Number.NEGATIVE_INFINITY);

  // Pick an offered label: that is the question's one answer, so its Other field closes over it — and the page is finished, so the strip goes on to the next question still owing one.
  const pickOption = (index: number, label: string) => {
    const pressedAt = pressClock();
    if (pressedAt - lastPagedAt.current < PAGING_SETTLE_MS) return;
    const next = picks.map((slot, at) => (at === index ? { ...slot, picked: label, otherOpen: false } : slot));
    setPicks(next);
    const target = nextUnanswered(next, index);
    if (target === null) return;
    lastPagedAt.current = pressedAt;
    strip.goTo(target);
    // The picked page is about to go off view and `inert`, which would drop focus to the body: the strip takes it, so Left/Right work at once and the next Tab lands on the question now in view.
    strip.stripRef.current?.focus({ preventScroll: true });
  };

  // Open or close a question's Other field: opening it takes the answer off the offered labels, and closing it leaves the typed words where they were. It never pages: the reader is still on this page.
  const toggleOther = (index: number) => {
    setPicks((slots) => slots.map((slot, at) => (at === index ? { ...slot, picked: null, otherOpen: !slot.otherOpen } : slot)));
  };

  // The Other field's own value, exactly as typed.
  const typeOther = (index: number, words: string) => {
    setPicks((slots) => slots.map((slot, at) => (at === index ? { ...slot, other: words } : slot)));
  };

  // Which questions have an answer, derived from the slots on every draw and never stored: the map's marks and Send's enabled state both ARE this.
  const answered = picks.map((slot) => answerOf(slot) !== null);
  const ready = answered.every(Boolean);

  // The round as a track, a node a question in the pages' order: `✓` once answered, its place in the round until then.
  const nodes: LaneFlowNode[] = ask.questions.map((_, index) => ({
    key: `q${index}`,
    mark: answered[index] ? '✓' : String(index + 1),
    tone: answered[index] ? 'positive' : 'neutral',
    label: t('dispatcher.flow.question', {
      position: index + 1,
      word: t(answered[index] ? 'dispatcher.flow.answered' : 'dispatcher.flow.unanswered'),
    }),
    live: false,
  }));
  const owing = answered.indexOf(false);

  // Send: every question at once, by its text as the key. Built from the slots of THIS draw, so what travels is exactly what the pages say was chosen.
  const pressSend = () => {
    const answers: Record<string, string> = {};
    ask.questions.forEach((question, index) => {
      const given = answerOf(picks[index]);
      if (given !== null) answers[question.text] = given;
    });
    void answer(ask, answers).then((took) => {
      if (took) onAnswered();
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {questionCount > 1 && (
        <StatusFlow
          nodes={nodes}
          doneCount={answered.filter(Boolean).length}
          selected={nodes[strip.view.index]?.key ?? null}
          current={nodes[owing]?.key ?? null}
          onSelect={(key) => strip.goTo(nodes.findIndex((node) => node.key === key))}
          ariaLabel={t('dispatcher.flow.questions', { plan: ask.plan })}
        />
      )}
      <SnapStrip
        strip={strip}
        handle="ask"
        stripLabel={t('dispatcher.ask.questionsStrip', { plan: ask.plan })}
        itemCount={questionCount}
        previousLabel={t('dispatcher.pager.previousQuestion')}
        nextLabel={t('dispatcher.pager.nextQuestion')}
        viewingLabel={t('dispatcher.pager.question', { n: strip.view.index + 1, total: questionCount })}
      >
        {ask.questions.map((question, index) => (
          <SnapStripItem
            key={`${index}:${question.text}`}
            data-ask-question
            className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-card px-3 py-2"
            {...(index === strip.view.index ? {} : OFF_VIEW)}
          >
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
          </SnapStripItem>
        ))}
      </SnapStrip>

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
