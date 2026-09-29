import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minus, Plus, X } from 'lucide-react';

import { OWNS_ESCAPE } from '@/shared/ui/overlayEscape';
import { useZoomPan } from '@/shared/ui/useZoomPan';

type LightboxProps = {
  /** The dialog's accessible name: the picture's alt text, or what the diagram is. */
  label: string;
  /** What is shown, sized to FIT the screen by its own CSS — the viewer scales it from there. */
  children: ReactNode;
  onClose: () => void;
};

/** Presses on the controls must reach neither the pan gesture nor the backdrop's close. */
const keepInside = (event: ReactPointerEvent | ReactMouseEvent) => event.stopPropagation();

const CONTROL_CLASS = 'rounded-full p-2 text-white transition-colors hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-transparent';

/**
 * The full-screen viewer in the claude.ai style: dark backdrop, the content centred and fitted, then
 * zoomable and pannable. Closes on Escape, the close button, or a click on the backdrop — never on a
 * click on the content, and never on the end of a drag.
 *
 * Used by chat's `ImageLightbox` (pictures, attachments and file previews) and by markdown-preview's
 * `MermaidDiagram` (a diagram opened from the chat's mermaid fence or a markdown preview): one
 * viewer for both modules, so it lives in the kit and neither module reaches into the other.
 *
 * Zoom: wheel and trackpad pinch about the pointer, two-finger pinch, double-click / double-tap for
 * fit ↔ 2×, `+` / `−` / fit buttons and the `+` `−` `0` keys. Pan: drag. The content is scaled with a
 * CSS transform, so a vector child (an inline SVG) stays sharp at every level.
 *
 * It is a native modal `<dialog>` opened with `showModal()`, which puts it in the browser's TOP
 * LAYER: no fixed layer of the app (the PRD editor's `z-[200]`, Settings' `z-[9999]`, or one added
 * later) can stack above it, and no z-index here has to outbid them. The same call makes the rest of
 * the page inert, moves focus in (to the close button), keeps Tab inside, and lets it go back to the
 * opener on close.
 */
