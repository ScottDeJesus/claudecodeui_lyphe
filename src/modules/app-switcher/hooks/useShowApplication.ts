import { useCallback } from 'react';

import { useAppSwitcher } from '@/modules/app-switcher/context/AppSwitcherContext';
import { appAddressAt, isSelfOrigin } from '@/modules/app-switcher/utils/resolveAppUrl';

/**
 * A verb: puts a registered application up at a path of its own, and MOVES it there when it is already up.
 *
 * The drawer's `open` is a toggle for a row (a row already on screen comes down), which is the right press for a reader and
 * the wrong order for a caller that means "show me this page": a second page's open would take the application down. This
 * puts it up where `open` would, or — when it is up — hands its pane a new address on the side it already holds. The address
 * is the registry's row resolved for THIS page's host (the drawer's rule) with the path laid on it, so which application
 * and where it lives stay decided in here; the caller names an id and a path inside the application.
 *
 * A row the registry does not hold, and a row that is this very app (CloudCLI framed in CloudCLI is a mirror the drawer
 * never frames), put nothing up; the reason is logged.
 *
 * Exported through the module's barrel for the project-workspace module's CompanionHost, which answers Kaylee's order to
 * open a DocSpace page in ArchPulse.
 */
export function useShowApplication(): (appId: string, path: string) => void {
  const { apps, selfPorts, putUp } = useAppSwitcher();

  return useCallback((appId: string, path: string) => {
    const app = apps.find((entry) => entry.id === appId);
    if (!app) {
      console.warn(`[AppSwitcher] Cannot show "${appId}": the registry holds no such application.`);
      return;
    }
    // The module's second reader of the page's own address, at its open site (see `resolveAppUrl`).
    const src = appAddressAt(app.url, window.location.hostname, path);
    if (isSelfOrigin(src, window.location.origin, selfPorts)) {
      console.warn(`[AppSwitcher] Cannot show "${appId}": it is this application, which is never framed.`);
      return;
    }
    putUp(appId, src);
  }, [apps, selfPorts, putUp]);
}
