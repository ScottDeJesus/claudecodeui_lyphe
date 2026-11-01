import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { LOCK_DRAFT } from '@/modules/dispatcher/askDrafts';
import { askIdentity, lockOptions } from '@/modules/dispatcher/askState';
import { useAskDraft } from '@/modules/dispatcher/hooks/useAskDraft';
import { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
import { QuestionText } from '@/modules/chat';
import type { DispatcherAsk, LockCompose } from '@/shared/types';
import { Button } from '@/shared/ui';

/** The lock this form answers: `DispatcherAsk` narrowed to its Accept kind — the shape `lockOptions` takes, and the only one a lock's card is drawn from. */
type LockAsk = Extract<DispatcherAsk, { kind: 'accept' }>;

/** Every press of the form: 32 px at a desk, a 44 px catch under a finger (`finger:` — a touch screen, or a window under 768 px; the touch law). */
const PRESS = 'h-8 finger:h-11';

/** A lock with nothing typed: the three answers showing, no notes. */
const BLANK_LOCK: LockCompose = { rework: false, notes: '' };

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
 * description as its `title`, so what a press does is readable before it is made: Queue records the
 * verdict and puts the run in the queue, where it starts when its turn comes; Hide records it and keeps
 * the run hidden and not started until he Shows it; Rework sends the operator's notes to the plan's
 * designer and launches nothing. They are one row of one weight in three variants — primary,
 * secondary, outline — so the press that starts work reads strongest and the one that sends words
 * back reads quietest.
 *
 * WHERE NOTHING HOVERS, THE DESCRIPTIONS STAND IN WORDS (`[@media(hover:none)]`, the touch law: nothing is said
 * only on hover). Under the three, inside the same group, one muted line per answer is led by its label and says what
 * the press does; a pointer sees none of them and keeps the `title`. The lines are `aria-hidden`: the `title` is
 * already each button's description for a screen reader, which would otherwise hear every answer twice.
 *
 * THE THREE ARE A GROUP THE KEYBOARD CAN LAND ON (`data-ask-answers`, `tabIndex={-1}`, `role="group"`, named by the
 * census region above it). The station's Accept lands the keyboard there and never on Queue itself, so a second
 * Enter after the one that opened the card presses nothing and approves nothing: Queue is one Tab away, and the
 * press that approves is one he chose after the census was in front of him (the lock law).
 *
 * UNDER A FINGER every press is 44 px (`finger:h-11`: a touch screen, or a window under 768 px), the notes'
 * Send and Cancel with them; at a desk with a mouse they keep their 32 px.
 *
 * REWORK IS A FIELD, NOT A PRESS. It swaps the three for a notes textarea — the one answer that
 * carries words — and `Send notes` stays disabled until those words exist, so no Rework is ever sent
 * empty. `Cancel` gives the three back with the notes still in them: a reader who cancelled to
 * re-read the census has not untyped what he wrote, and the form is kept mounted across a fold for
 * that same reason (`PlanAsk` hides it rather than unmounting it).
 *
 * THE NOTES ARE KEPT AS A DRAFT (operator: "Plan card answers to questions should save"). Whether the
 * notes field is open and what is in it are a draft in the `dispatcher` preference (`askDrafts.ts`,
 * through `useAskDraft`), so a reload, the other surface or an unmounted widget gives the field back
 * open, with the notes in it, and nothing focused. A draft is never sent by itself: every send is the
 * operator's press, and a TAKEN answer — any of the three — clears it.
 *
 * `busy` IS READ, NEVER GUESSED: every control THAT LEADS TO A SEND — Queue, Hide, Rework and
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
  // four controls below that lead to it being sent (Queue, Hide, Rework, Send notes) each read it,
  // so two presses racing at the same store cannot approve the plan twice.
  const busy = carrying === 'answer';

  // Whether the three answers have given way to the notes field, and the notes exactly as typed. Essential: a Rework is the one answer that cannot be sent without words, `rework` is the whole of what swaps the controls, and the notes are its payload — sent to the plan's designer word for word. They live above the swap, so Cancel and a fold of the card both leave them where the operator wrote them, and they are a draft in the preference too (`useAskDraft`), which is why they come back after a reload.
  const { state: compose, edit, clear: clearDraft, scopeRef } = useAskDraft(askIdentity(ask), BLANK_LOCK, LOCK_DRAFT);
  const { rework, notes } = compose;

  // The census region's id. Essential: it is what names the answers' group (`aria-labelledby`), so the keyboard landing on the group is told which prompt's answers they are, in the region's own words (`ask.header`).
  const censusId = useId();

  // What every press does with the lane's word: a TAKEN answer ends the ask, so its draft goes and the card is marked answered; a refusal changes nothing and the prompt stands beside the toast that says why.
  const settle = (took: boolean) => {
    if (!took) return;
    clearDraft();
    onAnswered();
  };

  // Queue, in one press: the lock's own label as the answer to its one question — the verdict is
  // recorded and the run joins the queue, starting when its turn comes.
  const pressQueue = () => {
    void answer(ask, { [ask.question]: options.queue.label }).then(settle);
  };

  // Hide: the same press with the hide label — the verdict is recorded and the run is held hidden.
  const pressHide = () => {
    void answer(ask, { [ask.question]: options.hide.label }).then(settle);
  };

  // Send notes: Rework's own label, with the words typed above it, by that same one question. The
  // notes travel TRIMMED and under the same key the labels do: the census is what the token pins, and
  // a leading newline is not a word the operator meant to send.
  const pressSendNotes = () => {
    void answer(ask, { [ask.question]: options.rework.label }, { [ask.question]: notes.trim() }).then(settle);
  };

  return (
    <div ref={scopeRef} className="flex min-w-0 flex-col gap-2">
      <div
        id={censusId}
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
            onChange={(event) => {
              const words = event.target.value;
              edit((current) => ({ ...current, notes: words }));
            }}
            placeholder={t('dispatcher.ask.notes')}
            aria-label={t('dispatcher.ask.notes')}
            className="vv-input w-full resize-y px-3 py-2 text-sm"
          />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              data-ask-send
              type="button"
              size="sm"
              className={PRESS}
              disabled={busy || notes.trim().length === 0}
              onClick={pressSendNotes}
            >
              {t('dispatcher.ask.sendNotes')}
            </Button>
            <Button type="button" variant="ghost" size="sm" className={PRESS} onClick={() => edit((current) => ({ ...current, rework: false }))}>
              {t('dispatcher.ask.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div
          data-ask-answers
          role="group"
          aria-labelledby={censusId}
          tabIndex={-1}
          className="flex min-w-0 flex-col gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              data-ask-queue
              type="button"
              size="sm"
              className={PRESS}
              title={options.queue.description}
              disabled={busy}
              onClick={pressQueue}
            >
              {options.queue.label}
            </Button>
            <Button
              data-ask-hide
              type="button"
              variant="secondary"
              size="sm"
              className={PRESS}
              title={options.hide.description}
              disabled={busy}
              onClick={pressHide}
            >
              {options.hide.label}
            </Button>
            <Button
              data-ask-rework
              type="button"
              variant="outline"
              size="sm"
              className={PRESS}
              title={options.rework.description}
              disabled={busy}
              onClick={() => edit((current) => ({ ...current, rework: true }))}
            >
              {options.rework.label}
            </Button>
          </div>
          <div aria-hidden="true" data-ask-answer-words className="hidden min-w-0 flex-col gap-1 [@media(hover:none)]:flex">
            {[options.queue, options.hide, options.rework].map((option) => (
              <p key={option.label} className="text-xs leading-snug text-muted-foreground">
                <span className="font-medium text-foreground">{option.label}</span>{' · '}{option.description}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
