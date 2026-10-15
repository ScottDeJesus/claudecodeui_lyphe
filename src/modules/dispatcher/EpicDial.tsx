import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
import { Button, Stepper } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * The dial's ladder, low to high, spelled as the dispatcher's grammar spells it (`dispatcher epics <word>`):
 * a press steps one rung, so `−` takes All to 5 and stops at 1, and `+` takes 5 to All and stops there.
 * `all` is the no-limit walk the house had before the dial, and what an absent flag reads.
 */
const RUNGS = ['1', '2', '3', '4', '5', 'all'] as const;

/** One rung of the dial: a limit word a press sends. */
type EpicDialRung = (typeof RUNGS)[number];

/** Where a limit word stands on the ladder. A word off it reads as the top, All, which is the dial's own default. */
function rungIndex(limit: string): number {
  const at = RUNGS.indexOf(limit as EpicDialRung);
  return at === -1 ? RUNGS.length - 1 : at;
}

/**
 * EPICS AT ONCE — the queue's dial, in In flight's header: how many epics of the queue run at once,
 * top down, and the one press that pauses them all (operator, 2026-10-14: "just like we have feature
 * concurrency, and task concurrency, I want epic concurrency").
 *
 * ONE LINE, READ LEFT TO RIGHT: the label (its title says what the dial does), a compact `Stepper` over
 * 1..5 and All, how full the queue is, and Pause all — or, while paused, Resume all. The label and the
 * stepper are one unbreakable pair and so are the readout and the press, so a header too narrow for the
 * whole dial breaks it between the two halves and never inside one: at a phone's width it takes a line of
 * its own whole, and only the paused readout, the longest, sends its half under the stepper. The label is
 * semibold, as the epic's WIP label is (`EpicWipControl`), so it opens a group of its own after the planner
 * readout's muted phrase instead of running on from it.
 *
 * DRAWN FROM THE FRAME AND NEVER GUESSED (`route.epics`, `line_gate.census`): the limit, the pause and how
 * many epics have started are one document's three figures, read at one instant, so the readout cannot
 * say `1 of 2` off a limit read a poll apart from the count. `running` above the limit is a true reading
 * the moment after the dial is lowered, since an epic that has started runs till its turn ends.
 * NOT DRAWN when the frame carries no `epics`: a dispatcher build older than the dial sends none.
 *
 * NOTHING OPTIMISTIC: a press relays a word and the next frame redraws the dial. While a press is out
 * all three refuse a second one (`busy`), so two words never race to the flag.
 *
 * PAUSED IS THE ONE STATE IT PAINTS. A board-wide pause holds every new start on every deck below, and
 * nothing else on the screen says so, so the readout wears `warn` while it lasts and Resume all wears
 * the fill a Start does (`ArcControls`): the way out is the press the eye lands on. Pause all is
 * `secondary`, as an epic's own Pause is.
 *
 * Handles: `data-epic-dial` (the group) with `data-epic-dial-limit` (the word in force) and
 * `data-epic-dial-paused`; `data-epic-dial-readout`; `data-epic-dial-pause`, valued with the word the
 * press sends (`pause` or `resume`).
 *
 * Used by `RunnerPanel` (runner-tab), in In flight's header beside the planner readout — nothing renders
 * over the transcript (MAN-642), so the dial lives with the decks it orders.
 */
export function EpicDial({ className }: { className?: string }) {
  const { t } = useTranslation();
  const labelId = useId();
  const { route } = useDispatcherPlans();
  const epics = route?.epics ?? null;

  // ── The wires: the dial's three presses (`dispatcher epics <word>`) and the flag that refuses them while
  //    one is out. Everything below them is composition. ──
  const busy = false; // FILL: busy
  const onDown = (_word: EpicDialRung): void => {}; // FILL: onDown
  const onUp = (_word: EpicDialRung): void => {}; // FILL: onUp
  const onPause = (_word: 'pause' | 'resume'): void => {}; // FILL: onPause

  if (epics === null) return null;
  const at = rungIndex(epics.limit);
  const down = at > 0 ? RUNGS[at - 1] : null;
  const up = at < RUNGS.length - 1 ? RUNGS[at + 1] : null;
  const unlimited = RUNGS[at] === 'all';
  const readout = epics.paused
    ? t('dispatcher.epics.paused')
    : unlimited
      ? t('dispatcher.epics.runningAll', { running: epics.running })
      : t('dispatcher.epics.running', { running: epics.running, limit: epics.limit });
  const pauseWord = epics.paused ? 'resume' : 'pause';

  return (
    // `-my-0.5`: the 32px stepper and press sit in the header's 28px line, so the header keeps one height
    // whether or not the frame states a dial — the rule `Dismiss done · N` keeps beside it.
    <div
      role="group"
      aria-labelledby={labelId}
      data-epic-dial=""
      data-epic-dial-limit={epics.limit}
      data-epic-dial-paused={String(epics.paused)}
      className={cn('-my-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', className)}
    >
      <span className="inline-flex flex-none items-center gap-1.5">
        <span id={labelId} className="whitespace-nowrap text-xs font-semibold text-muted-foreground" title={t('dispatcher.epics.hint')}>
          {t('dispatcher.epics.label')}
        </span>
        <Stepper
          compact
          value={unlimited ? t('dispatcher.epics.all') : epics.limit}
          onDecrease={() => { if (down !== null && !busy) onDown(down); }}
          onIncrease={() => { if (up !== null && !busy) onUp(up); }}
          canDecrease={!busy && down !== null}
          canIncrease={!busy && up !== null}
          decreaseLabel={t('dispatcher.epics.down')}
          increaseLabel={t('dispatcher.epics.up')}
          ariaLabel={t('dispatcher.epics.label')}
        />
      </span>
      <span className="inline-flex flex-none items-center gap-2">
        <span
          data-epic-dial-readout=""
          data-tone={epics.paused ? 'warn' : undefined}
          className={cn('whitespace-nowrap text-xs tabular-nums', epics.paused ? 'font-medium text-tone-ink' : 'text-muted-foreground')}
        >
          {readout}
        </span>
        <Button
          variant={epics.paused ? 'default' : 'secondary'}
          size="sm"
          className="h-8"
          busy={busy}
          onClick={() => onPause(pauseWord)}
          data-epic-dial-pause={pauseWord}
        >
          {t(epics.paused ? 'dispatcher.epics.resume' : 'dispatcher.epics.pause')}
        </Button>
      </span>
    </div>
  );
}
