import { scrollerOf } from '@/shared/ui/sortable/motion';

/**
 * A pane scrolled by the page's own hand: the pan under a finger and the glide after it, for a list whose
 * rows tell the browser not to scroll at all (`touch-action: none`, `surfaces.css`).
 *
 * WHY THE PAGE SCROLLS IT. A row that lifts on a touch hold must be told the browser will not take the
 * touch, and the only way that holds is for the browser to have no pan to take from the first touch on.
 * Some phones dispatch every touch sequence as uncancelable — a `preventDefault` met after the touch
 * began is ignored, whatever listeners stand (measured on a Galaxy Z Fold 8: `cancelable=false` from the
 * `touchstart`, then a `pointercancel` at the first move past the slop). `touch-action` is the one lever
 * that is read BEFORE the touch, so it is set at rest, and the swipe that starts on a row is scrolled
 * here. A lifted row and a scrolling swipe are the two outcomes of one gesture (`usePointerDrag`'s
 * touch path, `holdMs` with `scrollsPane`); this module is the second outcome.
 *
 * THE PAN follows the finger one to one from the point where it crossed the hold's slop — no jump,
 * because the slop is travelled before the pane moves — and is DELTA-driven, so a finger that is dragged
 * past an end and turned back scrolls back at once. THE GLIDE carries on at the finger's speed, read from
 * the last `VELOCITY_WINDOW_MS` of its moves, and brakes at a constant rate, frame-rate independent. Both
 * clamp at the pane's own ends and never overshoot; a glide that reaches an end stops there.
 *
 * ANY NEW TOUCH STOPS A GLIDE, wherever on the page it lands, as it does natively, and the tap that
 * stopped it opens nothing: the click is spent. So does the click a pan could still end in, when the
 * finger lifted within the browser's tap slop of a press. Both are spent here so that a list which
 * opts in carries no click rule of its own.
 *
 * A PANE'S LIMIT IS ITS OWN `scrollHeight`, which a transformed descendant extends. The sidebar's carry
 * keeps its lifted row inside the list's box (`useSimpleChatDrag`), so the pane's end is the list's end
 * whenever a touch can begin; a list that painted its carried item past its end would pan past it.
 *
 * Used by `usePointerDrag` (its `scrollsPane` option), for the sidebar's chat list and every list on the kit's `useSortable`
 * (the runner, roadmap and dispatcher lists).
 */

/** How far back a release looks for the finger's speed: the last tenth of a second of its moves. */
const VELOCITY_WINDOW_MS = 100;

/**
 * How hard a glide brakes (px/ms², so 2800 px/s²): a constant deceleration, so a glide travels speed²/2a — 45, 179, 714 and
 * 2857 px for a flick of 500, 1000, 2000 and 4000 px/s. The two flings it is set against: Android's `OverScroller`, worked
 * from its published constants (friction 0.015, deceleration rate ln 0.78 / ln 0.9, inflexion 0.35; the density cancels in
 * CSS px), 58, 194, 647 and 2157 px; and headless Chromium's touch fling, measured here at a constant 2640 px/s², 47, 189,
 * 758 and 3030 px. This is within about 25% of both from 500 to 2000 px/s. Neither is measured on the phone.
 */
const GLIDE_DECELERATION = 2.8;

/** The slowest speed a release glides from (px/ms; 50 px/s is Android's minimum fling velocity). */
const GLIDE_REST_SPEED = 0.05;

/** The fastest a glide begins (px/ms), Android's fling ceiling. */
const GLIDE_MAX_SPEED = 8;

/** A pane read back this far (px) from where this module last wrote it was scrolled by someone else, and is theirs now. */
const MOVED_BY_OTHER_PX = 1.5;

/** One moment of a finger: where it was, and when (an event's own `timeStamp`, so a busy main thread does not blur it). */
type Sample = { y: number; time: number };

/** A scroller between a press and its handle: the element, and whether it can scroll vertically now (the browser's whole). */
export type InnerScroller = { node: Element; vertical: boolean };

