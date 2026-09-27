import { EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DispatchArcControls } from '@/modules/dispatcher/ArcControls';
import {
  arcHide,
  deckFocusIndex,
  endedHide,
  epochOf,
  planHide,
  planLayer,
  planStatusTone,
  scheduleClock,
  waitsOnSiblings,
} from '@/modules/dispatcher/dispatcherState';
import { DeckFrame, DeckItem } from '@/modules/dispatcher/DeckFrame';
import type { DispatcherArcGroup } from '@/modules/dispatcher/dispatcherState';
import { LaneCardHead } from '@/modules/dispatcher/LaneCardHead';
import { PlanCard } from '@/modules/dispatcher/PlanCard';
import { PlannerBadge } from '@/modules/dispatcher/PlannerBadge';
import { SessionPin } from '@/modules/dispatcher/SessionPin';
import { SpendPills } from '@/modules/dispatcher/SpendPills';
import { dispatchArcFoldKey } from '@/shared/hooks/useCardFold';
import { spendParts } from '@/shared/spend';
import { Badge } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';
import type { DispatcherArcStatus, DispatcherPlanStatus, LaneFlowNode, Tone } from '@/shared/types';
import { cn } from '@/shared/utils';

/**
 * The arc's own word and tone, over the STORE's eight words. A dispatch arc is a row in the store
 * with plans hanging off it, so it states its vocabulary here rather than mapping it onto anything
 * else's shape. It lives beside the deck that wears it.
 *
 * `judged` is neutral because a judgment is a fact and not a verdict; `empty` is warn because an arc
 * whose every plan was dropped is the one state an operator did not ask for, and it is the state
 * nothing else on the screen would show.
 *
 * THE THREE WAITING WORDS WEAR THE PLAN'S OWN TONE, through `planStatusTone` and not a colour of
 * their own: `queued`, `paused` and `scheduled` are the plans' words too (`DispatcherPlanStatus`),
 * read off the arc's plans and printed on the cards in the strip below — a `queued` arc over `queued`
 * cards that were toned differently would be the header arguing with its own deck (`dispatcherState`
 * states that rule once). Every other word here is the arc's alone.
 */
const ARC_STATUS: Record<DispatcherArcStatus, { key: string; tone: Tone }> = {
  designing: { key: 'dispatcher.arcStatus.designing', tone: 'info' },
  judged: { key: 'dispatcher.arcStatus.judged', tone: 'neutral' },
  live: { key: 'dispatcher.arcStatus.live', tone: 'info' },
  complete: { key: 'dispatcher.arcStatus.complete', tone: 'positive' },
  empty: { key: 'dispatcher.arcStatus.empty', tone: 'warn' },
  queued: { key: 'dispatcher.arcStatus.queued', tone: planStatusTone('queued') },
  paused: { key: 'dispatcher.arcStatus.paused', tone: planStatusTone('paused') },
  scheduled: { key: 'dispatcher.arcStatus.scheduled', tone: planStatusTone('scheduled') },
};

/**
 * A plan's mark on the arc's flow, by its status: done, walking, held and armed each have a glyph of
 * their own, and every other plan (queued, parked, idle) is its place in the arc — so the node reads
 * without its colour, and the plans still ahead count off in the order they will walk.
 */
const FLOW_MARK: Partial<Record<DispatcherPlanStatus, string>> = { complete: '✓', live: '▶︎', paused: '⏸︎', scheduled: '◷' };

