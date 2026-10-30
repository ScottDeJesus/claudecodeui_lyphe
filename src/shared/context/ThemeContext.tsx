import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';
import { readSunPhase } from '@/shared/solarSchedule';

type ThemeContextValue = {
  /** The theme on screen: a held theme (`holdTheme`) while any hold stands, else the reader's own choice. */
  isDarkMode: boolean;
  /** Flips the reader's OWN choice and stores it. A hold keeps the screen where it holds it; the choice is there when the hold is released. */
  toggleDarkMode: () => void;
  /**
   * Holds the screen in `theme` over the reader's choice until the returned release is called; the newest hold wins while
   * several stand. Nothing a hold does is stored: his choice, the sun and the system scheme go on being read and written
   * as they were, and the release puts the screen back to them. The release may be called more than once.
   * Consumed by the Kaylee Station route, which holds dark while it is mounted.
   */
  holdTheme: (theme: 'dark' | 'light') => () => void;
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

/**
 * The colour the sun calls for right now, or `null` when it has no say: the reader is not following
 * it, or it measured nothing (a polar day or night has no crossing to compute from).
 *
 * The ONE place the solar answer is read for the stored preferences — the first paint, the preference
 * subscriber and the system-scheme listener below all ask it before any stored or system colour, so
 * no path can apply a colour over the sun's while the sun is in charge.
 */
function readSunDarkMode(): boolean | null {
  if (!readUserPreference<boolean>('themeFollowsSun', false)) return null;
  const phase = readSunPhase();
  return phase.nextChangeAt ? !phase.isDaylight : null;
}

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

  // The reader's OWN choice (stored theme, the sun's answer or the system scheme): what the switch flips and what
  // `setFollowsSun` stores. Never the held theme, so a hold cannot be written over his preference; the colour on
  // screen is `isDarkMode` below. Essential because the hold is applied over it and the release falls back to it.
  const [ownDarkMode, setOwnDarkMode] = useState(() => {
    // Ahead of the stored theme: when the reader has asked for the sun, the sun is the choice,
    // and the stored value is only a colour left over from before they asked.
    const sunDarkMode = readSunDarkMode();
    if (sunDarkMode !== null) return sunDarkMode;

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

  // The themes held over his choice right now, oldest first: one entry per `holdTheme` not yet released. State, because a
  // hold coming or going must re-render the provider so the colour on screen changes with it; the newest entry wins.
  const [holds, setHolds] = useState<readonly { theme: 'dark' | 'light' }[]>([]);
  // The colour on screen: the newest hold's theme while any stands, else his own choice. Every effect below that PAINTS
  // keys on this; every path that WRITES his choice reads `ownDarkMode`.
  const newestHold = holds[holds.length - 1];
  const isDarkMode = newestHold === undefined ? ownDarkMode : newestHold.theme === 'dark';

  // The theme now lives in auth.db, so a change made on another device (or in
  // another tab) arrives through the preference store rather than a re-render.
  //
  // ⚠ This listener runs on EVERY preference write of ANY key — a font-size step, a Settings switch,
  // the sign-in hydrate — not just on a change to the theme. While the sun is followed it therefore
  // applies the sun's answer, never the stored `theme`: that value is whatever the reader last chose by
  // hand, days ago, and re-applying it here turned the page dark at midday on the next button press,
  // with nothing to correct it until the sun-follower's next wake (up to 30 minutes later).
  useEffect(() => subscribeToUserPreferences(() => {
    setFollowsSunState(readUserPreference<boolean>('themeFollowsSun', false));
    const sunDarkMode = readSunDarkMode();
    if (sunDarkMode !== null) {
      setOwnDarkMode(sunDarkMode);
      return;
    }
    const savedTheme = readUserPreference<string | null>('theme', null);
    if (savedTheme) {
      setOwnDarkMode(savedTheme === 'dark');
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
    // The tab icon wears the theme's tile (`npm run icons` writes both). Rewritten in place so a
    // path-prefixed deployment keeps its prefix.
    const favicon = document.querySelector('link[rel="icon"]');
    const href = favicon?.getAttribute('href');
    if (favicon && href) {
      favicon.setAttribute('href', href.replace(/favicon(?:-dark)?\.png$/, isDarkMode ? 'favicon-dark.png' : 'favicon.png'));
    }

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
        setOwnDarkMode(!phase.isDaylight);
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
      // Only update if user hasn't manually set a preference, and the sun is not in charge of the colour
      const savedTheme = readUserPreference<string | null>('theme', null);
      if (!savedTheme && readSunDarkMode() === null) {
        setOwnDarkMode(e.matches);
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

  // A theme is stored because the user picked it (this switch), or because they let the sun go and
  // the colour on screen became their choice (`setFollowsSun`) — never because this device
  // happened to start on one.
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

    // The colour is taken from the render's `ownDarkMode` (his choice, never a held colour), not from a state
    // updater: an updater that writes a preference runs inside React's render when an update is already pending,
    // and the write then notifies other providers mid-render.
    const next = !ownDarkMode;

    // Stored before the sun is released: releasing notifies the preference listener above, which from
    // then on applies the stored `theme`, so it has to be the colour just chosen and not the old one.
    writeUserPreference('theme', next ? 'dark' : 'light');
    setOwnDarkMode(next);

    // Reaching for the switch IS the decision. Leaving the sun in charge would let it undo the
    // choice at the next crossing, which reads as the control being broken.
    if (readUserPreference<boolean>('themeFollowsSun', false)) {
      writeUserPreference('themeFollowsSun', false);
      setFollowsSunState(false);
    }
  }, [ownDarkMode]);

  // Letting the sun go from its own switch keeps the colour on screen: it becomes the stored choice.
  // The listener applies the stored `theme` once the sun is let go, so without this the page jumped
  // to whatever was stored days ago (the sun never writes `theme`).
  const setFollowsSun = useCallback((next: boolean) => {
    if (!next && readUserPreference<boolean>('themeFollowsSun', false)) {
      writeUserPreference('theme', ownDarkMode ? 'dark' : 'light');
    }
    writeUserPreference('themeFollowsSun', next);
    setFollowsSunState(next);
  }, [ownDarkMode]);

  // A hold is an entry in `holds` and its release takes that entry out by identity, so two holds of the same theme
  // release independently and a second call of one release finds nothing to remove. Nothing here touches a stored
  // preference: holding and releasing are about the screen alone.
  const holdTheme = useCallback((theme: 'dark' | 'light') => {
    const hold = { theme };
    setHolds((held) => [...held, hold]);
    return () => setHolds((held) => (held.includes(hold) ? held.filter((entry) => entry !== hold) : held));
  }, []);

  // A fresh object here would re-render every consumer in the app on any
  // render of this provider, theme change or not.
  const value = useMemo<ThemeContextValue>(
    () => ({ isDarkMode, toggleDarkMode, holdTheme, followsSun, setFollowsSun }),
    [isDarkMode, toggleDarkMode, holdTheme, followsSun, setFollowsSun],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
