import { useEffect, useState } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';

type UseDeviceSettingsOptions = {
  mobileBreakpoint?: number;
  trackMobile?: boolean;
  trackPWA?: boolean;
};

/**
 * A viewport measurement, so it reads the window the reader is looking through. The chat's composer
 * asks this at breakpoint 640, and inside a 420px picture-in-picture window it must answer narrow
 * although the opener is 1440 wide.
 */
const getIsMobile = (hostWindow: Window, mobileBreakpoint: number): boolean => (
  hostWindow.innerWidth < mobileBreakpoint
);

// Stays on the global window on purpose: display mode (standalone, home-screen app) is a fact of the
// opener's browser window, and a picture-in-picture window it opened has none of its own.
const getIsPWA = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean(navigatorWithStandalone.standalone) ||
    document.referrer.includes('android-app://')
  );
};

export function useDeviceSettings(options: UseDeviceSettingsOptions = {}) {
  const {
    mobileBreakpoint = 768,
    trackMobile = true,
    trackPWA = true
  } = options;

  const hostWindow = useHostWindow();
  const [isMobile, setIsMobile] = useState<boolean>(() => (
    trackMobile ? getIsMobile(hostWindow, mobileBreakpoint) : false
  ));
  const [isPWA, setIsPWA] = useState<boolean>(() => (
    trackPWA ? getIsPWA() : false
  ));

  useEffect(() => {
    if (!trackMobile) {
      return;
    }

    const checkMobile = () => {
      setIsMobile(getIsMobile(hostWindow, mobileBreakpoint));
    };

    // Read on the way in as well as on `resize`: a move to another window changes the width without
    // a resize event on the window the listener is about to bind to.
    checkMobile();
    hostWindow.addEventListener('resize', checkMobile);

    return () => {
      hostWindow.removeEventListener('resize', checkMobile);
    };
  }, [mobileBreakpoint, trackMobile, hostWindow]);

  useEffect(() => {
    if (!trackPWA || typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const checkPWA = () => {
      setIsPWA(getIsPWA());
    };

    checkPWA();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', checkPWA);
      return () => {
        mediaQuery.removeEventListener('change', checkPWA);
      };
    }

    mediaQuery.addListener(checkPWA);
    return () => {
      mediaQuery.removeListener(checkPWA);
    };
  }, [trackPWA]);

  return { isMobile, isPWA };
}
