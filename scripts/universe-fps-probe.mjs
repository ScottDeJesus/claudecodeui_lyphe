#!/usr/bin/env node
// Opens the real app in a real browser, walks the sky to three camera states, and reports what a
// frame cost at each — plus once more with the expensive look switched on.
//
//   node scripts/universe-fps-probe.mjs <app-url> <token> [--out <file>] [--tweaks <json>]
//
// It prints exactly one line and exits:
//
//   fit=<fps>/<step>/<draw>/<other> package=<…> folder=<…> folder+dof=<…> renderer=<canvas|webgl> painted=<n>
//
// so a caller greps the result instead of reading a log, and `NO-PERF` (with the reason on stderr)
// when the tab, the counter or a zoom state never arrives. With `--out` the same line is appended to
// that file with an ISO timestamp, so a phase can keep its before and its after side by side.
//
// THE FOURTH NUMBER IS WHAT THE INSTRUMENT CANNOT SEE — `frameMs − stepMs − drawMs`, the part of a
// frame the counter attributes to neither the layout nor the draw. It is in the line because the two
// numbers beside it are not a frame rate: at folder this box spends under 40 ms a frame in the sky's
// own work and over 250 ms in a frame, so a falling `draw` is no promise that the frame rate moved,
// and a caller comparing only the first three would read a passing draw as a passing sky.
//
// WHY IT READS `window.__universePerf` AND NOT A LOOP OF ITS OWN. A frame rate measured by asking the
// browser how fast requestAnimationFrame fires is the BROWSER's cadence, not the sky's: the sky's loop
// drops to a 250 ms tick once nothing has happened for twenty seconds, and a probe that drew its own
// 60 Hz loop would report 60 with the sky frozen. The counter is written by the sky's own loop, in the
// sky's own frame, so `mode` rides along on every sample and only `frame` samples are averaged. A
// quiet sky reports ~4 a second and the probe says so instead of pretending.
//
// AND `mode` IS THE CADENCE OF THE FRAME THAT DREW, not of the one after it: the loop remembers how
// the frame it is running was scheduled and answers with that, so a sample taken inside a tick-drawn
// frame says `tick`. That is the whole of what makes the filter above real — asked for the NEXT
// pending frame instead, every sample would say `frame` whenever a hand had just moved, and the idle
// tick would be averaged in as a slow sky.
//
// WHY IT CLEARS THE COUNTER'S WINDOW TWICE. Every published number is a mean over the counter's last
// 120 frames, and a mean describes a state only if every frame in it was drawn in that state. So the
// probe calls `window.__universePerf.reset()` the instant a state begins — a reading taken 30 frames
// into `folder` would otherwise be three quarters the zoom that led there — and calls it a SECOND time
// once the state has settled, because the frames between the last wheel event and the end of the
// settle are moving ones: under the layer cadence a frame whose camera moved repaints the star layer
// and a still one mostly does not, so those frames cost several times what the settled state costs and
// the single clear keeps every one of them inside the mean the state is judged by. Every frame in the
// mean below is therefore a frame drawn after the second clear. What is left to wait out is the mean's
// own noise, and that wait is counted in the counter's frames, so it is the same wait at 5 fps and 60.
//
// WHY IT KEEPS TOUCHING THE CANVAS. The loop's fast path lapses twenty seconds after the last row or
// the last hand, which is longer than the whole walk — but a pointer move every second costs nothing
// and makes the walk independent of that constant, of a stray idle timer, and of a tab that was
// backgrounded mid-sample. It also means the numbers below describe a sky a person is looking at.
//
// AND THE HAND RESTS OFF THE SKY. A hover that lands on a star pivots the focus, which draws every
// other star dimmed and individually rather than batched: measured at one camera, the same sky cost
// 30.9 ms a frame with the hand on empty space and 76.3 ms with it on a star, and the step did not
// move at all. The pointer move exists only to keep the loop awake — `noteInteraction` fires wherever
// the hand is — so it goes to a corner of the canvas, and the sky's own cursor (`pointer` over a
// node, `grab` over empty sky) is asked after every move, moving the hand on when a drift or a zoom
// has put a star under it.
//
// WHY REAL WHEEL EVENTS RATHER THAN A HOOK. The camera lives in a closure inside the canvas component
// and stays there; the only way in is the input path a hand uses. Dispatching `mouseWheel` at the
// canvas centre through the DevTools protocol is that path — and it proves the pointer wiring while it
// measures, which a window hook would quietly bypass.
//
// Two neighbours carry the parts that are not the walk: `scripts/universe-browser.mjs` is the chrome
// (nothing here knows how a headless browser is started, nor how a wheel event is dispatched) and
// `scripts/universe-paint.mjs` is the metric (nothing here decides what counts as drawn). This file is
// the path between them — the same walk `universe-ui-probe.mjs` makes, with a stopwatch in it.
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { WAIT_MS, closeBrowser, connectBrowser, evaluate, launchBrowser, openTab, waitFor } from './universe-browser.mjs';
import { CANVAS, readPaint } from './universe-paint.mjs';

