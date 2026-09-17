/**
 * THE INSTRUMENT — what a frame cost, published where a probe can read it.
 *
 * WHY IT EXISTS. A frame rate is the sum of parts that are fixed in different files: the layout
 * step, the draw, whatever the browser does around them. Splitting a frame into its parts, live and
 * per frame, is what turns "the sky is slow" into a number a change can be held to — and a number
 * published every frame is one the same probe can read before and after, on the same box, in the
 * same session.
 *
 * IT KNOWS NOTHING ABOUT THE SKY. Nothing here is imported from the module — not the graph, not the
 * camera, not the loop, not a field name. The owner assembles a `PerfSample` out of the things only
 * the owner has and hands it in, so a later phase that renames `coarse` or adds a regime edits one
 * line in the component and no line here. That is also why the fields are declared in this file
 * rather than imported: a type imported from the neighbour would be a dependency dressed as a
 * convenience, and the first refactor of the graph would reach into the instrument.
 *
 * IT ALLOCATES NOTHING PER FRAME. The fields are scalars copied onto one object built at
 * construction and mutated in place forever after; the three means are read out of three
 * Float64Arrays of 120 slots written through a cursor; the sample is the owner's preallocated object
 * too. No literal, no closure result, no string — a counter that allocated a few objects a frame
 * would be measuring, in part, its own garbage, which is exactly the number the plan is decided on.
 * Why 120: one frame is a lie on either side, and two seconds at 60 Hz is long enough that the mean
 * is the cadence and short enough that a tweak moved mid-sample shows up in it.
 *
 * THREE CLOCK READS A FRAME, AND WHAT EACH ONE BUYS. `begin`, `afterStep` and `end` each stamp the
 * monotonic page clock — the only clock a duration may be measured on. `stepMs` is `afterStep` minus
 * `begin` (the layout's own cost); `drawMs` is `end` minus `afterStep`, which is the drawing and
 * nothing else; `frameMs` is `begin` to `begin` across two frames, `0` on the first, and `fps` is
 * `1000 / frameMs`. All four are in the same units, so `frameMs − stepMs − drawMs` — the frame's
 * unaccounted time — reads straight off the published object and is published in the probe's line.
 *
 * WHICH NUMBER A GATE READS. `stepMs` and `drawMs` are the sky's own work and are what the layout and
 * draw targets are read against; a frame-rate target is read against `frameMs`, because a frame rate
 * is also the rasteriser, the compositor and everything the browser did between two frames — cost no
 * reading here can attribute, and no fall in `drawMs` is a promise that any of it moved.
 *
 * AND THE WINDOW CAN BE CLEARED BY ITS READER. The means cover the last 120 frames, so a mean read
 * just after the camera moved is part state and part whatever preceded it — a zoom's frames
 * outweighing a still camera's for as long as they are inside the window. `reset()`, on the published
 * object, forgets the window and nothing else: the frame count keeps running, and every frame in the
 * next mean was drawn after the call. A reader that wants a number about a state it has just entered
 * calls it on entering; the counter is never told what a state is, and stays blind to the sky.
 *
 * WHY `end` STAMPS AND DOES NOT DERIVE. Leaving `drawMs` as "what the interval has left once the
 * step is paid for" reads plausibly and is worthless: the interval is a frame's whole period, so on
 * a 60 Hz display that expression can never exceed 16.6 − stepMs, and a draw budget of ≤ 4 ms would
 * be unreachable by a sky whose draw passes had been made instant. It also moves the wrong way — a
 * slower draw leaves LESS leftover time, so the metric would improve as the drawing got worse. The
 * leftover is the frame's unaccounted time, not the drawing's cost, and the two are only equal when
 * the frame is spending everything it has.
 */

/** The three windows: how many frames a mean is taken over. Two seconds at 60 Hz. */
const WINDOW = 120;

/**
 * What a frame cost and what it was, as the owner alone can see it. Assembled in `onFrame` into an
 * object the owner owns and mutates — never a literal per frame — and never read back: each field is
 * copied onto the published reading in the same instant it arrives.
 */
export type PerfSample = {
  /** The camera's zoom, world units to screen pixels. The regimes are cut on this. */
  z: number;
  /** Whether the frame was drawn coarse — every star sub-pixel, files neither walked nor drawn. */
  coarse: boolean;
  /** How many nodes the display passes walked. Whole-graph today; a later phase makes it the list. */
  act: number;
  /** Which path drew the stars: the 2D passes, or the GL layer once it exists. */
  renderer: 'canvas' | 'webgl';
  /** What the loop says this frame was: an animation frame, the idle tick, or no frame at all. */
  mode: 'frame' | 'tick' | 'hidden';
};

/** The published reading: the live scalars, the three rolling means, and the frame count. */
export type PerfReading = {
  /** Frames completed since the counter was made — the probe's proof that the sky is still moving. */
  frames: number;
  /** Frames a second, from the mean interval between the frames the counter was handed. */
  fps: number;
  /** Mean milliseconds from one frame's `begin` to the next — the whole period, `stepMs + drawMs`
   *  and everything else the browser spent. What a frame-rate target is read against. */
  frameMs: number;
  /** Mean milliseconds the layout step cost over the window — `afterStep` minus `begin`. */
  stepMs: number;
  /** Mean milliseconds the draw cost over the window — `end` minus `afterStep`. */
  drawMs: number;
  z: number;
  coarse: boolean;
  act: number;
  renderer: 'canvas' | 'webgl';
  mode: 'frame' | 'tick' | 'hidden';
};

