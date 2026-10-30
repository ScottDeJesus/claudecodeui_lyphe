/*
 * WHERE HER BUTTON LANDS beside the thing she points at.
 *
 * IMPORTS NOTHING, on purpose: no alias, no constant, no type from elsewhere. Node's `tsx` loads this file with no
 * resolver for `@/`, and the placement is the part of her motion worth proving on bare numbers, so
 * `.verify/kaylee-avatar-placement.mjs` runs it that way. The numbers it reads that live elsewhere in the app are
 * restated below with where they come from.
 */

/** How far each edge of the screen is taken up by the notch, the status bar or the home indicator (`env(safe-area-inset-*)`). */
type SafeInsets = { top: number; right: number; bottom: number; left: number };

/**
 * The window the disc must stay inside: its size in CSS pixels, and `safe`, the insets the caller read from
 * `env(safe-area-inset-*)`. A viewport with no `safe` is one with no notch, which is what `env()` itself answers there.
 */
type PlacementViewport = { width: number; height: number; safe?: SafeInsets };

/**
 * The gap the disc keeps from every edge of the safe area. The same 8 px as the kit's `VIEWPORT_EDGE_PX`
 * (`DockableFab.tsx`, not exported), so a disc she flies to and a disc he drops stop the same distance from the edge.
 */
const VIEWPORT_EDGE_PX = 8;

/**
 * The least the disc's CENTRE stands past an anchor's right edge beside a row, and what it is at 28 px. The plan measures her by
 * that centre ("within 12 px of the row's right edge"), so the figure is the centre's and not a gap between boxes: the disc
 * overlaps the row's last few pixels. Ten leaves the rail button's 44 px catch off the button's own centre (20 px in from its
 * edge, so 30 px from the disc's centre). A larger disc stands further out, by `ROW_OVERLAP_PX`.
 */
const ROW_CENTRE_PAST_EDGE_PX = 10;

/** How far a LARGE disc overlaps a row: its left edge stands this far inside the row's right edge, however large it is. */
const ROW_OVERLAP_PX = 12;

/**
 * How far a LARGE disc overlaps a box: its bottom edge stands this far below the box's top. At 28 px this is the disc's own
 * radius, so the disc is centred on the box's corner; a larger disc stands back from the corner by the rest of its radius.
 */
const BOX_OVERLAP_PX = 14;

/**
 * The tallest anchor that is a ROW (a sidebar row, a rail button) rather than a BOX (the composer, the file tree). Measured
 * on the dev client at 1440x900 and 390x844: sidebar rows are 54 px tall, the rail's Files button 40, the empty composer
 * 123 on a desktop and 115 on a phone, and it only grows with the words typed. 88 sits in the gap between them, nearer
 * the rows, so a row that grows a line still counts as a row and no composer ever does.
 */
const ROW_MAX_HEIGHT_PX = 88;

/**
 * Keeps `value` inside [`low`, `high`]; a window too small for the disc gives `low`, the top-left, so she is never lost off
 * the far edge. A `value` that is not a number gives `low` too: `Math.max` with a NaN is NaN, and a NaN offset is dropped by
 * the browser, leaving her at her rest with nothing to say why.
 */
const clampInto = (value: number, low: number, high: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(low, high), Math.max(low, value)) : low;

/** `value` as the insets and the window report it, or 0 when it is not a number (`parseFloat('')` of an unset `env()` is NaN). */
const finiteOrZero = (value: number): number => (Number.isFinite(value) ? value : 0);

/**
 * Where the top-left of her disc goes to stand by `anchor`, in the viewport's coordinates, always clamped inside the
 * viewport's safe area.
 *
 * Used by this module's CompanionFab, which turns the answer into the offset it draws her at while a target holds
 * (`useAvatarTarget` picks the anchor and measures its rect; this says where beside it she stands).
 *
 * `size` is the disc's side as she is drawn NOW: 28 at rest and up to 120 while she is active (`useCompanionSize`). The disc
 * stands clear of the anchor at any size, so the figures below are the CENTRE's and grow with the disc once it is larger than
 * its overlap needs; at 28 px they are the numbers the plan first measured.
 *
 * TWO SHAPES OF ANCHOR, told apart by height alone because the rect is all it is given:
 *   - A ROW (at most `ROW_MAX_HEIGHT_PX` tall: a chat's sidebar row, the rail's Files button) gets the disc with its centre
 *     `max(ROW_CENTRE_PAST_EDGE_PX, size / 2 - ROW_OVERLAP_PX)` past the right edge, vertically centred on it — she stands
 *     beside the row like a finger on a line of a list, and a large disc overlaps it by 12 px and no more.
 *   - A BOX (taller: the composer, the file tree) gets the disc with its centre `max(0, size / 2 - BOX_OVERLAP_PX)` left of and
 *     above its top-right corner — at 28 px, centred on the corner; a large disc perches on it overlapping the box by 14 px.
 *     A box's right edge is the middle of a wall, and a disc centred on that would sit on the text.
 *
 * The clamp comes LAST and always applies, so an anchor against the right edge of the screen (a composer on a phone)
 * lands her on the anchor's own corner inside the screen rather than off it. The edges are the safe area plus
 * `VIEWPORT_EDGE_PX`; the answer is whole pixels, because a transform at a half pixel blurs the disc's rim. A window size or
 * inset that is not a number counts as 0 (a window of no size puts her top-left), so the answer is always a number.
 */
export function avatarPlacement(anchor: DOMRect, size: number, viewport: PlacementViewport): { left: number; top: number } {
  const isRow = anchor.height <= ROW_MAX_HEIGHT_PX;
  const rowCentrePast = Math.max(ROW_CENTRE_PAST_EDGE_PX, size / 2 - ROW_OVERLAP_PX);
  const boxCentreBack = Math.max(0, size / 2 - BOX_OVERLAP_PX);
  const wantedLeft = isRow ? anchor.right + rowCentrePast - size / 2 : anchor.right - boxCentreBack - size / 2;
  const wantedTop = isRow ? anchor.top + anchor.height / 2 - size / 2 : anchor.top - boxCentreBack - size / 2;

  const safe = viewport.safe;
  const leftmost = finiteOrZero(safe?.left ?? 0) + VIEWPORT_EDGE_PX;
  const topmost = finiteOrZero(safe?.top ?? 0) + VIEWPORT_EDGE_PX;
  const rightmost = finiteOrZero(viewport.width) - finiteOrZero(safe?.right ?? 0) - VIEWPORT_EDGE_PX - size;
  const bottommost = finiteOrZero(viewport.height) - finiteOrZero(safe?.bottom ?? 0) - VIEWPORT_EDGE_PX - size;
  return {
    left: Math.round(clampInto(wantedLeft, leftmost, rightmost)),
    top: Math.round(clampInto(wantedTop, topmost, bottommost)),
  };
}