/**
 * How long the whole probe may take before it answers rather than hanging. A pass takes about two and
 * a half minutes at this box's frame rates — two loads, four states, each settled and then left to
 * settle again — so this only ever fires on a page that has stopped drawing.
 */
const WATCHDOG_MS = 240_000;
/**
 * WHEN A STATE IS SETTLED ENOUGH TO BE MEASURED — frames of the state itself, counted on the counter.
 *
 * The window is cleared on entering a state and again once the state has settled (see the header), so
 * this is not a wait for the intro to leave a 120-frame mean: every frame counted here was drawn after
 * the state began. It is a frame count rather than a wall clock, because a wall clock is a different
 * wait at every speed — the same twelve seconds is a hundred frames here and a thousand after a fast
 * phase.
 *
 * AND IT IS WAITED OUT TWICE PER STATE, once after each clear. The frames between the last wheel event
 * and the end of the settle are moving ones — a moved camera repaints the star layer, a still one
 * repaints on its cadence — so the second settle is what leaves a still state's mean holding still
 * frames only. That is why the count is paid at both ends of every state, and why the watchdog above
 * carries two and a half minutes rather than one.
 *
 * WHY NOT A WHOLE WINDOW. Thirty frames is enough to leave the mean's own startup behind, and 120 is
 * what this box cannot afford: at its 2-8 fps a whole window is 15-60 s per state, four states, which
 * with two loads and the walks between them is the whole budget the probe allows itself. Half of that
 * spent on three of the four numbers would also make the walk hostage to a busy box.
 */
const SETTLE_FRAMES = 30;
const SETTLE_EVERY_MS = 500;
/** A backstop per state, so a sky that never settles answers instead of eating the watchdog. */
const SETTLE_MAX_MS = 30_000;
/** How far inside the canvas a resting hand sits — clear of the panel's own edges and any rounding. */
const HAND_INSET = 12;
/** How often a sample is read, for how long: a handful of readings of the settling window. Two
 *  seconds at 250 ms is eight readings per state, four states, and the run has to fit its watchdog
 *  on a box where the two slow states draw under 5 fps. */
const SAMPLE_EVERY_MS = 250;
const SAMPLE_FOR_MS = 2_000;
/** How long to wait for the frame counter to exist at all after the tab opens. */
const PERF_MS = 30_000;
/**
 * How long the sky is left alone after a load, before anything is measured. A sky a second old is not
 * the sky the gates name: the camera is still easing from its opening zoom toward the fitted one, and
 * the springs are still pulling the tree off the rings it was born on, so a frame drawn then is both
 * a different view and a different arrangement of stars. Measured: sampling straight after the tab
 * opened, the same fit state drew 36.5 ms a frame on one run and 74.9 on the next. The wait is in the
 * load path rather than in front of the first state, so the walk back after the reload gets it too —
 * `folder` and `folder+dof` are compared against each other, and they must differ by the look alone.
 */
const INTRO_MS = 12_000;
/**
 * The wheel: the app's own rate and push, how long between events, and how many before the probe
 * gives up on the state. The probe inverts the law the app zooms by — `z · e^(−deltaY · rate)` — so
 * one event LANDS where it was aimed instead of leaping over the band and hunting for it: a push
 * sized by a constant multiplier is three times the zoom at every event, and a band 1.6× wide is
 * crossed as often as entered. `WHEEL_MAX_PUSH` keeps an aim from far out a scroll rather than one
 * absurd event, and every event is followed by a read of the live zoom, so a frame that landed late
 * is corrected by the next one instead of compounding.
 */
