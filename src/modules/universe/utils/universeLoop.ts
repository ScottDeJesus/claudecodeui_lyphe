/**
 * THE LOOP — when a frame is drawn, and when nothing is.
 *
 * ONE MACHINE, FOUR ANSWERS. Sixty animation frames a second while the estate is alive, a slow tick
 * once it goes quiet, nothing at all while the tab is away, and a single frame for a visitor who
 * asked the machine for less motion. Every one of those decisions lives here and nowhere else: the
 * canvas knows how to draw a frame, this knows when a frame is owed.
 *
 * WHY A SLOW TICK RATHER THAN STOPPING. A settled sky still moves a little — the sun's glow, a
 * twinkle, a clock — and a canvas frozen on its last frame is a defect the visitor can see. Four
 * frames a second is enough for that and cheap; the moment a row lands or a hand touches the
 * canvas, `noteActivity` puts the fast path back and the next frame is an animation frame again,
 * not a tick twenty-five hundredths of a second away.
 *
 * WHY ACTIVITY HOLDS THE FAST PATH. A row keeps this loop at sixty because the live layer is what
 * a row makes move — a comet in flight, a flare burning out, a label fading — and that layer is
 * drawn every frame. It is not a licence to redraw the star layer: a row never repaints ten
 * thousand stars, and what bounds that cost is the cadence in `universeRepaint`, which hands each
 * frame the layers it owes and lets the rest keep the picture they already have.
 *
 * THE WINDOW IS IDLENESS, NOT PRESENCE. `activeWindowMs` measures the time since the last row or
 * the last movement, not the time since load, so a page left open overnight ticks instead of
 * burning a core on a sky nobody is watching, and a page being dragged stays at sixty frames.
 *
 * WHAT `mode()` ANSWERS. The cadence the frame NOW BEING DRAWN was scheduled on — `step` remembers
 * what it consumed before it clears it, so the code inside a frame (the instrument's own sample)
 * is told the truth about that frame rather than about the one after it. Asked between frames it
 * answers what is queued next, which is what `start` and a reader at a console see. This matters
 * because a frame rate is unreadable without it: a sky on the 250 ms tick draws four frames a
 * second with nothing whatsoever wrong, and a probe that averaged those into its mean would report
 * a working sky as a broken one.
 *
 * HIDDEN MEANS NOTHING, AND NOTHING IS CAUGHT UP. A hidden tab draws no frame at all — not even the
 * slow tick — because a background canvas is work the visitor cannot see. On the way back it
 * resumes where the sky is now rather than replaying: the graph's own clock is clamped at the one
 * place that advances motion, so a tab that slept for an hour does not teleport every star.
 *
 * THE CLOCK IS THE WIRE'S CLOCK. `onFrame` is handed `Date.now()`, epoch milliseconds — the unit a
 * row's `at` is stamped in and the unit `graph.lastNow` is written in — so a frame's instant can be
 * compared with the instant an edit landed without a conversion anywhere in between.
 *
 * WHAT THIS FILE DOES NOT KNOW. It has no import of React and no canvas, no layout and no graph: it
 * calls one function and forgets it. The only part of the page it touches is whether the tab is
 * visible, and the listener it installs for that is removed again on `stop`.
 */

/** The cadence once nothing has happened for a whole window, and how long that window is. */
const IDLE_MS = 250;
const ACTIVE_WINDOW_MS = 20_000;

export type UniverseLoopOptions = {
  /** Draw one frame for this instant, in epoch milliseconds. */
  onFrame(now: number): void;
  /** The cadence once the active window has lapsed. */
  idleMs?: number;
  /** How long the fast path stays fast after the last row or the last interaction. */
  activeWindowMs?: number;
  /** The visitor asked for less motion: one frame, then only when something is noted. */
  reducedMotion?: boolean;
};

export type UniverseLoop = {
  /** Begin. Idempotent: a second call while running does nothing. */
  start(): void;
  /** End, dropping any pending frame and the visibility listener. Idempotent. */
  stop(): void;
  /** A row arrived — the sky has something new to say. */
  noteActivity(): void;
  /** A hand moved on the canvas, a wheel turned, a key was pressed. */
  noteInteraction(): void;
  /** How this loop was scheduled — an animation frame, the slow idle tick — or `hidden` while the
   *  page is away. Called from inside a frame it describes THAT frame (what the instrument's sample
   *  needs); called between frames it describes what is queued next. */
  mode(): 'frame' | 'tick' | 'hidden';
};

