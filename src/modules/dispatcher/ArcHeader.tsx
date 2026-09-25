import { useTranslation } from 'react-i18next';

import { useDispatcherArcModel } from '@/modules/dispatcher/hooks/useDispatcherArcModel';
import { RunModelControl } from '@/modules/plan-runner';
import { Badge } from '@/shared/ui';
import type { DispatcherArc, DispatcherArcStatus, Tone } from '@/shared/types';
import { cn, effectiveModelWord } from '@/shared/utils';

/**
 * The arc's own word and tone — `ArcDeck`'s table over the STORE's five words rather than the
 * runner's. The two lanes' arcs are different objects (a runner arc is a deck of minted card plans
 * on disk, a dispatch arc is a row in the store with plans hanging off it), so their status
 * vocabularies are different too, and each lane states its own rather than mapping one onto the
 * other's shape.
 *
 * `judged` is neutral because a judgment is a fact and not a verdict; `empty` is warn because an arc
 * whose every plan was dropped is the one state an operator did not ask for, and it is the state
 * nothing else on the screen would show.
 */
const STATUS: Record<DispatcherArcStatus, { key: string; tone: Tone }> = {
  designing: { key: 'dispatcher.arcStatus.designing', tone: 'info' },
  judged: { key: 'dispatcher.arcStatus.judged', tone: 'neutral' },
  live: { key: 'dispatcher.arcStatus.live', tone: 'info' },
  complete: { key: 'dispatcher.arcStatus.complete', tone: 'positive' },
  empty: { key: 'dispatcher.arcStatus.empty', tone: 'warn' },
};

/**
 * ONE dispatch arc, as a header over the plans of it — `<name>.arc`, its own word, its plan count,
 * and the DeepSeek · Claude · Chat switch for the arc's ONE model word.
 *
 * THE SWITCH IS THE REASON THIS EXISTS. A plan card carries its own control, and a plan may say
 * anything it likes; the arc's word is the one that reaches EVERY plan of it, because
 * `dispatcher model <arc> <word>` copies it onto each of them (`store.set_arc_model`). So the header
 * is the operator's answer to "all of it, from here on", and a plan that presses its own word
 * afterwards speaks for itself until the arc presses again.
 *
 * NOTHING IS INVENTED AND NOTHING IS COUNTED HERE. The plan count is the names the store listed
 * (`store.arc_plans`'s order, which is the arc file's), and the control draws `arc.model` — the
 * ARC's own word, never a plan's effective one. A record with no word — or a frame from an older
 * server — reads the runner's default (`effectiveModelWord`), which is what its plans would run on.
 *
 * `data-dispatch-arc`, `data-arc-name` and `data-arc-status` are the browser harness's handles, on
 * the ROOT so a probe scopes every reading and every press to ONE arc — the operator's own arcs walk
 * beside a probe's and must never be pressed.
 *
 * Used by `DispatchArcHeaders`, one per arc the lane carries.
 */
export function DispatchArcHeader({ arc }: { arc: DispatcherArc }) {
  const { t } = useTranslation();
  const { setModel, busy } = useDispatcherArcModel(arc.name);
  const status = STATUS[arc.status] ?? STATUS.designing;

  return (
    <section
      data-dispatch-arc
      data-arc-name={arc.name}
      data-arc-status={arc.status}
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-muted/40 p-3"
    >
      <div className="flex min-w-0 items-start gap-2">
        <h4 className="min-w-0 flex-1 break-words font-mono text-sm leading-snug" data-arc-door>
          {`${arc.name}.arc`}
        </h4>
        <Badge tone={status.tone} className="shrink-0">{t(status.key)}</Badge>
      </div>
      {arc.goal && (
        <p className="line-clamp-2 min-w-0 break-words text-xs leading-snug text-muted-foreground">{arc.goal}</p>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="min-w-0 text-xs text-muted-foreground" data-arc-plans>
          {t('dispatcher.arcPlans', { count: arc.plans.length })}
        </p>
        <div className="ml-auto">
          <RunModelControl scope="dispatch-arc" value={effectiveModelWord(arc.model)} busy={busy}
            onChoose={(choice) => void setModel(choice)} />
        </div>
      </div>
    </section>
  );
}

/**
 * Every arc the lane carries, in the order the store listed them (oldest first), above the plan cards
 * they speak for.
 *
 * ONE HOME FOR EACH ARC, HOWEVER MANY CARDS IT HAS. A dispatch arc's plans are drawn in the SAME
 * urgency-ordered list as every other plan — they are not gathered under their arc, and that is the
 * plans list's own rule, not this component's business — so the header stands above the list rather
 * than over its own cards. That is the honest shape for a control that reaches every one of them: a
 * header wedged between two cards would claim a grouping the list does not have.
 *
 * ONE LIST, TWO HOMES, and `home` is its one variance — the run card's two, and `ArcGallery`'s own,
 * whose `home` this mirrors so the dispatcher's headers and the runner's decks stand in the same two
 * places with the same widths. The home is written on the DOM (`data-dispatch-arcs`), so a reading
 * is always taken from ONE home.
 *
 * Nothing here reads the lane: the caller hands it the arcs it already has (`useDispatcherPlans`),
 * so a caller that filters the list and one that does not can never draw different headers.
 */
export function DispatchArcHeaders({ arcs, home = 'tab' }: { arcs: DispatcherArc[]; home?: 'tab' | 'gutter' }) {
  if (arcs.length === 0) return null;
  return (
    <ul
      data-dispatch-arcs
      className={cn('flex min-w-0 flex-col gap-3',
        home === 'tab' && 'mx-auto w-full max-w-2xl px-4 pt-5')}
    >
      {arcs.map((arc) => (
        <li key={arc.name} className="min-w-0">
          <DispatchArcHeader arc={arc} />
        </li>
      ))}
    </ul>
  );
}
