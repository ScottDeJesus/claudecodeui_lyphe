import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { askHeadline, askIdentity } from '@/modules/dispatcher/askState';
import { LockAnswer } from '@/modules/dispatcher/LockAnswer';
import { RoundAnswer } from '@/modules/dispatcher/RoundAnswer';
import type { DispatcherAsk } from '@/shared/types';
import { Badge } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * The amber pulse dot a waiting head line opens with — the sidebar's own mark for a folder that is
 * waiting on the operator (`SidebarSimpleFolderRow`, `awaitingInput`), at this head's size. Decorative
 * and `aria-hidden`: the words beside it are the signal, and a mark the eye reads must not also be a
 * second thing a screen reader has to announce.
 */
function AskDot() {
  return (
    <span aria-hidden="true" className="vv-pulse flex h-4 w-4 flex-shrink-0 items-center justify-center">
      <span className="h-2 w-2 rounded-full bg-warn-ink" />
    </span>
  );
}

/**
 * The head line every waiting state of the card wears: the amber pulse, the plan's own state word, and
 * a neutral badge naming WHAT is being asked — a lock's own header, a round's plan. Drawn inside the
 * folded bar's button as well as above the open form, so it is built of phrasing content only (the
 * badge is a `span`): a `div` inside a `button` is a content model that only renders by accident.
 *
 * `ml-auto` parks the badge at the far edge: on a phone that is the second half of the head's own row,
 * and the state word truncates before the name of the thing being asked does.
 */
function AskWaitingLine({ badge }: { badge: string }) {
  const { t } = useTranslation();

  return (
    <span className="flex min-w-0 items-center gap-2">
      <AskDot />
      <span className="min-w-0 truncate text-xs font-medium text-warn-ink">{t('dispatcher.ask.waiting')}</span>
      <Badge as="span" tone="neutral" className="vv-badge--compact ml-auto flex-shrink-0 uppercase tracking-wider">
        {badge}
      </Badge>
    </span>
  );
}

/**
 * THE HEAD LINE OF AN ANSWERED CARD: the same dot, and the word that the answer is in and the
 * dispatcher has not moved yet. NO CONTROLS — the ask is answered, and a form left standing beside it
 * is a form the operator can answer a second time.
 *
 * Exported because it is a whole state of this card and nothing else draws it: `.verify`'s scaffold
 * fixtures mount it directly, which is how the answered card is photographed without answering a real
 * ask. The amber does not change colour here — the wait has not ended, only moved — and the dot and
 * the words say it together, so a greyscale reading keeps the state.
 */
export function AskAnsweredLine() {
  const { t } = useTranslation();

  return (
    <span className="flex min-w-0 items-center gap-2">
      <AskDot />
      <span className="min-w-0 truncate text-xs font-medium text-warn-ink">{t('dispatcher.ask.answered')}</span>
    </span>
  );
}

/**
 * THE PROMPT THE PLAN IS WAITING ON, drawn on the card as one band — from the first frame the store
 * carries an ask until the frame that stops carrying it.
 *
 * A FOLD KEEPS THE ASK (MAN-5412). Folded, the whole band is ONE button: the waiting head line, the
 * prompt's own first line (`askHeadline`, the census's first line for a lock, the first question's for a
 * round) truncated to the one line a bar has room for, and the word that pressing it opens the card
 * again. Nothing is answered from the bar — it is a door, not a form.
 *
 * AN OWED ANSWER IS NEVER LOST TO A FOLD. The form stays MOUNTED and goes `hidden` — `display:none`,
 * not shown-but-clipped, because a clip leaves every control in the tab order and in the accessibility
 * tree (the reason `CardFoldBody` exists). A reader who folded the card away mid-note finds the note
 * where he left it; the band does not keep its own copy of anything the form holds, and the form is
 * keyed by the ask's identity (`askIdentity`) so a DIFFERENT ask starts empty rather than inheriting
 * the last one's words.
 *
 * THREE STATES, ONE ROOT. `data-ask-state` reads `folded`, `open` or `answered` off the root, beside
 * `data-ask-kind` and `data-ask-plan`, so a probe reads which shape the band is in without guessing
 * from paint. The state is `answered` only once the dispatcher took the answer; a refusal leaves the
 * band where the fold put it, beside the toast that says why.
 *
 * IT TAKES NO FOCUS AND BINDS NOTHING: nothing here calls `focus()` on mount — a card that grabs the
 * caret takes it from whatever the reader was doing when the lane moved — and no key is bound outside
 * the controls' own press. The only thing in the band that ever takes focus on its own is the `Other…`
 * field a press opened (`RoundAnswer`), and that press means "I am typing".
 *
 * The form itself is `LockAnswer` or `RoundAnswer`, by the ask's kind, and each carries its own press
 * handlers. Mounted by `PlanCard` under the head and by `DeckFrame`'s `asks` slot above its strip, one
 * `PlanAsk` per open ask.
 */