export function createUniverseLoop(options: UniverseLoopOptions): UniverseLoop {
  const idleMs = options.idleMs ?? IDLE_MS;
  const activeWindowMs = options.activeWindowMs ?? ACTIVE_WINDOW_MS;
  const reducedMotion = options.reducedMotion === true;
  const onFrame = options.onFrame;
  let running = false;
  let pending: 'frame' | 'tick' | null = null;
  /** The cadence the frame now being drawn was scheduled on, held for the whole of that frame. */
  let drawn: 'frame' | 'tick' = 'frame';
  /** The two handles are kept apart because they are not the same type in every environment: an
   *  animation frame is a number everywhere, a timer is a number in a browser and an object in a
   *  script, and this module is imported by both ends of the build. */
  let handle = 0;
  let ticker: ReturnType<typeof setTimeout> | null = null;
  /** The instant of the last row or interaction — what the active window is measured from. */
  let lastActivity = 0;
  /** Whether the sky still owes a frame: true until one is drawn, and true again after every note
   *  and every return from a hidden tab. It is read in exactly one place — the reduced-motion gate,
   *  where it is the whole of the gate because nothing there schedules a frame on a timer. Everywhere
   *  else a frame is queued off the activity window and this is only ever set, never consulted. */
  let owed = true;

  const cancelPending = (): void => {
    if (pending === 'frame') cancelAnimationFrame(handle);
    else if (pending === 'tick' && ticker !== null) clearTimeout(ticker);
    pending = null;
    ticker = null;
  };

  /** Whether the tab is on screen. A page without a document — a script importing this module — is
   *  treated as visible, because there is nothing to hide it. */
  const visible = (): boolean => typeof document === 'undefined' || document.visibilityState === 'visible';

  /** One frame, and the next one queued whatever the frame did. A drawing that throws — a canvas
   *  the browser refused, a node a pass read off the end of — must not take the chain down with it:
   *  the error surfaces where it happened, and the sky is still there on the next frame. */
  const step = (): void => {
    // WHAT THIS FRAME WAS, REMEMBERED BEFORE THE FACT OF IT IS CLEARED. `mode()` reports this while
    // the frame runs, so the sample the frame publishes describes this frame's cadence — the thing
    // a frame rate is unreadable without. Consuming it first and asking afterwards would answer with
    // the NEXT scheduled frame, which for a tick-drawn frame is 'frame' whenever a hand just moved:
    // every sample would say 'frame' and the idle tick could never be told apart from a slow sky.
    drawn = pending ?? drawn;
    pending = null;
    if (!running) return;
    try {
      onFrame(Date.now());
    } finally {
      owed = false;
      schedule();
    }
  };

  const schedule = (): void => {
    if (!running || pending !== null) return;
    if (!visible()) return;
    if (reducedMotion) {
      // No timer at all under reduced motion: a slowly ticking sky is motion too.
      if (!owed) return;
      pending = 'frame';
      handle = requestAnimationFrame(step);
      return;
    }
    if (Date.now() - lastActivity < activeWindowMs) {
      pending = 'frame';
      handle = requestAnimationFrame(step);
    } else {
      pending = 'tick';
      ticker = setTimeout(step, idleMs);
    }
  };

  /** A row, or a hand: the fast path comes back at once rather than after the pending tick. */
  const note = (): void => {
    lastActivity = Date.now();
    owed = true;
    if (!running) return;
    if (pending === 'tick') cancelPending();
    schedule();
  };

  const onVisibility = (): void => {
    if (!running) return;
    if (document.hidden) {
      // Away: drop the frame that was waiting. No catch-up frame is scheduled for the return —
      // the next frame draws the sky as it is now, not the parade nobody was there to see.
      cancelPending();
      return;
    }
    owed = true;
    schedule();
  };

  /** The answer `mode()` gives: the frame being drawn, else what is queued, else the page is away. */
  const mode = (): 'frame' | 'tick' | 'hidden' => {
    if (!visible()) return 'hidden';
    return pending ?? drawn;
  };

  const start = (): void => {
    if (running) return;
    running = true;
    lastActivity = Date.now();
    owed = true;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    schedule();
  };

  const stop = (): void => {
    if (!running) return;
    running = false;
    cancelPending();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };

  return { start, stop, noteActivity: note, noteInteraction: note, mode };
}