const WHEEL_RATE = 0.0016;
const WHEEL_MAX_PUSH = 2_000;
const WHEEL_EVERY_MS = 100;
const WHEEL_EVENTS = 40;
const TICK_MS = 1_000;
/** The three camera states: fit as opened, and the zoom bands written in the plan. */
const ZOOM_BANDS = { package: [0.5, 0.8], folder: [1.4, 2.2] };
/** The look the last sample is taken with, merged over whatever `--tweaks` carried. */
const DOF_TWEAKS = { depthOfField: 0.6, trails: 8 };
/** The key `useUniverseTweaks` reads the diff from defaults under. */
const TWEAKS_KEY = 'universe.tweaks.v1';
/** The Universe tab's accessible name, exactly as `universe-ui-probe.mjs` finds it. */
const TAB_LABEL = 'Universe';
/** The sidebar's first project row, clicked — the app opens no workspace until one is. */
const SELECT_FIRST_PROJECT = `(() => {
  const row = document.querySelector('div[class*="20.5rem"] .pb-safe-area-inset-bottom > div > div.group > button');
  if (row === null) return false;
  row.click();
  return true;
})()`;
/** The workspace strip exists only once a project is open — the app's own "we are somewhere" signal. */
const TABS_PRESENT = 'document.querySelectorAll(\'[role="tab"]\').length > 0';
/** The canvas has taken its box — a canvas in an unmounted or hidden pane is 0 by 0. */
const CANVAS_SIZED = `(() => {
  const canvas = document.querySelector(${JSON.stringify(CANVAS)});
  if (canvas === null) return false;
  const rect = canvas.getBoundingClientRect();
  return canvas.width > 0 && canvas.height > 0 && rect.width > 0 && rect.height > 0;
})()`;
/** The counter the sky's own loop publishes. Absent while there is no sky, or no loop. */
const PERF_PRESENT = 'typeof window.__universePerf === "object" && window.__universePerf !== null';
/** One reading of the counter, or null while it is not there yet. Named field by field rather than
 *  spread: the published object carries a method, and a copy of it is data a caller can print. */
const READ_PERF = `(() => {
  const p = window.__universePerf;
  if (p === undefined || p === null) return null;
  return {
    frames: p.frames, fps: p.fps, frameMs: p.frameMs, stepMs: p.stepMs, drawMs: p.drawMs,
    z: p.z, coarse: p.coarse, act: p.act, renderer: p.renderer, mode: p.mode,
  };
})()`;
/** Forget the counter's window, so the means that follow cover this state and nothing before it. */
const RESET_PERF = '(() => { const p = window.__universePerf; if (p === undefined || p === null || typeof p.reset !== "function") return false; p.reset(); return true; })()';
/** The one reason a state cannot be measured — the counter publishes no window for its mean to cover.
 *  ONE object, returned by both clears of that window, so the failure reads the same either way. */
const NO_WINDOW = { error: 'the counter publishes no window to clear, so no mean of this state could be read' };
/** The sky's own report of what the hand is over: `pointer` on a node, `grab` on empty sky. Set only
 *  when the hover changes, so it always describes where the hand currently is. */
const CURSOR = `(() => { const canvas = document.querySelector(${JSON.stringify(CANVAS)}); return canvas === null ? null : canvas.style.cursor; })()`;

const USAGE = 'usage: node scripts/universe-fps-probe.mjs <app-url> <token> [--out <file>] [--tweaks <json>]';
const NO_PERF = 'NO-PERF';

/** The browser, from the moment it exists until it is shut down — reachable by the watchdog. */
let browser = null;
/** The step the probe is on, in the caller's words: why the watchdog fired, if it did. */
let stage = 'the browser starting';

/** Answers the one line and leaves. The last line is the contract, and it runs after the browser has
 *  been shut down, never instead of it. */
function report(line, reason) {
  if (reason) console.error(`universe-fps-probe: ${reason}`);
  console.log(line);
  process.exit(line === NO_PERF ? 1 : 0);
}

/** The answer when there is nothing to report: the one word, and why. */
function noPerf(reason) {
  return { line: NO_PERF, reason };
}

const watchdog = setTimeout(async () => {
  if (browser) await closeBrowser(browser);
  report(NO_PERF, `nothing settled within ${WATCHDOG_MS}ms — still waiting on ${stage}`);
}, WATCHDOG_MS);
watchdog.unref();

