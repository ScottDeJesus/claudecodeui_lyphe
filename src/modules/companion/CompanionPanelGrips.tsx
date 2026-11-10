import { useState } from 'react';

import type { useCompanionPanelPlace } from '@/modules/companion/hooks/useCompanionPanelPlace';
import { ResizeGrip } from '@/shared/ui';
import { cn } from '@/shared/utils';

type CompanionPanelGripsProps = {
  /** The keyboard grip's name, "Resize Kaylee's panel". */
  label: string;
  /** The bottom corner that faces into the page, where the keyboard's grip and its glyph stand; the other three corners are the pointer's alone. */
  keyboardCorner: 'bottom-left' | 'bottom-right';
  /** One handle's resize: its live delta and its release. */
  resizeBy: ReturnType<typeof useCompanionPanelPlace>['resizeBy'];
};

type Edge = 'top' | 'right' | 'bottom' | 'left';
type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * Where each edge strip stands: flush with its side, inside the panel's border, running between the corners (12px in
 * from each end, the panel's radius), so a corner is never an edge's. The kit gives the strip its thickness: 6px, and 12px
 * where the browser names touch its primary pointer (the glyph button below is 16px, and 24px under that query).
 */
const EDGE_PLACE: Record<Edge, string> = {
  top: 'inset-x-3 top-0',
  right: 'inset-y-3 right-0',
  bottom: 'inset-x-3 bottom-0',
  left: 'inset-y-3 left-0',
};

/**
 * Where each pointer-only corner stands: the 12px square at the corner, which the panel's 12px radius rounds. Twelve and
 * not the glyph's 16, measured against the header: her close button stands 9px in from the right and 15px down, so a
 * 12px corner clears it where a 16px one would take 2px off its corner.
 */
const CORNER_PLACE: Record<Corner, string> = {
  'top-left': 'left-0 top-0 size-3',
  'top-right': 'right-0 top-0 size-3',
  'bottom-left': 'bottom-0 left-0 size-3',
  'bottom-right': 'bottom-0 right-0 size-3',
};

/** Where the keyboard's grip stands: 2px in from its corner, so its glyph clears the rounded corner the panel clips (as the floating chat's grip does). */
const KEYBOARD_PLACE: Record<'bottom-left' | 'bottom-right', string> = {
  'bottom-left': 'bottom-0.5 left-0.5',
  'bottom-right': 'bottom-0.5 right-0.5',
};

const EDGES: Edge[] = ['top', 'right', 'bottom', 'left'];
const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

/**
 * Her floating panel's frame of grips: the kit's `ResizeGrip` on all four edges and all four corners, each resizing the
 * sides it names. Composed by this module's CompanionPanel, last in the panel, only while the panel floats (from lg, where a
 * mouse or a pen drives the page): the sheet a phone draws has none.
 *
 * At rest the frame draws one thing — the glyph of the keyboard's grip in the bottom corner that faces into the page, the
 * house's sign that a floating panel resizes (the floating chat wears the same one) — and the panel otherwise looks as it
 * did. The edges show a resize cursor and light their side in the accent under the pointer; the other corners show their
 * cursor. Only the keyboard's grip is a tab stop: its arrows move its two sides, 16px a press, so the keys reach any size
 * — the sides across from it stay where they are, and no key moves the panel (the header is no tab stop). It keeps its
 * corner while it holds the focus: a keyboard resize that carries the panel's centre across the room's middle would
 * otherwise seat it at the other corner, unmount the button under the focus and turn what its arrows do.
 *
 * The grips stand above the panel's rows (`z-20`), inside its border: nothing outside the panel's own box is taken from
 * the page under it.
 */
export function CompanionPanelGrips({ label, keyboardCorner, resizeBy }: CompanionPanelGripsProps) {
  // The corner the keyboard's grip stood at when it took the focus, held until the focus leaves it; null while it has none.
  // The corner the stored box asks for can change under a keyboard resize, and the grip must not move from under the keys.
  const [heldCorner, setHeldCorner] = useState<'bottom-left' | 'bottom-right' | null>(null);
  const keyCorner = heldCorner ?? keyboardCorner;
  return (
    <>
      {EDGES.map((edge) => (
        <div key={edge} data-companion-grip={edge} className={cn('absolute z-20', EDGE_PLACE[edge])}>
          <ResizeGrip edge={edge} {...resizeBy(edge)} />
        </div>
      ))}
      {CORNERS.map((corner) => (corner === keyCorner ? (
        <div
          key={corner}
          data-companion-grip={corner}
          className={cn('absolute z-20', KEYBOARD_PLACE[keyCorner])}
          onFocus={() => setHeldCorner(keyCorner)}
          onBlur={() => setHeldCorner(null)}
        >
          <ResizeGrip corner={corner} label={label} {...resizeBy(corner)} />
        </div>
      ) : (
        <div key={corner} data-companion-grip={corner} className={cn('absolute z-20', CORNER_PLACE[corner])}>
          <ResizeGrip corner={corner} pointerOnly {...resizeBy(corner)} />
        </div>
      )))}
    </>
  );
}