export function PlanAsk({ ask, folded, onUnfold }: { ask: DispatcherAsk; folded: boolean; onUnfold: () => void }) {
  const { t } = useTranslation();

  // Whether THIS ask's answer was TAKEN — set by the form's `onAnswered`, which fires only on a `true`
  // from `useDispatcherVerbs(ask.plan).answer`. Essential: an answered card must withdraw the controls
  // it was answered through, and this is the whole of what swaps the head line. It is the ASK's, not
  // the plan's, which is why it needs no clearing: the caller keys this component by `askIdentity`, so
  // this state dies with the ask the frame drops and a new ask mounts a fresh one. A refusal — a 409,
  // or a 503 while the store cannot be read — leaves it `false`, and the prompt stands beside the
  // toast that says why.
  const [answered, setAnswered] = useState(false);

  // What the root reports: the answer's own outcome first, then the fold the caller handed down. Not state — derived on every draw, so the band can never sit in a shape its two inputs do not say.
  const state = answered ? 'answered' : folded ? 'folded' : 'open';

  // What the badge names: a lock's own header ("Intent lock"), a round's plan — the round carries no header of its own, and the plan is what a round is about.
  const badge = ask.kind === 'accept' ? ask.header : ask.plan;

  // What a folded bar reads as the prompt: the ask's own first line, never a summary of it.
  const headline = askHeadline(ask);

  return (
    <div
      data-plan-ask
      data-ask-kind={ask.kind}
      data-ask-plan={ask.plan}
      data-ask-state={state}
      className="flex min-w-0 flex-col rounded-lg border border-warn-ink/30 bg-muted/40"
    >
      {answered ? (
        // The band stays drawn, one line, so the card that was waiting on the operator says what became
        // of his word instead of snapping back to a card with no sign it ever asked.
        <div className="flex min-w-0 items-center px-3 py-3">
          <AskAnsweredLine />
        </div>
      ) : (
        <>
          {folded ? (
            <button
              type="button"
              data-ask-bar
              onClick={onUnfold}
              className="flex w-full min-w-0 flex-col gap-1 rounded-lg p-3 text-left transition-colors duration-quick hover:bg-muted/60"
            >
              <AskWaitingLine badge={badge} />
              <span className="flex min-w-0 items-center gap-2">
                <span data-ask-headline className="min-w-0 truncate text-xs text-muted-foreground">{headline}</span>
                <span className="ml-auto flex-shrink-0 text-xs font-medium text-accent-ink">{t('dispatcher.ask.open')}</span>
              </span>
            </button>
          ) : (
            <div className="flex min-w-0 flex-col px-3 pt-3">
              <AskWaitingLine badge={badge} />
            </div>
          )}

          {/* MOUNTED AND HIDDEN, NEVER UNMOUNTED: a fold takes the form off the screen and leaves it
              standing, so a half-typed note is where its author left it when the card comes back.
              `hidden` is `display:none` — the controls leave the tab order and the accessibility tree
              with it, which is what a clip would not do. The key is the ask's own identity: the same
              ask folded and unfolded is one form, a different ask starts empty. */}
          <div
            key={askIdentity(ask)}
            data-ask-form
            className={cn('min-w-0 flex-col px-3 pb-3 pt-3', folded ? 'hidden' : 'flex')}
          >
            {ask.kind === 'accept' ? (
              <LockAnswer ask={ask} onAnswered={() => setAnswered(true)} />
            ) : (
              <RoundAnswer ask={ask} onAnswered={() => setAnswered(true)} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
