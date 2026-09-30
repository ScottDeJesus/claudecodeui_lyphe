import { type KeyboardEvent, useState } from 'react';

import { usePointerDrag } from '@/shared/ui/usePointerDrag';

type ResizeGripCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

type ResizeGripProps = {
  label: string;                                              // aria-label; every word arrives as a prop
  corner: ResizeGripCorner;                                   // the corner of the panel it stands at: its cursor and glyph
  onResize: (delta: { dx: number; dy: number }) => void;      // live, from the press
  onResizeEnd: (delta: { dx: number; dy: number }) => void;   // once, at release
};

/** How far one arrow key resizes: a whole resize, `onResize` then `onResizeEnd`. */
const KEY_RESIZE_PX = 16;

/** The delta an arrow key asks for, or null for a key that is not the grip's. */
function keyDelta(key: string): { dx: number; dy: number } | null {
  switch (key) {
    case 'ArrowRight': return { dx: KEY_RESIZE_PX, dy: 0 };
    case 'ArrowLeft': return { dx: -KEY_RESIZE_PX, dy: 0 };
    case 'ArrowDown': return { dx: 0, dy: KEY_RESIZE_PX };
    case 'ArrowUp': return { dx: 0, dy: -KEY_RESIZE_PX };
    default: return null;
  }
}

/**
 * The kit's resize handle: a small button the caller stands at one corner of a panel, dragged to size
 * it.
 *
 * It reports what the POINTER did and never what the panel should become. `onResize` is handed the raw
 * delta since the press, live, and `onResizeEnd` the same measure once at release; the caller turns
 * that into a size for its own corner (a grip at the bottom-right grows the panel by `+dx`, one at the
 * top-left by `-dx`). Keeping the sign out of the kit is what lets one grip serve every corner.
 *
 * It runs on `usePointerDrag` with the `'resize'` kind, and that is the reason it is not a hand-rolled
 * `pointermove` pair: a panel is dragged over cross-origin frames, which swallow the pointer stream
 * the moment a drag crosses into one. The hook's body class makes every frame inert for the length of
 * the drag, so the resize does not die mid-flight over an application.
 *
 * Used by chat-host's ChatHostPanel, which stands it at the corner away from the FAB and turns the
 * deltas into a size.
 *
 * The grip paints and never places (`.vv-resize-grip`, surfaces.css); the caller positions it. From
 * the keyboard each arrow is one whole resize of 16px, the press and the release in a single stroke.
 */
export function ResizeGrip({ label, corner, onResize, onResizeEnd }: ResizeGripProps) {
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