/** What the key held, as a plain object — unreadable or absent text is the empty diff. */
function storedDiff(stored) {
  if (typeof stored !== 'string') return {};
  try {
    const parsed = JSON.parse(stored);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** One decimal, which is all a frame budget needs and all a report should carry. */
function round(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0';
}

/** The four numbers a frame is judged by, as one reading of the counter has them. */
function frameCost(samples) {
  const count = samples.length;
  const total = samples.reduce((sum, sample) => ({
    fps: sum.fps + (Number.isFinite(sample.fps) ? sample.fps : 0),
    frameMs: sum.frameMs + (Number.isFinite(sample.frameMs) ? sample.frameMs : 0),
    stepMs: sum.stepMs + (Number.isFinite(sample.stepMs) ? sample.stepMs : 0),
    drawMs: sum.drawMs + (Number.isFinite(sample.drawMs) ? sample.drawMs : 0),
  }), { fps: 0, frameMs: 0, stepMs: 0, drawMs: 0 });
  const stepMs = total.stepMs / count;
  const drawMs = total.drawMs / count;
  const frameMs = total.frameMs / count;
  return {
    fps: total.fps / count,
    stepMs,
    drawMs,
    frameMs,
    // The frame's unaccounted time: what the whole period cost beyond the two things the counter
    // stamps. Negative would mean the instrument attributed more to a frame than the frame lasted,
    // and is reported as measured rather than clamped, because that is a fact about the counter.
    otherMs: frameMs - stepMs - drawMs,
    renderer: samples[count - 1].renderer,
    z: samples[count - 1].z,
  };
}

/** One camera state's numbers in the probe's own voice: `fps/step/draw/other`. */
function costText(cost) {
  return `${round(cost.fps)}/${round(cost.stepMs)}/${round(cost.drawMs)}/${round(cost.otherMs)}`;
}

/** Tabs carry their label as their accessible name — the attribute the harness selects them by. */
function clickTab(label) {
  return `(() => {
    const label = ${JSON.stringify(label)};
    const tab = Array.from(document.querySelectorAll('[role="tab"]'))
      .find((node) => node.getAttribute('aria-label') === label);
    if (!tab) return false;
    tab.click();
    return true;
  })()`;
}

/** The canvas's centre in the page's own coordinates — where a hand would put a wheel. */
const CANVAS_CENTRE = `(() => {
  const canvas = document.querySelector(${JSON.stringify(CANVAS)});
  if (canvas === null) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
})()`;

/**
 * Where a resting hand may go: the canvas's four corners, inset, and only those the canvas is on top
 * of — a corner under a floating panel is a pointer move the sky never sees, so the loop would go
 * back to sleep while the probe waited on frames that were not being drawn. Measured on this app all
 * four corners are the canvas itself, and the filter is what keeps that true if a panel moves. The
 * one point that is NOT a candidate is the centre, which is the sun at fit and a node at most zooms.
 */
const CANVAS_HAND_POINTS = `(() => {
  const canvas = document.querySelector(${JSON.stringify(CANVAS)});
  if (canvas === null) return [];
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return [];
  const inset = ${HAND_INSET};
  const corners = [
    { x: Math.round(rect.left + inset), y: Math.round(rect.top + inset) },
    { x: Math.round(rect.left + inset), y: Math.round(rect.bottom - inset) },
    { x: Math.round(rect.right - inset), y: Math.round(rect.top + inset) },
    { x: Math.round(rect.right - inset), y: Math.round(rect.bottom - inset) },
  ];
  return corners.filter((point) => document.elementFromPoint(point.x, point.y) === canvas);
})()`;

/** Reads the live zoom off the counter — the value the last frame actually drew with. */
function zoomScript() {
  return `(() => { const p = window.__universePerf; return p === undefined ? null : p.z; })()`;
}

/** A wheel event at the page's own point, positive `deltaY` zooming out and negative in. */
function wheel(cdp, sessionId, point, deltaY) {
  return cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: point.x,
    y: point.y,
    deltaX: 0,
    deltaY,
    button: 'none',
    pointerType: 'mouse',
  }, sessionId);
}

/** The hand that keeps the sky awake: one hover, on the probe's own clock. */
function hover(cdp, sessionId, point) {
  return cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none',
    pointerType: 'mouse',
  }, sessionId);
}

/** The points a state's hand may rest at — empty when the canvas is covered at every corner. */
async function restPoints(cdp, sessionId) {
  const points = await evaluate(cdp, sessionId, CANVAS_HAND_POINTS).catch(() => null);
  return Array.isArray(points) ? points : [];
}

/**
 * Keeps the sky awake without editing what it draws: a pointer move at the hand's current point,
 * then the sky's own cursor asked whether that landed on a star. `pointer` means it did — the hover
 * pivots the focus and the next frames cost a third more — so the hand moves to the next corner and
 * the move is repeated. A camera that drifts, or a zoom that brings a directory over the corner,
 * is caught on the next tick rather than corrupting the sample in silence.
 */
async function restHand(cdp, sessionId, hand) {
  for (let attempt = 0; attempt < hand.points.length; attempt += 1) {
    const point = hand.points[hand.index];
    await hover(cdp, sessionId, point).catch(() => {});
    const cursor = await evaluate(cdp, sessionId, CURSOR).catch(() => null);
    if (cursor !== 'pointer') return;
    hand.index = (hand.index + 1) % hand.points.length;
  }
}

/** How a reading reads in a reason line, so a failure says what the counter was actually doing. */
function readingText(reading) {
  if (reading === null) return 'nothing';
  return `fps=${round(reading.fps)} frameMs=${round(reading.frameMs)} stepMs=${round(reading.stepMs)}`
    + ` drawMs=${round(reading.drawMs)} mode=${reading.mode} frames=${reading.frames}`;
}

