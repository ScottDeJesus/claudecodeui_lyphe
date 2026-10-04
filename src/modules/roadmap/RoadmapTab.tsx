import { Suspense, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDispatcherPlans } from '@/modules/dispatcher';
import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
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
  /** The roadmap a `?roadmap=` landing named, held by `useRunnerLanding` until this tab has tried to select it; `null` on every ordinary visit. */
  openRoadmap: string | null;
  /** Called once the landing has run, whether or not the roadmap exists, so the workspace retires the request. */
  onRoadmapOpened: () => void;
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
 * which turns it and hands the plan down the same way. `RunnerPanel` does the reveal in both cases and
 * calls back once it has tried; this tab retires whichever request it was handed.
 *
 * A `?roadmap=<name>` landing is the other way in, onto the Roadmap face. It turns the face the moment it
 * arrives — once, so nothing the operator presses while the picture loads is undone, and a `?runner=`
 * landing that arrived with it keeps In flight — and once the picture has been read it selects that
 * roadmap and retires the request. A name the picture lacks selects nothing and is retired all the same:
 * the tab opens on the roadmap that was already on screen.
 *
 * Used by `WorkspaceMain` (project-workspace) as the `runner` tab's pane, through the module's barrel.
 */
export function RoadmapTab({ revealPlan, onRevealed, openRoadmap, onRoadmapOpened }: RoadmapTabProps) {
  const { t } = useTranslation();
  const { count, waiting } = useDispatcherPlans();
  const { picture, roadmaps, selected, select } = useRoadmap();
  // The face on screen. Local and never remembered: every visit opens on the roadmap, and only a landing
  // or a card press turns it to In flight, so the operator always arrives where he lives.
  const [face, setFace] = useState<Face>('path');
  // The plan a card press asked to see, held until `RunnerPanel` has tried to bring its card into view. A
  // landing's plan arrives as a prop and is the workspace's to retire; this is the same request made from
  // inside the tab, which only this tab can hold. Never both at once in practice, and a landing wins.
  const [requestedPlan, setRequestedPlan] = useState<string | null>(null);

  // A landing turns the face while this renders, not in an effect after it: set during render, React
  // discards the pass and renders again before anything is committed, so `RoadmapPath` never mounts under
  // a landing and `RunnerPanel` is the first thing drawn with the plan in hand. It holds the face on In
  // flight until the request is retired: by the pane once the bus has spoken, or by the operator's own
  // press on Roadmap (`showFace`), so nothing he does is undone and nothing waits on a quiet lane.
  if (revealPlan !== null && face !== 'inFlight') setFace('inFlight');

  // The `?roadmap=` request the face was last turned for. A landing turns the face ONCE, at the render it
  // arrives in, with `revealPlan` read at that same moment: a reveal that arrived with it wins by
  // construction (the card it names is the more specific ask), and a press the operator makes while the
  // picture is still loading is not undone when the picture lands. Remembering the request, not just
  // reading it, is what makes it once; it resets to `null` when the request is retired, so the same name
  // landing again later turns the face again.
  const [faceTurnedFor, setFaceTurnedFor] = useState<string | null>(null);
  if (openRoadmap !== faceTurnedFor) {
    setFaceTurnedFor(openRoadmap);
    if (openRoadmap !== null && revealPlan === null) setFace('path');
  }

  // Stable on purpose: `RunnerPanel`'s reveal effect lists it as a dependency, and a fresh identity per
  // render would re-run a reveal the request had already retired. Retires both kinds of request.
  const handleRevealed = useCallback(() => {
    setRequestedPlan(null);
    onRevealed();
  }, [onRevealed]);

  // The operator's own press on the switch. Turning to Roadmap answers any request still pending — a
  // landing the workspace holds, or a card press waiting on `RunnerPanel`'s lazy chunk — so both are
  // retired here: the render-time turn above then has nothing to re-apply, and no reveal can fire later
  // on a plain visit to In flight or after a trip to another tab.
  const showFace = (id: string) => {
    if (id === 'inFlight') {
      setFace('inFlight');
      return;
    }
    setRequestedPlan(null);
    if (revealPlan !== null) onRevealed();
    setFace('path');
  };

  // The `?roadmap=` landing's selection, answered once there is something to answer it with (the face
  // was turned above, on arrival). It waits for the picture: until the lane's first reading lands there is
  // no telling a roadmap that is absent from one not yet read. And it waits for `selected` when the
  // roadmap exists: `selected` is `null` until the preferences have settled (`useRoadmap`), and a pick
  // written on a cold mirror is overwritten by the hydrate that follows. A name the picture lacks needs
  // neither wait — it selects nothing — and is retired at once, so a stale link opens the tab and changes
  // nothing.
  useEffect(() => {
    if (openRoadmap === null || picture === null) return;
    const exists = roadmaps.some((roadmap) => roadmap.name === openRoadmap);
    if (exists && selected === null) return;
    if (exists) select(openRoadmap);
    onRoadmapOpened();
  }, [openRoadmap, picture, roadmaps, selected, select, onRoadmapOpened]);

  // Stable too: the Roadmap face puts it in the context every row and dialog reads.
  const openCard = useCallback((plan: string) => {
    setRequestedPlan(plan);
    setFace('inFlight');
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col" data-roadmap-tab={face}>
      <div className="flex shrink-0 items-center border-b border-border px-4 py-2.5 lg:px-6">
        <Tabs
          ariaLabel={t('roadmap.faces.label')}
          tabs={[
            { id: 'path', label: t('roadmap.faces.path') },
            {
              id: 'inFlight',
              label: t('roadmap.faces.inFlight'),
              // The strip's own reading of the same two numbers: no pill at zero, and the amber (with its
              // sentence) only while a prompt waits on the operator.
              count: count > 0 ? count : undefined,
              attention: waiting > 0 ? t('runner.waiting', { count: waiting }) : undefined,
            },
          ]}
          active={face}
          onChange={showFace}
        />
      </div>

      <div className="min-h-0 flex-1">
        {face === 'path' ? (
          <RoadmapPath onOpenCard={openCard} />
        ) : (
          // The live cards load on the face's first turn; the switch above stays put while they do.
          <Suspense fallback={<div className="grid h-full place-items-center"><Spinner /></div>}>
            <RunnerPanel revealPlan={revealPlan ?? requestedPlan} onRevealed={handleRevealed} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
