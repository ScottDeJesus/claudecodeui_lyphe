import { useTranslation } from 'react-i18next';

import { DispatchArcControls } from '@/modules/dispatcher/ArcControls';
import { deckFocusIndex, planDismissal, planLayer, planStatusTone, waitsOnSiblings } from '@/modules/dispatcher/dispatcherState';
import { DeckFrame, DeckItem } from '@/modules/dispatcher/DeckFrame';
import type { DispatcherArcGroup } from '@/modules/dispatcher/dispatcherState';
import { PlanCard } from '@/modules/dispatcher/PlanCard';
import { PlannerBadge } from '@/modules/dispatcher/PlannerBadge';
import { SessionPin } from '@/modules/dispatcher/SessionPin';
import { dispatchArcFoldKey } from '@/shared/hooks/useCardFold';
import { spendText } from '@/shared/spend';
import type { DispatcherArcStatus, Tone } from '@/shared/types';
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
 * ONE dispatch arc, drawn as the deck every arc on this screen is drawn as: the arc's own header on
 * top — its name, its word, its books, the goal a designer wrote, and the controls that move the
 * whole arc — and beneath it the plans of that arc in ONE horizontal strip, in the arc's own walk
 * order (`arc.plans`).
 *
 * THE DECK IS THE OPERATOR'S OWN ARC CARD (operator, 2026-09-25: "we have an arc already, layouts
 * should already be there" — "please tell him to do it like the other plans"). The chrome, the fold,
 * the arrows, the snap and the focused card are `DeckFrame`'s, and nothing here invents a second
 * layout: an arc of plans is one shape. What is the dispatcher's own, and what this file adds, is its
 * data (the store's status words, the arc's books) and its cards (`PlanCard`, whole: word, phases,
 * controls and Dismiss, exactly as a plan of no arc has them).
 *
 * THE FOLD TAKES THE STRIP AND THE CONTROLS — the model switch and
 * Stop/Resume are VERBS, and the reader who folded a deck away asked for the row, not for a card that
 * has not collapsed. What stays is the header: which arc this is, its word, its books and how many
 * plans it holds, so a folded deck still says everything but the plans.
 *
 * A FOCUSED CARD IS THE PLAN WHOSE TURN IT IS (`deckFocusIndex`): the first plan of the arc that has
 * not finished, or the last once all of them have. The strip opens on it and returns to it when the
 * arc moves.
 *
 * THE COUNT IS WHAT THE CARD HOLDS, NOT WHAT THE DOCUMENT LISTED. `arc.plans` is the arc file's
 * names, and a plan whose ending the operator has DISMISSED is gone from the strip while still being
 * named there: a caption reading "14 plans" over thirteen cards is the header lying about the deck
 * under it, which is the one thing `RunnerPanel`'s own count refuses to do. So the note counts
 * `plans` — the group's surviving members, which is exactly what the strip drew.
 *
 * `data-dispatch-arc` and `data-arc-name` are the root's handles (with `data-arc-status` and
 * `data-collapsed`, both written by the frame), and `data-dispatch-plan-row` marks one plan's item in
 * the strip with `data-plan-name`, `data-pinned` and `data-arc-layer`, so a probe counts and names
 * what an arc holds without reading through the cards' own handles.
 *
 * Used by `DispatchArcDecks`, once per arc the lane carries.
 */
