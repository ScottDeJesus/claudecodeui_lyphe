import { useSyncExternalStore } from 'react';

/** The media query the whole portrait answers to. The stylesheet's `@media (prefers-reduced-motion: …)` blocks ask the same question of the same setting. */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** The browser's one answer, made once: `matchMedia` hands back a live object, so every subscriber and every read shares it. */
const reducedMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION_QUERY) : null;

function subscribe(listener: () => void): () => void {
  reducedMotion?.addEventListener('change', listener);
  return () => reducedMotion?.removeEventListener('change', listener);
}

const readReducedMotion = () => reducedMotion?.matches ?? false;

/**
 * Used by this module's CompanionFab (a shown look counts as landed at once, because under reduced motion she jumps and no
 * glide ever ends): whether the operating system asks for reduced motion, now and when the setting changes. Her face's instrument
 * reads the same query for itself each frame, so the two never disagree.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, readReducedMotion);
}
