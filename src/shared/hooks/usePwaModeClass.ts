import { useEffect } from 'react';

import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';

/**
 * Puts `pwa-mode` on html and body while CloudCLI runs as the home-screen app. Consumed by the sidebar (the workspace's
 * shell) and by the station's route: `body.pwa-mode .pwa-status-clear` (src/index.css) is what moves a frame under the
 * status bar and the notch, so each page that draws a `pwa-status-clear` frame calls this once, and the class follows the
 * display mode (`useDeviceSettings` re-reads it on the media query's `change`, never on a timer).
 *
 * Both elements: the stylesheet keys on the body, and the chat's picture-in-picture window mirrors the html's and the body's
 * classes (`mirrorDocument`) to draw itself the same way. The class is toggled rather than added so a window that leaves
 * the app's display mode sheds it.
 */
export function usePwaModeClass(): void {
  const { isPWA } = useDeviceSettings({ trackMobile: false });

  useEffect(() => {
    document.documentElement.classList.toggle('pwa-mode', isPWA);
    document.body.classList.toggle('pwa-mode', isPWA);
  }, [isPWA]);
}