export function DispatchArcDeck({
  group,
  cardFillsStrip = false,
  pinnedSessionId = null,
  carriedNames,
}: {
  /** The arc and the plans of it, in the arc's own order — one `byArc` group. */
  group: DispatcherArcGroup;
  /** The gutter home's width instead: one whole card per view, paged by the arrows (`DeckFrame`'s own). */
  cardFillsStrip?: boolean;
  /** The open chat's session id, in the gutter home; `null` in the tab, where there is no open chat and so no "mine". */
  pinnedSessionId?: string | null;
  /** The lane's unfiltered plan names, which is what a Dismiss prunes the stored list against (`planDismissal`). */
  carriedNames: string[];
}) {
  const { t } = useTranslation();
  const { arc, plans } = group;
  const title = `${arc.name}.arc`;
  // The arc's own books: the store carries them on the arc row so no header has to add up the cards
  // itself (INV-4299), and `spendText` is the one spelling every card draws a figure in — dollars or
  // tokens by who was used, and NOTHING at all where nothing was billed.
  const spend = spendText(t, arc.cost_usd, arc.tokens_in, arc.tokens_out, arc.tokens);

  return (
    <DeckFrame
      rootAttributes={{ 'data-dispatch-arc': '', 'data-arc-name': arc.name }}
      status={arc.status}
      title={<span data-arc-door className="font-mono">{title}</span>}
      badge={ARC_STATUS[arc.status] ?? ARC_STATUS.designing}
      foldKey={dispatchArcFoldKey(arc.name)}
      // The arc's books ride the title row's tail — the LAST thing on that row to keep a width, never
      // the first to take one: `min-w-0` and no `shrink-0`, so a figure too wide for the row wraps by
      // word rather than pushing the arc's name (or the card's own edge) out of the way. The frame
      // floors and wraps the title itself; this line is the counterpart to that, stated where the
      // figure is produced.
      titleTail={spend
        ? <p data-arc-spend className="min-w-0 self-center font-mono text-xs text-muted-foreground">{spend}</p>
        : null}
      subtitle={arc.planner || arc.goal ? (
        // THE ARC'S OWN LINE, under the row that says which arc this is: who is out on it, and the
        // goal its designer wrote. The badge goes HERE rather than beside the status word because of
        // WIDTH, not because that row cannot wrap: a planner badge is a LONG LINE in a row of marks,
        // and at 390px it would take a row the arc's own name and books are read on. `DeckFrame` wraps
        // that row and floors the title, so nothing would be crushed — the cost is a row's height, and
        // this line is where it is paid. It draws nothing on an arc no planner is on.
        <>
          {arc.planner && <PlannerBadge planner={arc.planner} />}
          {arc.goal && (
            <p className="line-clamp-2 min-w-0 break-words text-xs leading-snug text-muted-foreground">{arc.goal}</p>
          )}
        </>
      ) : null}
      note={<span data-arc-plans>{t('dispatcher.arcPlans', { count: plans.length })}</span>}
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
            cardFillsStrip={cardFillsStrip}
            data-dispatch-plan-row
            data-plan-name={plan.name}
            data-pinned={String(mine)}
            data-arc-layer={layer}
            className={cn('flex flex-col gap-1', layer === 'done' && 'opacity-60')}
          >
            {mine && <SessionPin />}
            <PlanCard plan={plan} waitsOn={waitsOnSiblings(plan, plans)} onDismiss={planDismissal(plan, carriedNames)} />
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
 * (`byArc`), and the two must agree about the width the column takes as much as about which plans sit
 * under which arc. `home` is the one variance — the TAB centring a measured `max-w-2xl` column with
 * its own inset, the GUTTER flush, because the widget card around it already owns the inset, and each
 * card taking the strip's whole width there (`cardFillsStrip`). It is written on the DOM
 * (`data-dispatch-arcs`) so a reading is always taken from ONE home.
 *
 * NOTHING AT ZERO ARCS: an operator with none sees the pane exactly as it was before arcs existed.
 * Nothing here reads the lane either — the caller hands it the split it already has, so a caller that
 * filters its list and one that does not can never draw different decks.
 *
 * Used by `RunnerPanel` (the tab home) and `RunnerWidgetBody` (the gutter), above the plans of no arc.
 */
export function DispatchArcDecks({
  groups,
  home = 'tab',
  pinnedSessionId = null,
  carriedNames,
}: {
  groups: DispatcherArcGroup[];
  home?: 'tab' | 'gutter';
  pinnedSessionId?: string | null;
  carriedNames: string[];
}) {
  if (groups.length === 0) return null;
  return (
    <ul
      data-dispatch-arcs
      className={cn('flex min-w-0 flex-col gap-4',
        home === 'tab' && 'mx-auto w-full max-w-2xl px-4 pt-5')}
    >
      {groups.map((group) => (
        <li key={group.arc.name} className="min-w-0">
          <DispatchArcDeck
            group={group}
            cardFillsStrip={home === 'gutter'}
            pinnedSessionId={pinnedSessionId}
            carriedNames={carriedNames}
          />
        </li>
      ))}
    </ul>
  );
}
