import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lockOptions } from '@/modules/dispatcher/askState';
import { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
import { QuestionText } from '@/modules/chat';
import type { DispatcherAsk } from '@/shared/types';
import { Button } from '@/shared/ui';

/** The lock this form answers: `DispatcherAsk` narrowed to its Accept kind — the shape `lockOptions` takes, and the only one a lock's card is drawn from. */
type LockAsk = Extract<DispatcherAsk, { kind: 'accept' }>;

/**
 * A LOCK'S ANSWER FORM — the census a plan's Accept prompt prints, whole, and the three words under it.
 *
 * THE CENSUS IS DRAWN WHOLE, EVERY TIME, IN ONE BOUNDED REGION. `ask.question` is what
 * `dispatcher question <plan>` printed, and its last line pins it (`Run it? · lock:<digest>`): the
 * token is the digest of exactly what the operator was shown, `dispatcher accept --lock` re-checks it
 * against the store, and a stale one approves NOTHING (MAN-7400). So this card may not shorten the
 * prompt — no clamp, no excerpt, no summary — because whatever is on the card IS what the press
 * approves. It is bounded instead: `max-h-[50dvh]` with its own scrollbar, focusable
 * (`tabIndex={0}`) so the whole of it can be read from the keyboard, and a `region` named for the
 * lock's own header, so a screen reader hears which prompt it is inside before the words.
 *
 * THE THREE TAKE ONE PRESS EACH, AND THEIR LABELS ARE VERBATIM. `lockOptions(ask)` is
 * `intent_lock.OPTIONS`' three, in contract order, and the label IS the word sent back as the answer
 * — a prettified one would be an answer the prompt never offered. Each button carries its own
 * description as its `title`, so what a press does is readable before it is made: Accept records the
 * verdict and launches the runner, Queue records it and brings the run up parked, Rework sends the
 * operator's notes to the plan's designer and launches nothing. They are one row of one weight in
 * three variants — primary, secondary, outline — so the press that starts work reads strongest and
 * the one that sends words back reads quietest.
 *
 * REWORK IS A FIELD, NOT A PRESS. It swaps the three for a notes textarea — the one answer that
 * carries words — and `Send notes` stays disabled until those words exist, so no Rework is ever sent
 * empty. `Cancel` gives the three back with the notes still in them: a reader who cancelled to
 * re-read the census has not untyped what he wrote, and the form is kept mounted across a fold for
 * that same reason (`PlanAsk` hides it rather than unmounting it).
 *
 * `busy` IS READ, NEVER GUESSED: every control THAT LEADS TO A SEND — Accept, Queue, Rework and
 * Send notes — refuses a press while the lane is carrying one, because a lock is ONE word, and two
 * presses racing at the same store is how a plan is approved twice. The two compose-only controls,
 * the notes field and Cancel, stay live on purpose: neither puts anything on the wire, and gating
 * them would take the caret out of the hand of the operator mid-sentence for no gain.
 *
 * Used by `PlanAsk`, as the form its lock branch draws; nothing else mounts it.
 */
export function LockAnswer({ ask, onAnswered }: { ask: LockAsk; onAnswered: () => void }) {
  const { t } = useTranslation();
  const options = lockOptions(ask);
  // The lane's own door for this plan — the card's presses go through no route of their own — and
  // whichever verb it is carrying, read below as one fact about THIS form.
  const { answer, busy: carrying } = useDispatcherVerbs(ask.plan);

  // Whether the lane is carrying this plan's answer right now. Essential: a lock is ONE word, and the
  // four controls below that lead to it being sent (Accept, Queue, Rework, Send notes) each read it,
  // so two presses racing at the same store cannot approve the plan twice.
  const busy = carrying === 'answer';

  // Whether the three answers have given way to the notes field. Essential: a Rework is the one answer that cannot be sent without words, and this is the whole of what swaps the controls.
  const [rework, setRework] = useState(false);

  // The notes, exactly as typed. Essential: they are a Rework's payload — sent to the plan's designer word for word — and they live here, above the swap, so Cancel and a fold of the card both leave them where the operator wrote them.
  const [notes, setNotes] = useState('');

  // Accept, in one press: the lock's own label as the answer to its one question.
  const pressAccept = () => {
    void answer(ask, { [ask.question]: options.accept.label }).then((took) => {
      if (took) onAnswered();
    });
  };

  // Queue: the same press with the queue label — the verdict is recorded and the run comes up parked.
  const pressQueue = () => {
    void answer(ask, { [ask.question]: options.queue.label }).then((took) => {
      if (took) onAnswered();
    });
  };

  // Send notes: Rework's own label, with the words typed above it, by that same one question. The
  // notes travel TRIMMED and under the same key the labels do: the census is what the token pins, and
  // a leading newline is not a word the operator meant to send.
  const pressSendNotes = () => {
    void answer(ask, { [ask.question]: options.rework.label }, { [ask.question]: notes.trim() }).then((took) => {
      if (took) onAnswered();
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div
        data-ask-region
        role="region"
        aria-label={ask.header}
        tabIndex={0}
        className="scrollbar-thin max-h-[50dvh] min-h-0 overflow-y-auto overscroll-contain rounded-md border border-border bg-card px-3 py-2"
      >
        <QuestionText text={ask.question} />
      </div>

      {rework ? (
        <div className="flex min-w-0 flex-col gap-2">
          <textarea
            data-ask-notes
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t('dispatcher.ask.notes')}
            aria-label={t('dispatcher.ask.notes')}
            className="vv-input w-full resize-y px-3 py-2 text-sm"
          />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              data-ask-send
              type="button"
              size="sm"
              className="h-8"
              disabled={busy || notes.trim().length === 0}
              onClick={pressSendNotes}
            >
              {t('dispatcher.ask.sendNotes')}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setRework(false)}>
              {t('dispatcher.ask.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            data-ask-accept
            type="button"
            size="sm"
            className="h-8"
            title={options.accept.description}
            disabled={busy}
            onClick={pressAccept}
          >
            {options.accept.label}
          </Button>
          <Button
            data-ask-queue
            type="button"
            variant="secondary"
            size="sm"
            className="h-8"
            title={options.queue.description}
            disabled={busy}
            onClick={pressQueue}
          >
            {options.queue.label}
          </Button>
          <Button
            data-ask-rework
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            title={options.rework.description}
            disabled={busy}
            onClick={() => setRework(true)}
          >
            {options.rework.label}
          </Button>
        </div>
      )}
    </div>
  );
}
