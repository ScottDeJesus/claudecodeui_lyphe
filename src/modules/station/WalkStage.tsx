import { ArrowLeft, ArrowRight, Check, Mic, X } from 'lucide-react';
import { useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useCompanion } from '@/modules/companion';
import { useStationSessions } from '@/modules/station/context/StationSessionsContext';
import { StageGone, StageReadFailed } from '@/modules/station/stageStates';
import { useKeepFocusWhenGone } from '@/modules/station/hooks/useKeepFocusWhenGone';
import { refusalMessage } from '@/modules/station/stageRefusal';
import { StageFoot, StageHeadActions } from '@/modules/station/stageSlots';
import type { CompanionWalk } from '@/shared/companion-types';
import { useToast } from '@/shared/context/ToastContext';
import type { StationFocus } from '@/shared/station-types';
import { Button, Card, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** Her walkthrough on the stage: there is one per account, so the focus names nothing but its label. */
type WalkFocus = Extract<StationFocus, { kind: 'walk' }>;

type WalkStageViewProps = {
  /** The walk as her picture holds it: undefined until her picture has been read, null once it has and no walk is held. */
  walk: CompanionWalk | null | undefined;
  /** Set while her picture has not been read because the read FAILED: the stage says so and offers `onRetry`, in place of waiting. Absent for a read still out. */
  readFailed?: { onRetry: () => void } | null;
  /** The chat it walks, by the name he knows it by: the walk's own accessible name. */
  sessionName: string;
  /** Back, pressed (or ←): the item before. Refused at the first. */
  onBack: () => void;
  /** Next, pressed (or →): the item after, or the first while it has not begun. Refused at the last. */
  onNext: () => void;
  /** End the walkthrough, pressed: the walk ended for her too. */
  onEnd: () => void;
};

/** Where an item of the list stands against the walk's place: behind it, at it, or still ahead. */
type ItemState = 'done' | 'current' | 'ahead';

/** Each item's row by where it stands: a done one checked and dimmed, the current one lit and named, the rest plain. */
const ITEM_ROW: Record<ItemState, string> = {
  done: 'text-muted-foreground',
  current: 'bg-accent-soft font-medium text-foreground',
  ahead: 'text-foreground',
};

/** A field the arrow keys belong to: typing there never moves the walk. */
const TEXT_FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** Whether a keydown is the plain arrow it takes to move the walk: no modifier held, not typed into a text field, not already handled. */
function isPlainArrow(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  return !(event.target instanceof Element && event.target.closest(TEXT_FIELD) !== null);
}

/**
 * HER WALKTHROUGH ON THE STAGE: "a walkthrough (N of M with next/back)". The stage's head names it ("Walkthrough" over the
 * chat it walks), and "End the walkthrough" stands in that head (`StageHeadActions`), named in words beside the stage's ✕,
 * which only clears the stage and leaves her walk where it is.
 *
 * WHERE IT STANDS FIRST, in a card: "Item 4 of 15" in the display serif, the item's words large under it, and how to answer:
 * "Say “next”, or answer this one". A walk set up and not begun (`at` 0) reads "Not begun", and Next begins it.
 *
 * THE WHOLE LIST under it, every item numbered: a done one checked and dimmed, the current one lit with its arrow and named
 * "Now" in words (`aria-current="step"`: never the tint alone, MAN-578), the rest plain.
 *
 * BACK AND NEXT at the stage's foot (`StageFoot`) in every tier: halves of the foot on a narrow stage, so a thumb reaches
 * either on a phone, where the foot sticks to the screen's bottom while the walk is in view; at the foot's two ends on a stage
 * 40rem wide or more. Each refuses the press at its end (`aria-disabled`, which keeps the keyboard where it was) and names its
 * key, ← and →, which move it too while the keyboard is inside the walk. No swipe: on a phone the browser's own edge swipe is
 * Back. A press tells her nothing until his next word, which carries the stage's `<view kind="walk">`.
 *
 * While her picture has not been read, a quiet "Reading her walkthrough…" waits, and a read that failed says so with a Try again
 * (`StageReadFailed`) rather than wait for ever; with no walk held, "The walkthrough ended" (`StageGone`), where the keyboard
 * that pressed End stays. `data-station-walk` reads `walking`, `reading`, `failed` or `ended`. A pure view: `WalkStage` below binds it, and
 * `.verify/kaylee-station-shots.mjs` draws it on `fake/cards.ts`'s walk at item 4 of 15.
 */
export function WalkStageView({ walk, readFailed = null, sessionName, onBack, onNext, onEnd }: WalkStageViewProps) {
  const { t } = useTranslation();
  const listId = useId();
  // The ended line's box, which takes the keyboard when the walk ends while End had it (`useKeepFocusWhenGone`).
  const endedRef = useRef<HTMLDivElement>(null);
  useKeepFocusWhenGone(walk !== undefined && walk !== null, endedRef);

  if (walk === undefined) {
    if (readFailed !== null) {
      return (
        <div data-station-walk="failed">
          <StageReadFailed kind="walk" title={t('station.cards.walk.readFailed', { defaultValue: 'Her walkthrough could not be read just now.' })} onRetry={readFailed.onRetry} />
        </div>
      );
    }
    return (
      <div data-station-walk="reading" className="grid place-items-center py-10">
        <Spinner size={32} label={t('station.cards.walk.reading', { defaultValue: 'Reading her walkthrough…' })} />
      </div>
    );
  }
  if (walk === null) {
    return (
      <div ref={endedRef} tabIndex={-1} data-station-walk="ended" className="outline-none">
        <StageGone focus={{ kind: 'walk', label: sessionName }} />
      </div>
    );
  }

  const total = walk.items.length;
  const begun = walk.at >= 1 && walk.at <= total;
  const stateOf = (n: number): ItemState => (begun && n < walk.at ? 'done' : begun && n === walk.at ? 'current' : 'ahead');
  // The two ends of the walk: Back has nothing before the first (or before it has begun), Next nothing after the last.
  const backRefused = !begun || walk.at <= 1;
  const nextRefused = walk.at >= total;
  // ← and →, while the keyboard is inside the walk. A refused end leaves the key alone, so the browser's own arrow still scrolls.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isPlainArrow(event)) return;
    if (event.key === 'ArrowLeft' && !backRefused) {
      event.preventDefault();
      onBack();
    } else if (event.key === 'ArrowRight' && !nextRefused) {
      event.preventDefault();
      onNext();
    }
  };

  return (
    <div
      role="group"
      tabIndex={-1}
      data-station-walk="walking"
      data-station-walk-at={walk.at}
      aria-label={t('station.cards.walk.label', { name: sessionName, defaultValue: 'The walkthrough of {{name}}' })}
      onKeyDown={onKeyDown}
      className="flex min-w-0 flex-col gap-5"
    >
      <StageHeadActions>
        <Button variant="outline" size="sm" data-station-walk-end="" className="finger:h-11" onClick={onEnd}>
          <X aria-hidden="true" />
          {t('station.cards.walk.end', { defaultValue: 'End the walkthrough' })}
        </Button>
      </StageHeadActions>

      <Card data-station-walk-now="" className="flex min-w-0 flex-col gap-3 p-4 lg:p-5">
        <p data-station-walk-place="" className="font-serif text-[30px] leading-none text-foreground md:text-[34px]">
          {begun
            ? t('station.cards.walk.place', { at: walk.at, total, defaultValue: 'Item {{at}} of {{total}}' })
            : t('station.cards.walk.notBegun', { defaultValue: 'Not begun' })}
        </p>
        {begun ? (
          <p data-station-walk-words="" className="break-words text-xl font-medium leading-snug text-foreground">
            {walk.items[walk.at - 1]}
          </p>
        ) : (
          <p className="text-base text-muted-foreground">
            {t('station.cards.walk.waiting', { count: total, defaultValue_one: '{{count}} item, waiting to begin', defaultValue_other: '{{count}} items, waiting to begin' })}
          </p>
        )}
        <p data-station-walk-say="" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Mic aria-hidden="true" className="size-4 shrink-0" />
          {begun
            ? t('station.cards.walk.say', { defaultValue: 'Say “next”, or answer this one' })
            : t('station.cards.walk.sayBegin', { defaultValue: 'Say “next”, or press Next, to begin' })}
        </p>
      </Card>

      <section aria-labelledby={listId} className="flex min-w-0 flex-col gap-1.5">
        <h3 id={listId} className="px-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {t('station.cards.walk.items', { count: total, defaultValue_one: '{{count}} item', defaultValue_other: 'All {{count}} items' })}
        </h3>
        <ol data-station-walk-list="" className="flex min-w-0 flex-col">
          {walk.items.map((item, index) => {
            const state = stateOf(index + 1);
            return (
              <li
                key={index}
                data-walk-item={state}
                aria-current={state === 'current' ? 'step' : undefined}
                className={cn('flex min-w-0 items-start gap-2.5 rounded-lg px-2 py-2 text-[15px] leading-snug', ITEM_ROW[state])}
              >
                <span aria-hidden="true" className="flex h-5 w-4 shrink-0 items-center justify-center">
                  {state === 'done' && <Check className="size-4" />}
                  {state === 'current' && <ArrowRight className="size-4 text-accent-ink" />}
                </span>
                <span className="w-6 shrink-0 text-right tabular-nums">{`${index + 1}.`}</span>
                <span className="min-w-0 flex-1 break-words">
                  {item}
                  {state === 'done' && <span className="sr-only">{t('station.cards.walk.doneWord', { defaultValue: ', done' })}</span>}
                </span>
                {state === 'current' && (
                  <span className="shrink-0 pt-0.5 text-xs font-medium uppercase tracking-[0.14em] text-accent-ink">
                    {t('station.cards.walk.now', { defaultValue: 'Now' })}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <StageFoot>
        <div data-station-walk-moves="" className="grid grid-cols-2 gap-2 [@container(min-width:40rem)]:flex [@container(min-width:40rem)]:justify-between">
          <Button variant="outline" data-station-walk-back="" aria-disabled={backRefused} aria-keyshortcuts="ArrowLeft" className="finger:h-11" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            {t('station.cards.walk.back', { defaultValue: 'Back' })}
          </Button>
          <Button data-station-walk-next="" aria-disabled={nextRefused} aria-keyshortcuts="ArrowRight" className="finger:h-11" onClick={onNext}>
            {t('station.cards.walk.next', { defaultValue: 'Next' })}
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </StageFoot>
    </div>
  );
}

/**
 * Her walkthrough's stage on the page, registered for the `walk` kind in `stageViews.ts`, drawn by `StationStage`: it reads the
 * one walk her picture holds and binds his Back, Next and End to the same cursor her `walk` tool moves (MAN-9061: one walk per
 * account, held in her store), and hands them to `WalkStageView`, which draws every state. A press tells her nothing: the
 * frame her store sends redraws every page, and she hears where the walk stands from the shell's `<view kind="walk">` on his
 * next word. A walk ended or replaced elsewhere is redrawn from her picture.
 */
export function WalkStage({ focus }: { focus: WalkFocus }) {
  const { t } = useTranslation();
  const pushToast = useToast();
  const { picture, readFailure, reread, moveWalk, endWalk } = useCompanion();
  const { sessions } = useStationSessions();

  // undefined while her picture has not been read (the view waits); null once it has and no walk is held (ended or replaced
  // elsewhere: this redraws from it, so the stage says so).
  const walk = picture === null ? undefined : picture.walk;
  // His sessions' name for the chat now, else the name the walk was set up with, else the label the stage was given.
  const sessionName = (walk ? sessions?.find((session) => session.sessionId === walk.session.sessionId)?.name || walk.session.name : '') || focus.label;

  // His press moves the held walk through the same cursor her tool calls (MAN-9061: one walk per account). A refusal is the walk
  // tool's own sentence, said in a toast; the walk keeps standing where it was.
  const move = (at: number) => {
    moveWalk(at).catch((error: unknown) => {
      pushToast({ tone: 'warn', title: t('station.cards.walk.refused', { defaultValue: 'The walkthrough did not move' }), message: refusalMessage(error) });
    });
  };

  return (
    <WalkStageView
      walk={walk}
      // Her picture is null and its read failed: the stage says so with a Try again (`reread`) instead of waiting on it.
      readFailed={picture === null && readFailure !== null ? { onRetry: reread } : null}
      sessionName={sessionName}
      onBack={() => { if (walk && walk.at > 1) move(walk.at - 1); }}
      // At 0 the walk is set up and not begun: Next begins it.
      onNext={() => { if (walk && walk.at < walk.items.length) move(walk.at + 1); }}
      onEnd={() => {
        endWalk().catch((error: unknown) => {
          pushToast({ tone: 'warn', title: t('station.cards.walk.endRefused', { defaultValue: 'The walkthrough did not end' }), message: refusalMessage(error) });
        });
      }}
    />
  );
}
