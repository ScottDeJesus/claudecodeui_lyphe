import * as React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { FOCUSABLE_SELECTOR } from '@/shared/constants';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import { OWNS_ESCAPE, modalInFrontHoldsEscape } from '@/shared/ui/overlayEscape';

type SheetProps = {
  open: boolean;
  onClose: () => void;
  /** The serif heading. */
  title: string;
  /** A word after the title, set in italic accent ink — "Mute *this check*". */
  titleAccent?: string;
  /** The action row pinned under the body; omitted, the sheet has no footer. */
  footer?: React.ReactNode;
  /** Any CSS width; the panel never outgrows the viewport at the default. */
  width?: string;
  children: React.ReactNode;
};

/**
 * Verve's `Sheet` (`_ds_bundle.js`, components/overlays/Sheet.jsx): a panel pinned to the right edge
 * over a scrim, for a detail that belongs beside the screen rather than over it. Used by the cerberus
 * module's CheckSheet.
 *
 * Portalled into the host window's body exactly as `Dialog` is, and rendered ONLY while open — which
 * is what lets the root carry `OWNS_ESCAPE` honestly (`overlayEscape.ts`): a `Dialog` opened before
 * this sheet stands down for it, so Escape closes the sheet first and the dialog on the next press.
 *
 * The keys are Dialog's rules from the other side. Escape listens on the host window's capture phase
 * and is marked (`preventDefault`) first, so the chat never also stops its running turn; then the
 * sheet asks whether a panel that owns the key — or a modal dialog — is drawn in front of it, and
 * stands down if so. A Select open in the footer closes on the first Escape, the Mute dialog opened
 * from the body closes on the first Escape, and the sheet on the next.
 *
 * Paint is `.vv-sheet*` in verve/panels.css, motion included; there is no exit animation, as with
 * Dialog — the panel is unmounted the moment `open` goes false.
 */
export function Sheet({ open, onClose, title, titleAccent, footer, width = 'min(600px, 100%)', children }: SheetProps) {
  const { t } = useTranslation('common');
  const hostWindow = useHostWindow();
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) return undefined;
    const hostDocument = hostWindow.document;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (modalInFrontHoldsEscape(panelRef.current, hostDocument)) return;
        event.stopPropagation();
        onClose();
        return;
      }

      // Tab cycles inside the panel: the scrim says the page behind is out of reach, so focus must
      // not walk off the last control into it.
      if (event.key === 'Tab' && panelRef.current) {
        const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && hostDocument.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && hostDocument.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    hostWindow.addEventListener('keydown', handleKeyDown, true);
    return () => hostWindow.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onClose, hostWindow]);

  // Focus goes into the panel on open and back to what held it on close. A frame of the window the
  // reader is looking at, as Dialog does it, so a sheet raised from a floating window is not left
  // waiting on a frame that never comes.
  React.useEffect(() => {
    if (!open) return undefined;
    const hostDocument = hostWindow.document;
    const previous = hostDocument.activeElement as HTMLElement | null;
    const frame = hostWindow.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    });
    return () => {
      hostWindow.cancelAnimationFrame(frame);
      // Only when focus fell to `body` with the panel: focus already placed on a live element is a
      // choice made in the same commit (the Mute dialog taking it, say) and is not undone here.
      const active = hostDocument.activeElement;
      if (active === null || active === hostDocument.body) previous?.focus();
    };
  }, [open, hostWindow]);

  if (!open) return null;

  return createPortal(
    <div className="vv-sheet fixed inset-0 z-50" {...OWNS_ESCAPE}>
      <div className="vv-sheet__scrim absolute inset-0" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="vv-sheet__panel absolute inset-y-0 right-0 flex max-w-full flex-col"
        style={{ width }}
      >
        <div className="vv-sheet__head flex items-center justify-between gap-3">
          {/* `min-w-0` lets the title shrink inside the flex head, and `.vv-sheet__title` breaks an
              unbroken id anywhere: without both, a long `snake_case` title widens the head and pushes
              the ✕ off the panel, which on a phone is the only way left to close it. */}
          <h2 id={titleId} className="vv-sheet__title m-0 min-w-0">
            {title}
            {titleAccent ? <> <em className="vv-sheet__accent">{titleAccent}</em></> : null}
          </h2>
          <button
            type="button"
            className="vv-sheet__close flex shrink-0 items-center justify-center"
            onClick={onClose}
            aria-label={t('buttons.close')}
          >
            ✕
          </button>
        </div>
        <div className="vv-sheet__body min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <div className="vv-sheet__foot flex justify-end gap-2.5">{footer}</div> : null}
      </div>
    </div>,
    hostWindow.document.body,
  );
}
