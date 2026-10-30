import { useId, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { byArc, DispatchArcDecks, PlanCard, usePutAway, useDispatcherPlans, waitsOnSiblings } from '@/modules/dispatcher';
import { EpicPanel, FeatureFacts, RoadmapDialogHost, useRoadmap, useRoadmapCard } from '@/modules/roadmap';
import { useStation } from '@/modules/station/context/StationContext';
import { labelOf } from '@/modules/station/cardLabel';
import { StageGone } from '@/modules/station/FocusFallback';
import type { RoadmapEpic, RoadmapFeature, RoadmapPicture } from '@/shared/roadmap-types';
import type { StationFocus } from '@/shared/station-types';
import type { DispatcherArcGroup, DispatcherPlan, RoadmapDotState } from '@/shared/types';
import { Card, CardContent, Spinner } from '@/shared/ui';

/** A feature (plan) or an epic (arc) on the stage, by name. */
type CardFocus = Extract<StationFocus, { kind: 'card' }>;

/**
 * What the house holds of the card's name, in the order the stage looks for it. `plan`: the dispatcher's plan of that
 * name, with the names of its own arc it waits on. `arc`: the dispatcher's arc of that name, as its one group of the
 * lane's split, with the lane's carried names its deck prunes its put-away store against. `feature` and `epic`: the
 * roadmap's of that name, when the dispatcher holds neither (the feature with the picture its waits are named from and
 * its Cases section's body, null when it keeps no case; the epic with its milestone's 1-based place and every
 * feature's dot state). `loading`: the lane's picture or the roadmap's has not landed, so whether the card is there
 * is not known yet. `gone`: neither holds it.
 */
type CardFound =
  | { kind: 'loading' }
  | { kind: 'plan'; plan: DispatcherPlan; waitsOn: string[] }
  | { kind: 'arc'; group: DispatcherArcGroup; carriedNames: string[] }
  | { kind: 'feature'; feature: RoadmapFeature; picture: RoadmapPicture | null; cases: ReactNode }
  | { kind: 'epic'; epic: RoadmapEpic; n: number; dots: ReadonlyMap<string, RoadmapDotState> }
  | { kind: 'gone' };

type CardStageViewProps = {
  focus: CardFocus;
  found: CardFound;
  /** The plan card's corner: Hide, or Dismiss for a complete plan. */
  onPutAway: () => void;
  /** The feature's empty goal, pressed (an idea with no goal yet): the goal opened for writing. */
  onWriteGoal: () => void;
  /** A feature's row in the epic's panel, pressed: that feature takes the stage. */
  onSelectFeature: (name: string) => void;
};

/**
 * A FEATURE OR AN EPIC ON THE STAGE, drawn by its owners and never redrawn here:
 *
 * - a plan the dispatcher holds is the dispatcher's own `PlanCard`, its ask on it: an Accept with Queue, Hide and
 *   Rework by the card's own lock form, a round by its round form — one answer form, the dispatcher's, so what is
 *   answered here is exactly what the Roadmap tab would answer;
 * - an epic the dispatcher holds is its deck, alone (`DispatchArcDecks` over that one arc's group), its one lock drawn
 *   once on the deck;
 * - a feature or an epic the dispatcher no longer holds is the roadmap's own facts of it: `FeatureFacts` (the feature
 *   dialog's body) in a card, or `EpicPanel` in the frame the tree's panel gives it;
 * - a name neither holds is its "no longer on the roadmap" line (`StageGone`), and while the pictures have not landed
 *   a quiet "Looking for …" waits instead, so a stage restored on a reload never says gone of a card it has not
 *   looked for.
 *
 * `data-station-card` reads which of the six it drew. A pure view: `CardStage` below binds it. Drawn on the stage by
 * `StationStage` for a `card` focus (registered in `stageViews.ts`), and by `.verify/kaylee-station-shots.mjs` for the
 * `waiting` and `home` pictures.
 */
export function CardStageView({ focus, found, onPutAway, onWriteGoal, onSelectFeature }: CardStageViewProps) {
  const { t } = useTranslation();
  // The epic panel's heading id: its frame is named by it, as the tree's panel names it.
  const headingId = useId();

  switch (found.kind) {
    case 'loading':
      return (
        <div data-station-card="loading" className="grid place-items-center py-10">
          <Spinner size={32} label={t('station.card.looking', { label: focus.label, defaultValue: 'Looking for {{label}}…' })} />
        </div>
      );
    case 'plan':
      return (
        <div data-station-card="plan" className="min-w-0">
          <PlanCard plan={found.plan} waitsOn={found.waitsOn} onPutAway={onPutAway} />
        </div>
      );
    case 'arc':
      return (
        <div data-station-card="arc" className="min-w-0">
          <DispatchArcDecks groups={[found.group]} carriedNames={found.carriedNames} />
        </div>
      );
    case 'feature':
      return (
        <Card data-station-card="feature" className="min-w-0">
          <CardContent className="p-4 lg:p-5">
            <FeatureFacts feature={found.feature} picture={found.picture} onWriteGoal={onWriteGoal} cases={found.cases} />
          </CardContent>
        </Card>
      );
    case 'epic':
      return (
        <Card data-station-card="epic" role="region" aria-labelledby={headingId} className="min-w-0">
          <div className="flex min-w-0 flex-col gap-3 px-4 py-3.5">
            <EpicPanel
              epic={found.epic}
              n={found.n}
              dots={found.dots}
              headingId={headingId}
              onSelect={(selection) => { if (selection.kind === 'feature') onSelectFeature(selection.name); }}
            />
          </div>
        </Card>
      );
    case 'gone':
      return <StageGone focus={focus} />;
  }
}

/** A press that has nothing to do for this kind of card (a deck puts itself away; the roadmap's facts have no corner). */
const NO_PRESS = () => {};

/** The card order the operator saved matters among many cards and not within one arc's deck, so the split for the one arc is given none. */
const NO_RANKS: ReadonlyMap<string, number> = new Map();

/**
 * The card stage on the page: registered for the `card` kind in `stageViews.ts`, drawn by `StationStage`. It finds
 * the card's name in the dispatcher's lane and the roadmap's picture and binds the presses, and hands them to
 * `CardStageView`, which draws every state.
 *
 * THE VIEW STANDS IN THE ROADMAP'S DIALOG HOST (`RoadmapDialogHost`), so the roadmap's own facts keep their own
 * presses on the station: an epic's ⋯ menu and its Add a feature open the roadmap's dialogs over the page, and a
 * feature's empty goal opens the roadmap's goal editor. The station edits the roadmap exactly as the Roadmap tab does,
 * through the same dialogs; it draws no editor of its own.
 */
export function CardStage({ focus }: { focus: CardFocus }) {
  const { setFocus } = useStation();
  const { plans, hidden, arcs, carriedNames, route } = useDispatcherPlans();
  const { picture } = useRoadmap();
  const putAway = usePutAway(carriedNames);

  // What the dispatcher holds of the name: a plan (hidden ones too: the card shows its Show), else an arc, as its one group.
  const held = useMemo<CardFound | null>(() => {
    const plan = plans.find((item) => item.name === focus.plan) ?? hidden.find((item) => item.name === focus.plan);
    if (plan !== undefined) {
      const members = plan.arc === null ? [] : plans.filter((item) => item.arc === plan.arc);
      return { kind: 'plan', plan, waitsOn: waitsOnSiblings(plan, members) };
    }
    const arc = arcs.find((item) => item.name === focus.plan);
    if (arc === undefined) return null;
    const split = byArc(plans.filter((item) => item.arc === arc.name), [arc], NO_RANKS);
    const card = split.cards.find((item) => item.kind === 'arc');
    return card?.kind === 'arc' ? { kind: 'arc', group: card.group, carriedNames } : null;
  }, [plans, hidden, arcs, carriedNames, focus.plan]);

  // `route` is null until the lane's first picture has landed (a landed picture always states one): until then the
  // dispatcher's silence means nothing, so the roadmap is not asked either, or a reload would show a feature's facts for
  // a moment and then its plan card. The roadmap is asked only for a name the dispatcher does not hold.
  const laneLanded = route !== null;
  const facts = useRoadmapCard(laneLanded && held === null ? focus.plan : null);

  const found: CardFound = held
    ?? (!laneLanded || facts === undefined ? { kind: 'loading' } : facts === null ? { kind: 'gone' } : facts);

  return (
    <RoadmapDialogHost
      // A roadmap dialog's Open its card or Answer on its card, the dialog already closed: that card takes the stage.
      onOpenCard={(plan) => setFocus({ kind: 'card', plan, label: labelOf(picture, plan) })}
    >
      {({ writeGoal }) => (
        <CardStageView
          focus={focus}
          found={found}
          onPutAway={found.kind === 'plan' ? putAway.plan(found.plan) : NO_PRESS}
          onWriteGoal={() => { if (found.kind === 'feature') writeGoal(found.feature); }}
          onSelectFeature={(name) => setFocus({ kind: 'card', plan: name, label: labelOf(picture, name) })}
        />
      )}
    </RoadmapDialogHost>
  );
}