/**
 * Waits out `SETTLE_FRAMES` frames of the current state on the counter's own `frames` — `null` once
 * they are past, or the reason they never were. The target is fixed at the FIRST reading after the
 * clear, and `min` keeps it there as the counter advances, so the wait is the same number of frames
 * from where the state found the sky rather than from wherever the last reading happened to be. The
 * hand rests off the sky on its own cadence throughout, and every reading is left in `last.reading`
 * for a caller that has to say what the counter was doing when it gave up.
 */
async function waitForSettle(cdp, sessionId, hand, last) {
  let targetFrames = Infinity;
  const deadline = Date.now() + SETTLE_MAX_MS;
  let nextHover = Date.now();

  for (;;) {
    const reading = await evaluate(cdp, sessionId, READ_PERF).catch(() => null);
    if (reading !== null) {
      last.reading = reading;
      targetFrames = Math.min(targetFrames, reading.frames + SETTLE_FRAMES);
      if (reading.frames >= targetFrames) return null;
    }
    if (Date.now() >= deadline) {
      return `the counter never drew ${SETTLE_FRAMES} frames for this state`
        + ` within ${SETTLE_MAX_MS}ms (${readingText(last.reading)})`;
    }
    if (Date.now() >= nextHover) {
      nextHover = Date.now() + TICK_MS;
      await restHand(cdp, sessionId, hand);
    }
    await delay(SETTLE_EVERY_MS);
  }
}

/**
 * Samples the counter for `SAMPLE_FOR_MS` once the state has settled, and returns the numbers.
 *
 * THE WINDOW IS CLEARED FIRST, so the means that follow cover this state and nothing before it. That
 * is what makes the numbers a property of the state rather than of the walk that led to it: without
 * it, a folder zoom that costs 60 ms a frame three quarters fills the window the still camera is
 * about to be measured over, and the phase that has just made the still sky cheap fails its gate. A
 * `frame`-mode frame is the LOOP's frame, and under the layer cadence the star layer is repainted by
 * the camera having moved rather than by the frame being drawn, so the window is cleared a SECOND time
 * once the state has settled and the settle waited out again: a still camera's mean then holds frames
 * a still camera drew, not the zoom that led to it.
 *
 * ONLY `frame`-MODE READINGS ARE AVERAGED. A tick-mode frame is the loop deciding the sky is asleep
 * and drawing four a second on purpose; a hidden one is a page nobody can see. Neither is a slow
 * frame, and averaging either in is the single easiest way to report a working sky as 4 fps.
 *
 * AND ONLY POST-SETTLE ONES. `SETTLE_FRAMES` frames are let past, counted on the counter's own
 * `frames`, which makes it the same wait at 5 fps and at 60. It is a frame count and NOT a "the frame
 * rate has stopped moving" test, deliberately: on this box the rate genuinely wanders several percent
 * either side of its own mean, so a stillness test times out on a sky that is working perfectly,
 * while a frame count is monotone and therefore always reachable.
 */
async function sampleFrameCost(cdp, sessionId) {
  const cleared = await evaluate(cdp, sessionId, RESET_PERF).catch(() => false);
  if (cleared !== true) {
    return NO_WINDOW;
  }
  const points = await restPoints(cdp, sessionId);
  // No corner of the canvas is the canvas — a panel covers all four. The hand is what keeps the loop
  // on its fast path, and the only other place to put it is a star, which would change what this
  // sample measures. So the probe says so rather than printing a number about a sky with a hand on it.
  if (points.length === 0) {
    return { error: 'the canvas is covered at every corner, so the hand cannot rest off the sky' };
  }
  const hand = { points, index: 0 };
  const last = { reading: null };

  const settled = await waitForSettle(cdp, sessionId, hand, last);
  if (settled !== null) return { error: settled };

  // THE WINDOW IS CLEARED AGAIN, NOW THE STATE HAS SETTLED. The frames kept by the clear above reach
  // back to the last wheel event, and every one of them was a MOVING frame: a camera that has moved
  // repaints the star layer, a still one mostly does not, so those frames cost a multiple of what the
  // state they landed in costs and would be averaged in as if the camera were standing still. Cleared
  // here, and the settle waited out once more, the mean below covers still frames only.
  const recleared = await evaluate(cdp, sessionId, RESET_PERF).catch(() => false);
  if (recleared !== true) {
    return NO_WINDOW;
  }
  const resettled = await waitForSettle(cdp, sessionId, hand, last);
  if (resettled !== null) return { error: resettled };

  // The sampling pass, from here on: every reading is a frame of this state, past the settle gate,
  // and only `frame`-mode ones are kept.
  let lastReading = last.reading;
  const frameMode = [];
  const until = Date.now() + SAMPLE_FOR_MS;
  let nextHover = Date.now();
  while (Date.now() < until) {
    const reading = await evaluate(cdp, sessionId, READ_PERF).catch(() => null);
    if (reading !== null && reading.mode === 'frame') frameMode.push(reading);
    if (reading !== null) lastReading = reading;
    if (Date.now() >= nextHover) {
      nextHover = Date.now() + TICK_MS;
      await restHand(cdp, sessionId, hand);
    }
    await delay(SAMPLE_EVERY_MS);
  }
  if (frameMode.length === 0) {
    return { error: lastReading === null
      ? 'the counter was never readable while sampling'
      : `every sample was mode=${lastReading.mode}, so the sky drew no animation frame (${readingText(lastReading)})` };
  }
  return { cost: frameCost(frameMode) };
}

