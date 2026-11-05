import { type KeyboardEvent, useState } from 'react';

import { usePointerDrag } from '@/shared/ui/usePointerDrag';

type ResizeGripCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
type ResizeGripEdge = 'top' | 'right' | 'bottom' | 'left';
type ResizeDelta = { dx: number; dy: number };

type ResizeGripProps = {
  onResize: (delta: ResizeDelta) => void;      // live, from the press
  onResizeEnd: (delta: ResizeDelta) => void;   // once, at release
} & (
  // The keyboard's grip: a button with the glyph, a tab stop, named to a reader.
  | { corner: ResizeGripCorner; label: string; pointerOnly?: false; edge?: never }
  // A corner for the pointer alone, beside a keyboard grip on the same panel.
  | { corner: ResizeGripCorner; pointerOnly: true; label?: never; edge?: never }
  // An edge, which is always the pointer's alone.
  | { edge: ResizeGripEdge; corner?: never; label?: never; pointerOnly?: never }
);

/** How far one arrow key resizes: a whole resize, `onResize` then `onResizeEnd`. */
const KEY_RESIZE_PX = 16;

/** The delta an arrow key asks for, or null for a key that is not the grip's. */
function keyDelta(key: string): ResizeDelta | null {
  switch (key) {
    case 'ArrowRight': return { dx: KEY_RESIZE_PX, dy: 0 };
    case 'ArrowLeft': return { dx: -KEY_RESIZE_PX, dy: 0 };
    case 'ArrowDown': return { dx: 0, dy: KEY_RESIZE_PX };
    case 'ArrowUp': return { dx: 0, dy: -KEY_RESIZE_PX };
    default: return null;
  }
}

/**
 * The kit's resize handle: a grip the caller stands at one corner or along one edge of a panel, dragged to size it.
 *
 * It reports what the POINTER did and never what the panel should become. `onResize` is handed the raw
 * delta since the press, live, and `onResizeEnd` the same measure once at release; the caller turns
 * that into a size for its own corner or edge (a grip at the bottom-right grows the panel by `+dx`, one at the
 * top-left by `-dx`, one on the top edge by `-dy` and not at all by `dx`). Keeping the sign out of the kit is what
 * lets one grip serve every side.
 *
 * It runs on `usePointerDrag` with the `'resize'` kind, and that is the reason it is not a hand-rolled
 * `pointermove` pair: a panel is dragged over cross-origin frames, which swallow the pointer stream
 * the moment a drag crosses into one. The hook's body class makes every frame inert for the length of
 * the drag, so the resize does not die mid-flight over an application.
 *
 * TWO SHAPES. A CORNER grip is a small button with a glyph: from the keyboard each arrow is one whole resize of 16px,
 * the press and the release in a single stroke, along both axes, so one corner grip is a panel's whole resize from the
 * keys. An EDGE grip is a strip along one side, with no glyph — its cursor and the accent line it draws along its side
 * under the pointer are its sign — and it is the POINTER'S ALONE: not a tab stop and hidden from assistive technology,
 * because the arrows of a corner grip already move that side. A panel resized by its edges stands one corner grip
 * beside them for the keys. A corner can be the pointer's alone too (`pointerOnly`), for a panel grabbed at all four
 * corners and resized from the keys at one: it draws no glyph, so the corners near a panel's own controls stay clear.
 *
 * Used by chat-host's ChatHostPanel, which stands one corner grip at the corner away from the FAB, and by the
 * companion's CompanionPanelGrips, which frames Kaylee's floating panel in four edges and four corners, one of them the
 * keyboard's.
 *
 * The grip paints and never places (`.vv-resize-grip`, surfaces.css); the caller positions it. A corner button has
 * the kit's own size; an edge strip takes the kit's thickness and the length of the box its caller stands it in, and a
 * pointer-only corner fills that box.
 */
export function ResizeGrip({ corner, edge, label, pointerOnly, onResize, onResizeEnd }: ResizeGripProps) {
  // Whether a resize is running. Drives `data-dragging`, which the stylesheet reads for the grip's
  // colour and for the body's corner cursor (`:has()`); it cannot be derived from props, because the
  // drag is a gesture in the hook's refs and the component has no other way to know it is under way.
  const [dragging, setDragging] = useState(false);

  const drag = usePointerDrag({
    kind: 'resize',
    onMove: ({ dx, dy }) => {
      setDragging(true);
      onResize({ dx, dy });
    },
    onEnd: ({ dx, dy, moved }) => {
      setDragging(false);
      // A press that never travelled is not a resize: the caller is told of an end only when there
      // was a beginning, so a click on the grip cannot commit a size.
      if (moved) onResizeEnd({ dx, dy });
    },
  });

  if (edge !== undefined || pointerOnly) {
    // A zone for the pointer: no role, no name, no focus. The panel's keyboard grip is the way in from the keys.
    return (
      <div
        aria-hidden="true"
        data-corner={corner}
        data-edge={edge}
        data-pointer-only=""
        data-dragging={dragging ? '' : undefined}
        onPointerDown={drag.onPointerDown}
        className="vv-resize-grip"
      />
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    // While the pointer is dragging, a key is not a second resize: its delta would replace the pointer's
    // running delta and its end would move the caller's base mid-gesture, so the pointer's later deltas
    // would land on top of a base 16px off.
    if (dragging) return;
    const delta = keyDelta(event.key);
    // A modified arrow is the browser's or the reader's own (Alt+Left is "back"); it is not a resize.
    if (!delta || event.altKey || event.ctrlKey || event.metaKey) return;
    // The arrows would otherwise scroll whatever the panel sits in, which is the one thing they are
    // not for while the reader is holding a handle.
    event.preventDefault();
    onResize(delta);
    onResizeEnd(delta);
  }

  return (
    <button
      type="button"
      aria-label={label}
      data-corner={corner}
      data-dragging={dragging ? '' : undefined}
      onPointerDown={drag.onPointerDown}
      onKeyDown={handleKeyDown}
      className="vv-resize-grip"
    >
      {/* Drawn for the bottom-right corner; surfaces.css turns it to the grip's own corner. */}
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M13 3 L3 13 M13 7.5 L7.5 13 M13 12 L12 13" />
      </svg>
    </button>
  );
}
