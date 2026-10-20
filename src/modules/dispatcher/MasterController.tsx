import { useTranslation } from 'react-i18next';

import { HouseSwitch } from '@/modules/dispatcher/HouseSwitch';
import { useBoardVerbs } from '@/modules/dispatcher/hooks/useBoardVerbs';
import { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
import { PaceLine } from '@/modules/dispatcher/PaceLine';
import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * THE MASTER CONTROLLER — In flight's whole header of controls, in one place (operator, 2026-10-15: "a
 * master controller … everything should be moved up as a single controller"). READ LEFT TO RIGHT:
 *
 * - **Claude · DeepSeek** — the features switch (`HouseSwitch`), the dispatcher's own, apart from the chat's.
 *   Epics and features with no model word of their own follow it.
 * - **Start** — drawn ONLY while a plan waits for its first Start (`route.waiting`, the dispatcher's own count
 *   of what `dispatcher start` reaches): an approval joins the queue by itself, so what waits is what the operator
 *   held back with a Stop on a feature that was waiting its turn. It lets every one of them go at once, and the
 *   queue's order and Pause all then decide what runs. A HIDDEN plan is never counted or reached — Show is its
 *   press. A feature's own Start (on its card) is the override that skips both.
 * - **Pause all** / **Resume all** and the running readout. The queue runs top down with no limit above it: an
 *   epic not started starts when every epic above it has started or cannot start.
 * - **The pacer's line** — the dispatcher's own sentence (`route.pace.words`) beside them, one unbreakable piece in
 *   the same wrapping row: what the pacer is doing, in the gate's words, never the board's. No picture, no line.
 *
 * FITS HIS PHONE AND THE CHAT GUTTER'S NARROW COLUMN: every control is one unbreakable piece (`flex-none`) in a
 * wrapping row, so a narrow header wraps BETWEEN controls and never inside one — an Android Fold folded or open,
 * and the Runs widget's column, which is as narrow as 300px.
 *
 * DRAWN FROM THE FRAME AND NEVER GUESSED (`route.epics`, `route.waiting`, `route.pace`): every figure and
 * every sentence is the dispatcher's, read at one instant. NOT DRAWN when the frame carries no `epics` (a
 * dispatcher older than the census), and the pace line alone when it carries no `pace` or no words. NOTHING
 * OPTIMISTIC: a press relays a word and the next frame redraws; while one is out the controls it could race
 * refuse a second.
 *
 * PAUSED READS IN INK, NEVER IN A TONE (a pause is the operator's own press, and amber is the house's error
 * tone, MAN-577): the readout takes the foreground's ink and weight while it lasts, and Resume all wears the fill
 * a Start does — the way out is the press the eye lands on.
 *
 * Handles: `data-master-controller` (the group) with `data-master-paused` and `data-master-waiting`;
 * `data-master-start`; `data-master-readout`; `data-master-pause` valued with the word the press sends
 * (`pause` or `resume`).
 *
 * ONE COMPONENT, TWO MOUNTS, ONE FRAME: a press in either place is the same press, and both draw from the same
 * `useDispatcherPlans` picture, so a choice made in one is the other's next render.
 *
 * Used by `RunnerPanel` (runner-tab), as the second row of In flight's header, and by `RunnerWidgetBody` (runner-tab),
 * at the top of the chat gutter's Runs widget — the controls live with the decks they order (MAN-642).
 */
export function MasterController({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { route } = useDispatcherPlans();
  const pace = route?.pace ?? null;
  const epics = route?.epics ?? null;
  const waiting = route?.waiting ?? 0;

  // The wires: the board's presses (`dispatcher epics <word>`, `dispatcher start`) and the flag that
  // refuses a second while one is out. Everything below them is composition.
  const { setDial, start, busy } = useBoardVerbs();

  if (epics === null) return null;
  const pauseWord = epics.paused ? 'resume' : 'pause';

  return (
    <div
      role="group"
      aria-label={t('dispatcher.master.label')}
      data-master-controller=""
      data-master-paused={String(epics.paused)}
      data-master-waiting={String(waiting)}
      className={cn('flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2', className)}
    >
      <HouseSwitch />
      {waiting > 0 && (
        <Button
          size="sm"
          className="h-8 flex-none"
          busy={busy}
          title={t('dispatcher.master.startTitle', { count: waiting })}
          onClick={() => void start()}
          data-master-start=""
        >
          {t('runner.start')} <span className="tabular-nums">· {waiting}</span>
        </Button>
      )}
      <Button
        variant={epics.paused ? 'default' : 'secondary'}
        size="sm"
        className="h-8 flex-none"
        busy={busy}
        onClick={() => void setDial(pauseWord)}
        data-master-pause={pauseWord}
      >
        {t(epics.paused ? 'dispatcher.epics.resume' : 'dispatcher.epics.pause')}
      </Button>
      <span
        data-master-readout=""
        className={cn('flex-none whitespace-nowrap pb-1.5 text-xs tabular-nums', epics.paused ? 'font-medium text-foreground' : 'text-muted-foreground')}
      >
        {epics.paused
          ? t('dispatcher.epics.paused')
          : t('dispatcher.epics.count', { running: epics.running })}
      </span>
      <PaceLine pace={pace} />
    </div>
  );
}
