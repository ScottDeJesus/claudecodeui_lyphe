import { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RoadmapPath } from '@/modules/roadmap/RoadmapPath';
import { RunnerPanel } from '@/modules/runner-tab';
import { Spinner, Tabs } from '@/shared/ui';

/** The tab's two faces: the roadmap as a path to its goal, and the live cards of what is in flight. */
type Face = 'path' | 'inFlight';

type RoadmapTabProps = {
  /** The plan a `?runner=` landing named, held by `useRunnerLanding` until its card has been brought into view; `null` on every ordinary visit. */
  revealPlan: string | null;
  /** Called once the reveal has run, whether or not a card was found, so the workspace retires the request. */
  onRevealed: () => void;
};

/**
 * The Roadmap tab: a segmented switch over its two faces. Roadmap is the path to the goal
 * (`RoadmapPath`); In flight is the live cards (`RunnerPanel`, mounted exactly as the Runner tab mounted
 * it, so not one card behaviour changes). In flight carries the tab strip's own pill and amber — the
 * cards drawn, and the sentence for the prompts waiting on the operator — so the switch says where the
 * urgent thing is before he turns to it.
 *
 * Both ways onto a card land on In flight: a `?runner=<plan>` landing, which turns the face before
 * `RunnerPanel` is handed the plan, and a feature's "Open its card" or "Answer" on the Roadmap face,
 * which turns it and hands the plan down the same way.
 *
 * Used by `WorkspaceMain` (project-workspace) as the `runner` tab's pane, through the module's barrel.
 */
export function RoadmapTab({ revealPlan, onRevealed }: RoadmapTabProps) {
  const { t } = useTranslation();
  // The face on screen. Local and never remembered: every visit opens on the roadmap, and only a landing
  // or a card press turns it to In flight, so the operator always arrives where he lives.
  const [face, setFace] = useState<Face>('path');
  const count = 6; // FILL: count — useDispatcherPlans().count (the dispatcher's barrel): the cards drawn, the strip's own pill, which draws nothing at 0
  const attention: string | undefined = t('runner.waiting', { count: 2 }); // FILL: attention — the strip's own amber: t('runner.waiting', { count: waiting }) while useDispatcherPlans().waiting is above 0, else undefined
  // FILL: reveal — a non-null revealPlan turns the face to In flight before RunnerPanel receives it (set while rendering, so RoadmapPath never commits under a landing); and a plan onOpenCard asked for, held in state while no landing holds one; `done` retires either, then calls onRevealed
  const reveal = { plan: revealPlan, done: onRevealed };
  const openCard = (_plan: string) => {}; // FILL: onOpenCard — turns the face to In flight and holds the plan as the reveal RunnerPanel receives

  return (
    <div className="flex h-full min-h-0 flex-col" data-roadmap-tab={face}>
      <div className="flex shrink-0 items-center border-b border-border px-4 py-2.5 lg:px-6">
        <Tabs
          ariaLabel={t('roadmap.faces.label')}
          tabs={[
            { id: 'path', label: t('roadmap.faces.path') },
            { id: 'inFlight', label: t('roadmap.faces.inFlight'), count, attention },
          ]}
          active={face}
          onChange={(id) => setFace(id === 'inFlight' ? 'inFlight' : 'path')}
        />
      </div>

      <div className="min-h-0 flex-1">
        {face === 'path' ? (
          <RoadmapPath onOpenCard={openCard} />
        ) : (
          // The live cards load on the face's first turn; the switch above stays put while they do.
          <Suspense fallback={<div className="grid h-full place-items-center"><Spinner /></div>}>
            <RunnerPanel revealPlan={reveal.plan} onRevealed={reveal.done} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
