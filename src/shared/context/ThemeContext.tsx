import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';
import { readSunPhase } from '@/shared/solarSchedule';

type ThemeContextValue = {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  /** True while the theme is following the sun rather than a stored choice. */
  followsSun: boolean;
  setFollowsSun: (next: boolean) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * The longest the sun-follower will sleep before re-reading the phase (30 min).
 *
 * `setTimeout` is suspended while the machine is, so a timer armed for a sunset eight hours out
 * does not fire on a laptop that was closed — the cap bounds how long a slept-through crossing
 * can leave the wrong theme on screen.
 */
const MAX_SUN_CHECK_MS = 30 * 60_000;

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

/** Mounted once by App so every module can read and switch the colour theme through useTheme. */
export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  // Check for saved theme preference or default to system preference. The
  // stored theme is read synchronously from the preference mirror so the very
  // first paint is already the right colour.
  const [followsSun, setFollowsSunState] = useState(
    () => readUserPreference<boolean>('themeFollowsSun', false),
  );

  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Ahead of the stored theme: when the reader has asked for the sun, the sun is the choice,
    // and the stored value is only the last colour it happened to leave behind.
    if (readUserPreference<boolean>('themeFollowsSun', false)) {
      const phase = readSunPhase();
      if (phase.nextChangeAt) return !phase.isDaylight;
    }

    const savedTheme = readUserPreference<string | null>('theme', null);
    if (savedTheme) {
      return savedTheme === 'dark';
    }

    // Check system preference
    if (window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    return false;
  });

  // The theme now lives in auth.db, so a change made on another device (or in
  // another tab) arrives through the preference store rather than a re-render.
  useEffect(() => subscribeToUserPreferences(() => {
    setFollowsSunState(readUserPreference<boolean>('themeFollowsSun', false));
    const savedTheme = readUserPreference<string | null>('theme', null);
    if (savedTheme) {
      setIsDarkMode(savedTheme === 'dark');
    }
  }), []);

  // Applying the theme to the document and persisting it are deliberately
  // separate. Persisting from here would also fire on mount — before the stored
  // theme had been fetched — writing this device's system default over the
  // theme the user actually chose on another one.
  //
  // A LAYOUT effect, so `dark` is on <html> before any ordinary (passive) effect of
  // the same update runs. React runs a child's effects before its parent's, and this
  // provider is everyone's parent: as a plain effect it would run after every
  // consumer's effect keyed on `isDarkMode`, and a consumer reading the computed
  // tokens there would read the theme being left behind (measured on a live HTML
  // widget: the dark flag with all 89 colour readings still light). All layout
  // effects run before any passive one, so a PASSIVE effect reads the new theme. A
  // reader in its own layout effect, or at render time, still would not — read the
  // tokens in an ordinary effect.
  useLayoutEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');

      // Update iOS status bar style and theme color for dark mode
      const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (statusBarMeta) {
        statusBarMeta.setAttribute('content', 'black-translucent');
      }

      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', '#101116'); // Verve --canvas, dark
      }
    } else {
      document.documentElement.classList.remove('dark');

      // Update iOS status bar style and theme color for light mode
      const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (statusBarMeta) {
        statusBarMeta.setAttribute('content', 'default');
      }

      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', '#f7f7f9'); // Verve --canvas, light
      }
    }
  }, [isDarkMode]);

  // Follow the sun: set the colour now, then wake exactly at the next crossing and set it again.
  //
  // A timer per transition, not a poll: there are two crossings a day, so a ticking interval
  // would be thousands of wasted wake-ups to catch two moments it already knows the time of.
  // `nextChangeAt` is recomputed after every flip, which is what makes the schedule follow the
  // seasons instead of drifting off a fixed offset.
  //
  // ⚠ Two hazards this closes. `setTimeout` does not fire while a laptop is asleep, so the delay
  // is CAPPED and the phase re-read on each wake — a machine that slept through sunset comes
  // back and corrects within the cap rather than staying light until the next sunrise. And a
  // delay over ~24.8 days overflows the 32-bit timer and fires immediately; the same cap makes
  // that unreachable.
  useEffect(() => {
    if (!followsSun) return undefined;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const apply = () => {
      if (cancelled) return;
      const phase = readSunPhase();

      // A polar day or night measured nothing, so nothing is changed — the theme stays where the
      // reader last had it rather than being flipped by a time nobody computed.
      if (phase.nextChangeAt) {
        setIsDarkMode(!phase.isDaylight);
      }

      const msUntilChange = phase.nextChangeAt
        ? phase.nextChangeAt.getTime() - Date.now()
        : MAX_SUN_CHECK_MS;
      timer = setTimeout(apply, Math.min(Math.max(msUntilChange, 1_000), MAX_SUN_CHECK_MS));
    };

    apply();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [followsSun]);

  // Listen for system theme changes
  useEffect(() => {
    if (!window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      // Only update if user hasn't manually set a preference
      const savedTheme = readUserPreference<string | null>('theme', null);
      if (!savedTheme) {
        setIsDarkMode(e.matches);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // The pending `vv-anim` removal, held so a second flip inside the window restarts the half
  // second instead of being cut short by the first flip's timer — and so an unmount does not
  // leave a callback that reaches for a document that is going away.
  const animationTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (animationTimer.current !== null) window.clearTimeout(animationTimer.current);
  }, []);

  // The only writer: a theme is stored because the user picked it, never
  // because this device happened to start on one.
  const toggleDarkMode = useCallback(() => {
    // The theme swap is the one moment colour is allowed to animate. `vv-anim` sets a
    // transition with !important on EVERY element, so it goes on for the half second around
    // the flip and comes straight back off — left on, it would smear every hover, menu and
    // scroll in the app. It goes on the BODY: the rule is written `body.vv-anim`.
    document.body.classList.add('vv-anim');
    if (animationTimer.current !== null) window.clearTimeout(animationTimer.current);
    animationTimer.current = window.setTimeout(() => {
      animationTimer.current = null;
      document.body.classList.remove('vv-anim');
    }, 500);

    setIsDarkMode((previous) => {
      const next = !previous;
      writeUserPreference('theme', next ? 'dark' : 'light');
      return next;
    });

    // Reaching for the switch IS the decision. Leaving the sun in charge would let it undo the
    // choice at the next crossing, which reads as the control being broken.
    if (readUserPreference<boolean>('themeFollowsSun', false)) {
      writeUserPreference('themeFollowsSun', false);
      setFollowsSunState(false);
    }
  }, []);

  const setFollowsSun = useCallback((next: boolean) => {
    writeUserPreference('themeFollowsSun', next);
    setFollowsSunState(next);
  }, []);

  // A fresh object here would re-render every consumer in the app on any
  // render of this provider, theme change or not.
  const value = useMemo<ThemeContextValue>(
    () => ({ isDarkMode, toggleDarkMode, followsSun, setFollowsSun }),
    [isDarkMode, toggleDarkMode, followsSun, setFollowsSun],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
