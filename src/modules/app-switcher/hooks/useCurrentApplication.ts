import { useMemo } from 'react';

import { useAppSwitcher } from '@/modules/app-switcher/context/AppSwitcherContext';
import type { CurrentApplication } from '@/shared/types';

/**
 * The application in front of the layer, with the url its pane frames — or null when nothing is up.
 *
 * "In front" is `frontSide`'s slot, found in the registry by id: a row the registry no longer holds
 * reads as nothing, the same rule the layer draws by (framing an address this app cannot name is a
 * pane with no title). The answer is memoised on the app and the src, so a reader that only cares
 * WHAT is up is not woken by a re-render of the switcher's context that changed neither.
 *
 * Exported through the module's barrel for the project-workspace module (the chat door asks it for
 * the application's project, the frame for whether one covers the main region) and used inside the
 * module by the actions hook. Which pane is in front and which row is this app stay decided here.
 */
export function useCurrentApplication(): CurrentApplication | null {
  const { apps, panes, frontSide } = useAppSwitcher();
  const { appId, src } = panes[frontSide];
  const app = appId === null ? null : (apps.find((entry) => entry.id === appId) ?? null);

  return useMemo(() => (app !== null && src !== null ? { app, src } : null), [app, src]);
}
