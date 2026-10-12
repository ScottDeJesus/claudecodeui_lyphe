import { useId, type AriaAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/Dialog';
import { cn } from '@/shared/utils';

/** The two widths a framed dialog comes in, the prototype's own: 520 for a short form, 600 for a long one. */
const WIDTH = { md: 'max-w-[520px]', lg: 'max-w-[600px]' } as const;

type DialogFrameProps = {
  size: keyof typeof WIDTH;
  /** The serif heading's first words: "Mute", "Enroll a". */
  title: string;
  /**
   * What the dialog is about, after the title: words in the accent's italic ("*session is valid*", "*node*"), or
   * a raw key in mono, upright, while the thing it names has no name of its own. Omitted, the title stands alone.
   */
  accent?: { words: string } | { key: string };
  /** A write is out: the ✕ waits with the dialog's own buttons. */
  busy?: boolean;
  /** Escape, the backdrop and the ✕. The dialog decides whether that closes it. */
  onDismiss: () => void;
  children: ReactNode;
} & Omit<AriaAttributes, 'aria-labelledby'> & {
  /** A `data-*` for the panel — what a verify script finds this dialog by. The title names it, so `aria-labelledby` is the frame's alone. */
  [name: `data-${string}`]: string | undefined;
};

/**
 * Verve's `Modal` (`_ds_bundle.js`, components/overlays/Modal.jsx), composed on the house `Dialog`: a panel 520 or
 * 600 wide, never wider than the screen less a margin, with the serif title and its accent word at the top and the
 * round ✕ in the top right corner. The panel scrolls as a whole on a screen too short for it, so a step never hides
 * its own buttons. Whatever `data-*` or `aria-*` the caller passes lands on the panel.
 *
 * Mounted only while its dialog is open, so the dialog opens clean every time and the house Dialog's own Escape,
 * backdrop, focus trap and first focus all hold. The ✕ comes LAST in the panel's order though it is drawn first: the
 * first focus then lands on the dialog's first field or chip, not on the way out, and Escape still closes from
 * anywhere. The ✕ is 32 px on a desk and 44 px below md, Verve's touch minimum.
 *
 * Paint is `.vv-dialogframe*` in verve/panels.css; the panel's own width and scroll are layout, spelled here. A kit
 * piece rather than the cerberus module's own because Verve draws it (MAN-571), and every dialog it frames is a
 * screen composing it (MAN-575).
 *
 * Used by the cerberus module's `MuteDialog` and `EnrollDialog` at their widths, by its `PromoteDialog` at the 600,
 * the nearer of the two to the prototype's 580, and by its `UpdateWardensDialog` at 600, the prototype's own.
 */
export function DialogFrame({ size, title, accent, busy = false, onDismiss, children, ...rest }: DialogFrameProps) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onDismiss(); }}>
      <DialogContent
        {...rest}
        aria-labelledby={titleId}
        className={cn('max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain p-0', WIDTH[size])}
      >
        <div className="vv-dialogframe">
          {/* `DialogTitle` is `sr-only` until `not-sr-only` takes that back. `pr-12` keeps a long title clear of the ✕. */}
          <DialogTitle id={titleId} className="vv-dialogframe__title not-sr-only mb-3 pr-12">
            {title}
            {accent !== undefined && (
              <>
                {' '}
                {'words' in accent
                  ? <em className="vv-dialogframe__accent">{accent.words}</em>
                  : <span className="vv-dialogframe__key font-mono">{accent.key}</span>}
              </>
            )}
          </DialogTitle>
          {children}
          <button
            type="button"
            aria-label={t('buttons.close')}
            disabled={busy}
            onClick={onDismiss}
            className="vv-dialogframe__close flex items-center justify-center"
          >
            ✕
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
