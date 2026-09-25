import { useTranslation } from 'react-i18next';

import { DispatchArcControls } from '@/modules/dispatcher/ArcControls';
import { deckFocusIndex, planDismissal, planLayer, waitsOnSiblings } from '@/modules/dispatcher/dispatcherState';
import type { DispatcherArcGroup } from '@/modules/dispatcher/dispatcherState';
import { PlanCard } from '@/modules/dispatcher/PlanCard';
import { DeckFrame, DeckItem, SessionPin, spendText } from '@/modules/plan-runner';
import { dispatchArcFoldKey } from '@/shared/hooks/useCardFold';
import type { DispatcherArcStatus, Tone } from '@/shared/types';
import { cn } from '@/shared/utils';

/**
 * The arc's own word and tone — `ArcDeck`'s table over the STORE's five words rather than the
 * runner's. The two lanes' arcs are different objects (a runner arc is a deck of minted card plans
 * on disk, a dispatch arc is a row in the store with plans hanging off it), so their status
 * vocabularies are different too, and each lane states its own rather than mapping one onto the
 * other's shape. It lives here, beside the deck that wears it, exactly as the runner's does.
 *
 * `judged` is neutral because a judgment is a fact and not a verdict; `empty` is warn because an arc
 * whose every plan was dropped is the one state an operator did not ask for, and it is the state
 * nothing else on the screen would show.
 */
const ARC_STATUS: Record<DispatcherArcStatus, { key: string; tone: Tone }> = {
  designing: { key: 'dispatcher.arcStatus.designing', tone: 'info' },
  judged: { key: 'dispatcher.arcStatus.judged', tone: 'neutral' },
  live: { key: 'dispatcher.arcStatus.live', tone: 'info' },
  complete: { key: 'dispatcher.arcStatus.complete', tone: 'positive' },
  empty: { key: 'dispatcher.arcStatus.empty', tone: 'warn' },
};

/**
 * ONE dispatch arc, drawn as the deck every arc on this screen is drawn as: the arc's own header on
 * top — its name, its word, its books, the goal a designer wrote, and the controls that move the
 * whole arc — and beneath it the plans of that arc in ONE horizontal strip, in the arc's own walk
 * order (`arc.plans`).
 *
 * THE SAME DECK AS THE RUNNER'S ARCS, AND THAT IS THE POINT (operator, 2026-09-25: "he did not do it
 * properly it is not the same as the other arc card" — "we have an arc already, layouts should
 * already be there" — "please tell him to do it like the other plans"). The chrome, the fold, the
 * arrows, the snap and the focused card are `DeckFrame`'s — the composition `ArcDeck` draws the
 * runner's arcs through — and nothing here invents a second layout: an arc of plans is one shape,
 * whichever lane's plans hang off it. What is the dispatcher's own, and what this file adds, is its
 * data (the store's status words, the arc's books) and its cards (`PlanCard`, whole: pill, word,
 * phases, controls and Dismiss, exactly as a plan of no arc has them).
 *
 * THE FOLD TAKES THE STRIP AND THE CONTROLS, as it does on the runner's deck — the model switch and
 * Stop/Resume are VERBS, and the reader who folded a deck away asked for the row, not for a card that
 * has not collapsed. What stays is the header: which arc this is, its word, its books and how many
 * plans it holds, so a folded deck still says everything but the plans.
 *
 * A FOCUSED CARD IS THE PLAN WHOSE TURN IT IS (`deckFocusIndex`): the first plan of the arc that has
 * not finished, or the last once all of them have. The strip opens on it and returns to it when the
 * arc moves — the runner's deck opens on its live card by the same rule.
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
  /** The gutter home's width instead: one whole card per view, paged by the arrows (`ArcGallery` says why). */
  cardFillsStrip?: boolean;
  /** The open chat's session id, in the gutter home; `null` in the tab, where there is no open chat and so no "mine". */
  pinnedSessionId?: string | null;
  /** The lane's unfiltered plan ids, which is what a Dismiss prunes the stored list against (`planDismissal`). */
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
      titleTail={spend
        ? <p data-arc-spend className="min-w-0 shrink-0 self-center font-mono text-xs text-muted-foreground">{spend}</p>
        : null}
      subtitle={arc.goal
        ? <p className="line-clamp-2 min-w-0 break-words text-xs leading-snug text-muted-foreground">{arc.goal}</p>
        : null}
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
 * under which arc. `home` is the one variance — the run card's two, and `ArcGallery`'s own — the TAB
 * centring a measured `max-w-2xl` column with its own inset, the GUTTER flush, because the widget card
 * around it already owns the inset, and each card taking the strip's whole width there
 * (`cardFillsStrip`). It is written on the DOM (`data-dispatch-arcs`) so a reading is always taken
 * from ONE home.
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
