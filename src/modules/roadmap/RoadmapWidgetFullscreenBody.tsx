import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { RoadmapTab } from '@/modules/roadmap/lazyRoadmapTab';
import { Spinner } from '@/shared/ui';

/** What the tab calls once a request of the workspace's is answered. The widget holds no such request, so there is nothing to retire. */
const NOTHING_TO_RETIRE = () => {};

/**
 * THE ROADMAP WIDGET AT FULL SCREEN: the Roadmap tab itself, in the card that has the viewport. Both faces behind
 * the one switch — Roadmap (the tree and its panel, `RoadmapTreeFace` in viewport fit) and In flight (the live
 * cards) — exactly what the tab draws, because it IS the tab's own composition (`RoadmapTab`) and not a second
 * copy of it: a change to the tab is a change here, and the two cannot drift apart. At a column's width the
 * widget stays the same roadmap face in its column fit (`RoadmapWidgetBody`); the gutter layout swaps this body
 * in only while the card is full screen and the column body back when it leaves, so nothing done here outlives
 * the visit. The face on screen is the tab's own local state; this body starts it on Roadmap every time
 * (`startFace`), the face the column body was already showing, where the workspace's tab starts on In flight.
 *
 * WHAT THE TAB'S LANDING PROPS MEAN HERE: nothing is landing. `revealPlan` and `openRoadmap` are the
 * workspace's requests (`?runner=<plan>`, `?roadmap=<name>`), held by `useRunnerLanding` for the tab it brings
 * forward; a widget is not that tab and holds none, so both are `null` and the tab opens on the face this body
 * starts it on. The card press needs none of them: a feature dialog's Open its card or Answer on its card
 * goes through the tab's own `openCard`, which turns to In flight and hands the plan down to
 * `RunnerPanel`, which reveals it — the same press, the same turn, as on the tab. That request lives in the
 * tab, so the one callback it makes (`onRevealed`, when the reveal has run) has nothing of the workspace's
 * to retire, and neither callback is ever more than a no-op.
 *
 * The tab is lazy (`lazyRoadmapTab`), so the chat's first paint carries the column body alone; the first press
 * of the fullscreen switch shows a spinner for as long as the chunk takes. The card is `flush`, so the tab
 * fills its inside, as it does in the workspace's pane.
 *
 * Used by `src/modules/chat-gutters` (`ChatGutterLayout`), through the roadmap barrel, as the Roadmap widget's
 * full-screen body.
 */
export function RoadmapWidgetFullscreenBody() {
  const { t } = useTranslation();
  return (
    <Suspense fallback={<div className="grid h-full place-items-center"><Spinner size={32} label={t('roadmap.loading')} /></div>}>
      <RoadmapTab revealPlan={null} onRevealed={NOTHING_TO_RETIRE} openRoadmap={null} onRoadmapOpened={NOTHING_TO_RETIRE} startFace="path" />
    </Suspense>
  );
}