/**
 * The scroller of `handle`'s own a press on `target` landed in — an element between the two (the target included, the handle
 * not) whose `overflow-x` or `overflow-y` is `auto` or `scroll` — or `null` when the press landed on the card itself. A deck's
 * plan strip, a phase track: `vertical` is `false`, and only a sideways swipe is that scroller's. An element that can scroll
 * vertically now is `vertical: true`: the browser scrolls it, and a page pan beside it would fight it.
 *
 * WHY A VERTICAL SWIPE IS NOT LEFT TO THE BROWSER. It used to be: this walk answered "the browser pans inside any scroller,
 * whatever the handle's `touch-action` says", and `usePointerDrag` returned. That bet holds in headless Chromium and not on the
 * operator's Fold (2026-10-19): a vertical swipe that began on a feature inside a deck's strip scrolled nothing, whether the device
 * resolved the ancestor's `touch-action: none` through the strip or latched the gesture to a strip that cannot move that way. Both
 * leave the early return with nothing to do. So the axis is decided by `usePointerDrag`: a sideways swipe is released to the
 * browser (the strip's own), and a vertical one is panned by the page. A strip holding one card is a scroller here all the same:
 * the browser may latch to it, and a hold on it must never lift the card.
 *
 * A press outside the handle answers `null` (`paneToPan` refuses it).
 */
export function innerScrollerOf(handle: Element, target: EventTarget | null): InnerScroller | null {
  if (!(target instanceof Element) || !handle.contains(target)) return null;
  for (let node: Element | null = target; node !== null && node !== handle; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if (!/(auto|scroll)/.test(overflowX) && !/(auto|scroll)/.test(overflowY)) continue;
    return { node, vertical: /(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight + 1 };
  }
  return null;
}

/**
 * The pane a swipe that began on `target`, inside `handle`, scrolls by hand — or `null` when the browser still owns that swipe: the
 * press landed outside the handle (a portal's, bubbled through React), or the handle is not `touch-action: none` (a hybrid
 * laptop's finger, where the browser pans as ever and a second scroll would double it). A page that scrolls as a whole is the pane
 * when no ancestor does.
 * A press inside a scroller of the handle's own comes here too: `usePointerDrag` decides its axis (`innerScrollerOf`), releasing
 * a sideways swipe to the browser and panning a vertical one.
 */
export function paneToPan(handle: Element, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Node) || !handle.contains(target)) return null;
  if (getComputedStyle(handle).touchAction !== 'none') return null;
  return scrollerOf(handle) ?? (document.scrollingElement as HTMLElement | null);
}

/** A pan in progress, handed back by `beginPan`. */
export type Pan = {
  /** The finger is at `y` (client px) as of `time`. */
  move: (y: number, time: number) => void;
  /** The finger lifted at `time`: a swipe still moving glides on. `cancelled` is a touch the browser took away, which glides nowhere. */
  release: (time: number, cancelled: boolean) => void;
};

/** How far `pane` can scroll, read now. */
const limitOf = (pane: HTMLElement) => Math.max(0, pane.scrollHeight - pane.clientHeight);

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** The glides running, as the function that stops each: a new touch stops them all, as it stops the browser's own. */
const running = new Set<() => void>();

/** The click a stopped glide or a finished pan owes, spent unseen until the next press; at most one is waiting. */
let unspendClick: (() => void) | null = null;

