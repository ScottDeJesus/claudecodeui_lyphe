import type { CompanionPanelHandle, CompanionPanelRect } from '@/shared/types';

/**
 * Where Kaylee's floating panel may stand, and how a drag moves and resizes it.
 *
 * Pure arithmetic over rectangles, as chat-host's `panelGeometry.ts` is for the floating chat: the only import is a
 * TYPE, so the file runs under `tsx` and its numbers can be read off a terminal. `useCompanionPanelPlace` measures the
 * shell (the room) and the panel's content (its floor) and hands them in; every decision about where the panel goes is
 * made here.
 *
 * THE ROOM is the workspace shell the panel is `absolute` in, which is the window less what the shell already keeps
 * clear (a standalone app's status strip). THE FLOOR is the least height the panel's content stands in — her header,
 * the composer, the log's 3.5rem floor and every card in the dock at its own floor (the action waiting for his word
 * whole) — measured from the panel as it is drawn, never written down here: a row that comes and goes (her focus, the
 * failed banner, a card docking) moves it.
 */

type Size = { width: number; height: number };

/**
 * How far the panel keeps from every side of its room: the FAB's edge gap (`VIEWPORT_EDGE_PX` in DockableFab), the
 * margin the floating chat keeps too, so the floating things of the house share one margin. Her default stance stands
 * 12px in, inside it.
 */
const PANEL_INSET_PX = 8;

/**
 * The narrowest he can make her panel: 320px. Measured on the live panel (1440×900, 2026-11-04): every row of her
 * header — her name, the status line (which wraps to two lines below 380px, as designed), the focus, the model, Live and
 * Clear, the voice and ears rows — holds whole down to 310px with nothing scrolling sideways, and her name begins to be
 * cut at 300px. 320 is that floor rounded to the narrowest phone the panel's sheet is laid out and checked at
 * (`.verify/companion-panel-scaffold.mjs`), so the panel is never narrower than a width it was drawn for.
 */
const PANEL_MIN_WIDTH_PX = 320;

/** `value` held between `min` and `max`; where the two cross, `max` wins: a panel larger than its room is out of reach however small it may be. A non-finite `value` is held to `min`. */
function clampAxis(value: number, min: number, max: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}

/** The most a panel may take of one axis of its room: all of it less the inset on both sides. */
function roomOnAxis(extent: number): number {
  return Math.max(extent - 2 * PANEL_INSET_PX, 0);
}

/**
 * `rect` held inside its room: its size between the least it stands in (320px wide, `floor` tall) and the room less
 * the inset on each side, then its place moved just enough to keep the whole box in, whole pixels throughout. A box
 * stored on a larger window shrinks to fit this one, and gets its size back when the window grows again: the stored box
 * is never what this changes. Used by `useCompanionPanelPlace` on the stored box at every render, and below.
 */
export function clampPanelRect(rect: CompanionPanelRect, room: Size, floor: number): CompanionPanelRect {
  const width = Math.round(clampAxis(rect.width, PANEL_MIN_WIDTH_PX, roomOnAxis(room.width)));
  const height = Math.round(clampAxis(rect.height, Math.ceil(floor), roomOnAxis(room.height)));
  return {
    left: Math.round(clampAxis(rect.left, PANEL_INSET_PX, room.width - PANEL_INSET_PX - width)),
    top: Math.round(clampAxis(rect.top, PANEL_INSET_PX, room.height - PANEL_INSET_PX - height)),
    width,
    height,
  };
}

/** `base` carried by the pointer's travel since the press, held inside the room; its size is not touched. Used by `useCompanionPanelPlace` while he drags the header. */
export function movePanelRect(base: CompanionPanelRect, dx: number, dy: number, room: Size, floor: number): CompanionPanelRect {
  return clampPanelRect({ ...base, left: base.left + dx, top: base.top + dy }, room, floor);
}

/**
 * `base` resized by one handle's travel since the press: the sides the handle names follow the pointer and the others
 * stay where they are, so a drag of the left edge never moves the right one. Each moving side stops at the room's inset
 * and at the least the panel stands in from the side across from it (320px, `floor`), so a drag past either limit
 * holds the panel there rather than sliding it. Used by `useCompanionPanelPlace` for every grip, live and at release.
 */
export function resizePanelRect(
  base: CompanionPanelRect,
  handle: CompanionPanelHandle,
  delta: { dx: number; dy: number },
  room: Size,
  floor: number,
): CompanionPanelRect {
  let left = base.left;
  let top = base.top;
  let right = base.left + base.width;
  let bottom = base.top + base.height;
  const least = Math.ceil(floor);
  if (handle === 'left' || handle.endsWith('-left')) left = clampAxis(left + delta.dx, PANEL_INSET_PX, right - PANEL_MIN_WIDTH_PX);
  if (handle === 'right' || handle.endsWith('-right')) right = clampAxis(right + delta.dx, left + PANEL_MIN_WIDTH_PX, room.width - PANEL_INSET_PX);
  if (handle.startsWith('top')) top = clampAxis(top + delta.dy, PANEL_INSET_PX, bottom - least);
  if (handle.startsWith('bottom')) bottom = clampAxis(bottom + delta.dy, top + least, room.height - PANEL_INSET_PX);
  return clampPanelRect({ left, top, width: right - left, height: bottom - top }, room, floor);
}

/**
 * The corner her keyboard grip stands at: the bottom corner that faces into the page, away from the side of the room the
 * panel stands nearer. Bottom-left for her default stance at the right edge (no box stored), bottom-right once she is
 * moved into the left half. Used by `useCompanionPanelPlace`, from the stored box and never the one in the hand, so the
 * grip does not change corners under a drag.
 */
export function keyboardCorner(rect: CompanionPanelRect | null, room: Size | null): 'bottom-left' | 'bottom-right' {
  if (rect === null || room === null) return 'bottom-left';
  return rect.left + rect.width / 2 >= room.width / 2 ? 'bottom-left' : 'bottom-right';
}