/**
 * Turns the wheel at the canvas centre until the LIVE zoom is inside the band, aiming at the band's
 * middle: the wheel moves the zoom by a ratio, so the middle of a ratio band is its geometric mean,
 * and aiming there lands every run of every phase at the same camera state — which is what makes a
 * before and an after comparable at all. The live zoom is read back after every event rather than
 * assumed: one event's push depends on the frame it lands between, so a loop that trusted its own
 * arithmetic would drift off the band and never know it.
 */
async function zoomTo(cdp, sessionId, band) {
  const point = await evaluate(cdp, sessionId, CANVAS_CENTRE);
  if (point === null) return { error: 'the canvas has no centre to zoom at' };
  const [low, high] = band;
  const aim = Math.sqrt(low * high);
  let z = await evaluate(cdp, sessionId, zoomScript()).catch(() => null);
  if (typeof z !== 'number') return { error: 'the counter has no zoom to read' };
  for (let i = 0; i < WHEEL_EVENTS; i += 1) {
    if (z >= low && z <= high) return { ready: true };
    const push = Math.max(-WHEEL_MAX_PUSH, Math.min(WHEEL_MAX_PUSH, -Math.log(aim / z) / WHEEL_RATE));
    await wheel(cdp, sessionId, point, push);
    await delay(WHEEL_EVERY_MS);
    z = await evaluate(cdp, sessionId, zoomScript()).catch(() => null);
    if (typeof z !== 'number') return { error: 'the counter stopped reporting a zoom mid-zoom' };
  }
  return { error: `the zoom never reached ${low}-${high} in ${WHEEL_EVENTS} wheel events (last ${z})` };
}

/** Everything after a load: the strip, the tab, the canvas, the counter. */
async function openSky(cdp, sessionId) {
  stage = 'the app painting anything at all';
  if (!await waitFor(cdp, sessionId, 'document.body.innerText.trim().length > 0')) {
    return { error: 'the app painted nothing at all after the token was written and the page reloaded' };
  }
  stage = 'a project being selected';
  // THE STRIP EXISTS ONLY ONCE A PROJECT IS OPEN, and the app no longer opens one on its own.
  if (!await waitFor(cdp, sessionId, SELECT_FIRST_PROJECT, 15_000)) {
    return { error: 'no project row appeared in the sidebar, so no workspace could be opened' };
  }
  stage = 'the workspace tab strip';
  if (!await waitFor(cdp, sessionId, TABS_PRESENT, 10_000)) {
    return { error: `no workspace tab strip appeared, so there is no "${TAB_LABEL}" tab to open` };
  }
  stage = `the "${TAB_LABEL}" tab opening`;
  if (!await waitFor(cdp, sessionId, clickTab(TAB_LABEL))) {
    return { error: `no tab labelled "${TAB_LABEL}"` };
  }
  stage = 'the canvas taking its box';
  if (!await waitFor(cdp, sessionId, CANVAS_SIZED)) {
    return { error: `opening "${TAB_LABEL}" produced no canvas with a size within ${WAIT_MS}ms` };
  }
  stage = 'the perf counter existing';
  if (!await waitFor(cdp, sessionId, PERF_PRESENT, PERF_MS)) {
    return { error: `the canvas took its box but no window.__universePerf appeared within ${PERF_MS}ms` };
  }
  stage = 'the intro finishing';
  await delay(INTRO_MS);
  return { ready: true };
}

/**
 * The whole walk, from the browser to the one line. Returns `{ line, reason? }`, never an exit:
 * leaving has to happen where the browser is shut down, so a probe that fails and one that passes
 * leave the box in exactly the same state.
 */
