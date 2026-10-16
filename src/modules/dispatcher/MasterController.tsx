import { useTranslation } from 'react-i18next';

import { HouseSwitch } from '@/modules/dispatcher/HouseSwitch';
import { useBoardVerbs } from '@/modules/dispatcher/hooks/useBoardVerbs';
import { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
import { useWipDefaultsVerbs } from '@/modules/dispatcher/hooks/useWipDefaultsVerbs';
import { LabeledPick } from '@/modules/dispatcher/LabeledPick';
import { useDeepSeekFlashSwitch } from '@/shared/hooks/useDeepSeekFlashSwitch';
import { Button } from '@/shared/ui';
import type { DispatcherEpicsWord, DispatcherWipLimit } from '@/shared/types';
import { cn, wipCountOfWord, wipLadderTop, wipLadderWords } from '@/shared/utils';

/** The five limits the epic dial takes (`epic_dial.LIMITS`), as the dropdown lists them. There is no `All`: the dial is 1 to 5. */
const EPIC_LIMITS = ['1', '2', '3', '4', '5'] as const;

/** The order the two WIP defaults are drawn in, which is the order the dispatcher prints them. */
const WIP_LIMITS: readonly DispatcherWipLimit[] = ['features', 'tasks'];

/**
 * THE MASTER CONTROLLER — In flight's whole header of controls, in one place (operator, 2026-10-15: "a
 * master controller … everything should be moved up as a single controller"). READ LEFT TO RIGHT:
 *
 * - **Epics at once** — a dropdown, 1 to 5, the queue's dial (`dispatcher epics <N>`): how many epics run at
 *   once, top down. An absent file reads 1, so the queue holds an epic that has not started behind one in
 *   progress. There is no "All".
 * - **Features at once** and **Tasks at once** — dropdowns over the WIP ladder, 1 … 6 and All (and any wider
 *   count in play), writing the DEFAULTS every epic follows (`PUT /api/settings/wip`, `useWipDefaultsVerbs`).
 *   They moved here from Settings. An epic's own words are its fold's overrides.
 * - **Claude · DeepSeek** — the house switch (`HouseSwitch`), the very one Settings and the chat box draw. Epics
 *   and features with no model word of their own follow it.
 * - **Start** — drawn ONLY while a plan waits for its first Start (`route.waiting`, the dispatcher's own count
 *   of what `dispatcher start` reaches): an approval joins the queue by itself, so what waits is what the operator
 *   held back with a Stop on a feature that was waiting its turn. It lets every one of them go at once, and the
 *   queue's order and the dial then decide what runs. A HIDDEN plan is never counted or reached — Show is its
 *   press. A feature's own Start (on its card) is the override that skips both.
 * - **Pause all** / **Resume all** and the running readout.
 *
 * WHILE THE DEEPSEEK SWITCH IS ON the two WIP dropdowns show All and are dimmed, with one line under the
 * controls saying why: DeepSeek work runs with no feature or task limit unless an epic sets its own
 * (operator, 2026-10-04: "DeepSeek should default all always"), so a dropdown reading 2 would claim a limit that
 * is not in force. Their numbers are the Claude defaults, editable the moment the switch is off.
 *
 * FITS HIS PHONE AND THE CHAT GUTTER'S NARROW COLUMN: every control is one unbreakable piece (`flex-none`) in a
 * wrapping row, so a narrow header wraps BETWEEN controls and never inside one — an Android Fold folded or open,
 * and the Runs widget's column, which is as narrow as 300px. A dropdown's list is drawn on `body` (the kit `Select`'s
 * one behaviour), so neither the widget's scroller nor a phone's edge clips it, wherever its control wrapped to.
 *
 * DRAWN FROM THE FRAME AND NEVER GUESSED (`route.epics`, `route.wip`, `route.waiting`): every figure is the
 * dispatcher's, read at one instant. NOT DRAWN when the frame carries no `epics` (a dispatcher older than the
 * dial). NOTHING OPTIMISTIC: a press relays a word and the next frame redraws; while one is out the controls it
 * could race refuse a second.
 *
 * PAUSED READS IN INK, NEVER IN A TONE (a pause is the operator's own press, and amber is the house's error
 * tone, MAN-577): the readout takes the foreground's ink and weight while it lasts, and Resume all wears the fill
 * a Start does — the way out is the press the eye lands on.
 *
 * Handles: `data-master-controller` (the group) with `data-master-limit`, `data-master-paused` and
 * `data-master-waiting`; `data-master-epics`, `data-master-wip-features` and `data-master-wip-tasks` on the
 * three dropdowns; `data-master-note` on the DeepSeek line; `data-master-start`; `data-master-readout`;
 * `data-master-pause` valued with the word the press sends (`pause` or `resume`).
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
  const epics = route?.epics ?? null;
  const defaults = route?.wip;
  const waiting = route?.waiting ?? 0;
  const { enabled: deepseekOn } = useDeepSeekFlashSwitch();

  // The wires: the board's presses (`dispatcher epics <word>`, `dispatcher start`) and the WIP defaults' one press,
  // each with the flag that refuses a second while one is out. Everything below them is composition.
  const { setDial, start, busy } = useBoardVerbs();
  const { setLimit, busy: wipBusy } = useWipDefaultsVerbs();

  if (epics === null) return null;
  const deepseek = deepseekOn === true;
  const pauseWord = epics.paused ? 'resume' : 'pause';
  const allWord = t('dispatcher.wip.all');

  return (
    <div
      role="group"
      aria-label={t('dispatcher.master.label')}
      data-master-controller=""
      data-master-limit={epics.limit}
      data-master-paused={String(epics.paused)}
      data-master-waiting={String(waiting)}
      className={cn('flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2', className)}
    >
      <LabeledPick
        label={t('dispatcher.epics.label')}
        hint={t('dispatcher.epics.hint')}
        options={EPIC_LIMITS.map((word) => ({ value: word, label: word }))}
        value={epics.limit}
        disabled={busy}
        width="w-20"
        handle="data-master-epics"
        onChoose={(word) => { if (word !== epics.limit) void setDial(word as DispatcherEpicsWord); }}
      />
      {defaults && WIP_LIMITS.map((limit) => {
        const word = deepseek ? 'all' : defaults[limit];
        const options = wipLadderWords(wipLadderTop(wipCountOfWord(defaults[limit]))).map((rung) => ({ value: rung, label: rung === 'all' ? allWord : rung }));
        return (
          <LabeledPick
            key={limit}
            label={t(`dispatcher.master.wip.${limit}`)}
            hint={t(deepseek ? 'dispatcher.master.noteDeepseek' : `dispatcher.master.wip.${limit}Hint`)}
            options={options}
            value={word}
            disabled={wipBusy || deepseek}
            width="w-20"

            handle={`data-master-wip-${limit}`}
            onChoose={(rung) => { if (rung !== defaults[limit]) void setLimit(limit, rung); }}
          />
        );
      })}
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
        {epics.paused ? t('dispatcher.epics.paused') : t('dispatcher.epics.running', { running: epics.running, limit: epics.limit })}
      </span>
      {deepseek && (
        <p data-master-note="" className="m-0 basis-full text-xs text-muted-foreground">
          {t('dispatcher.master.noteDeepseek')}
        </p>
      )}
    </div>
  );
}
