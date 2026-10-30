import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { RUNNER_LANDING_PARAM } from '@/shared/constants';

/**
 * The opener of a feature's live card from a surface with no Roadmap tab above it (the chat gutter's roadmap
 * widget, the Inbox's asks list): a function that takes the plan's name and goes to the workspace's own landing,
 * `?runner=<plan>`, which `useRunnerLanding` answers by bringing the tab forward and the card into view, the way a
 * tap on a plan's prompt does. The tab's own surfaces turn their face to In flight themselves and never call it.
 * Used by the roadmap module's `RoadmapTreeFace`, for a feature dialog's Open its card and Answer on its card when
 * the surface hands the face no card opener of its own; by the dispatcher module's `WaitingAsks`, whose Answer opens the
 * card where the answer is given; and by the project-workspace module's `CompanionHost`, which answers Kaylee's order to
 * open a card. Shared because three modules read it.
 */
export function useRevealCard(): (plan: string) => void {
  const navigate = useNavigate();
  return useCallback((plan: string) => {
    // Replacing, as the landing itself does when it strips the param: the press is a redirection, so Back must not find the same URL twice.
    navigate({ search: `?${new URLSearchParams({ [RUNNER_LANDING_PARAM]: plan })}` }, { replace: true });
  }, [navigate]);
}
