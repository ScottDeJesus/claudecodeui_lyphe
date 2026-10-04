import { useCallback, useContext } from 'react';
import { useNavigate } from 'react-router-dom';

import { RoadmapFaceContext } from '@/modules/roadmap/faceContext';
import { RUNNER_LANDING_PARAM } from '@/shared/constants';

/**
 * The opener of a feature's live card: a function that takes the plan's name and shows its card on the
 * In flight face. On the Roadmap tab that is the face's own `openCard` (`RoadmapTab` turns to In flight
 * and hands the name down to `RunnerPanel`). Anywhere there is no tab above — the chat gutter's roadmap
 * widget — it is the workspace's own landing: the page goes to `?runner=<plan>`, which `useRunnerLanding`
 * answers by bringing the tab forward and the card into view, the way a tap on a plan's prompt does.
 * Used by `FeatureRow`, for its Answer press, and by `RoadmapWidgetBody`, for its dialog's Open its card.
 */
export function useRevealCard(): (plan: string) => void {
  const { openCard } = useContext(RoadmapFaceContext);
  const navigate = useNavigate();
  return useCallback((plan: string) => {
    if (openCard !== null) {
      openCard(plan);
      return;
    }
    // Replacing, as the landing itself does when it strips the param: the press is a redirection, so Back must not find the same URL twice.
    navigate({ search: `?${new URLSearchParams({ [RUNNER_LANDING_PARAM]: plan })}` }, { replace: true });
  }, [openCard, navigate]);
}