export function Lightbox({ label, children, onClose }: LightboxProps) {
  const { t } = useTranslation('common');
  const {
    surfaceRef, stageRef, contentRef, scale, x, y, animated, canZoomIn, canZoomOut,
    onPointerDown, wasDrag, zoomIn, zoomOut, fit,
  } = useZoomPan();
  // Whether the press now ending began on one of the controls. A ref, not state: it is read once, in
  // the click that ends the press, and never drawn.
  const pressBeganOnControl = useRef(false);

  // Opens the dialog into the top layer, and puts focus back on whatever opened it when it goes.
  // A LAYOUT effect so the dialog is shown before the first paint, never as an empty flash; the
  // guard keeps a re-run (Strict Mode) from calling `showModal()` on a dialog that is already open.
  useLayoutEffect(() => {
    const dialog = surfaceRef.current;
    if (!dialog) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog.isConnected && !dialog.open) dialog.showModal();
    return () => {
      dialog.close();
      opener?.focus({ preventScroll: true });
    };
  }, [surfaceRef]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Marked from window capture, as the shared Dialog does, so closing never stops the run.
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      // A chord (Ctrl+= is the browser's own zoom) is never ours.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomIn();
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomOut();
      } else if (event.key === '0') {
        event.preventDefault();
        fit();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, zoomIn, zoomOut, fit]);

  const percent = Math.round(scale * 100);

  return createPortal(
    <dialog
      ref={surfaceRef}
      {...OWNS_ESCAPE}
      // The element itself is the full-screen backdrop, so the browser's `::backdrop` is left
      // transparent and the UA's dialog box (margin, border, padding, size caps) is zeroed.
      // `pwa-notch-safe`: in the home-screen app the inset is what keeps the picture itself out
      // from under the status bar and the landscape notch. The controls are `absolute`, so this
      // padding does NOT move them — see their own offsets below. `touch-none` hands every touch to
      // the pan/pinch handlers instead of the browser's own page pan and zoom; `select-none` keeps a
      // drag from selecting a diagram's labels.
      className="pwa-notch-safe fixed inset-0 m-0 h-full max-h-none w-full max-w-none touch-none select-none overflow-hidden border-0 bg-black/80 p-0 text-white backdrop-blur-sm backdrop:bg-transparent focus:outline-none"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      // Escape is ours, from the window capture below; the browser's own close request must never
      // shut the dialog behind React's back.
      onCancel={(event) => event.preventDefault()}
      onPointerDownCapture={(event) => {
        // Capture, because the controls stop the press before the bubble reaches this layer.
        pressBeganOnControl.current = event.target instanceof Element && event.target.closest('[data-lightbox-control]') !== null;
      }}
      onPointerDown={(event) => {
        // This layer is a portal: React would still bubble the press through the tree that opened
        // it, into whatever handles pointers there.
        event.stopPropagation();
        onPointerDown(event);
      }}
      onClick={(event) => {
        event.stopPropagation();
        // A press that began on a button and was dragged off it onto the backdrop is a cancelled
        // press, not a click on the backdrop; and a click that ends a pan or a pinch is the end of
        // a gesture, not a request to close.
        if (pressBeganOnControl.current || wasDrag()) return;
        onClose();
      }}
      onDragStart={(event) => event.preventDefault()}
    >
      <div ref={stageRef} className="flex h-full w-full items-center justify-center">
        <div
          ref={contentRef}
          onClick={(event) => event.stopPropagation()}
          style={{
            transform: `translate(${x}px, ${y}px) scale(${scale})`,
            // Eased only for a button, key or double-tap; a wheel tick or a finger must land at
            // once or the content trails the pointer. No `will-change: transform`: it pins the
            // raster at the first scale and an SVG would blur when zoomed.
            transition: animated ? 'transform 180ms ease-out' : 'none',
          }}
          className={scale > 1 ? 'cursor-grab active:cursor-grabbing' : undefined}
        >
          {children}
        </div>
      </div>

      <button
        type="button"
        data-lightbox-control
        onPointerDown={keepInside}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label={t('lightbox.close')}
        // The inset rides the OFFSET, not the layer's padding: an absolutely positioned box is
        // placed against its containing block's padding EDGE, which padding does not move — measured,
        // the layer's padding went 0 -> 47px and this button stayed at y=16, inside the band. `1rem`
        // is the `top-4 right-4` it replaces, kept as the breathing room inside the band edge, and it
        // is 0 pixels of change wherever there is no inset (every desktop and every non-PWA window).
        className="absolute right-[calc(1rem+var(--safe-area-inset-right))] top-[calc(1rem+var(--safe-area-inset-top))] rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>

      <div
        data-lightbox-control
        onPointerDown={keepInside}
        onClick={keepInside}
        // Centred with auto margins, NOT `left-1/2 -translate-x-1/2`: on a touch screen index.css
        // gives a hovered (i.e. tapped) button `transform: inherit !important`, so a button inside a
        // translated parent inherits the parent's percentage translate and jumps half its own width
        // out from under the finger between press and release — the click then misses it.
        className="absolute inset-x-0 bottom-[calc(1rem+var(--safe-area-inset-bottom))] mx-auto flex w-fit items-center gap-0.5 rounded-full bg-white/10 p-1 text-white"
      >
        <button type="button" onClick={zoomOut} disabled={!canZoomOut} aria-label={t('lightbox.zoomOut')} className={CONTROL_CLASS}>
          <Minus className="h-5 w-5" />
        </button>
        <span data-lightbox-zoom className="min-w-[3.25rem] text-center text-xs tabular-nums" aria-hidden="true">{percent}%</span>
        <button type="button" onClick={zoomIn} disabled={!canZoomIn} aria-label={t('lightbox.zoomIn')} className={CONTROL_CLASS}>
          <Plus className="h-5 w-5" />
        </button>
        <button type="button" onClick={fit} aria-label={t('lightbox.fit')} className={CONTROL_CLASS}>
          <Maximize2 className="h-5 w-5" />
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
