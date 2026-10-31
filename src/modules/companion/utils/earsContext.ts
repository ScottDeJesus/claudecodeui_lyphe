// The page's ONE AudioContext for her ears and their tones, held for the life of the document rather than of a provider. The page
// is touched once (its first `pointerdown` or `keydown`, or the switch's own press), and a context made after that runs; the
// workspace and the station each mount their own `CompanionProvider`, so a hop between them inside one document remounts `useEars`,
// which must find the touch the page already had and the context it made, not ask for a second touch and leave the first context
// running. Module-private: only `useEars` reads it.
let pageContext: AudioContext | null = null;

/** The context this page has made for her ears, or null before the page's first touch (or once the browser has closed it). */
export function heldAudioContext(): AudioContext | null {
  return pageContext !== null && pageContext.state !== 'closed' ? pageContext : null;
}

/** The page's context: the one already made, else a new one. Call it inside a gesture, so the new one runs. */
export function ensurePageAudioContext(): AudioContext {
  const held = heldAudioContext();
  if (held !== null) return held;
  pageContext = new AudioContext();
  return pageContext;
}
