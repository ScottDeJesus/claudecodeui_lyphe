import { useCallback, useEffect, useRef, useState } from 'react';

import type { UniverseTweaks } from '@/modules/universe/utils/universeTweaks';
import {
  DEFAULT_TWEAKS,
  TWEAKS_STORAGE_KEY,
  diffFromDefaults,
  parseTweaks,
} from '@/modules/universe/utils/universeTweaks';

/**
 * THE TWEAKS, AS REACT STATE AND AS A REF AT ONCE — one object, read two ways, by one rule.
 *
 * WHY BOTH. The Tweaks panel is React: it re-renders on a slider, so the chrome and the value it
 * shows can never disagree. The canvas loop is NOT: it reads the tweaks once per frame, inside an
 * animation callback that has no render phase to be part of. So the object lives in React state —
 * a user action, so the chrome re-renders — and the same object is mirrored into a ref, which the
 * loop reads on its next frame with no React dependency anywhere in its path.
 *
 * WHY THE REF IS WRITTEN IN AN EFFECT. An effect runs after a commit and before the frame is
 * painted, so a slider moved at time T is in the ref before the loop's T+1 frame and is never
 * visible mid-render. Writing the ref during render would be a side effect of rendering, which
 * React is free to run twice.
 *
 * WHAT PERSISTS IS THE DIFF. A sky left alone stores nothing — the key is removed rather than
 * filled with the defaults — so a future change to a default reaches every user who never moved
 * that control. Nothing about the tweaks reaches the server: localStorage, and only localStorage.
 */

/** What a reader of the tweaks is handed: the render-time value, the frame-time ref, and the writers. */
export type UniverseTweaksHandle = {
  tweaks: UniverseTweaks;
  tweaksRef: { readonly current: UniverseTweaks };
  setTweak: <K extends keyof UniverseTweaks>(key: K, value: UniverseTweaks[K]) => void;
  reset: () => void;
};

/** The stored diff, parsed and validated — or the defaults, which is what an absent file means. */
function readStoredTweaks(): UniverseTweaks {
  try {
    const stored = localStorage.getItem(TWEAKS_STORAGE_KEY);
    if (stored === null) return DEFAULT_TWEAKS;
    return parseTweaks(JSON.parse(stored));
  } catch {
    // Unreadable, absent, or not JSON at all is the same answer: `parseTweaks` validates whatever
    // did parse and drops the rest, and nothing here may leave a user without a panel.
    return DEFAULT_TWEAKS;
  }
}

/** The diff from defaults written back, or the key removed when there is no diff to write. */
function writeStoredTweaks(tweaks: UniverseTweaks): void {
  try {
    const diff = diffFromDefaults(tweaks);
    if (Object.keys(diff).length === 0) {
      localStorage.removeItem(TWEAKS_STORAGE_KEY);
      return;
    }
    localStorage.setItem(TWEAKS_STORAGE_KEY, JSON.stringify(diff));
  } catch {
    // A browser that refuses storage still gets a working panel for this session.
  }
}

export function useUniverseTweaks(): UniverseTweaksHandle {
  // Read once at mount, not synced from an effect, so the first frame already draws the sky the
  // user last left behind.
  const [tweaks, setTweaks] = useState<UniverseTweaks>(readStoredTweaks);

  // The canvas loop's copy: the same object, reachable without a re-render or a prop.
  const tweaksRef = useRef<UniverseTweaks>(tweaks);
  useEffect(() => {
    tweaksRef.current = tweaks;
  }, [tweaks]);

  const setTweak = useCallback(
    <K extends keyof UniverseTweaks>(key: K, value: UniverseTweaks[K]) => {
      // The merge is re-parsed, not trusted: a slider is as much an outside value as the file is,
      // and both leave through the one door that clamps.
      const next = parseTweaks({ ...tweaks, [key]: value });
      setTweaks(next);
      writeStoredTweaks(next);
    },
    [tweaks],
  );

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(TWEAKS_STORAGE_KEY);
    } catch {
      // The key is already gone as far as this session is concerned.
    }
    setTweaks(DEFAULT_TWEAKS);
  }, []);

  return { tweaks, tweaksRef, setTweak, reset };
}