/**
 * What the page's window carries: the reading itself, plus the one thing a reader may do to it.
 * A function on the published object rather than a second global, so a probe still finds everything
 * it is allowed to touch in one place — and it is a plain value spread by any reader that copies the
 * reading, since a method has no state of its own.
 */
export type PublishedPerf = PerfReading & {
  /** Forget the window: the three means start again at the next frame, the frame count does not. */
  reset(): void;
};

export type UniversePerf = {
  /** The frame began. */
  begin(): void;
  /** The layout step is over — everything from here to `end` is the draw. */
  afterStep(): void;
  /** The frame is over, and this is what it was. */
  end(sample: PerfSample): void;
};

/** Where a probe finds it: one property on the page's own window, rewritten every frame. */
declare global {
  // eslint-disable-next-line no-var
  var __universePerf: PublishedPerf | undefined;
}

/**
 * The mean of a window's filled part, as one number. A non-positive slot is skipped rather than
 * averaged: it is the first frame of a run or a tab that just woke, where nothing was measured.
 * Returns the number and writes its own count through `tally` — one preallocated cell for all three
 * means, where returning `{ total, count }` would put an object on the measured path every frame.
 */
function meanOf(values: Float64Array, filled: number, tally: Int32Array): number {
  let total = 0;
  let count = 0;
  for (let i = 0; i < filled; i += 1) {
    if (values[i] <= 0) continue;
    total += values[i];
    count += 1;
  }
  tally[0] = count;
  return count === 0 ? 0 : total / count;
}

export function createPerf(): UniversePerf {
  // The three windows and the one cursor they share: a slot is overwritten in every array at once,
  // so "how full is the window" is one number and never three that could disagree.
  const intervals = new Float64Array(WINDOW);
  const steps = new Float64Array(WINDOW);
  const draws = new Float64Array(WINDOW);
  /** One cell reused by `meanOf` for the count of measurable slots in the window it just read. */
  const tally = new Int32Array(1);
  let cursor = 0;
  let filled = 0;
  let frames = 0;

  let began = 0;
  let stepped = 0;
  let previous = 0;

  /**
   * Drop the window: the cursor goes back to the first slot, so the means are over the frames drawn
   * since this call and nothing else. `previous` is cleared with it, or the first interval after a
   * reset would be the gap between the two states — a duration belonging to neither. The arrays are
   * not cleared because nothing reads a slot past `filled`. A reader's call, never the frame's.
   */
  const reset = (): void => {
    cursor = 0;
    filled = 0;
    previous = 0;
    // The published means go with the window: a reader that clears it must not be handed the last
    // mean of the window it just dropped — a `frameMs` for frames it has decided do not count. The
    // frame count stays, because the sky has not stopped drawing; a reader watching `frames` sees
    // the sky still move while the means start again from nothing, which is the whole point of it.
    reading.fps = 0;
    reading.frameMs = 0;
    reading.stepMs = 0;
    reading.drawMs = 0;
  };

  /** ONE object, made here and mutated in place on every frame — the published reading itself. */
  const reading: PublishedPerf = {
    frames: 0,
    fps: 0,
    frameMs: 0,
    stepMs: 0,
    drawMs: 0,
    z: 0,
    coarse: false,
    act: 0,
    renderer: 'canvas',
    mode: 'frame',
    reset,
  };

  const begin = (): void => {
    const now = performance.now();
    // The interval is takeoff to takeoff. The frame's own `now` is the wire's clock in epoch
    // milliseconds and has no place in a duration beside these three.
    intervals[cursor] = previous === 0 ? 0 : now - previous;
    previous = now;
    began = now;
  };

  const afterStep = (): void => {
    stepped = performance.now();
  };

  const end = (sample: PerfSample): void => {
    const finished = performance.now();
    steps[cursor] = stepped - began;
    draws[cursor] = finished - stepped;
    cursor = (cursor + 1) % WINDOW;
    if (filled < WINDOW) filled += 1;
    frames += 1;

    const intervalMs = meanOf(intervals, filled, tally);
    const intervalCount = tally[0];
    const stepMs = meanOf(steps, filled, tally);
    const drawMs = meanOf(draws, filled, tally);

    // The scalars first: they are this frame's truth whatever the last 120 were.
    reading.frames = frames;
    reading.z = sample.z;
    reading.coarse = sample.coarse;
    reading.act = sample.act;
    reading.renderer = sample.renderer;
    reading.mode = sample.mode;
    reading.stepMs = stepMs;
    reading.drawMs = drawMs;
    reading.frameMs = intervalMs;
    reading.fps = intervalCount === 0 || intervalMs === 0 ? 0 : 1000 / intervalMs;

    // Guarded, because this module is also imported by a Node script through the layout's own barrel
    // and a script has no page to publish to. The reading is still the same object on that side.
    if (typeof window !== 'undefined') window.__universePerf = reading;
  };

  return { begin, afterStep, end };
}
