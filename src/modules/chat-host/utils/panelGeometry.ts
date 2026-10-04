import type { PanelPlacement } from '@/shared/types';

/**
 * Where the floating chat panel stands, and how big it may be.
 *
 * Pure arithmetic over rectangles, with nothing in it that reads the page: the only import is a TYPE,
 * which is erased before the file runs, so the whole file can be run under `tsx` and its numbers read
 * straight off the terminal. The panel component measures the FAB and the window and hands them in;
 * every decision about where the panel goes is made here.
 */

type Size = { width: number; height: number };
type Rect = { left: number; top: number; width: number; height: number };

/**
 * How far the panel's nearest corner stands from the FAB, on each axis. Wider than the 8px the FAB's
 * 44px catch reaches past its 28px dot, so a press meant for the FAB never lands on the panel, and
 * the same beside a docked FAB (a 28px dot in the sidebar's rail) and a floating one: the FAB is the
 * same dot in both, and its catch is the only thing the gap has to clear.
 */
const PANEL_GAP_PX = 12;

/**
 * How far the panel keeps from every edge of the viewport: the FAB's own edge gap (`VIEWPORT_EDGE_PX`
 * in DockableFab), so the panel and the FAB it stands beside share one margin.
 */
const PANEL_MARGIN_PX = 8;

/**
 * The smallest the panel may be resized to, and the least width a side must hold for the panel to
 * stand beside the FAB.
 *
 * WIDTH 376 IS CHOSEN FOR THE PHONE, and it is one more than the most a phone's side can offer. The
 * widest phone measured, 430px, leaves 374px beside a 28px FAB parked at its edge (430 − 8 margin −
 * 12 gap − 28 FAB − 8 FAB inset); at the 300px this file first carried, a 390px phone with the FAB in
 * its resting corner left 326px, and the panel stood in a narrow strip beside the FAB instead of
 * above it at full width. At 376 no phone (under 768px, the desktop default's threshold) is ever
 * beside: it stands above or below the FAB, across the screen. On a desktop it is the narrowest a
 * chat reads at — the composer's chips and a code block still have room.
 *
 * HEIGHT 360 is the header (40px), a composer with its chips (about 120px) and a transcript tall
 * enough for the reader to see what was just said — three or four lines — without the panel being
 * something to scroll inside of.
 */
const PANEL_MIN: Size = { width: 376, height: 360 };

/**
 * What a reader who has never resized the panel gets: a fixed size on a desktop, most of the screen on
 * a phone.
 *
 * The desktop's 420 is the width of the picture-in-picture window's first opening, so the chat is the
 * same column wherever it floats, and 640 is a tall column that leaves an application visible above
 * and below it on a 900px screen. The phone's height is 60% of the viewport — the panel stands above
 * the FAB, so 60% leaves the top of the application in view and the FAB's row clear — and its width is
 * the whole viewport less the margins.
 */
const PANEL_DEFAULT = {
  desktop: { width: 420, height: 640 } as Size,
  phoneHeightRatio: 0.6,
};

/** At or above this viewport width the default is the desktop size; below it, the phone's. */
const DESKTOP_MIN_WIDTH_PX = 768;

/**
 * A measurement the arithmetic below can rely on: NaN and the infinities count as 0. A NaN would
 * otherwise pass through every `Math.min`/`Math.max` here untouched and reach the panel's `top` and
 * `height` as an invalid style; the plausible source is the viewport height read as
 * `innerHeight - parseFloat(keyboardHeight)` while the variable is unset.
 */
function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** `value` held between `min` and `max`. When the two cross, `max` wins: a panel that overflows the screen is out of reach, however small it is allowed to be. A NaN `value` is held to `min`. */
function clampAxis(value: number, min: number, max: number): number {
  return Math.min(Math.max(Number.isNaN(value) ? min : value, min), max);
}

/** The most a panel may take of one viewport axis: all of it, less the margin on both sides. */
function roomOnAxis(viewportExtent: number): number {
  return Math.max(finiteOrZero(viewportExtent) - 2 * PANEL_MARGIN_PX, 0);
}

/**
 * `size` held to what a panel can be: at least `PANEL_MIN`, at most the viewport less the margins, on
 * each axis. Where a viewport is smaller than the minimum, the viewport wins.
 *
 * Used by chat-host's panel on the size it reads from storage or from `defaultPanelSize` (a size
 * remembered on a large window is too large for a small one), and again on every resize.
 */
export function clampPanelSize(size: Size, viewport: Size): Size {
  return {
    width: clampAxis(size.width, PANEL_MIN.width, roomOnAxis(viewport.width)),
    height: clampAxis(size.height, PANEL_MIN.height, roomOnAxis(viewport.height)),
  };
}