async function main({ appUrl, token, tweaks, outPath }) {
  try {
    const launched = await launchBrowser();
    browser = launched;
    stage = "the browser's own debugging socket";
    const cdp = await connectBrowser(launched.port);
    stage = 'the first page opening';
    const sessionId = await openTab(cdp, appUrl);

    // An app that is not answering leaves the browser on its own error page — a document that IS
    // complete, on an origin that will throw when `localStorage` is touched. So "did it load?" is
    // asked of the ORIGIN and not of `readyState`, or the next reader is sent chasing a credential
    // problem on an app that is simply down.
    stage = `${appUrl} finishing its first load`;
    const landed = `location.origin === ${JSON.stringify(new URL(appUrl).origin)} && document.readyState === "complete"`;
    if (!await waitFor(cdp, sessionId, landed)) {
      const shown = await evaluate(cdp, sessionId, 'location.href').catch(() => '(nothing)');
      return noPerf(`${appUrl} never finished loading — the browser is on ${shown}`);
    }

    // The token goes in on the app's OWN origin, which is why the navigation came first: on a blank
    // page localStorage belongs to nobody, and the write would be discarded. The tweaks go in at the
    // same instant, in the same origin, so the sky's FIRST frame already has them — the hook reads
    // the key once at mount.
    const previousTweaks = await evaluate(cdp, sessionId, `localStorage.getItem(${JSON.stringify(TWEAKS_KEY)})`);
    // What was already stored is KEPT, not overwritten: `--tweaks` is one caller's diff, and a phase
    // that passes it must not silently clear a control a previous phase set. The store stays the
    // DIFF shape `useUniverseTweaks` itself writes, and what a value means is `parseTweaks`'s
    // business — it clamps, drops unknown keys and defaults the rest, so nothing here second-guesses
    // a value the app is about to validate anyway.
    const wanted = { ...storedDiff(previousTweaks), ...tweaks };
    if (Object.keys(wanted).length > 0) {
      await evaluate(cdp, sessionId, `localStorage.setItem(${JSON.stringify(TWEAKS_KEY)}, ${JSON.stringify(JSON.stringify(wanted))})`);
    }
    // The key goes back the moment the entry tweaks are written, NOT at the end of the walk: from
    // here on every `NO-PERF` return — a canvas that never sized, a zoom that never landed, the
    // watchdog killing the process — leaves the app's storage exactly as the probe found it. Each
    // later write is wrapped so a failure on some other path restores rather than leaves it written.
    const restoreTweaks = async () => {
      const write = previousTweaks === null
        ? `localStorage.removeItem(${JSON.stringify(TWEAKS_KEY)})`
        : `localStorage.setItem(${JSON.stringify(TWEAKS_KEY)}, ${JSON.stringify(previousTweaks)})`;
      await evaluate(cdp, sessionId, write).catch(() => {});
    };
    const writeTweaks = async (value) => {
      await evaluate(cdp, sessionId, `localStorage.setItem(${JSON.stringify(TWEAKS_KEY)}, ${JSON.stringify(JSON.stringify(value))})`);
      // READ BACK, not assumed: this proves the key's name and this profile's storage both still
      // mean what the probe thinks. A silent rename or a refused write would otherwise leave the
      // last sample measuring the plain look and printing a perfectly well-formed line.
      const stored = await evaluate(cdp, sessionId, `localStorage.getItem(${JSON.stringify(TWEAKS_KEY)})`);
      if (stored !== JSON.stringify(value)) {
        return { error: `the tweaks key did not take what was written (${TWEAKS_KEY} holds ${stored})` };
      }
      return { ready: true };
    };

    await evaluate(cdp, sessionId, `localStorage.setItem('auth-token', ${JSON.stringify(token)})`);
    await cdp.send('Page.reload', {}, sessionId);
    stage = `${appUrl} finishing the reload`;
    if (!await waitFor(cdp, sessionId, 'document.readyState === "complete"')) {
      await restoreTweaks();
      return noPerf(`${appUrl} never finished reloading`);
    }
    const opened = await openSky(cdp, sessionId);
    if (opened.error) {
      await restoreTweaks();
      return noPerf(opened.error);
    }

    // The intro was waited out by `openSky`, and the sample clears the counter's window the instant
    // it starts, so neither the arrival nor that wait can reach the mean below. The wheel's own point
    // is read inside `zoomTo`, for each zoom it makes.
    stage = 'sampling at fit';
    const fit = await sampleFrameCost(cdp, sessionId);
    if (fit.error) {
      await restoreTweaks();
      return noPerf(`fit: ${fit.error}`);
    }

    stage = 'zooming to package';
    const pack = await zoomTo(cdp, sessionId, ZOOM_BANDS.package);
    if (pack.error) {
      await restoreTweaks();
      return noPerf(pack.error);
    }
    stage = 'sampling at package';
    const packageCost = await sampleFrameCost(cdp, sessionId);
    if (packageCost.error) {
      await restoreTweaks();
      return noPerf(`package: ${packageCost.error}`);
    }

    stage = 'zooming to folder';
    const folder = await zoomTo(cdp, sessionId, ZOOM_BANDS.folder);
    if (folder.error) {
      await restoreTweaks();
      return noPerf(folder.error);
    }
    stage = 'sampling at folder';
    const folderCost = await sampleFrameCost(cdp, sessionId);
    if (folderCost.error) {
      await restoreTweaks();
      return noPerf(`folder: ${folderCost.error}`);
    }

    stage = 'reading the paint at folder';
    const painted = await readPaint(cdp, sessionId);
    if (painted === null) {
      await restoreTweaks();
      return noPerf('the canvas could not be read back at folder zoom');
    }

    // The look the phases are targeted against: depth of field and trails both on, over the same
    // walk's own tweaks — so `folder` and `folder+dof` differ by the look and nothing else.
    stage = 'writing the look and reloading';
    const look = { ...wanted, ...DOF_TWEAKS };
    const written = await writeTweaks(look);
    if (written.error) {
      await restoreTweaks();
      return noPerf(`folder+dof: ${written.error}`);
    }
    await cdp.send('Page.reload', {}, sessionId);
    if (!await waitFor(cdp, sessionId, 'document.readyState === "complete"')) {
      await restoreTweaks();
      return noPerf(`${appUrl} never finished the reload with the look applied`);
    }
    const reopened = await openSky(cdp, sessionId);
    if (reopened.error) {
      await restoreTweaks();
      return noPerf(`with the look applied: ${reopened.error}`);
    }

    // The reload re-ran the intro, so the walk back to folder zoom starts from a fresh camera — and
    // it is the SAME walk, which is what makes `folder` and `folder+dof` comparable at all. The
    // settle before each sample is the counter's own progress, not this delay: this only lets the
    // page finish mounting before the wheel starts turning.
    stage = 'zooming back to folder with the look applied';
    const again = await zoomTo(cdp, sessionId, ZOOM_BANDS.folder);
    if (again.error) {
      await restoreTweaks();
      return noPerf(`with the look applied: ${again.error}`);
    }
    stage = 'sampling at folder with the look applied';
    const lookCost = await sampleFrameCost(cdp, sessionId);
    if (lookCost.error) {
      await restoreTweaks();
      return noPerf(`folder+dof: ${lookCost.error}`);
    }

    // Belt as well as braces: every return above restores the key, and this is the one on the way
    // out of a good run — a visitor leaves the profile as it found it, or not at all.
    stage = 'restoring the tweaks';
    await restoreTweaks();

    // Exactly the documented line and nothing else: a caller greps it, and `look` is already public
    // in what this wrote to the key (`writeTweaks` read it back) — the proof does not belong here.
    const line = `fit=${costText(fit.cost)} package=${costText(packageCost.cost)} folder=${costText(folderCost.cost)}`
      + ` folder+dof=${costText(lookCost.cost)} renderer=${lookCost.cost.renderer} painted=${painted.painted}`;
    if (outPath) {
      await mkdir(path.dirname(outPath), { recursive: true });
      await appendFile(outPath, `${new Date().toISOString()} ${line}\n`);
    }
    return { line };
  } catch (error) {
    return noPerf(error.message);
  } finally {
    if (browser) await closeBrowser(browser);
    browser = null;
  }
}

/** One flag's value: `--out value` and `--out=value` both work, because a caller will use both. */
function flagValue(argv, name) {
  const inline = argv.find((argument) => argument.startsWith(`--${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 3);
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
}

const argv = process.argv.slice(2);
const appUrl = argv[0] && !argv[0].startsWith('--') ? argv[0] : undefined;
const token = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
const outPath = flagValue(argv, 'out');
const tweaksArg = flagValue(argv, 'tweaks');
let tweaks = {};
let usageError = null;
if (tweaksArg !== undefined) {
  try {
    const parsed = JSON.parse(tweaksArg);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      usageError = '--tweaks must be a JSON object of tweak values';
    } else {
      tweaks = parsed;
    }
  } catch (error) {
    usageError = `--tweaks is not JSON: ${error.message}`;
  }
}
if (!appUrl || !token || usageError) {
  report(NO_PERF, usageError ?? USAGE);
}

let outcome;
try {
  outcome = await main({ appUrl, token, tweaks, outPath });
} catch (error) {
  outcome = noPerf(error.message);
}

clearTimeout(watchdog);
report(outcome.line, outcome.reason);