/** The next click is nobody's: it is the tail of a gesture that already did its work. A keyboard's click (`detail` 0) is not that tail. */
function spendNextClick(): void {
  unspendClick?.();
  function spend(event: MouseEvent) {
    if (event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
    unspend();
  }
  // A press is the end of the wait: a click owed by the gesture before it is dispatched before it begins.
  function unspend() {
    window.removeEventListener('click', spend, true);
    window.removeEventListener('pointerdown', unspend, true);
    if (unspendClick === unspend) unspendClick = null;
  }
  unspendClick = unspend;
  window.addEventListener('click', spend, true);
  window.addEventListener('pointerdown', unspend, true);
}

/** A touch landed while something glides: it stops the glide, and its tap is spent. */
function stopGlidesOnTouch(event: PointerEvent): void {
  if (event.pointerType !== 'touch') return;
  stopGlides();
  spendNextClick();
}

function stopGlides(): void {
  for (const stop of [...running]) stop();
}

/** Lets `pane` glide on at `startSpeed` (px/ms along its scrollTop, signed) from `from`, as of `since`. */
function startGlide(pane: HTMLElement, startSpeed: number, from: number, since: number): void {
  let position = from;
  let last = since;
  const direction = Math.sign(startSpeed);
  // What the glide has left, unsigned: it only ever brakes toward 0.
  let speed = Math.min(Math.abs(startSpeed), GLIDE_MAX_SPEED);
  let frame = 0;

  const stop = () => {
    cancelAnimationFrame(frame);
    running.delete(stop);
    if (running.size === 0) window.removeEventListener('pointerdown', stopGlidesOnTouch, true);
  };
  const step = (now: number) => {
    // A pane taken away, or scrolled by someone else (a `scrollIntoView`, the wheel), is theirs: no fight.
    if (!pane.isConnected || Math.abs(pane.scrollTop - position) > MOVED_BY_OTHER_PX) {
      stop();
      return;
    }
    const elapsed = Math.max(0, now - last);
    last = now;
    // Exact for any frame length: a frame that outlasts the glide travels only what the glide had left.
    const braked = GLIDE_DECELERATION * elapsed;
    const travelled = braked >= speed ? (speed * speed) / (2 * GLIDE_DECELERATION) : speed * elapsed - (braked * elapsed) / 2;
    speed = Math.max(0, speed - braked);
    const wanted = position + direction * travelled;
    position = clamp(wanted, 0, limitOf(pane));
    pane.scrollTop = position;
    if (position !== wanted || speed === 0) {
      stop();
      return;
    }
    frame = requestAnimationFrame(step);
  };

  if (running.size === 0) window.addEventListener('pointerdown', stopGlidesOnTouch, true);
  running.add(stop);
  frame = requestAnimationFrame(step);
}

/**
 * Begins scrolling `pane` under a finger that is at `y` (client px) as of `time`: the pane stays where it
 * is, and each `move` after this scrolls it by exactly what the finger travelled since the one before.
 */
export function beginPan(pane: HTMLElement, y: number, time: number): Pan {
  stopGlides();
  // Where the pane stands by this module's count, a float: a pane's own `scrollTop` snaps to device pixels, which loses a slow finger's fractions.
  let position = pane.scrollTop;
  let lastY = y;
  let samples: Sample[] = [{ y, time }];

  return {
    move(nextY, nextTime) {
      if (Math.abs(pane.scrollTop - position) > MOVED_BY_OTHER_PX) position = pane.scrollTop;
      position = clamp(position + (lastY - nextY), 0, limitOf(pane));
      pane.scrollTop = position;
      lastY = nextY;
      samples.push({ y: nextY, time: nextTime });
      samples = samples.filter((sample) => nextTime - sample.time <= VELOCITY_WINDOW_MS);
    },
    release(time, cancelled) {
      if (cancelled) return;
      // The speed is the finger's over the last `VELOCITY_WINDOW_MS` up to the lift: one that rested before lifting has none.
      const recent = samples.filter((sample) => time - sample.time <= VELOCITY_WINDOW_MS);
      const first = recent[0];
      const latest = recent[recent.length - 1];
      spendNextClick();
      if (first === undefined || latest === undefined || latest.time <= first.time) return;
      const speed = (first.y - latest.y) / (latest.time - first.time);
      if (Math.abs(speed) >= GLIDE_REST_SPEED) startGlide(pane, speed, position, time);
    },
  };
}