/**
 * ONE dispatch arc, drawn as the deck every arc on this screen is drawn as, in the lane card's ONE
 * anatomy (`LaneCardHead`, `ActionBar`): the arc's head on top, its action bar directly under it, the
 * arc's flow of plans under that, and beneath it the plans of the arc in the arc's own walk order
 * (`arc.plans`) — ONE CARD PER VIEW in a horizontal strip, in either home (`DeckFrame` → `DeckStrip`).
 *
 * AN ARC'S PLANS ARE SWIPED, NOT WALLED (operator, 2026-09-26: "Can you please bring back the
 * swipable plan cards if it's under an arc, a new plan changed it and I think it's poor design").
 * The tab and the chat gutter draw the arc the same way, so a reader who has paged one has paged the
 * other; only the plans no arc holds keep the tab's wall (`RunnerPanel`).
 *
 * THE FLOW IS ONE NODE A PLAN, in the cards' order: `✓` complete, `▶︎` live (and breathing), `⏸︎`
 * paused, `◷` scheduled, else the plan's place in the arc (`FLOW_MARK`); toned as the plan's own badge
 * is (`planStatusTone`), named `<plan> · <word>`, and filled as far as the arc's complete plans reach.
 *
 * THE HEAD, ROW BY ROW: the arc's door (`<name>.arc`), its word (`ARC_STATUS`), the hour a Schedule
 * start armed (the clock slot, `data-dispatch-arc-schedule-note`) and how many of its plans are
 * complete; then the goal its designer wrote, clamped to two lines, and who is out on it; then its
 * books as pills, counting at first sight (`darc:<name>`). The corner is `⋯` — carrying `Hide ended
 * plans · N` when any plan of the deck has ended — then Hide, which puts EVERY plan of the deck in the
 * `Hidden` list in one write (`arcHide`), then the fold.
 *
 * A FOLD KEEPS THAT WHOLE HEAD (MAN-5412) and takes the bar, the flow and the cards: the model
 * switch and Start/Pause are VERBS, and the reader who folded a deck away asked for the row, not for a
 * card that has not collapsed.
 *
 * THE DECK IS THE OPERATOR'S OWN ARC CARD (operator, 2026-09-25: "we have an arc already, layouts
 * should already be there" — "please tell him to do it like the other plans"). The chrome, the fold,
 * the flow and the strip are `DeckFrame`'s, and nothing here invents a layout of its own: an arc of
 * plans is one shape, in either home. What is the dispatcher's own, and what this file adds, is its
 * data (the store's status words, the arc's books) and its cards (`PlanCard`, whole: word, phases,
 * bar and Hide, exactly as a plan of no arc has them).
 *
 * A FOCUSED CARD IS THE PLAN WHOSE TURN IT IS (`deckFocusIndex`): the first plan of the arc that has
 * not finished, or the last once all of them have. The strip opens on it in either home, and returns
 * to it when the arc moves — so the tab opens an arc on what is walking rather than on card one.
 *
 * THE COUNT IS WHAT THE CARD HOLDS, NOT WHAT THE DOCUMENT LISTED. `arc.plans` is the arc file's
 * names, and a plan the operator has HIDDEN (`hiddenPlans.ts`) is gone from the strip while still
 * being named there: a head reading "13/14" over thirteen cards would be the head lying about the deck
 * under it. So `done/total`, the flow and the strip's `Card N of M` all count `plans` — the group's
 * drawn members, exactly the cards the deck drew.
 *
 * `data-dispatch-arc` and `data-arc-name` are the root's handles (with `data-arc-status` and
 * `data-collapsed`, both written by the frame), and `data-dispatch-plan-row` marks one plan's item in
 * the deck with `data-plan-name`, `data-pinned` and `data-arc-layer`, so a probe counts and names
 * what an arc holds without reading through the cards' own handles.
 *
 * Used by `DispatchArcDecks`, once per arc the lane carries.
 */
