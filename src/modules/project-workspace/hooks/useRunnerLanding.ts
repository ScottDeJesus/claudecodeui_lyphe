import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ROADMAP_LANDING_PARAM as ROADMAP_PARAM, RUNNER_LANDING_PARAM as RUNNER_PARAM } from '@/shared/constants';
import type { AppTab, Project } from '@/shared/types';

/**
 * The workspace's half of two landings, both onto the Roadmap tab (the `runner` id), which this brings
 * forward for either:
 *
 * - `…?runner=<plan>` — a tap on a plan's prompt (`landingPathOf`, `notification-landing.service.ts`), or
 *   the chat widget's Answer press: the tab turns to its In flight face (`RoadmapTab`) and the cards' pane
 *   puts that plan's card in view. Held as `revealPlan`.
 * - `…?roadmap=<name>` — the chat widget's "Open the roadmap": the tab turns to its Roadmap face and
 *   selects that roadmap. Held as `openRoadmap`.
 *
 * THE NAME IS TAKEN THE MOMENT IT IS SEEN, BECAUSE THE PICK TAKES THE PARAM AWAY. At `/` with nothing
 * selected the workspace draws no tab strip and no panes (`ProjectSidebarRegion` gates the strip on the
 * selection), so there is nothing to land in yet — and the pick that follows REWRITES THE LOCATION to
 * bare `/` (`handleProjectSelect`), so a read that waited for `selectedProject` would arrive after the
 * only copy of the name was gone and drop the landing silently. The name is held from the commit that
 * first sees it and consumed when a project arrives — the same wait a `/session/<id>` landing makes,
 * where the project is chosen from the session a frame later.
 *
 * `revealPlan` AND `openRoadmap` ARE STATE, NOT THE PARAMS. The effect below strips each param from the
 * URL in the same commit that it reads it, and the Roadmap tab mounts a render later (on
 * `activeTab === 'runner'`), so a live read of the URL down there would always find nothing. The names are
 * held here instead and cleared by `clearReveal` and `clearOpenRoadmap` — handed to the tab as
 * `onRevealed` and `onRoadmapOpened` — so one landing is one reveal and one opening.
 *
 * The strip is `replace`: a landing is a redirection, not a place, and Back must not return to a URL
 * that would carry the operator to the same card, or the same roadmap, again.
 *
 * A LANDING THE OPERATOR WALKS AWAY FROM IS DROPPED. Each name is retired by the tab's own signal, which
 * needs the tab mounted and its data read; an operator who presses another tab before that has declined
 * the landing, and a name still held would fire on his next plain visit (writing the stored roadmap) and
 * drag the workspace back to the tab on the next project switch, long after the URL was clean. So the
 * Roadmap tab leaving the screen retires whatever it had not yet answered.
 *
 * Used by `WorkspaceMain`, which owns the selected project, the active tab and `setActiveTab`.
 */
export function useRunnerLanding({ selectedProject, activeTab, setActiveTab }: {
  selectedProject: Project | null;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
}): {
  revealPlan: string | null;
  clearReveal: () => void;
  openRoadmap: string | null;
  clearOpenRoadmap: () => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  // An empty value is not a name (`landingPathOf` cannot write one, and the widget writes a roadmap's own
  // name), so it moves nothing at all — no tab, no strip, no stored selection — exactly as a missing
  // param does. Read here so the effect below keys on the two names it acts on.
  const runner = nameOf(searchParams.get(RUNNER_PARAM));
  const roadmap = nameOf(searchParams.get(ROADMAP_PARAM));

  // The plan the pane must bring into view, held until the pane reports it has tried — found or not.
  // It outlives the URL it came from by design (see the header), and it is the pane's OWN signal that
  // retires it, because only the pane can know that the lane has drawn the card to scroll to.
  const [revealPlan, setRevealPlan] = useState<string | null>(null);
  // The roadmap the tab must show, held until the tab reports it has tried — selected or not. Held for the
  // same reason as the plan above, and retired by the tab's own signal, because only the tab can know that
  // the picture has been read and so whether the roadmap exists.
  const [openRoadmap, setOpenRoadmap] = useState<string | null>(null);

  useEffect(() => {
    if (runner === null && roadmap === null) return;
    // The URL is the external fact being synced here, and the names cannot be derived during render:
    // the very next call strips the params they came from, in this same pass.
    if (runner !== null) {
      // oxlint-disable-next-line react/set-state-in-effect -- the param is stripped in this same pass
      setRevealPlan(runner);
    }
    if (roadmap !== null) {
      // oxlint-disable-next-line react/set-state-in-effect -- the param is stripped in this same pass
      setOpenRoadmap(roadmap);
    }
    // With no project selected there is nothing to strip FOR — the pick rewrites the location to bare
    // `/` on its own — so the params stay put and the held names above are what land.
    if (selectedProject === null) return;
    // BOTH KEYS GO IN ONE CALL. `setSearchParams`'s updater is handed the params of the render that made
    // it, not the latest location, so two calls in one pass would each rebuild from the same start and
    // the second would put the first's key back. The whole search string is rebuilt rather than the keys
    // deleted in place: `setSearchParams` REPLACES the params it is given, so a rebuild keeps every other
    // key the URL carried — an empty `?runner=` among them, which was never a name and is left alone.
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (runner !== null) next.delete(RUNNER_PARAM);
      if (roadmap !== null) next.delete(ROADMAP_PARAM);
      return next;
    }, { replace: true });
  }, [runner, roadmap, selectedProject, setSearchParams]);

  // The landing itself, once there is a project to land in: the tab comes forward as the pick makes the
  // workspace exist. It keys on the HELD names, never on the params — by this commit the pick has already
  // rewritten the location to bare `/`, so a param read here would find nothing.
  useEffect(() => {
    if ((revealPlan === null && openRoadmap === null) || selectedProject === null) return;
    setActiveTab('runner');
  }, [revealPlan, openRoadmap, selectedProject, setActiveTab]);

  // The Roadmap tab leaving the screen retires both held names (see the header): the cleanup runs when
  // `activeTab` moves off `runner`. It is registered only once the tab IS the active one, so a name held
  // while the pick is still pending (the tab not yet forward) is not dropped before it has landed
  // anywhere. StrictMode's dev-only unmount-and-remount runs the cleanup once on a first mount that
  // starts on `runner`; the take effect above runs again right after it, from the same render's params,
  // and holds the names again.
  useEffect(() => {
    if (activeTab !== 'runner') return undefined;
    return () => {
      setRevealPlan(null);
      setOpenRoadmap(null);
    };
  }, [activeTab]);

  // Stable: the pane's reveal effect lists it as a dependency, and a fresh identity per render would
  // re-run a reveal the request had already retired.
  const clearReveal = useCallback(() => setRevealPlan(null), []);
  // Stable for the same reason: the tab's opening effect lists it.
  const clearOpenRoadmap = useCallback(() => setOpenRoadmap(null), []);

  return { revealPlan, clearReveal, openRoadmap, clearOpenRoadmap };
}

/** A param's value as a landing's name: the value itself, or `null` when the param is missing or blank. */
function nameOf(value: string | null): string | null {
  return value === null || value.trim() === '' ? null : value;
}
