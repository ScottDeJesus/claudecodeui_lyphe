import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { RUNNER_LANDING_PARAM as RUNNER_PARAM } from '@/shared/constants';
import type { AppTab, Project } from '@/shared/types';

/**
 * The workspace's half of a tap on a plan's prompt (`landingPathOf`, `notification-landing.service.ts`):
 * the page opens on `…?runner=<plan>`, and this brings the Roadmap tab (the `runner` id) forward — its
 * `RoadmapTab` turns to the In flight face — and asks the cards' pane to put that plan's card in view.
 *
 * THE NAME IS TAKEN THE MOMENT IT IS SEEN, BECAUSE THE PICK TAKES THE PARAM AWAY. At `/` with nothing
 * selected the workspace draws no tab strip and no panes (`ProjectSidebarRegion` gates the strip on the
 * selection), so there is nothing to land in yet — and the pick that follows REWRITES THE LOCATION to
 * bare `/` (`handleProjectSelect`), so a read that waited for `selectedProject` would arrive after the
 * only copy of the name was gone and drop the landing silently. The name is held as `revealPlan` from
 * the commit that first sees it and consumed when a project arrives — the same wait a `/session/<id>`
 * landing makes, where the project is chosen from the session a frame later.
 *
 * `revealPlan` IS STATE, NOT THE PARAM. The effect below strips `runner` from the URL in the same
 * commit that it reads it, and the Roadmap tab mounts a render later (on `activeTab === 'runner'`),
 * so a live read of the URL down there would always find nothing. The name is held here instead and
 * cleared by `clearReveal` — handed to the tab as `onRevealed` — so one landing is one reveal.
 *
 * The strip is `replace`: a landing is a redirection, not a place, and Back must not return to a URL
 * that would carry the operator to the same card again.
 *
 * Used by `WorkspaceMain`, which owns both the selected project and `setActiveTab`.
 */
export function useRunnerLanding({ selectedProject, setActiveTab }: {
  selectedProject: Project | null;
  setActiveTab: (tab: AppTab) => void;
}): { revealPlan: string | null; clearReveal: () => void } {
  const [searchParams, setSearchParams] = useSearchParams();
  const runner = searchParams.get(RUNNER_PARAM);

  // The plan the pane must bring into view, held until the pane reports it has tried — found or not.
  // It outlives the URL it came from by design (see the header), and it is the pane's OWN signal that
  // retires it, because only the pane can know that the lane has drawn the card to scroll to.
  const [revealPlan, setRevealPlan] = useState<string | null>(null);

  useEffect(() => {
    // An empty value is not a plan name (`landingPathOf` cannot write one), so it moves nothing at all
    // — no tab, no strip, no stored selection — exactly as a missing param does.
    if (runner === null || runner.trim() === '') return;
    // The URL is the external fact being synced here, and the name cannot be derived during render:
    // the very next call strips the param it came from, in this same pass.
    // oxlint-disable-next-line react/set-state-in-effect -- the param is stripped in this same pass
    setRevealPlan(runner);
    // With no project selected there is nothing to strip FOR — the pick rewrites the location to bare
    // `/` on its own — so the param stays put and the held name above is what lands.
    if (selectedProject === null) return;
    // The whole search string is rebuilt rather than the one key deleted in place: `setSearchParams`
    // REPLACES the params it is given, so a rebuild keeps every other key the URL carried.
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete(RUNNER_PARAM);
      return next;
    }, { replace: true });
  }, [runner, selectedProject, setSearchParams]);

  // The landing itself, once there is a project to land in: the tab comes forward as the pick makes the
  // workspace exist. It keys on the HELD name, never on the param — by this commit the pick has already
  // rewritten the location to bare `/`, so a param read here would find nothing.
  useEffect(() => {
    if (revealPlan === null || selectedProject === null) return;
    setActiveTab('runner');
  }, [revealPlan, selectedProject, setActiveTab]);

  // Stable: the pane's reveal effect lists it as a dependency, and a fresh identity per render would
  // re-run a reveal the request had already retired.
  const clearReveal = useCallback(() => setRevealPlan(null), []);

  return { revealPlan, clearReveal };
}