export function DispatchArcDeck({
  group,
  pinnedSessionId = null,
  carriedNames,
}: {
  /** The arc and the plans of it, in the arc's own order — one `byArc` group. */
  group: DispatcherArcGroup;
  /** The open chat's session id, in the gutter home; `null` in the tab, where there is no open chat and so no "mine". */
  pinnedSessionId?: string | null;
  /** The lane's unfiltered plan names, which is what a hide prunes the stored list against (`planHide`). */
  carriedNames: string[];
}) {
  const { t } = useTranslation();
  const { arc, plans } = group;
  const title = `${arc.name}.arc`;
  const word = ARC_STATUS[arc.status] ?? ARC_STATUS.designing;
  // The arc's own books: the store carries them on the arc row so no head has to add up the cards
  // itself (INV-4299), and `spendParts` is the one decision every card draws a figure from — dollars
  // or tokens by who was used, and NO pill at all where the arc has neither half.
  const spend = spendParts(arc.cost_usd, arc.tokens_in, arc.tokens_out, arc.tokens);
  // The hour a Schedule start armed, over the arc's stopped plans (`report_arcs.hour`) — the head's
  // clock, so a folded deck still says when it will start. The Cancel that clears it is in the bar.
  const armed = epochOf(arc.schedule);
  const ended = endedHide(plans, carriedNames);
  const doneCount = plans.filter((plan) => plan.status === 'complete').length;
  const nodes: LaneFlowNode[] = plans.map((plan, index) => ({
    key: plan.name,
    mark: FLOW_MARK[plan.status] ?? String(index + 1),
    tone: planStatusTone(plan.status),
    label: t('dispatcher.flow.plan', { name: plan.name, word: t(`dispatcher.status.${plan.status}`) }),
    live: plan.status === 'live',
  }));
  const menuItems: ActionMenuItem[] = ended
    ? [{ key: 'hide-ended', label: t('dispatcher.hideEndedPlans', { count: ended.count }), icon: EyeOff, onSelect: ended.hide }]
    : [];

  return (
    <DeckFrame
      rootAttributes={{ 'data-dispatch-arc': '', 'data-arc-name': arc.name }}
      status={arc.status}
      head={(
        <LaneCardHead
          title={<span data-arc-door className="font-mono">{title}</span>}
          badge={<Badge tone={word.tone} className="shrink-0">{t(word.key)}</Badge>}
          clock={armed !== null ? (
            <span className="flex-none font-mono text-xs text-muted-foreground" data-dispatch-arc-schedule-note>
              {t('runner.schedule.starts', { time: scheduleClock(armed) })}
            </span>
          ) : undefined}
          progress={{ done: doneCount, total: plans.length }}
          lead={(
            <>
              {/* A measure of its own (`max-w-3xl`): the tab's deck spans the wall, and a goal set at
                  that width is two lines of 250 characters no eye can track back across. */}
              {arc.goal && (
                <p className="line-clamp-2 min-w-0 max-w-3xl break-words text-xs leading-snug text-muted-foreground">{arc.goal}</p>
              )}
              {/* Who is out on the arc, under its goal: a planner badge is a LONG LINE, and on row one
                  it would take the room the arc's door and word are read in. Nothing when none is. */}
              {arc.planner && <PlannerBadge planner={arc.planner} />}
            </>
          )}
          spend={spend.paid !== null || spend.tokens !== null
            ? <div data-arc-spend className="min-w-0"><SpendPills parts={spend} countKey={`darc:${arc.name}`} /></div>
            : undefined}
          corner={{ menuLabel: t('dispatcher.menu'), menuItems, onHide: arcHide(plans, carriedNames), hideLabel: t('dispatcher.hideArc') }}
        />
      )}
      foldKey={dispatchArcFoldKey(arc.name)}
      flow={{ nodes, doneCount, ariaLabel: t('dispatcher.flow.arc', { arc: title }) }}
      bodyTop={<DispatchArcControls arc={arc} />}
      stripLabel={t('runner.arcStrip', { title })}
      focusIndex={deckFocusIndex(plans)}
      cardCount={plans.length}
    >
      {plans.map((plan) => {
        const mine = pinnedSessionId !== null && plan.session_app_id === pinnedSessionId;
        const layer = planLayer(plan);
        return (
          <DeckItem
            key={plan.name}
            data-dispatch-plan-row
            data-plan-name={plan.name}
            data-pinned={String(mine)}
            data-arc-layer={layer}
            className={cn('flex flex-col gap-1', layer === 'done' && 'opacity-60')}
          >
            {mine && <SessionPin />}
            <PlanCard plan={plan} waitsOn={waitsOnSiblings(plan, plans)} onHide={planHide(plan, carriedNames)} headingLevel={4} />
          </DeckItem>
        );
      })}
    </DeckFrame>
  );
}

/**
 * Every dispatch arc the lane carries, one deck each, one under another — and each deck holding the
 * plans of its own arc.
 *
 * ONE DECK FOR EACH ARC, IN EITHER HOME, and that is why this exists rather than a map at each call
 * site: the Runner tab and the chat gutter's Runner widget draw the same arcs from the same split
 * (`byArc`), and the two must agree about which plans sit under which arc. AN ARC IS ONE SHAPE IN
 * BOTH HOMES — its plans in a strip, one card per view — so `home` no longer picks a layout and
 * decides nothing but the width each home gives the deck: the tab's scroll body spans the pane and
 * the widget's card is a column a card wide, and NEITHER deck carries an inset of its own, because
 * those two already own it. The home is still written on the DOM (`data-dispatch-arcs`) so a reading
 * is always taken from ONE home.
 *
 * THE DECKS STACK AT `gap-6`, wider than the cards' own `gap-4` inside a deck, so where one arc ends
 * and the next begins is read from the spacing before any head is read.
 *
 * NOTHING AT ZERO ARCS: an operator with none sees the pane exactly as it was before arcs existed.
 * Nothing here reads the lane either — the caller hands it the split it already has, so a caller that
 * filters its list and one that does not can never draw different decks.
 *
 * Used by `RunnerPanel` (the tab home), above the plans of no arc, and by `WidgetPager` (the gutter),
 * one arc per page (`groups={[group]}`).
 */
export function DispatchArcDecks({
  groups,
  home = 'tab',
  pinnedSessionId = null,
  carriedNames,
}: {
  groups: DispatcherArcGroup[];
  /** Which home is drawing these decks. It changes no layout — an arc is drawn the same in both — and exists to write `data-dispatch-arcs`, so a probe always reads ONE home's decks and never both. */
  home?: 'tab' | 'gutter';
  pinnedSessionId?: string | null;
  carriedNames: string[];
}) {
  if (groups.length === 0) return null;
  return (
    <ul data-dispatch-arcs={home} className="flex min-w-0 flex-col gap-6">
      {groups.map((group) => (
        <li key={group.arc.name} className="min-w-0">
          <DispatchArcDeck
            group={group}
            pinnedSessionId={pinnedSessionId}
            carriedNames={carriedNames}
          />
        </li>
      ))}
    </ul>
  );
}