/**
 * The size a reader who has never resized the panel gets: `PANEL_DEFAULT.desktop` from 768px of width
 * up; below that, the full width less the margins by `phoneHeightRatio` of the height.
 *
 * The answer is NOT clamped — a short desktop window can still be shorter than the desktop default —
 * because the caller clamps whatever size it ends up with, this one or a stored one, in one place.
 *
 * Used by chat-host's panel when nothing is stored.
 */
export function defaultPanelSize(viewport: Size): Size {
  if (viewport.width >= DESKTOP_MIN_WIDTH_PX) return { ...PANEL_DEFAULT.desktop };
  return {
    width: roomOnAxis(viewport.width),
    height: Math.round(finiteOrZero(viewport.height) * PANEL_DEFAULT.phoneHeightRatio),
  };
}

/**
 * Beside the FAB: the corner nearest it stands `PANEL_GAP_PX` off it, the panel grows toward the side
 * with more room on each axis, the far corner holds the grip, and the whole panel stays inside the
 * margins. Where the side cannot hold the minimum width, it stands above or below the FAB at the
 * viewport's full width less the margins instead.
 *
 * Used by chat-host's panel, which re-runs it on every move of the FAB, so a drag carries the panel.
 *
 * BESIDE (the roomier side holds `PANEL_MIN.width`). The panel's near corner is offset from the FAB's
 * rect by the gap on BOTH axes, so it stands clear of the FAB's row as well as its column. Width shrinks
 * to the room the side has (between the minimum and the size asked for). Height never shrinks for the
 * FAB: if the panel would run out of the viewport it SLIDES along the axis instead, which cannot bring
 * it onto the FAB because the gap on the other axis already keeps them apart.
 *
 * ABOVE OR BELOW (neither side holds the minimum width — a phone, or a FAB far from an edge). The
 * panel spans the viewport between the margins and stands the gap off the FAB's top or bottom edge,
 * toward the side with more room; its height is what fits, since sliding would cover the FAB. The
 * grip takes the edge away from the FAB, on the corner away from the FAB's own half of the screen.
 *
 * A tie between two sides goes right and down.
 */
export function panelPlacement(anchorRect: Rect, size: Size, viewportSize: Size): PanelPlacement {
  // Every field is read once, through `finiteOrZero`, so no NaN can enter the arithmetic below.
  const anchor: Rect = {
    left: finiteOrZero(anchorRect.left),
    top: finiteOrZero(anchorRect.top),
    width: finiteOrZero(anchorRect.width),
    height: finiteOrZero(anchorRect.height),
  };
  const viewport: Size = { width: finiteOrZero(viewportSize.width), height: finiteOrZero(viewportSize.height) };
  const wanted = clampPanelSize(size, viewport);
  const anchorRight = anchor.left + anchor.width;
  const anchorBottom = anchor.top + anchor.height;

  // The room each side of the FAB leaves, measured from where the panel's near edge would stand.
  const roomRight = viewport.width - PANEL_MARGIN_PX - (anchorRight + PANEL_GAP_PX);
  const roomLeft = anchor.left - PANEL_GAP_PX - PANEL_MARGIN_PX;
  const roomBelow = viewport.height - PANEL_MARGIN_PX - (anchorBottom + PANEL_GAP_PX);
  const roomAbove = anchor.top - PANEL_GAP_PX - PANEL_MARGIN_PX;

  const growsRight = roomRight >= roomLeft;
  const growsDown = roomBelow >= roomAbove;
  const roomBeside = growsRight ? roomRight : roomLeft;
  const verticalGrip = growsDown ? 'bottom' : 'top';

  if (roomBeside >= PANEL_MIN.width) {
    const width = Math.min(wanted.width, roomBeside);
    const idealTop = growsDown ? anchorBottom + PANEL_GAP_PX : anchor.top - PANEL_GAP_PX - wanted.height;
    return {
      left: growsRight ? anchorRight + PANEL_GAP_PX : anchor.left - PANEL_GAP_PX - width,
      top: clampAxis(idealTop, PANEL_MARGIN_PX, viewport.height - PANEL_MARGIN_PX - wanted.height),
      width,
      height: wanted.height,
      grip: `${verticalGrip}-${growsRight ? 'right' : 'left'}`,
    };
  }

  const height = Math.max(Math.min(wanted.height, growsDown ? roomBelow : roomAbove), 0);
  const fabInRightHalf = anchor.left + anchor.width / 2 > viewport.width / 2;
  return {
    left: PANEL_MARGIN_PX,
    top: growsDown ? anchorBottom + PANEL_GAP_PX : anchor.top - PANEL_GAP_PX - height,
    width: roomOnAxis(viewport.width),
    height,
    grip: `${verticalGrip}-${fabInRightHalf ? 'left' : 'right'}`,
  };
}
